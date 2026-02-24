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
import path from 'path';
import { fileURLToPath } from 'url';
import { registerMockRoutes } from './mocks/routes.js';
import {
  fetchAgents,
  fetchAllMessages,
  fetchChannels,
  sendMessage,
  loadRelaycastConfig,
} from './relaycast-provider.js';
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
  normalizeAgentName,
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
import { registerReactionRoutes } from './routes/reactions.js';
import { registerRelayConfigRoutes } from './routes/relay-config.js';

export type { DashboardServerOptions, DashboardServer } from './lib/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    const [agents, messages, spawnedAgents, localAgentNames] = await Promise.all([
      fetchAgents(config),
      fetchAllMessages(config),
      brokerProxyEnabled ? getSpawnedAgents() : Promise.resolve({ names: null, agents: null }),
      brokerProxyEnabled ? Promise.resolve(null) : Promise.resolve(getLocalAgentNames()),
    ]);

    const filteredAgents = filterPhantomAgents(agents, spawnedAgents.names, localAgentNames);
    const mergedAgents = mergeBrokerSpawnedAgents(filteredAgents, spawnedAgents.agents);
    return {
      agents: mergedAgents,
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

    return { channels: activeChannels, archivedChannels };
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
      const rawTarget = params.to.trim();
      let resolvedTarget = rawTarget;

      if (isDirectRecipient(rawTarget)) {
        const relayAgents = await fetchAgents(config);
        const relayMatch = relayAgents.find((agent) => normalizeAgentName(agent.name) === normalizeAgentName(rawTarget));
        if (relayMatch) {
          resolvedTarget = relayMatch.name;
        }
      }

      const projectIdentity = config.agentName?.trim() || 'Dashboard';
      const senderName = params.from?.trim() ? params.from.trim() : projectIdentity;

      const result = await sendMessage(config, {
        to: resolvedTarget,
        message: params.message.trim(),
        from: senderName,
        dataDir,
      });
      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (err) {
      const message = (err as Error).message || 'Failed to send message';
      if (isDirectRecipient(params.to) && /agent\s+\".+\"\s+not\s+found/i.test(message)) {
        const relayAgents = await fetchAgents(config);
        const available = relayAgents.map((agent) => agent.name).sort();
        const suffix = available.length > 0
          ? ` Available relay agents: ${available.join(', ')}.`
          : ' No relay agents are currently online.';
        return {
          success: false,
          status: 404,
          error: `${message}.${suffix}`,
        };
      }
      return {
        success: false,
        status: 502,
        error: message,
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
