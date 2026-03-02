import type { Server } from 'http';
import type { WebSocket, WebSocketServer } from 'ws';

export interface WebSocketRuntimeDeps {
  server: Server;
  wss: WebSocketServer;
  wssBridge: WebSocketServer;
  wssLogs: WebSocketServer;
  wssPresence: WebSocketServer;
  mainClientAlive: WeakMap<WebSocket, boolean>;
  bridgeClientAlive: WeakMap<WebSocket, boolean>;
  debug: (message: string) => void;
}

/**
 * Configure ping/pong health checks, HTTP upgrade routing, and server-level WS error handlers.
 */
export function setupWebSocketRuntime(deps: WebSocketRuntimeDeps): void {
  const {
    server,
    wss,
    wssBridge,
    wssLogs,
    wssPresence,
    mainClientAlive,
    bridgeClientAlive,
    debug,
  } = deps;

  const pingIntervalMs = 15000;

  const mainPingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (mainClientAlive.get(ws) === false) {
        debug('[dashboard] Main WebSocket client unresponsive, closing gracefully');
        ws.close(1000, 'unresponsive');
        return;
      }
      mainClientAlive.set(ws, false);
      ws.ping();
    });
  }, pingIntervalMs);

  const bridgePingInterval = setInterval(() => {
    wssBridge.clients.forEach((ws) => {
      if (bridgeClientAlive.get(ws) === false) {
        debug('[dashboard] Bridge WebSocket client unresponsive, closing gracefully');
        ws.close(1000, 'unresponsive');
        return;
      }
      bridgeClientAlive.set(ws, false);
      ws.ping();
    });
  }, pingIntervalMs);

  wss.on('close', () => {
    clearInterval(mainPingInterval);
  });

  wssBridge.on('close', () => {
    clearInterval(bridgePingInterval);
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host ?? 'localhost'}`).pathname;

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
      return;
    }

    if (pathname === '/ws/bridge') {
      wssBridge.handleUpgrade(request, socket, head, (ws) => {
        wssBridge.emit('connection', ws, request);
      });
      return;
    }

    if (pathname === '/ws/logs' || pathname.startsWith('/ws/logs/')) {
      wssLogs.handleUpgrade(request, socket, head, (ws) => {
        wssLogs.emit('connection', ws, request);
      });
      return;
    }

    if (pathname === '/ws/presence') {
      wssPresence.handleUpgrade(request, socket, head, (ws) => {
        wssPresence.emit('connection', ws, request);
      });
      return;
    }

    socket.destroy();
  });

  wss.on('error', (err) => {
    console.error('[dashboard] WebSocket server error:', err);
  });
  wssBridge.on('error', (err) => {
    console.error('[dashboard] Bridge WebSocket server error:', err);
  });
  wssLogs.on('error', (err) => {
    console.error('[dashboard] Logs WebSocket server error:', err);
  });
  wssPresence.on('error', (err) => {
    console.error('[dashboard] Presence WebSocket server error:', err);
  });
}
