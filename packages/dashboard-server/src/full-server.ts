/**
 * Full Dashboard Server
 *
 * Complete dashboard server implementation with all @agent-relay integrations.
 * This is what the CLI uses when running `agent-relay up --dashboard`.
 *
 * For a lightweight proxy/mock server, see ./server.ts
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createServer as createHttpServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { DashboardOptions, DashboardServer, ServerContext } from './types/index.js';
import { registerRoutes } from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track connected clients and agent states
const connectedClients = new Set<WebSocket>();
const agentStates = new Map<string, { lastSeen: number; state: Record<string, unknown> }>();

/**
 * Broadcast data to all connected WebSocket clients
 */
function broadcast(data: unknown): void {
  const message = JSON.stringify(data);
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Export for use by route handlers
(global as Record<string, unknown>).__broadcastLogOutput = (agentName: string, data: string) => {
  broadcast({
    type: 'log',
    agent: agentName,
    data,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Find the dashboard static files directory
 */
function findDashboardDir(): string | null {
  const searchPaths = [
    // npm package location (when installed as dependency)
    path.join(__dirname, '../../../dashboard/out'),
    path.join(__dirname, '../../../../node_modules/@agent-relay/dashboard/out'),
    // Docker container location
    '/app/node_modules/@agent-relay/dashboard/out',
    // Development location
    path.join(__dirname, '../../dashboard/out'),
  ];

  for (const searchPath of searchPaths) {
    if (fs.existsSync(searchPath)) {
      return searchPath;
    }
  }

  return null;
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

    server.once('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      resolve(port);
    });
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
 * Start the full dashboard server
 *
 * This is the main entry point used by the CLI.
 * Supports two calling conventions for backwards compatibility.
 */
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

  const {
    port,
    dataDir,
    teamDir,
    dbPath,
    enableSpawner,
    projectRoot,
    onMarkSpawning,
    onClearSpawning,
  } = options;

  console.log('[dashboard] Starting full dashboard server...');

  // Create Express app
  const app: Express = express();
  const server = createHttpServer(app);

  // Server context for route handlers
  const context: ServerContext = {
    dataDir,
    teamDir,
    dbPath,
    projectRoot: projectRoot ?? dataDir,
    defaultWorkspaceId: process.env.RELAY_WORKSPACE_ID ?? process.env.AGENT_RELAY_WORKSPACE_ID,
    enableSpawner,
    onMarkSpawning,
    onClearSpawning,
  };

  // Middleware
  app.use(express.json({ limit: '10mb' }));

  // CORS for development
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Register modular routes
  registerRoutes({
    app,
    context,
    mode: 'full',
    getAgentCount: () => agentStates.size,
    getMessageCount: () => 0, // TODO: implement
  });

  // Serve static dashboard files
  const dashboardDir = findDashboardDir();
  if (dashboardDir) {
    console.log(`[dashboard] Serving static files from: ${dashboardDir}`);
    app.use(express.static(dashboardDir, { extensions: ['html'] }));

    // SPA fallback
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api') || req.path.includes('.')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      if (req.path.startsWith('/app')) {
        res.sendFile(path.join(dashboardDir, 'app.html'));
        return;
      }

      res.sendFile(path.join(dashboardDir, 'index.html'));
    });
  } else {
    console.warn('[dashboard] Warning: Dashboard static files not found');
    app.get('/', (_req: Request, res: Response) => {
      res.json({
        message: 'Dashboard API is running',
        note: 'Static files not found. Install @agent-relay/dashboard for the UI.',
      });
    });
  }

  // WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleWebSocketConnection(ws);
      });
    } else {
      socket.destroy();
    }
  });

  // Find available port and start listening
  const actualPort = await findAvailablePort(server, port);

  if (actualPort !== port) {
    console.log(`[dashboard] Port ${port} in use, using port ${actualPort}`);
  }

  console.log(`[dashboard] Server running at http://localhost:${actualPort}`);

  return actualPort;
}

/**
 * Handle WebSocket connections
 */
function handleWebSocketConnection(ws: WebSocket): void {
  console.log('[dashboard] WebSocket client connected');
  connectedClients.add(ws);

  // Send current agent states
  const agents = Array.from(agentStates.entries()).map(([name, data]) => ({
    name,
    ...data.state,
    lastSeen: new Date(data.lastSeen).toISOString(),
  }));
  ws.send(JSON.stringify({ type: 'agents', agents }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWebSocketMessage(ws, msg);
    } catch {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    console.log('[dashboard] WebSocket client disconnected');
    connectedClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[dashboard] WebSocket error:', err.message);
    connectedClients.delete(ws);
  });
}

/**
 * Handle incoming WebSocket messages
 */
function handleWebSocketMessage(ws: WebSocket, msg: Record<string, unknown>): void {
  const type = msg.type as string;

  switch (type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'subscribe':
      // Send current state
      const agents = Array.from(agentStates.entries()).map(([name, data]) => ({
        name,
        ...data.state,
        lastSeen: new Date(data.lastSeen).toISOString(),
      }));
      ws.send(JSON.stringify({ type: 'agents', agents }));
      break;

    default:
      // Unknown message type - ignore
      break;
  }
}
