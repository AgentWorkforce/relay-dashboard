import { WebSocket, type WebSocketServer } from 'ws';

export interface BridgeWebSocketDeps {
  wssBridge: WebSocketServer;
  bridgeClientAlive: WeakMap<WebSocket, boolean>;
  getBridgeData: () => Promise<unknown>;
  debug: (message: string) => void;
}

/**
 * Bridge WebSocket handler for cross-project dashboard state.
 */
export function setupBridgeWebSocket(deps: BridgeWebSocketDeps): void {
  const { wssBridge, bridgeClientAlive, getBridgeData, debug } = deps;

  wssBridge.on('connection', async (ws) => {
    debug('[dashboard] Bridge WebSocket client connected');

    // Mark client as alive initially for ping/pong keepalive.
    bridgeClientAlive.set(ws, true);

    // Handle pong responses (keep connection alive).
    ws.on('pong', () => {
      bridgeClientAlive.set(ws, true);
    });

    try {
      const data = await getBridgeData();
      const payload = JSON.stringify(data);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    } catch (err) {
      console.error('[dashboard] Failed to send initial bridge data:', err);
    }

    ws.on('error', (err) => {
      console.error('[dashboard] Bridge WebSocket client error:', err);
    });

    ws.on('close', (code, reason) => {
      debug(`[dashboard] Bridge WebSocket client disconnected, code: ${code}, reason: ${reason?.toString() || 'none'}`);
    });
  });
}
