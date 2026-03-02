/**
 * Relay Dashboard Server
 *
 * A flexible server that can operate in three modes:
 * 1. Proxy mode (default): static files + Relaycast data + broker proxy
 * 2. Standalone mode: static files + Relaycast data (no broker proxy)
 * 3. Mock mode: fixture-backed standalone mode for demos/tests
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer as createHttpServer, type Server } from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerMockRoutes } from './mocks/routes.js';
import {
  fetchAgents,
  fetchChannels,
  loadRelaycastConfig,
} from './relaycast-provider.js';
import { createSendStrategy } from './lib/send-strategy.js';
import type { SendStrategy } from './lib/send-strategy.js';
import { DASHBOARD_DISPLAY_NAME } from './relaycast-provider-types.js';
import { resolveIdentity } from './lib/identity.js';
import type {
  DashboardMode,
  DashboardSnapshot,
  DashboardChannel,
  DashboardServerOptions,
  DashboardServer,
  RouteContext,
} from './lib/types.js';
import { EMPTY_DASHBOARD_SNAPSHOT } from './lib/types.js';
import {
  normalizeRelayUrl,
  normalizeName,
  isDirectRecipient,
  sendHtmlFileOrFallback,
  getBindHost,
  mapChannelForDashboard,
} from './lib/utils.js';
import {
  filterPhantomAgents,
  mergeBrokerSpawnedAgents,
  createSpawnedAgentsCaches,
} from './lib/spawned-agents.js';
import { handleMockWebSocket } from './websocket/mock.js';
import { handleStandaloneWebSocket, handleHybridWebSocket } from './websocket/standalone.js';
import { handleStandaloneLogWebSocket } from './websocket/logs.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerDataRoutes } from './routes/data.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerChannelRoutes } from './routes/channels.js';
import { registerBrokerProxyRoutes } from './routes/broker-proxy.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerReactionRoutes } from './routes/reactions.js';
import { registerRelayConfigRoutes } from './routes/relay-config.js';
import { registerRelaycastHistoryRoutes } from './routes/history-relaycast.js';

export type { DashboardServerOptions, DashboardServer } from './lib/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveMetricsPagePath(staticDir: string): string {
  const candidates = [
    path.join(staticDir, 'metrics.html'),
    path.join(staticDir, 'metrics', 'index.html'),
    path.join(staticDir, 'app.html'),
    path.join(staticDir, 'index.html'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
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
    requestTimeout = parseInt(process.env.REQUEST_TIMEOUT || '60000', 10),
  } = options;

  const resolvedDataDir = path.resolve(dataDir);
  if (!process.env.AGENT_RELAY_PROJECT) {
    process.env.AGENT_RELAY_PROJECT = path.dirname(resolvedDataDir);
  }

  const relayUrl = normalizeRelayUrl(relayUrlOption ?? process.env.RELAY_URL);
  const mode: DashboardMode = mock ? 'mock' : (relayUrl ? 'proxy' : 'standalone');
  const brokerProxyEnabled = mode === 'proxy' && Boolean(relayUrl);
  const defaultWorkspaceId = process.env.RELAY_WORKSPACE_ID ?? process.env.AGENT_RELAY_WORKSPACE_ID;

  const resolveWorkspaceId = (req: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  }): string | undefined => {
    const fromQuery = asString(req.query?.workspaceId);
    const fromBody = asString(req.body?.workspaceId);
    const fromHeader = getWorkspaceHeader(req.headers);
    return fromQuery || fromBody || fromHeader || defaultWorkspaceId;
  };

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

  // --- Build shared context ---

  const resolveRelaycastConfig = () => loadRelaycastConfig(dataDir);
  const { getSpawnedAgents, getLocalAgentNames } = createSpawnedAgentsCaches({
    brokerProxyEnabled,
    relayUrl,
    dataDir,
    verbose,
  });

  const getRelaycastSnapshot = async (): Promise<DashboardSnapshot> => {
    const config = resolveRelaycastConfig();
    if (!config) {
      return { ...EMPTY_DASHBOARD_SNAPSHOT };
    }

    const [agents, spawnedAgents, localAgentNames] = await Promise.all([
      fetchAgents(config),
      brokerProxyEnabled ? getSpawnedAgents() : Promise.resolve({ names: null, agents: null }),
      brokerProxyEnabled ? Promise.resolve(null) : Promise.resolve(getLocalAgentNames()),
    ]);

    const filteredAgents = filterPhantomAgents(agents, spawnedAgents.names, localAgentNames);
    const mergedAgents = mergeBrokerSpawnedAgents(filteredAgents, spawnedAgents.agents);
    return {
      agents: mergedAgents,
      users: [],
      messages: [],
      activity: [],
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
      const mapped = mapChannelForDashboard({ ...channel, is_archived: channel.is_archived ?? false });
      if (mapped.status === 'archived') {
        archivedChannels.push(mapped);
      } else {
        activeChannels.push(mapped);
      }
    }

    activeChannels.sort((a, b) => a.name.localeCompare(b.name));
    archivedChannels.sort((a, b) => a.name.localeCompare(b.name));

    return { channels: activeChannels, archivedChannels };
  };

  const sendRelaycastMessage = async (
    params: { to: string; message: string; from?: string },
  ): Promise<{ success: true; messageId: string } | { success: false; status: number; error: string }> => {
    const sendTimeout = Math.max(requestTimeout - 5000, 10000);
    const sendStart = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Send timed out')), sendTimeout),
    );

    try {
      return await Promise.race([
        (async () => {
          const config = resolveRelaycastConfig();
          const rawTarget = params.to.trim();
          const message = params.message.trim();
          let resolvedTarget = rawTarget;

          if (isDirectRecipient(rawTarget) && config) {
            const relayAgents = await fetchAgents(config);
            const relayMatch = relayAgents.find((agent) => normalizeName(agent.name) === normalizeName(rawTarget));
            if (relayMatch) {
              resolvedTarget = relayMatch.name;
            }
          }

          const projectIdentity = config?.agentName?.trim()
            || path.basename(path.resolve(dataDir, '..'))
            || DASHBOARD_DISPLAY_NAME;
          const senderInput = params.from?.trim() ?? '';
          const senderName = mode === 'proxy'
            ? resolveIdentity(senderInput || projectIdentity, {
                projectIdentity: projectIdentity.trim(),
                relayAgentName: config?.agentName?.trim(),
              })
            : (senderInput || projectIdentity);

          const strategy: SendStrategy | null = createSendStrategy({
            brokerProxyEnabled,
            brokerUrl: relayUrl,
            relaycastConfig: config,
            dataDir,
          });

          if (!strategy) {
            return {
              success: false as const,
              status: 503,
              error: `Relaycast credentials not found in ${path.join(dataDir, 'relaycast.json')}`,
            };
          }

          console.log(
            `[dashboard] /api/send request: to=${resolvedTarget}, from=${senderName}, relayUrl=${relayUrl}, timeoutMs=${sendTimeout}`,
          );

          const outcome = await strategy.send({ to: resolvedTarget, message, from: senderName });
          console.log(`[dashboard] /api/send completed in ${Date.now() - sendStart}ms with status=${outcome.success ? 200 : outcome.status}`);

          // Enrich "agent not found" errors with available agent names
          if (!outcome.success && isDirectRecipient(params.to) && config) {
            if (/agent\s+\".+\"\s+not\s+found/i.test(outcome.error)) {
              const relayAgents = await fetchAgents(config);
              const available = relayAgents.map((agent) => agent.name).sort();
              const suffix = available.length > 0
                ? ` Available relay agents: ${available.join(', ')}.`
                : ' No relay agents are currently online.';
              return {
                success: false as const,
                status: 404,
                error: `${outcome.error}.${suffix}`,
              };
            }
          }

          return outcome;
        })(),
        timeoutPromise,
      ]);
    } catch (err) {
      console.error(`[dashboard] /api/send failed after ${Date.now() - sendStart}ms: ${(err as Error).message}`);
      return {
        success: false,
        status: 504,
        error: (err as Error).message || 'Send request timed out',
      };
    }
  };

  const ctx: RouteContext = {
    mode,
    dataDir,
    staticDir,
    verbose,
    relayUrl,
    brokerProxyEnabled,
    resolveRelaycastConfig,
    getRelaycastSnapshot,
    getRelaycastChannels,
    sendRelaycastMessage,
    getSpawnedAgents,
    getLocalAgentNames,
    filterPhantomAgents,
  };

  // --- Register routes ---

  registerHealthRoutes(app, ctx);

  if (mock) {
    console.log('[dashboard] Running in MOCK mode - no relay broker required');
    registerMockRoutes(app, verbose);
  } else {
    if (mode === 'proxy' && relayUrl) {
      console.log(`[dashboard] Running in PROXY mode - relaycast + broker proxy (${relayUrl})`);
    } else {
      console.log('[dashboard] Running in STANDALONE mode - relaycast only (read-only broker surface)');
    }

    registerAgentRoutes(app, ctx);
    registerDataRoutes(app, ctx);
    registerRelayConfigRoutes(app, ctx);
    registerChannelRoutes(app, ctx);
    registerReactionRoutes(app, ctx);
    registerMetricsRoutes(app, {
      teamDir: path.join(dataDir, 'team'),
      resolveWorkspaceId,
    });
    registerRelaycastHistoryRoutes(app, ctx);
    registerBrokerProxyRoutes(app, ctx);
  }

  // --- Static files and SPA fallback ---

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
    const metricsPath = resolveMetricsPagePath(staticDir);
    sendHtmlFileOrFallback(res, metricsPath, fallbackHtml, 200);
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
    // WebSocket endpoints require upgrade - return 426 for regular HTTP requests
    if (req.path === '/ws' || req.path.startsWith('/ws/')) {
      res.status(426).json({ error: 'Upgrade Required', message: 'WebSocket upgrade required' });
      return;
    }
    if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.includes('.')) {
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

  // --- WebSocket ---

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        if (mode === 'mock') {
          handleMockWebSocket(ws, verbose);
        } else if (mode === 'proxy' && relayUrl) {
          handleHybridWebSocket(ws, getRelaycastSnapshot, relayUrl, verbose);
        } else {
          handleStandaloneWebSocket(ws, getRelaycastSnapshot, verbose);
        }
      });
      return;
    }

    if (mode !== 'mock' && (pathname === '/ws/logs' || pathname.startsWith('/ws/logs/'))) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleStandaloneLogWebSocket(ws, pathname, dataDir, getLocalAgentNames, verbose);
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
