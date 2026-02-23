/**
 * Relay Dashboard Server
 *
 * A flexible server that can operate in three modes:
 * 1. Proxy mode (default): static files + Relaycast data + broker proxy
 * 2. Standalone mode: static files + Relaycast data (no broker proxy)
 * 3. Mock mode: fixture-backed standalone mode for demos/tests
 */

import fs from 'fs';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createServer as createHttpServer, type Server } from 'http';
import { createProxyMiddleware, type Options as ProxyOptions } from 'http-proxy-middleware';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerMockRoutes } from './mocks/routes.js';
import {
  mockAgents,
  mockMessages,
  mockSessions,
} from './mocks/fixtures.js';
import {
  fetchAgents,
  fetchAllMessages,
  fetchChannelMembers,
  fetchChannelMessages,
  fetchChannels,
  inviteToChannel,
  joinChannel,
  leaveChannel,
  sendMessage,
  setChannelArchived,
  createChannel,
  loadRelaycastConfig,
  type AgentStatus,
  type Message,
  type RelaycastConfig,
} from './relaycast-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHANTOM_OFFLINE_MAX_AGE_MS = 5 * 60 * 1000;
const STANDALONE_WS_POLL_MS = 3000;
const SPAWNED_CACHE_TTL_MS = 3000;
const WORKFLOW_BOOTSTRAP_TASK =
  'You are connected to Agent Relay. Wait for relay messages and respond using Relaycast MCP tools.';
const WORKFLOW_CONVENTIONS = [
  'Messaging requirements:',
  '- When you receive `Relay message from <sender> ...`, reply using `relay_send(to: "<sender>", message: "...")`.',
  '- Send `ACK: ...` when you receive a task.',
  '- Send `DONE: ...` when the task is complete.',
  '- Do not reply only in terminal text; send the response via relay_send.',
  '- Use relay_inbox() and relay_who() when context is missing.',
].join('\n');

type DashboardMode = 'proxy' | 'standalone' | 'mock';

interface DashboardSnapshot {
  agents: AgentStatus[];
  users: AgentStatus[];
  messages: Message[];
  activity: Message[];
  sessions: Array<Record<string, unknown>>;
  summaries: Array<Record<string, unknown>>;
}

interface DashboardChannel {
  id: string;
  name: string;
  description?: string;
  topic?: string;
  visibility: 'public' | 'private';
  status: 'active' | 'archived';
  createdAt: string;
  createdBy: string;
  memberCount: number;
  unreadCount: number;
  hasMentions: boolean;
  isDm: boolean;
}

interface FileSearchResult {
  path: string;
  name: string;
  isDirectory: boolean;
}

const EMPTY_DASHBOARD_SNAPSHOT: DashboardSnapshot = {
  agents: [],
  users: [],
  messages: [],
  activity: [],
  sessions: [],
  summaries: [],
};

const FILE_SEARCH_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.turbo',
  '.vercel',
  '.nuxt',
  '.output',
  'vendor',
  'target',
  '.idea',
  '.vscode',
]);

const FILE_SEARCH_IGNORE_PATTERNS = [
  /\.lock$/,
  /\.log$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.d\.ts$/,
  /\.pyc$/,
];

/**
 * Get the host to bind to.
 * In cloud environments, bind to '::' (IPv6 any) which also accepts IPv4 on dual-stack.
 * This is required for Fly.io's internal IPv6 network (6PN) connectivity.
 * Locally, let Node.js use its default behavior.
 */
function getBindHost(): string | undefined {
  if (process.env.BIND_HOST) {
    return process.env.BIND_HOST;
  }
  const isCloudEnvironment =
    process.env.FLY_APP_NAME ||
    process.env.WORKSPACE_ID ||
    process.env.RELAY_WORKSPACE_ID ||
    process.env.RUNNING_IN_DOCKER === 'true';
  return isCloudEnvironment ? '::' : undefined;
}

function normalizeRelayUrl(relayUrl: string | undefined): string | undefined {
  if (!relayUrl) return undefined;
  const trimmed = relayUrl.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

function withWorkflowConventions(
  task: string | undefined,
  includeWorkflowConventions: boolean,
): string | undefined {
  const normalized = typeof task === 'string' ? task.trim() : '';

  if (!includeWorkflowConventions) {
    return normalized.length > 0 ? normalized : undefined;
  }

  if (normalized.length === 0) {
    return `${WORKFLOW_BOOTSTRAP_TASK}\n\n${WORKFLOW_CONVENTIONS}`;
  }

  const lower = normalized.toLowerCase();
  const alreadyConfigured =
    lower.includes('relay_send(') || (lower.includes('ack:') && lower.includes('done:'));
  return alreadyConfigured ? normalized : `${normalized}\n\n${WORKFLOW_CONVENTIONS}`;
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function countOnlineAgents(agents: Array<{ status?: string }>): number {
  return agents.reduce((count, agent) => {
    return (agent.status ?? '').toLowerCase() === 'online' ? count + 1 : count;
  }, 0);
}

function normalizeAgentName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface SpawnedAgentNamesResult {
  names: Set<string>;
  hasSpawnedList: boolean;
}

function extractSpawnedAgentNames(payload: unknown): SpawnedAgentNamesResult {
  const names = new Set<string>();
  let hasSpawnedList = false;
  let candidates: unknown[] = [];

  const resolveCandidates = (value: unknown): unknown[] => {
    if (Array.isArray(value)) {
      hasSpawnedList = true;
      return value;
    }
    if (!isRecord(value)) {
      return [];
    }
    if (Array.isArray(value.agents)) {
      hasSpawnedList = true;
      return value.agents;
    }
    if (Array.isArray(value.workers)) {
      hasSpawnedList = true;
      return value.workers;
    }
    if (Array.isArray(value.spawned)) {
      hasSpawnedList = true;
      return value.spawned;
    }
    return [];
  };

  candidates = resolveCandidates(payload);
  if (candidates.length === 0 && isRecord(payload)) {
    candidates = resolveCandidates(payload.data);
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const name = normalizeAgentName(candidate);
      if (name) {
        names.add(name);
      }
      continue;
    }

    if (!isRecord(candidate)) {
      continue;
    }

    const name = typeof candidate.name === 'string'
      ? candidate.name
      : (typeof candidate.id === 'string' ? candidate.id : '');

    const normalized = normalizeAgentName(name);
    if (normalized) {
      names.add(normalized);
    }
  }

  return { names, hasSpawnedList };
}

function normalizeChannelTarget(channel: string): string {
  const trimmed = channel.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('#') || trimmed.startsWith('dm:')) {
    return trimmed;
  }
  return `#${trimmed}`;
}

function normalizeChannelName(channel: string): string {
  const target = normalizeChannelTarget(channel);
  if (target.startsWith('#')) {
    return target.slice(1);
  }
  return target;
}

function parseInviteMembers(invites: unknown): Array<{ id: string; type: 'user' | 'agent' }> {
  if (typeof invites === 'string') {
    return invites
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((id) => ({ id, type: 'agent' as const }));
  }

  if (Array.isArray(invites)) {
    return invites
      .map((item) => {
        if (typeof item === 'string') {
          const id = item.trim();
          return id ? { id, type: 'agent' as const } : null;
        }

        if (!isRecord(item) || typeof item.id !== 'string') {
          return null;
        }

        const id = item.id.trim();
        if (!id) {
          return null;
        }

        const type = item.type === 'user' ? 'user' : 'agent';
        return { id, type };
      })
      .filter((item): item is { id: string; type: 'user' | 'agent' } => item !== null);
  }

  return [];
}

async function searchFiles(rootDir: string, query: string, limit: number): Promise<FileSearchResult[]> {
  const results: FileSearchResult[] = [];
  const normalizedQuery = query.trim().toLowerCase();

  const shouldIgnore = (name: string, isDirectory: boolean): boolean => {
    if (isDirectory) {
      return FILE_SEARCH_IGNORE_DIRS.has(name);
    }
    return FILE_SEARCH_IGNORE_PATTERNS.some((pattern) => pattern.test(name));
  };

  const matches = (relativePath: string, name: string): boolean => {
    if (!normalizedQuery) return true;
    const lowerPath = relativePath.toLowerCase();
    const lowerName = name.toLowerCase();

    if (normalizedQuery.includes('/')) {
      return lowerPath.includes(normalizedQuery);
    }

    return lowerName.includes(normalizedQuery) || lowerPath.includes(normalizedQuery);
  };

  const visit = async (dir: string, relativePath = ''): Promise<void> => {
    if (results.length >= limit) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (results.length >= limit) break;
      if (shouldIgnore(entry.name, entry.isDirectory())) continue;

      const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (matches(entryPath, entry.name)) {
        results.push({
          path: entryPath,
          name: entry.name,
          isDirectory: entry.isDirectory(),
        });
      }

      if (entry.isDirectory()) {
        await visit(path.join(dir, entry.name), entryPath);
      }
    }
  };

  await visit(rootDir);
  return results;
}

function mapChannelForDashboard(channel: {
  id: string;
  name: string;
  topic: string | null;
  member_count: number;
  created_at: string;
  is_archived: boolean;
}): DashboardChannel {
  const channelId = channel.name.startsWith('#') ? channel.name : `#${channel.name}`;

  return {
    id: channelId,
    name: channel.name,
    description: channel.topic ?? undefined,
    topic: channel.topic ?? undefined,
    visibility: 'public',
    status: channel.is_archived ? 'archived' : 'active',
    createdAt: channel.created_at,
    createdBy: 'system',
    memberCount: channel.member_count ?? 0,
    unreadCount: 0,
    hasMentions: false,
    isDm: channel.name.startsWith('dm:'),
  };
}

function sendHtmlFileOrFallback(
  res: Response,
  filePath: string,
  fallbackHtml?: string,
  statusIfMissing = 404,
): void {
  if (fs.existsSync(filePath)) {
    res.sendFile(path.resolve(filePath));
    return;
  }

  if (fallbackHtml) {
    res.type('html').send(fallbackHtml);
    return;
  }

  res.status(statusIfMissing).json({ error: 'Not found' });
}

export interface DashboardServerOptions {
  /** Port to listen on (default: 3888) */
  port?: number;
  /** Relay daemon URL for broker proxy mode */
  relayUrl?: string;
  /** Path to static files directory (default: ../out) */
  staticDir?: string;
  /** Data directory containing relaycast.json credentials */
  dataDir?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Run in mock mode (no relay daemon required) */
  mock?: boolean;
  /** CORS allowed origins (comma-separated, or '*' for all) */
  corsOrigins?: string;
  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout?: number;
}

export interface DashboardServer {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
  mode: DashboardMode;
}

/**
 * Create the dashboard server without starting it
 */
export function createServer(options: DashboardServerOptions = {}): DashboardServer {
  const {
    relayUrl: relayUrlOption,
    staticDir = process.env.STATIC_DIR || path.join(__dirname, '..', 'out'),
    dataDir = process.env.DATA_DIR || path.join(process.cwd(), '.agent-relay'),
    verbose = process.env.VERBOSE === 'true',
    mock = process.env.MOCK === 'true',
    corsOrigins = process.env.CORS_ORIGINS || '',
    requestTimeout = parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
  } = options;

  const relayUrl = normalizeRelayUrl(relayUrlOption ?? process.env.RELAY_URL);
  const mode: DashboardMode = mock ? 'mock' : (relayUrl ? 'proxy' : 'standalone');
  const brokerProxyEnabled = mode === 'proxy' && Boolean(relayUrl);

  const app = express();
  const server = createHttpServer(app);
  server.timeout = requestTimeout;

  app.use(express.json({ limit: '10mb' }));

  if (corsOrigins) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;

      if (corsOrigins === '*') {
        res.header('Access-Control-Allow-Origin', '*');
      } else if (origin) {
        const allowedOrigins = corsOrigins.split(',').map((value) => value.trim());
        if (allowedOrigins.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
        }
      }

      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Expose-Headers', 'X-CSRF-Token');

      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }

      next();
    });
  }

  if (verbose) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[dashboard] ${req.method} ${req.url}`);
      next();
    });
  }

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'relay-dashboard',
      mode,
      uptime: process.uptime(),
      brokerProxyEnabled,
    });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'relay-dashboard',
      mode,
      uptime: process.uptime(),
      brokerProxyEnabled,
    });
  });

  app.get('/keep-alive', async (_req: Request, res: Response) => {
    let activeAgentCount = 0;

    if (mode === 'mock') {
      activeAgentCount = countOnlineAgents(mockAgents);
    } else {
      try {
        const snapshot = await getRelaycastSnapshot();
        activeAgentCount = countOnlineAgents(snapshot.agents);
      } catch {
        activeAgentCount = 0;
      }
    }

    res.json({
      ok: true,
      mode,
      timestamp: Date.now(),
      activeAgentCount,
    });
  });

  if (!mock) {
    app.get('/api/workspaces/primary', (_req: Request, res: Response) => {
      res.json({
        success: true,
        data: {
          exists: false,
          statusMessage: 'Running locally',
          workspace: null,
        },
      });
    });

    app.get('/api/usage', (_req: Request, res: Response) => {
      res.json({ success: true, data: null });
    });
  }

  let spawnedAgentsCache: { expiresAt: number; names: Set<string> | null } = {
    expiresAt: 0,
    names: null,
  };

  const resolveRelaycastConfig = (): RelaycastConfig | null => loadRelaycastConfig(dataDir);

  const getSpawnedAgentNames = async (): Promise<Set<string> | null> => {
    if (!brokerProxyEnabled || !relayUrl) {
      return null;
    }

    const now = Date.now();
    if (spawnedAgentsCache.expiresAt > now) {
      return spawnedAgentsCache.names;
    }

    try {
      const response = await fetch(`${relayUrl}/api/spawned`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        if (verbose) {
          console.warn(`[dashboard] Failed to fetch /api/spawned from broker: ${response.status}`);
        }
        spawnedAgentsCache = {
          expiresAt: now + SPAWNED_CACHE_TTL_MS,
          names: null,
        };
        return null;
      }

      const payload = await response.json() as unknown;
      const { names, hasSpawnedList } = extractSpawnedAgentNames(payload);
      const resolvedNames = hasSpawnedList ? names : null;

      if (!hasSpawnedList && verbose) {
        console.warn('[dashboard] /api/spawned payload missing agents/workers list; skipping phantom cross-reference');
      }

      spawnedAgentsCache = {
        expiresAt: now + SPAWNED_CACHE_TTL_MS,
        names: resolvedNames,
      };
      return resolvedNames;
    } catch (err) {
      if (verbose) {
        console.warn('[dashboard] Failed to fetch /api/spawned from broker:', (err as Error).message);
      }
      spawnedAgentsCache = {
        expiresAt: now + SPAWNED_CACHE_TTL_MS,
        names: null,
      };
      return null;
    }
  };

  const filterPhantomAgents = (agents: AgentStatus[], spawnedAgentNames: Set<string> | null): AgentStatus[] => {
    const now = Date.now();

    return agents.filter((agent) => {
      const status = (agent.status ?? '').toLowerCase();
      const lastSeenTs = parseTimestamp(agent.lastSeen ?? agent.lastActive);

      if (status === 'offline' && lastSeenTs !== null && (now - lastSeenTs) > PHANTOM_OFFLINE_MAX_AGE_MS) {
        return false;
      }

      if (spawnedAgentNames !== null) {
        const normalizedAgentName = normalizeAgentName(agent.name);
        return normalizedAgentName ? spawnedAgentNames.has(normalizedAgentName) : false;
      }

      return true;
    });
  };

  const getRelaycastSnapshot = async (): Promise<DashboardSnapshot> => {
    const config = resolveRelaycastConfig();
    if (!config) {
      return { ...EMPTY_DASHBOARD_SNAPSHOT };
    }

    const [agents, messages, spawnedAgentNames] = await Promise.all([
      fetchAgents(config),
      fetchAllMessages(config),
      brokerProxyEnabled ? getSpawnedAgentNames() : Promise.resolve(null),
    ]);

    const filteredAgents = filterPhantomAgents(agents, spawnedAgentNames);
    return {
      agents: filteredAgents,
      users: [],
      messages,
      activity: messages,
      sessions: [],
      summaries: [],
    };
  };

  const getRelaycastChannels = async (): Promise<{ channels: DashboardChannel[]; archivedChannels: DashboardChannel[] }> => {
    const config = resolveRelaycastConfig();
    if (!config) {
      return { channels: [], archivedChannels: [] };
    }

    const channels = await fetchChannels(config);

    const activeChannels: DashboardChannel[] = [];
    const archivedChannels: DashboardChannel[] = [];

    for (const channel of channels) {
      const mapped = mapChannelForDashboard(channel);
      if (mapped.status === 'archived') {
        archivedChannels.push(mapped);
      } else {
        activeChannels.push(mapped);
      }
    }

    activeChannels.sort((a, b) => a.name.localeCompare(b.name));
    archivedChannels.sort((a, b) => a.name.localeCompare(b.name));

    return {
      channels: activeChannels,
      archivedChannels,
    };
  };

  const sendRelaycastMessage = async (
    params: { to: string; message: string; from?: string },
  ): Promise<{ success: true; messageId: string } | { success: false; status: number; error: string }> => {
    const config = resolveRelaycastConfig();
    if (!config) {
      return {
        success: false,
        status: 503,
        error: `Relaycast credentials not found in ${path.join(dataDir, 'relaycast.json')}`,
      };
    }

    try {
      const result = await sendMessage(config, {
        to: params.to.trim(),
        message: params.message.trim(),
        from: params.from?.trim() ? params.from.trim() : 'Dashboard',
        dataDir,
      });
      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (err) {
      return {
        success: false,
        status: 502,
        error: (err as Error).message || 'Failed to send message',
      };
    }
  };

  if (mock) {
    console.log('[dashboard] Running in MOCK mode - no relay daemon required');
    registerMockRoutes(app, verbose);
  } else {
    if (mode === 'proxy' && relayUrl) {
      console.log(`[dashboard] Running in PROXY mode - relaycast + broker proxy (${relayUrl})`);
    } else {
      console.log('[dashboard] Running in STANDALONE mode - relaycast only (read-only broker surface)');
    }

    app.get('/api/files', async (req: Request, res: Response) => {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 15;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 15;
      const searchRoot = path.dirname(dataDir);

      try {
        const files = await searchFiles(searchRoot, query, limit);
        res.json({
          files,
          query,
          searchRoot: path.basename(searchRoot),
        });
      } catch (err) {
        console.error('[dashboard] File search failed:', err);
        res.status(500).json({ error: 'Failed to search files', files: [] });
      }
    });

    app.get('/api/data', async (_req: Request, res: Response) => {
      try {
        const snapshot = await getRelaycastSnapshot();
        res.json(snapshot);
      } catch (err) {
        console.error('[dashboard] Failed to fetch Relaycast dashboard data:', err);
        res.status(500).json({ error: 'Failed to load Relaycast data' });
      }
    });

    app.get('/api/channels', async (_req: Request, res: Response) => {
      try {
        const channels = await getRelaycastChannels();
        res.json({
          success: true,
          ...channels,
        });
      } catch (err) {
        console.error('[dashboard] Failed to fetch Relaycast channels:', err);
        res.status(500).json({ error: 'Failed to load channels' });
      }
    });

    app.get('/api/channels/available-members', async (_req: Request, res: Response) => {
      try {
        const snapshot = await getRelaycastSnapshot();
        const agents = snapshot.agents.map((agent) => ({
          id: agent.name,
          displayName: agent.name,
          entityType: 'agent' as const,
          status: (agent.status ?? 'online').toLowerCase() === 'online' ? 'online' : 'offline',
        }));

        res.json({
          success: true,
          members: [],
          agents,
        });
      } catch (err) {
        console.error('[dashboard] Failed to build available members:', err);
        res.status(500).json({ error: 'Failed to load members' });
      }
    });

    app.get('/api/channels/:channel/members', async (req: Request, res: Response) => {
      const channelParamRaw = Array.isArray(req.params.channel) ? req.params.channel[0] : req.params.channel;
      const channelParam = decodeURIComponent(channelParamRaw ?? '');
      const channelName = channelParam.startsWith('#') ? channelParam.slice(1) : channelParam;

      if (!channelName) {
        res.status(400).json({ error: 'Channel is required' });
        return;
      }

      const config = resolveRelaycastConfig();
      if (!config) {
        res.json({ members: [] });
        return;
      }

      try {
        const [members, spawnedAgentNames] = await Promise.all([
          fetchChannelMembers(config, channelName),
          brokerProxyEnabled ? getSpawnedAgentNames() : Promise.resolve(null),
        ]);

        const filteredMembers = filterPhantomAgents(members, spawnedAgentNames);
        res.json({
          members: filteredMembers.map((agent) => ({
            id: agent.name,
            displayName: agent.name,
            entityType: 'agent' as const,
            role: 'member' as const,
            status: (agent.status ?? 'online').toLowerCase() === 'online' ? 'online' : 'offline',
            joinedAt: agent.lastSeen ?? new Date().toISOString(),
          })),
        });
      } catch (err) {
        console.error('[dashboard] Failed to fetch channel members:', err);
        res.status(500).json({ error: 'Failed to load channel members' });
      }
    });

    app.get('/api/channels/:channel/messages', async (req: Request, res: Response) => {
      const channelParamRaw = Array.isArray(req.params.channel) ? req.params.channel[0] : req.params.channel;
      const channelParam = decodeURIComponent(channelParamRaw ?? '');
      const channelName = channelParam.startsWith('#') ? channelParam.slice(1) : channelParam;
      const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
      const beforeRaw = req.query.before ? parseInt(req.query.before as string, 10) : NaN;
      const beforeTs = Number.isFinite(beforeRaw) ? beforeRaw : null;

      if (!channelName) {
        res.status(400).json({ error: 'Channel is required' });
        return;
      }

      const config = resolveRelaycastConfig();
      if (!config) {
        res.json({ messages: [], hasMore: false });
        return;
      }

      try {
        const requestedLimit = beforeTs ? Math.min(limit * 2, 500) : limit;
        const messages = await fetchChannelMessages(config, channelName, {
          limit: requestedLimit,
          before: beforeTs === null ? undefined : beforeTs,
        });

        const trimmed = messages.slice(-limit);
        const hasMore = messages.length > limit;

        res.json({
          messages: trimmed.map((message) => ({
            id: message.id,
            channelId: channelParam.startsWith('#') ? channelParam : `#${channelName}`,
            from: message.agent_name,
            fromEntityType: 'agent' as const,
            content: message.text,
            timestamp: message.created_at,
            threadId: message.thread_id,
            threadSummary: typeof message.reply_count === 'number' && message.reply_count > 0 ? {
              threadId: message.id,
              replyCount: message.reply_count,
              lastReplyAt: message.created_at,
            } : undefined,
            isRead: true,
          })),
          hasMore,
        });
      } catch (err) {
        console.error('[dashboard] Failed to fetch Relaycast channel messages:', err);
        res.status(500).json({ error: 'Failed to load channel messages' });
      }
    });

    const handleRelaycastSend = async (req: Request, res: Response): Promise<void> => {
      const { to, from } = req.body ?? {};
      const messageValue = req.body?.message ?? req.body?.text ?? req.body?.body ?? req.body?.content;
      const message = typeof messageValue === 'string' ? messageValue.trim() : '';

      if (typeof to !== 'string' || !to.trim() || !message) {
        res.status(400).json({ success: false, error: 'Missing required fields: to, message' });
        return;
      }

      const result = await sendRelaycastMessage({
        to: to.trim(),
        message,
        from: typeof from === 'string' ? from : undefined,
      });

      if (!result.success) {
        res.status(result.status).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        messageId: result.messageId,
      });
    };

    app.post('/api/send', handleRelaycastSend);
    app.post('/api/dm', handleRelaycastSend);
    app.post('/api/relay/send', handleRelaycastSend);

    app.post('/api/channels', async (req: Request, res: Response) => {
      const { name, description, topic, isPrivate, visibility, invites } = req.body ?? {};
      const username = typeof req.body?.username === 'string' && req.body.username.trim()
        ? req.body.username.trim()
        : 'Dashboard';
      const rawName = typeof name === 'string' ? name : '';
      const channelName = normalizeChannelName(rawName);

      if (!channelName || channelName.startsWith('dm:')) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const config = resolveRelaycastConfig();
      if (!config) {
        res.status(503).json({
          success: false,
          error: `Relaycast credentials not found in ${path.join(dataDir, 'relaycast.json')}`,
        });
        return;
      }

      try {
        await createChannel(config, {
          name: channelName,
          description: typeof description === 'string' ? description : (typeof topic === 'string' ? topic : undefined),
          visibility: visibility === 'private' || isPrivate === true ? 'private' : 'public',
          creator: username,
          dataDir,
        });
        await joinChannel(config, { channel: channelName, username, dataDir }).catch(() => {});

        const inviteMembers = parseInviteMembers(invites);
        const inviteResult = inviteMembers.length > 0
          ? await inviteToChannel(config, {
              channel: channelName,
              members: inviteMembers,
              invitedBy: username,
              dataDir,
            })
          : { invited: [] };

        res.json({
          success: true,
          channel: {
            id: `#${channelName}`,
            name: channelName,
            description: typeof description === 'string' ? description : undefined,
            topic: typeof topic === 'string' ? topic : undefined,
            visibility: visibility === 'private' || isPrivate === true ? 'private' : 'public',
            status: 'active',
            createdAt: new Date().toISOString(),
            createdBy: username,
            memberCount: Math.max(1, inviteResult.invited.filter((member) => member.success).length + 1),
            unreadCount: 0,
            hasMentions: false,
            isDm: false,
          },
          invited: inviteResult.invited,
        });
      } catch (err) {
        console.error('[dashboard] Failed to create Relaycast channel:', err);
        res.status(500).json({ error: (err as Error).message || 'Failed to create channel' });
      }
    });

    app.post('/api/channels/invite', async (req: Request, res: Response) => {
      const { channel, invites, invitedBy } = req.body ?? {};
      const channelName = typeof channel === 'string' ? normalizeChannelName(channel) : '';
      const inviteMembers = parseInviteMembers(invites);

      if (!channelName || inviteMembers.length === 0 || channelName.startsWith('dm:')) {
        res.status(400).json({ error: 'channel and invites are required' });
        return;
      }

      const config = resolveRelaycastConfig();
      if (!config) {
        res.status(503).json({
          success: false,
          error: `Relaycast credentials not found in ${path.join(dataDir, 'relaycast.json')}`,
        });
        return;
      }

      const inviteResult = await inviteToChannel(config, {
        channel: channelName,
        members: inviteMembers,
        invitedBy: typeof invitedBy === 'string' && invitedBy.trim() ? invitedBy.trim() : 'Dashboard',
        dataDir,
      });

      res.json({
        channel: normalizeChannelTarget(channelName),
        invited: inviteResult.invited,
      });
    });

    app.get('/api/channels/users', (_req: Request, res: Response) => {
      res.json({ users: [] });
    });

    app.post('/api/channels/join', async (req: Request, res: Response) => {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const channel = typeof req.body?.channel === 'string' ? req.body.channel : '';
      const channelName = normalizeChannelName(channel);
      const channelTarget = normalizeChannelTarget(channel);

      if (!username || !channelName) {
        res.status(400).json({ error: 'username and channel required' });
        return;
      }

      if (channelName.startsWith('dm:')) {
        res.json({ success: true, channel: channelTarget });
        return;
      }

      const config = resolveRelaycastConfig();
      if (!config) {
        res.status(503).json({
          success: false,
          error: `Relaycast credentials not found in ${path.join(dataDir, 'relaycast.json')}`,
        });
        return;
      }

      try {
        await joinChannel(config, { channel: channelName, username, dataDir });
      } catch (err) {
        console.error('[dashboard] Failed to join Relaycast channel:', err);
        res.status(500).json({ error: (err as Error).message || 'Failed to join channel' });
        return;
      }

      res.json({ success: true, channel: channelTarget });
    });

    app.post('/api/channels/leave', async (req: Request, res: Response) => {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const channel = typeof req.body?.channel === 'string' ? normalizeChannelTarget(req.body.channel) : '';
      if (!username || !channel) {
        res.status(400).json({ error: 'username and channel required' });
        return;
      }

      const config = resolveRelaycastConfig();
      if (config) {
        try {
          await leaveChannel(config, { channel, username });
        } catch (err) {
          if (verbose) {
            console.warn('[dashboard] Leave channel fallback failed:', (err as Error).message);
          }
        }
      }

      res.json({ success: true, channel });
    });

    app.post('/api/channels/admin-join', async (req: Request, res: Response) => {
      const channel = typeof req.body?.channel === 'string' ? normalizeChannelName(req.body.channel) : '';
      const member = typeof req.body?.member === 'string' ? req.body.member.trim() : '';

      if (!channel || !member || channel.startsWith('dm:')) {
        res.status(400).json({ error: 'channel and member required' });
        return;
      }

      const config = resolveRelaycastConfig();
      if (!config) {
        res.status(503).json({
          success: false,
          error: `Relaycast credentials not found in ${path.join(dataDir, 'relaycast.json')}`,
        });
        return;
      }

      try {
        await inviteToChannel(config, {
          channel,
          members: [{ id: member, type: 'agent' }],
          invitedBy: 'Dashboard',
          dataDir,
        });
        res.json({ success: true, channel: normalizeChannelTarget(channel), member });
      } catch (err) {
        console.error('[dashboard] Failed to admin-join channel member:', err);
        res.status(500).json({ error: (err as Error).message || 'Failed to add member' });
      }
    });

    app.post('/api/channels/admin-remove', (req: Request, res: Response) => {
      const channel = typeof req.body?.channel === 'string' ? normalizeChannelTarget(req.body.channel) : '';
      const member = typeof req.body?.member === 'string' ? req.body.member.trim() : '';
      if (!channel || !member) {
        res.status(400).json({ error: 'channel and member required' });
        return;
      }
      // Relaycast membership removal is not exposed by the current SDK wrapper.
      res.json({ success: true, channel, member });
    });

    app.post('/api/channels/subscribe', async (req: Request, res: Response) => {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const channelsRaw: unknown[] = Array.isArray(req.body?.channels) ? req.body.channels : ['#general'];
      const channelNames = channelsRaw
        .filter((entry: unknown): entry is string => typeof entry === 'string')
        .map((entry: string) => normalizeChannelName(entry))
        .filter(Boolean);

      if (!username) {
        res.status(400).json({ error: 'username required' });
        return;
      }

      const config = resolveRelaycastConfig();
      if (!config) {
        res.status(503).json({
          success: false,
          error: `Relaycast credentials not found in ${path.join(dataDir, 'relaycast.json')}`,
        });
        return;
      }

      const joinedChannels: string[] = [];

      for (const channelName of channelNames) {
        if (channelName.startsWith('dm:')) {
          joinedChannels.push(channelName);
          continue;
        }

        try {
          await joinChannel(config, { channel: channelName, username, dataDir });
          joinedChannels.push(normalizeChannelTarget(channelName));
        } catch (err) {
          if (verbose) {
            console.warn(`[dashboard] Failed to subscribe ${username} to ${channelName}:`, (err as Error).message);
          }
        }
      }

      res.json({
        success: true,
        channels: joinedChannels,
      });
    });

    app.post('/api/channels/message', async (req: Request, res: Response) => {
      const username = typeof req.body?.username === 'string' && req.body.username.trim()
        ? req.body.username.trim()
        : 'Dashboard';
      const channel = typeof req.body?.channel === 'string' ? req.body.channel : '';
      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';

      if (!channel || !body) {
        res.status(400).json({ error: 'username, channel, and body required' });
        return;
      }

      const result = await sendRelaycastMessage({
        to: normalizeChannelTarget(channel),
        message: body,
        from: username,
      });

      if (!result.success) {
        res.status(result.status).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({ success: true, messageId: result.messageId });
    });

    app.post('/api/channels/archive', async (req: Request, res: Response) => {
      const channel = typeof req.body?.channel === 'string' ? normalizeChannelTarget(req.body.channel) : '';
      if (!channel) {
        res.status(400).json({ error: 'channel required' });
        return;
      }

      const config = resolveRelaycastConfig();
      if (config) {
        try {
          await setChannelArchived(config, { channel, archived: true, updatedBy: 'Dashboard' });
        } catch (err) {
          if (verbose) {
            console.warn('[dashboard] Archive channel fallback failed:', (err as Error).message);
          }
        }
      }

      res.json({ success: true, channel });
    });

    app.post('/api/channels/unarchive', async (req: Request, res: Response) => {
      const channel = typeof req.body?.channel === 'string' ? normalizeChannelTarget(req.body.channel) : '';
      if (!channel) {
        res.status(400).json({ error: 'channel required' });
        return;
      }

      const config = resolveRelaycastConfig();
      if (config) {
        try {
          await setChannelArchived(config, { channel, archived: false, updatedBy: 'Dashboard' });
        } catch (err) {
          if (verbose) {
            console.warn('[dashboard] Unarchive channel fallback failed:', (err as Error).message);
          }
        }
      }

      res.json({ success: true, channel });
    });

    if (brokerProxyEnabled && relayUrl) {
      const forwardBrokerJson = async (
        req: Request,
        res: Response,
        endpoint: string,
        transformBody?: (body: Record<string, unknown>) => Record<string, unknown>,
      ) => {
        try {
          const rawBody = isRecord(req.body) ? { ...req.body } : {};
          const body = transformBody ? transformBody(rawBody) : rawBody;
          const headers: Record<string, string> = {
            'content-type': 'application/json',
          };
          const workspaceId = req.header('x-workspace-id');
          if (workspaceId) {
            headers['x-workspace-id'] = workspaceId;
          }

          const upstream = await fetch(`${relayUrl}${endpoint}`, {
            method: req.method,
            headers,
            body: JSON.stringify(body),
          });

          const contentType = upstream.headers.get('content-type') ?? '';
          const text = await upstream.text();
          res.status(upstream.status);
          if (contentType) {
            res.setHeader('content-type', contentType);
          }

          if (!text) {
            res.end();
            return;
          }

          if (contentType.includes('application/json')) {
            try {
              res.json(JSON.parse(text));
              return;
            } catch {
              // Fall back to raw text when upstream emits invalid JSON.
            }
          }
          res.send(text);
        } catch (err) {
          console.error('[dashboard] Broker proxy error:', (err as Error).message);
          res.status(502).json({
            success: false,
            error: 'Broker unavailable',
            message: (err as Error).message,
          });
        }
      };

      const brokerProxyOptions: ProxyOptions = {
        target: relayUrl,
        changeOrigin: true,
        ws: false,
        logger: verbose ? console : undefined,
        on: {
          error: (err, _req, res) => {
            console.error('[dashboard] Broker proxy error:', (err as Error).message);
            if (res && 'writeHead' in res && typeof res.writeHead === 'function') {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: 'Broker unavailable',
                message: (err as Error).message,
              }));
            }
          },
        },
      };

      app.post('/api/spawn', async (req: Request, res: Response) => {
        await forwardBrokerJson(req, res, '/api/spawn', (rawBody) => {
          const includeWorkflowConventions =
            typeof rawBody.includeWorkflowConventions === 'boolean'
              ? rawBody.includeWorkflowConventions
              : true;
          const task = typeof rawBody.task === 'string' ? rawBody.task : undefined;
          return {
            ...rawBody,
            includeWorkflowConventions,
            task: withWorkflowConventions(task, includeWorkflowConventions),
          };
        });
      });

      app.get('/api/spawned', createProxyMiddleware(brokerProxyOptions));
      app.post('/api/release', createProxyMiddleware(brokerProxyOptions));
      app.post('/api/agents/by-name/:name/interrupt', createProxyMiddleware(brokerProxyOptions));
      app.get('/api/logs', createProxyMiddleware(brokerProxyOptions));
      app.get('/api/logs/:name', createProxyMiddleware(brokerProxyOptions));
      app.get('/api/agents/:name/online', createProxyMiddleware(brokerProxyOptions));
      app.put('/api/agents/:name/cwd', createProxyMiddleware(brokerProxyOptions));
      app.post('/api/spawn/architect', async (req: Request, res: Response) => {
        await forwardBrokerJson(req, res, '/api/spawn/architect', (rawBody) => {
          const task = typeof rawBody.task === 'string' ? rawBody.task : undefined;
          return {
            ...rawBody,
            includeWorkflowConventions: true,
            task: withWorkflowConventions(task, true),
          };
        });
      });
      app.get('/api/bridge', createProxyMiddleware(brokerProxyOptions));

      // Keep legacy release path for older dashboard clients while broker migration completes.
      app.delete('/api/spawned/:name', createProxyMiddleware(brokerProxyOptions));
    }
  }

  const fallbackHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Relay Dashboard</title>
</head>
<body>
  <h1>Relay Dashboard</h1>
  <p>Dashboard static build not found.</p>
</body>
</html>`;

  app.get('/metrics', (_req: Request, res: Response) => {
    const metricsPath = path.join(staticDir, 'metrics.html');
    sendHtmlFileOrFallback(res, metricsPath, undefined, 404);
  });

  app.get('/app', (_req: Request, res: Response) => {
    const appHtmlPath = path.join(staticDir, 'app.html');
    sendHtmlFileOrFallback(res, appHtmlPath, fallbackHtml, 200);
  });

  app.get('/app/{*path}', (_req: Request, res: Response) => {
    const appHtmlPath = path.join(staticDir, 'app.html');
    sendHtmlFileOrFallback(res, appHtmlPath, fallbackHtml, 200);
  });

  app.use(express.static(staticDir, {
    extensions: ['html'],
  }));

  app.get('/', (_req: Request, res: Response) => {
    const indexPath = path.join(staticDir, 'index.html');
    sendHtmlFileOrFallback(res, indexPath, fallbackHtml, 200);
  });

  app.get('/{*path}', (req: Request, res: Response) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/ws') || req.path.includes('.')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (req.path.startsWith('/app')) {
      const appHtmlPath = path.join(staticDir, 'app.html');
      sendHtmlFileOrFallback(res, appHtmlPath, fallbackHtml, 200);
      return;
    }

    const indexPath = path.join(staticDir, 'index.html');
    sendHtmlFileOrFallback(res, indexPath, fallbackHtml, 200);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        if (mode === 'mock') {
          handleMockWebSocket(ws, verbose);
        } else if (mode === 'proxy' && relayUrl) {
          handleProxyWebSocket(ws, relayUrl, verbose, '/ws');
        } else {
          handleStandaloneWebSocket(ws, getRelaycastSnapshot, verbose);
        }
      });
      return;
    }

    if (mode === 'proxy' && relayUrl && (pathname === '/ws/logs' || pathname.startsWith('/ws/logs/'))) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleProxyWebSocket(ws, relayUrl, verbose, pathname);
      });
      return;
    }

    socket.destroy();
  });

  const close = (): Promise<void> => {
    return new Promise((resolve) => {
      wss.close(() => {
        server.close(() => {
          resolve();
        });
      });
    });
  };

  return { app, server, wss, close, mode };
}

/**
 * Handle mock WebSocket connections.
 */
function handleMockWebSocket(ws: WebSocket, verbose: boolean): void {
  if (verbose) {
    console.log('[dashboard] Mock WebSocket client connected');
  }

  const sendData = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        agents: mockAgents,
        messages: mockMessages,
        sessions: mockSessions,
      }));
    }
  };

  sendData();
  const interval = setInterval(sendData, 5000);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (verbose) {
        console.log('[dashboard] Mock WS received:', message);
      }
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (message.type === 'subscribe') {
        sendData();
      }
    } catch {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    if (verbose) {
      console.log('[dashboard] Mock WebSocket client disconnected');
    }
    clearInterval(interval);
  });

  ws.on('error', (err) => {
    console.error('[dashboard] Mock WebSocket error:', err.message);
    clearInterval(interval);
  });
}

/**
 * Handle standalone WebSocket connections with periodic Relaycast snapshot polling.
 */
function handleStandaloneWebSocket(
  ws: WebSocket,
  getSnapshot: () => Promise<DashboardSnapshot>,
  verbose: boolean,
): void {
  if (verbose) {
    console.log('[dashboard] Standalone WebSocket client connected');
  }

  let lastPayload = '';

  const sendSnapshot = async (force = false): Promise<void> => {
    if (ws.readyState !== WebSocket.OPEN) return;

    try {
      const snapshot = await getSnapshot();
      const payload = JSON.stringify(snapshot);
      if (!force && payload === lastPayload) {
        return;
      }
      lastPayload = payload;
      ws.send(payload);
    } catch (err) {
      if (verbose) {
        console.warn('[dashboard] Standalone WS snapshot error:', (err as Error).message);
      }
    }
  };

  void sendSnapshot(true);
  const interval = setInterval(() => {
    void sendSnapshot();
  }, STANDALONE_WS_POLL_MS);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (message.type === 'subscribe' || message.type === 'refresh' || message.type === 'replay') {
        void sendSnapshot(true);
      }
    } catch {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    if (verbose) {
      console.log('[dashboard] Standalone WebSocket client disconnected');
    }
    clearInterval(interval);
  });

  ws.on('error', (err) => {
    if (verbose) {
      console.warn('[dashboard] Standalone WebSocket error:', err.message);
    }
    clearInterval(interval);
  });
}

/**
 * Handle proxy WebSocket connections.
 */
function handleProxyWebSocket(ws: WebSocket, relayUrl: string, verbose: boolean, targetPath = '/ws'): void {
  const relayUrlObj = new URL(relayUrl);
  const wsProtocol = relayUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
  const relayWs = new WebSocket(`${wsProtocol}//${relayUrlObj.host}${targetPath}`);

  relayWs.on('open', () => {
    if (verbose) {
      console.log(`[dashboard] WebSocket connected to broker (${targetPath})`);
    }
  });

  ws.on('message', (data) => {
    if (relayWs.readyState === WebSocket.OPEN) {
      relayWs.send(data);
    }
  });

  relayWs.on('message', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on('close', () => {
    relayWs.close();
  });

  relayWs.on('close', () => {
    ws.close();
  });

  ws.on('error', (err) => {
    console.error('[dashboard] Client WebSocket error:', err.message);
    relayWs.close();
  });

  relayWs.on('error', (err) => {
    console.error('[dashboard] Relay WebSocket error:', err.message);
    ws.close();
  });
}

/**
 * Try to listen on a port, returns the port if successful or null if in use.
 */
function tryListen(server: Server, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        server.removeListener('error', onError);
        resolve(null);
      }
    };

    const host = getBindHost();
    server.once('error', onError);
    if (host) {
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    } else {
      server.listen(port, () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    }
  });
}

/**
 * Find an available port starting from the preferred port.
 */
async function findAvailablePort(server: Server, preferredPort: number, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferredPort + i;
    const result = await tryListen(server, port);
    if (result !== null) {
      return result;
    }
    server.close();
  }
  throw new Error(`Could not find available port after ${maxAttempts} attempts starting from ${preferredPort}`);
}

/**
 * Start the dashboard server.
 */
export async function startServer(options: DashboardServerOptions = {}): Promise<DashboardServer> {
  const preferredPort = options.port || parseInt(process.env.PORT || '3888', 10);
  const dashboard = createServer(options);
  const actualPort = await findAvailablePort(dashboard.server, preferredPort);

  if (actualPort !== preferredPort) {
    console.log(`[dashboard] Port ${preferredPort} in use, using port ${actualPort}`);
  }

  console.log(`[dashboard] Server running at http://localhost:${actualPort}`);
  if (dashboard.mode === 'mock') {
    console.log('[dashboard] Using mock data - ready for standalone testing');
  } else if (dashboard.mode === 'proxy') {
    console.log(`[dashboard] Proxy mode enabled - broker URL ${normalizeRelayUrl(options.relayUrl ?? process.env.RELAY_URL)}`);
  } else {
    console.log('[dashboard] Standalone mode enabled - relaycast data only');
  }

  return dashboard;
}
