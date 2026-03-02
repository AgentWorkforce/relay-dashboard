import fs from 'fs';
import type { WebSocketServer, WebSocket } from 'ws';
import type { StorageAdapter } from '@agent-relay/storage/adapter';
import type { RelayAdapter } from '@agent-relay/sdk';
import { MessageBuffer } from '../messageBuffer.js';

export interface ResolveWorkspaceRequest {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

export interface SpawnWorkerLike {
  name: string;
  cli: string;
  task: string;
  team?: string;
  spawnerName?: string;
  spawnedAt: number;
  pid?: number;
}

export interface SpawnReaderLike {
  getActiveWorkers(): SpawnWorkerLike[];
  hasWorker(name: string): boolean;
  getWorkerOutput(name: string, limit?: number): string[] | undefined;
  getWorkerRawOutput(name: string): string | undefined;
  sendWorkerInput(name: string, data: string): Promise<boolean>;
}

type BrokerShimSpawnRequest = {
  name: string;
  cli: string;
  task?: string;
  team?: string;
  cwd?: string;
  interactive?: boolean;
  shadowMode?: string;
  shadowAgent?: string;
  shadowOf?: string;
  shadowTriggers?: string;
  shadowSpeakOn?: string;
  spawnerName?: string;
  userId?: string;
  includeWorkflowConventions?: boolean;
};

export type BrokerRelayClientShim = {
  state: 'READY';
  connect: () => Promise<void>;
  disconnect: () => void;
  sendMessage: (
    to: string,
    body: string,
    _kind?: string,
    data?: unknown,
    thread?: string
  ) => boolean;
  joinChannel: (channel: string, displayName?: string) => boolean;
  leaveChannel: (channel: string, reason?: string) => boolean;
  sendChannelMessage: (
    channel: string,
    body: string,
    options?: { thread?: string; mentions?: string[]; attachments?: unknown[]; data?: Record<string, unknown> }
  ) => boolean;
  adminJoinChannel: (channel: string, member: string) => boolean;
  adminRemoveMember: (channel: string, member: string) => boolean;
  spawn: (req: BrokerShimSpawnRequest) => Promise<unknown>;
  release: (name: string) => Promise<unknown>;
};

export interface ServerState<
  TPresenceState = unknown,
  TAttachment = unknown,
  TDecision = unknown,
  TTask = unknown,
> {
  config: {
    dataDir: string;
    teamDir: string;
    projectRoot?: string;
    verbose: boolean;
    defaultWorkspaceId?: string;
  };
  refs: {
    storage?: StorageAdapter;
    relayAdapter: RelayAdapter;
    spawnReader: SpawnReaderLike;
    wss: WebSocketServer;
    wssBridge: WebSocketServer;
    wssLogs: WebSocketServer;
    wssPresence: WebSocketServer;
  };
  mainClientAlive: WeakMap<WebSocket, boolean>;
  bridgeClientAlive: WeakMap<WebSocket, boolean>;
  presenceHealth: WeakMap<WebSocket, { isAlive: boolean }>;
  mainMessageBuffer: MessageBuffer;
  agentLogBuffers: Map<string, MessageBuffer>;
  logSubscriptions: Map<string, Set<WebSocket>>;
  fileWatchers: Map<string, fs.FSWatcher>;
  fileLastSize: Map<string, number>;
  onlineUsers: Map<string, TPresenceState>;
  initializingClients: WeakSet<WebSocket>;
  attachmentRegistry: Map<string, TAttachment>;
  agentCwdMap: Map<string, string>;
  decisions: Map<string, TDecision>;
  tasks: Map<string, TTask>;
  brokerClientShimCache: Map<string, BrokerRelayClientShim>;
  getAgentLogBuffer: (agentName: string) => MessageBuffer;
  getBrokerClientShim: (senderName: string) => BrokerRelayClientShim;
  resolveWorkspaceId: (req: ResolveWorkspaceRequest) => string | undefined;
}

export interface CreateServerStateOptions {
  dataDir: string;
  teamDir: string;
  projectRoot?: string;
  verbose: boolean;
  defaultWorkspaceId?: string;
  storage?: StorageAdapter;
  relayAdapter: RelayAdapter;
  spawnReader: SpawnReaderLike;
  wss: WebSocketServer;
  wssBridge: WebSocketServer;
  wssLogs: WebSocketServer;
  wssPresence: WebSocketServer;
}

const asString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.length > 0) return item;
    }
  }
  return undefined;
};

const getWorkspaceHeader = (headers: Record<string, unknown> | undefined): string | undefined => {
  if (!headers) return undefined;
  const direct = headers['x-workspace-id'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'x-workspace-id' && typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

export function createServerState(options: CreateServerStateOptions): ServerState {
  const {
    dataDir,
    teamDir,
    projectRoot,
    verbose,
    defaultWorkspaceId,
    storage,
    relayAdapter,
    spawnReader,
    wss,
    wssBridge,
    wssLogs,
    wssPresence,
  } = options;

  const brokerClientShimCache = new Map<string, BrokerRelayClientShim>();

  const getBrokerClientShim = (senderName: string): BrokerRelayClientShim => {
    let shim = brokerClientShimCache.get(senderName);
    if (!shim) {
      const sendViaBroker = (to: string, body: string, thread?: string, data?: Record<string, unknown>): boolean => {
        void relayAdapter.sendMessage({
          to,
          text: body,
          from: senderName,
          threadId: thread,
          data,
        }).catch((err) => {
          console.error(`[dashboard] Failed to send broker message from ${senderName} to ${to}:`, err);
        });
        return true;
      };

      shim = {
        state: 'READY',
        connect: async () => {},
        disconnect: () => {},
        sendMessage: (to: string, body: string, _kind?: string, data?: unknown, thread?: string) => {
          const typedData = (data && typeof data === 'object') ? data as Record<string, unknown> : undefined;
          return sendViaBroker(to, body, thread, typedData);
        },
        joinChannel: (_channel: string, _displayName?: string) => true,
        leaveChannel: (_channel: string, _reason?: string) => true,
        sendChannelMessage: (channel: string, body: string, options?: { thread?: string; mentions?: string[]; attachments?: unknown[]; data?: Record<string, unknown> }) => {
          const channelData: Record<string, unknown> = {
            ...(options?.data || {}),
            _isChannelMessage: true,
          };
          if (options?.mentions) channelData.mentions = options.mentions;
          if (options?.attachments) channelData.attachments = options.attachments;
          return sendViaBroker(channel, body, options?.thread, channelData);
        },
        adminJoinChannel: (_channel: string, _member: string) => true,
        adminRemoveMember: (_channel: string, _member: string) => true,
        spawn: async (req: BrokerShimSpawnRequest) => {
          return relayAdapter.spawn({
            name: req.name,
            cli: req.cli,
            task: req.task,
            team: req.team,
            cwd: req.cwd,
            interactive: req.interactive,
            shadowMode: req.shadowMode,
            shadowOf: req.shadowOf,
            spawnerName: req.spawnerName,
            userId: req.userId,
            includeWorkflowConventions: req.includeWorkflowConventions,
          });
        },
        release: async (name: string) => relayAdapter.release(name),
      };
      brokerClientShimCache.set(senderName, shim);
    }
    return shim;
  };

  const state: ServerState = {
    config: {
      dataDir,
      teamDir,
      projectRoot,
      verbose,
      defaultWorkspaceId,
    },
    refs: {
      storage,
      relayAdapter,
      spawnReader,
      wss,
      wssBridge,
      wssLogs,
      wssPresence,
    },
    mainClientAlive: new WeakMap<WebSocket, boolean>(),
    bridgeClientAlive: new WeakMap<WebSocket, boolean>(),
    presenceHealth: new WeakMap<WebSocket, { isAlive: boolean }>(),
    mainMessageBuffer: new MessageBuffer(500),
    agentLogBuffers: new Map<string, MessageBuffer>(),
    logSubscriptions: new Map<string, Set<WebSocket>>(),
    fileWatchers: new Map<string, fs.FSWatcher>(),
    fileLastSize: new Map<string, number>(),
    onlineUsers: new Map<string, unknown>(),
    initializingClients: new WeakSet<WebSocket>(),
    attachmentRegistry: new Map<string, unknown>(),
    agentCwdMap: new Map<string, string>(),
    decisions: new Map<string, unknown>(),
    tasks: new Map<string, unknown>(),
    brokerClientShimCache,
    getAgentLogBuffer: (agentName: string): MessageBuffer => {
      let buffer = state.agentLogBuffers.get(agentName);
      if (!buffer) {
        buffer = new MessageBuffer(200);
        state.agentLogBuffers.set(agentName, buffer);
      }
      return buffer;
    },
    getBrokerClientShim,
    resolveWorkspaceId: (req: ResolveWorkspaceRequest): string | undefined => {
      const fromQuery = asString(req.query?.workspaceId);
      const fromBody = asString(req.body?.workspaceId);
      const fromHeader = getWorkspaceHeader(req.headers);
      return fromQuery || fromBody || fromHeader || defaultWorkspaceId;
    },
  };

  return state;
}
