/**
 * Relay Dashboard Server
 *
 * Minimal proxy server that serves the dashboard UI and forwards
 * all API/WebSocket requests to the relay daemon.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createServer as createHttpServer, type Server } from 'http';
import { createProxyMiddleware, type Options as ProxyOptions } from 'http-proxy-middleware';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DashboardServerOptions {
  /** Port to listen on (default: 3888) */
  port?: number;
  /** Relay daemon URL to proxy to (default: http://localhost:3889) */
  relayUrl?: string;
  /** Path to static files directory (default: ../out) */
  staticDir?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface DashboardServer {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
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
  } = options;

  const app = express();
  const server = createHttpServer(app);

  // Parse relay URL for WebSocket proxying
  const relayUrlObj = new URL(relayUrl);
  const wsRelayUrl = `ws://${relayUrlObj.host}`;

  // Logging middleware
  if (verbose) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[dashboard] ${req.method} ${req.url}`);
      next();
    });
  }

  // Health check endpoint (handled locally, not proxied)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'relay-dashboard' });
  });

  // Proxy API requests to relay daemon
  const apiProxyOptions: ProxyOptions = {
    target: relayUrl,
    changeOrigin: true,
    ws: false, // WebSocket handled separately
    logLevel: verbose ? 'debug' : 'silent',
    on: {
      error: (err: Error, _req: Request, res: Response | WebSocket) => {
        console.error('[dashboard] API proxy error:', err.message);
        if ('status' in res && typeof res.status === 'function') {
          (res as Response).status(502).json({
            error: 'Relay daemon unavailable',
            message: err.message,
          });
        }
      },
    },
  };

  app.use('/api', createProxyMiddleware(apiProxyOptions));

  // Serve static files
  app.use(express.static(staticDir, {
    // Enable HTML5 history mode fallback
    extensions: ['html'],
  }));

  // SPA fallback - serve index.html for unmatched routes
  app.get('*', (req: Request, res: Response) => {
    // Don't serve index.html for API routes or static assets
    if (req.path.startsWith('/api') || req.path.includes('.')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  // WebSocket server for proxying to relay daemon
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
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

  return { app, server, wss, close };
}

/**
 * Start the dashboard server
 */
export async function startServer(options: DashboardServerOptions = {}): Promise<DashboardServer> {
  const port = options.port || parseInt(process.env.PORT || '3888', 10);
  const dashboard = createServer(options);

  return new Promise((resolve) => {
    dashboard.server.listen(port, () => {
      console.log(`[dashboard] Server running at http://localhost:${port}`);
      console.log(`[dashboard] Proxying to relay daemon at ${options.relayUrl || process.env.RELAY_URL || 'http://localhost:3889'}`);
      resolve(dashboard);
    });
  });
}
