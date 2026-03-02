import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { createStorageAdapter, type StorageAdapter } from '@agent-relay/storage/adapter';
import { UserBridge } from './services/user-bridge.js';
import { detectWorkspacePath } from '@agent-relay/config';
import { BrokerSpawnReader } from './services/broker-spawn-reader.js';
import type { RelayAdapter } from '@agent-relay/sdk';

import type { DashboardOptions } from './types/index.js';
import {
  startCLIAuth,
  getAuthSession,
  cancelAuthSession,
  submitAuthCode,
  completeAuthSession,
  getSupportedProviders,
} from './lib/cli-auth.js';
import { createServerState, type BrokerRelayClientShim } from './lib/server-state.js';
import { createBroadcasters } from './lib/broadcast.js';
import { createDataAssembly } from './lib/data-assembly.js';
import { createChannelPersistence } from './lib/channel-state.js';
import { setupWebSocketRuntime } from './lib/websocket-runtime.js';
import { initializeAttachmentStorage } from './lib/attachment-storage.js';
import { setupMainWebSocket } from './websocket/main.js';
import { setupBridgeWebSocket } from './websocket/bridge.js';
import { setupLogsWebSocket } from './websocket/logs.js';
import { setupPresenceWebSocket } from './websocket/presence.js';
import { registerMessagingRoutes } from './routes/messaging.js';
import { registerHistoryRoutes } from './routes/history.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerDecisionsRoutes, type Decision } from './routes/decisions.js';
import { registerTasksRoutes, type TaskAssignment } from './routes/tasks.js';
import { registerFleetRoutes } from './routes/fleet.js';
import { registerSpawnRoutes } from './routes/spawn.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerChannelsIntegratedRoutes } from './routes/channels-integrated.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerUiRoutes } from './routes/ui.js';
import {
  getBindHost,
  isAgentOnline as checkAgentOnline,
  isRecipientOnline as checkRecipientOnline,
  getTeamMembers as resolveTeamMembers,
  isValidUsername,
  isValidAvatarUrl,
} from './lib/utils.js';

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  /** Absolute file path for agents to read the file directly */
  filePath?: string;
  width?: number;
  height?: number;
  data?: string;
}

export async function startDashboard(port: number, dataDir: string, teamDir: string, dbPath?: string): Promise<number>;
export async function startDashboard(options: DashboardOptions): Promise<number>;
export async function startDashboard(
  portOrOptions: number | DashboardOptions,
  dataDirArg?: string,
  teamDirArg?: string,
  dbPathArg?: string
): Promise<number> {
  // Handle overloaded signatures
  const options: DashboardOptions = typeof portOrOptions === 'number'
    ? { port: portOrOptions, dataDir: dataDirArg!, teamDir: teamDirArg!, dbPath: dbPathArg }
    : portOrOptions;

  const { port, dataDir, teamDir, dbPath, enableSpawner, projectRoot, tmuxSession, onMarkSpawning, onClearSpawning, verbose } = options;
  let { relayAdapter } = options;

  // Auto-create a RelayAdapter when projectRoot is available and no adapter is passed.
  // This makes the dashboard self-contained — `relay-dashboard-server --integrated --project-root .`
  // works without the CLI.
  if (!relayAdapter && enableSpawner && projectRoot) {
    try {
      const brokerSdk = await import('@agent-relay/sdk');
      relayAdapter = new brokerSdk.RelayAdapter({
        cwd: projectRoot,
        clientName: 'dashboard',
      });
      console.log('[dashboard] Auto-created RelayAdapter for broker mode');
    } catch {
      // Ignore import failures here and throw a clear error below.
    }
  }

  if (!relayAdapter) {
    throw new Error('[dashboard] RelayAdapter is required (legacy daemon relay-client mode has been removed)');
  }

  // Debug logging helper - only logs when verbose is true or VERBOSE env var is set
  const isVerbose = verbose || process.env.VERBOSE === 'true';
  const debug = (message: string) => {
    if (isVerbose) {
      console.log(message);
    }
  };

  console.log('[dashboard] Starting dashboard...');

  const disableStorage = process.env.RELAY_DISABLE_STORAGE === 'true';
  // Use createStorageAdapter to match daemon's storage type (JSONL by default)
  // This ensures dashboard reads from the same storage as daemon writes to
  // Enable watchForChanges so JSONL adapter auto-reloads when daemon writes new messages
  const storagePath = dbPath ?? path.join(dataDir, 'messages.sqlite');
  const storage: StorageAdapter | undefined = disableStorage
    ? undefined
    : await createStorageAdapter(storagePath, { watchForChanges: true });

  const defaultWorkspaceId = process.env.RELAY_WORKSPACE_ID ?? process.env.AGENT_RELAY_WORKSPACE_ID;

  const {
    loadChannelRecords,
    loadPersistedChannelsForUser,
    persistChannelMembershipEvent,
  } = createChannelPersistence({
    storage,
    defaultWorkspaceId,
  });

  // Initialize spawner if enabled
  // When projectRoot is explicitly provided (e.g., via --project-root), use it directly.
  // Only use detectWorkspacePath for cloud workspace auto-detection when no explicit root is given.
  // This fixes #380: detectWorkspacePath could re-resolve projectRoot incorrectly when
  // tool directories like ~/.nvm contain package.json markers.
  const workspacePath = projectRoot || detectWorkspacePath(dataDir);
  console.log(`[dashboard] Workspace path: ${workspacePath}`);

  // SpawnReader is now always broker-backed.
  const brokerSpawnReader = new BrokerSpawnReader(relayAdapter);
  await relayAdapter.start();
  await brokerSpawnReader.initialize();
  const spawnReader = brokerSpawnReader;
  console.log('[dashboard] Using broker adapter for spawn operations');

  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  const app = express();
  const server = http.createServer(app);

  // Use noServer mode to manually route upgrade requests
  // This prevents the bug where multiple WebSocketServers attached to the same
  // HTTP server cause conflicts - each one's upgrade handler fires and the ones
  // that don't match the path call abortHandshake(400), writing raw HTTP to the socket
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    skipUTF8Validation: true,
    maxPayload: 100 * 1024 * 1024 // 100MB
  });
  const wssBridge = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    skipUTF8Validation: true,
    maxPayload: 100 * 1024 * 1024
  });
  const wssLogs = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    skipUTF8Validation: true,
    maxPayload: 100 * 1024 * 1024
  });
  const wssPresence = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    skipUTF8Validation: true,
    maxPayload: 1024 * 1024 // 1MB - presence messages are small
  });

  // Track online users for presence with multi-tab support
  // username -> { connections: Set<WebSocket>, userInfo }
  interface UserPresenceInfo {
    username: string;
    avatarUrl?: string;
    connectedAt: string;
    lastSeen: string;
  }
  interface UserPresenceState {
    info: UserPresenceInfo;
    connections: Set<WebSocket>;
  }

  const state = createServerState({
    dataDir,
    teamDir,
    projectRoot,
    verbose: isVerbose,
    defaultWorkspaceId,
    storage,
    relayAdapter,
    spawnReader,
    wss,
    wssBridge,
    wssLogs,
    wssPresence,
  });
  const logSubscriptions = state.logSubscriptions;
  const fileWatchers = state.fileWatchers;
  const fileLastSize = state.fileLastSize;
  const mainMessageBuffer = state.mainMessageBuffer;
  const agentLogBuffers = state.agentLogBuffers;
  const getAgentLogBuffer = state.getAgentLogBuffer;
  const mainClientAlive = state.mainClientAlive;
  const bridgeClientAlive = state.bridgeClientAlive;
  const onlineUsers = state.onlineUsers as Map<string, UserPresenceState>;
  const agentCwdMap = state.agentCwdMap;
  const resolveWorkspaceId = state.resolveWorkspaceId;

  setupWebSocketRuntime({
    server,
    wss,
    wssBridge,
    wssLogs,
    wssPresence,
    mainClientAlive,
    bridgeClientAlive,
    debug,
  });

  if (storage) {
    await storage.init();
  }

  // Request logger for debugging
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/channels')) {
      console.log(`[dashboard] ${req.method} ${req.path} - incoming request`);
    }
    next();
  });

  // Increase JSON body limit for base64 image uploads (10MB)
  app.use(express.json({ limit: '10mb' }));

  const { attachmentsDir, uploadsDir, stopEviction } = initializeAttachmentStorage(dataDir);
  process.on('beforeExit', stopEviction);

  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadsDir));
  // Serve attachments from ~/.relay/attachments
  app.use('/attachments', express.static(attachmentsDir));

  // In-memory attachment registry (for current session)
  // Attachments are also stored on disk, so this is just for quick lookups
  const attachmentRegistry = state.attachmentRegistry as Map<string, Attachment>;

  registerUiRoutes(app);

  // Relay clients for sending messages from dashboard are broker-backed shims.
  // Forward declaration - initialized after helper factories.
  let userBridge: UserBridge | undefined;

  const getRelayClient = async (
    senderName: string = 'Dashboard',
    _entityType?: 'agent' | 'user'
  ): Promise<BrokerRelayClientShim> => {
    return state.getBrokerClientShim(senderName);
  };

  userBridge = new UserBridge({
    createRelayClient: async (options: {
      agentName: string;
      entityType: 'user';
      displayName?: string;
      avatarUrl?: string;
    }) => {
      return getRelayClient(options.agentName, options.entityType);
    },
    loadPersistedChannels: (username: string) =>
      loadPersistedChannelsForUser(username, defaultWorkspaceId),
    lookupUserInfo: (username: string) => {
      const presence = onlineUsers.get(username);
      if (presence) {
        return { avatarUrl: presence.info.avatarUrl };
      }
      return undefined;
    },
  });

  const isAgentOnline = (agentName: string): boolean => checkAgentOnline(teamDir, agentName);
  const isRecipientOnline = (name: string): boolean => checkRecipientOnline(teamDir, name, onlineUsers, userBridge);
  const getTeamMembers = (teamName: string): string[] =>
    resolveTeamMembers(teamName, projectRoot, dataDir, teamDir, spawnReader);

  const {
    getAllData,
    getBridgeData,
    isInternalAgent,
    remapAgentName,
    buildThreadSummaryMap,
    formatDuration,
  } = createDataAssembly({
    dataDir,
    teamDir,
    projectRoot,
    defaultWorkspaceId,
    storage,
    spawnReader,
    onlineUsers,
    agentCwdMap,
    debug,
  });

  registerHistoryRoutes(app, {
    storage,
    formatDuration,
    isInternalAgent,
    remapAgentName,
  });

  // Track clients that are still initializing (haven't received first data yet)
  // This prevents race conditions where broadcastData sends before initial data is sent
  const initializingClients = state.initializingClients;

  const { broadcastData, broadcastBridgeData, broadcastPresence, broadcastLogOutput } =
    createBroadcasters(state, { getAllData, getBridgeData, debug });

  registerMessagingRoutes(app, {
    getTeamMembers,
    isAgentOnline,
    isRecipientOnline,
    getRelayClient,
    attachmentRegistry,
    attachmentsDir,
    broadcastData,
  });

  // Expose broadcastLogOutput for PTY wrappers to call.
  (global as any).__broadcastLogOutput = broadcastLogOutput;

  // Handle new WebSocket connections - send initial data immediately.
  setupMainWebSocket({
    wss,
    mainClientAlive,
    mainMessageBuffer,
    initializingClients,
    getAllData,
    debug,
  });

  // Handle bridge WebSocket connections.
  setupBridgeWebSocket({
    wssBridge,
    bridgeClientAlive,
    getBridgeData,
    debug,
  });

  setupLogsWebSocket({
    wssLogs,
    teamDir,
    debug,
    logSubscriptions,
    fileWatchers,
    fileLastSize,
    agentLogBuffers,
    getAgentLogBuffer,
    spawnReader,
  });

  // ===== Presence WebSocket Handler =====
  const { broadcastChannelMessage, broadcastDirectMessage } = setupPresenceWebSocket({
    wss,
    wssPresence,
    mainMessageBuffer,
    onlineUsers,
    presenceHealth: state.presenceHealth,
    broadcastPresence,
    isValidUsername,
    isValidAvatarUrl,
    getUserBridge: () => userBridge,
    debug,
  });

  relayAdapter.onEvent((event) => {
    if (event.kind === 'relay_inbound') {
      const senderPresence = onlineUsers.get(event.from);
      const fromAvatarUrl = senderPresence?.info.avatarUrl;
      const fromEntityType: 'user' | 'agent' = senderPresence ? 'user' : 'agent';
      const timestamp = new Date().toISOString();

      // Route to channel or direct message based on target.
      if (event.target.startsWith('#')) {
        broadcastChannelMessage({
          type: 'channel_message',
          targetUser: event.target,
          channel: event.target,
          from: event.from,
          fromAvatarUrl,
          fromEntityType,
          body: event.body,
          thread: event.thread_id,
          timestamp,
        });
      } else {
        broadcastDirectMessage({
          type: 'direct_message',
          targetUser: event.target,
          from: event.from,
          fromAvatarUrl,
          fromEntityType,
          body: event.body,
          id: event.event_id,
          messageId: event.event_id,
          timestamp,
        });
      }
    }
  });
  console.log('[dashboard] Broker event subscription active for message forwarding');

  registerChannelsIntegratedRoutes(app, {
    storage,
    teamDir,
    attachmentRegistry,
    onlineUsers,
    userBridge,
    spawnReader,
    resolveWorkspaceId,
    loadChannelRecords,
    persistChannelMembershipEvent,
    getRelayClient,
    buildThreadSummaryMap,
    isInternalAgent,
    getAllData,
  });

  registerAuthRoutes(app, {
    startCLIAuth,
    getAuthSession,
    cancelAuthSession,
    submitAuthCode,
    completeAuthSession,
    getSupportedProviders,
  });

  registerMetricsRoutes(app, {
    teamDir,
    spawnReader,
    resolveWorkspaceId,
  });
  registerSystemRoutes(app, {
    dataDir,
    teamDir,
    projectRoot,
    resolveWorkspaceId,
    getRelayClient,
  });

  registerSpawnRoutes(app, {
    dataDir,
    projectRoot,
    relayAdapter,
    spawnReader,
    agentCwdMap,
    isAgentOnline,
    resolveWorkspaceId,
    broadcastData,
    broadcastPresence,
  });

  registerSettingsRoutes(app);

  const decisions = state.decisions as Map<string, Decision>;
  registerDecisionsRoutes(app, {
    decisions,
    getRelayClient,
    broadcastData,
  });

  const tasks = state.tasks as Map<string, TaskAssignment>;
  registerTasksRoutes(app, {
    tasks,
    getRelayClient,
    broadcastData,
  });
  registerFleetRoutes(app, {
    dataDir,
    spawnReader,
    wss,
    decisions,
    tasks,
  });

  // Watch for changes - poll as a safety net for DB-backed storage mode.
  // Real-time updates are already handled by explicit broadcastData() calls
  // at every data mutation point (message send, spawn, release, cwd update, etc.).
  // This interval only catches external/indirect changes (presence, DB edits).
  if (storage) {
    setInterval(() => {
      broadcastData().catch((err) => console.error('Broadcast failed', err));
      broadcastBridgeData().catch((err) => console.error('Bridge broadcast failed', err));
    }, 5000);
  } else {
    let fsWait: NodeJS.Timeout | null = null;
    let bridgeFsWait: NodeJS.Timeout | null = null;
    try {
      if (fs.existsSync(dataDir)) {
          console.log(`Watching ${dataDir} for changes...`);
          fs.watch(dataDir, { recursive: true }, (eventType, filename) => {
              if (filename && (filename.endsWith('inbox.md') || filename.endsWith('team.json') || filename.endsWith('agents.json') || filename.endsWith('processing-state.json'))) {
                  // Debounce
                  if (fsWait) return;
                  fsWait = setTimeout(() => {
                      fsWait = null;
                      broadcastData().catch((err) => {
                        console.error('Broadcast failed', err);
                      });
                  }, 100);
              }
              // Watch for bridge state changes
              if (filename && filename.endsWith('bridge-state.json')) {
                  if (bridgeFsWait) return;
                  bridgeFsWait = setTimeout(() => {
                      bridgeFsWait = null;
                      broadcastBridgeData().catch((err) => {
                        console.error('Bridge broadcast failed', err);
                      });
                  }, 100);
              }
          });
      } else {
          console.warn(`Data directory ${dataDir} does not exist yet.`);
      }
    } catch (e) {
      console.error('Watch failed:', e);
    }
  }

  // Try to find an available port, starting from the requested port
  const findAvailablePort = async (startPort: number, maxAttempts = 10): Promise<number> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const portToTry = startPort + attempt;
      const isAvailable = await new Promise<boolean>((resolve) => {
        const testServer = http.createServer();
        testServer.once('error', () => resolve(false));
        testServer.once('listening', () => {
          testServer.close();
          resolve(true);
        });
        testServer.listen(portToTry);
      });

      if (isAvailable) {
        return portToTry;
      }
      console.log(`Port ${portToTry} in use, trying ${portToTry + 1}...`);
    }
    throw new Error(`Could not find available port after trying ${startPort}-${startPort + maxAttempts - 1}`);
  };

  const availablePort = await findAvailablePort(port);
  if (availablePort !== port) {
    console.log(`Requested dashboard port ${port} is busy; switching to ${availablePort}.`);
  }

  return new Promise((resolve, reject) => {
    const host = getBindHost();
    const listenCallback = async () => {
      console.log(`Dashboard running at http://${host || 'localhost'}:${availablePort} (build: cloud-channels-v2)`);
      console.log(`Monitoring: ${dataDir}`);

      // Health and spawned status are now pass-through broker/cloud proxies.

      resolve(availablePort);
    };

    // Bind to specified host in cloud environments, or let Node.js default for local
    if (host) {
      server.listen(availablePort, host, listenCallback);
    } else {
      server.listen(availablePort, listenCallback);
    }

    server.on('error', (err) => {
      console.error('Server error:', err);
      reject(err);
    });
  });
}
