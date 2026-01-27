/**
 * Relay Dashboard Server
 *
 * A flexible server that can operate in two modes:
 * 1. Proxy mode (default): Proxies API/WebSocket requests to a relay daemon
 * 2. Mock mode: Returns fixture data for standalone testing/demos
 *
 * This allows the dashboard to run independently without any external dependencies.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the host to bind to.
 * In cloud environments (Fly.io, Docker), bind to 0.0.0.0 for load balancer access.
 * Locally, let Node.js use its default (:: for IPv6 dual-stack).
 */
function getBindHost(): string | undefined {
  // Explicit override via env var
  if (process.env.BIND_HOST) {
    return process.env.BIND_HOST;
  }
  // Cloud environment detection - must bind to 0.0.0.0 for external access
  const isCloudEnvironment =
    process.env.FLY_APP_NAME ||           // Fly.io
    process.env.WORKSPACE_ID ||           // Agent Relay workspace
    process.env.RELAY_WORKSPACE_ID ||     // Alternative workspace ID
    process.env.RUNNING_IN_DOCKER === 'true';  // Docker container
  return isCloudEnvironment ? '0.0.0.0' : undefined;
}

export interface DashboardServerOptions {
  /** Port to listen on (default: 3888) */
  port?: number;
  /** Relay daemon URL to proxy to (default: http://localhost:3889) */
  relayUrl?: string;
  /** Path to static files directory (default: ../out) */
  staticDir?: string;
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
  mode: 'proxy' | 'mock';
}

/**
 * Create the dashboard server without starting it
 */
export function createServer(options: DashboardServerOptions = {}): DashboardServer {
  const {
    port = parseInt(process.env.PORT || '3888', 10),
    relayUrl = process.env.RELAY_URL || 'http://localhost:3889',
    staticDir = process.env.STATIC_DIR || path.join(__dirname, '..', 'out'),
    verbose = process.env.VERBOSE === 'true',
    mock = process.env.MOCK === 'true',
    corsOrigins = process.env.CORS_ORIGINS || '',
    requestTimeout = parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
  } = options;

  const app = express();
  const server = createHttpServer(app);
  const mode = mock ? 'mock' : 'proxy';

  // Set request timeout
  server.timeout = requestTimeout;

  // Parse JSON bodies
  app.use(express.json({ limit: '10mb' }));

  // CORS middleware - configurable for cross-origin deployments
  if (corsOrigins) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;

      // Check if origin is allowed
      if (corsOrigins === '*') {
        res.header('Access-Control-Allow-Origin', '*');
      } else if (origin) {
        const allowedOrigins = corsOrigins.split(',').map(o => o.trim());
        if (allowedOrigins.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
        }
      }

      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Expose-Headers', 'X-CSRF-Token');

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }

      next();
    });
  }

  // Logging middleware
  if (verbose) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[dashboard] ${req.method} ${req.url}`);
      next();
    });
  }

  // Health check endpoint (always local)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'relay-dashboard',
      mode,
      uptime: process.uptime(),
    });
  });

  // Keep-alive endpoint
  app.get('/keep-alive', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  if (mock) {
    // ===== MOCK MODE =====
    // Register mock API routes for standalone operation
    console.log('[dashboard] Running in MOCK mode - no relay daemon required');
    registerMockRoutes(app, verbose);
  } else {
    // ===== PROXY MODE =====
    // Proxy all API requests to the relay daemon
    console.log(`[dashboard] Running in PROXY mode - forwarding to ${relayUrl}`);

    const apiProxyOptions: ProxyOptions = {
      target: relayUrl,
      changeOrigin: true,
      ws: false, // WebSocket handled separately
      logger: verbose ? console : undefined,
      on: {
        error: (err, _req, res) => {
          console.error('[dashboard] API proxy error:', (err as Error).message);
          if (res && 'writeHead' in res && typeof res.writeHead === 'function') {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Relay daemon unavailable',
              message: (err as Error).message,
            }));
          }
        },
      },
    };

    app.use('/api', createProxyMiddleware(apiProxyOptions));
    app.use('/auth', createProxyMiddleware(apiProxyOptions));
    app.use('/metrics', createProxyMiddleware(apiProxyOptions));
  }

  // Serve static files
  app.use(express.static(staticDir, {
    extensions: ['html'],
  }));

  // SPA fallback - serve appropriate HTML file for unmatched routes
  // Express 5 requires named parameter instead of bare *
  app.get('/{*path}', (req: Request, res: Response) => {
    // Don't serve HTML for API routes or static assets
    if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.includes('.')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // For /app/* routes (including /app/channel/*, /app/agent/*, /app/dm/*, /app/settings/*),
    // serve the app.html which handles client-side routing
    if (req.path.startsWith('/app')) {
      res.sendFile(path.join(staticDir, 'app.html'));
      return;
    }

    // For other routes, serve index.html
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  // WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        if (mock) {
          // Mock WebSocket - send periodic updates with fixture data
          handleMockWebSocket(ws, verbose);
        } else {
          // Proxy WebSocket to relay daemon
          handleProxyWebSocket(ws, relayUrl, verbose);
        }
      });
    } else {
      socket.destroy();
    }
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
 * Handle mock WebSocket connections
 * Sends periodic updates with fixture data
 */
function handleMockWebSocket(ws: WebSocket, verbose: boolean): void {
  if (verbose) {
    console.log('[dashboard] Mock WebSocket client connected');
  }

  // Send initial data
  const sendData = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        agents: mockAgents,
        messages: mockMessages,
        sessions: mockSessions,
      }));
    }
  };

  // Send initial data immediately
  sendData();

  // Send updates every 5 seconds
  const interval = setInterval(sendData, 5000);

  // Handle messages from client
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (verbose) {
        console.log('[dashboard] Mock WS received:', msg);
      }

      // Echo back acknowledgment for certain message types
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (msg.type === 'subscribe') {
        // Send current data when client subscribes
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
 * Handle proxy WebSocket connections
 * Forwards messages bidirectionally to relay daemon
 */
function handleProxyWebSocket(ws: WebSocket, relayUrl: string, verbose: boolean): void {
  const relayUrlObj = new URL(relayUrl);
  const wsRelayUrl = `ws://${relayUrlObj.host}`;

  // Create connection to relay daemon
  const relayWs = new WebSocket(`${wsRelayUrl}/ws`);

  relayWs.on('open', () => {
    if (verbose) {
      console.log('[dashboard] WebSocket connected to relay daemon');
    }
  });

  // Forward messages from client to relay
  ws.on('message', (data) => {
    if (relayWs.readyState === WebSocket.OPEN) {
      relayWs.send(data);
    }
  });

  // Forward messages from relay to client
  relayWs.on('message', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Handle client disconnect
  ws.on('close', () => {
    if (verbose) {
      console.log('[dashboard] Client WebSocket closed');
    }
    relayWs.close();
  });

  // Handle relay disconnect
  relayWs.on('close', () => {
    if (verbose) {
      console.log('[dashboard] Relay WebSocket closed');
    }
    ws.close();
  });

  // Handle errors
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
 * Try to listen on a port, returns the port if successful or null if in use
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
 * Find an available port starting from the preferred port
 */
async function findAvailablePort(server: Server, preferredPort: number, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferredPort + i;
    const result = await tryListen(server, port);
    if (result !== null) {
      return result;
    }
    // Close and recreate listener for next attempt
    server.close();
  }
  throw new Error(`Could not find available port after ${maxAttempts} attempts starting from ${preferredPort}`);
}

/**
 * Start the dashboard server
 * Automatically finds an available port if the preferred port is in use
 */
export async function startServer(options: DashboardServerOptions = {}): Promise<DashboardServer> {
  const preferredPort = options.port || parseInt(process.env.PORT || '3888', 10);
  const dashboard = createServer(options);

  // Try preferred port first, then search for available port
  const actualPort = await findAvailablePort(dashboard.server, preferredPort);

  if (actualPort !== preferredPort) {
    console.log(`[dashboard] Port ${preferredPort} in use, using port ${actualPort}`);
  }

  console.log(`[dashboard] Server running at http://localhost:${actualPort}`);
  if (dashboard.mode === 'mock') {
    console.log('[dashboard] Using mock data - ready for standalone testing');
  } else {
    console.log(`[dashboard] Proxying to relay daemon at ${options.relayUrl || process.env.RELAY_URL || 'http://localhost:3889'}`);
  }

  return dashboard;
}
