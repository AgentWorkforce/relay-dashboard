import { WebSocket, type WebSocketServer } from 'ws';
import type { MessageBuffer } from '../messageBuffer.js';

export interface MainWebSocketDeps {
  wss: WebSocketServer;
  mainClientAlive: WeakMap<WebSocket, boolean>;
  mainMessageBuffer: MessageBuffer;
  initializingClients: WeakSet<WebSocket>;
  getAllData: () => Promise<unknown>;
  debug: (message: string) => void;
}

/**
 * Main dashboard WebSocket handler: initial snapshot + replay support.
 */
export function setupMainWebSocket(deps: MainWebSocketDeps): void {
  const {
    wss,
    mainClientAlive,
    mainMessageBuffer,
    initializingClients,
    getAllData,
    debug,
  } = deps;

  wss.on('connection', async (ws, req) => {
    debug(`[dashboard] WebSocket client connected from: ${req.socket.remoteAddress}`);

    // Mark client as alive initially for ping/pong keepalive.
    mainClientAlive.set(ws, true);

    // Handle pong responses (keep connection alive).
    ws.on('pong', () => {
      mainClientAlive.set(ws, true);
    });

    // Send current sequence ID so client can track its position.
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sync', sequenceId: mainMessageBuffer.currentId() }));
    }

    // Mark as initializing to prevent broadcaster races.
    initializingClients.add(ws);

    try {
      const data = await getAllData();

      if (!data) {
        // Team data temporarily unavailable — defer initial send.
        debug('[dashboard] Team data unavailable on connect - deferring initial send to next broadcast');
      } else if (ws.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify(data);
        debug(`[dashboard] Sending initial data, size: ${payload.length}, first 200 chars: ${payload.substring(0, 200)}`);
        ws.send(payload);
        debug('[dashboard] Initial data sent successfully');
      } else {
        console.warn('[dashboard] WebSocket not open, state:', ws.readyState);
      }
    } catch (err) {
      console.error('[dashboard] Failed to send initial data:', err);
    } finally {
      // Now allow broadcastData to send to this client.
      initializingClients.delete(ws);
    }

    // Handle replay requests.
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle replay request: { type: "replay", lastSequenceId: N }.
        if (msg.type === 'replay' && typeof msg.lastSequenceId === 'number') {
          const missed = mainMessageBuffer.getAfter(msg.lastSequenceId);
          const gapMs = missed.length > 0 ? Date.now() - missed[0].timestamp : 0;

          console.log(`[dashboard] Client replaying ${missed.length} missed messages (gap: ${gapMs}ms)`);

          // Send each missed message with its original sequence ID.
          for (const buffered of missed) {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                const original = JSON.parse(buffered.payload);
                ws.send(JSON.stringify({ seq: buffered.id, ...original }));
              } catch (err) {
                console.error('[dashboard] Failed to replay message:', err);
              }
            }
          }

          // Send current sync position after replay.
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'sync', sequenceId: mainMessageBuffer.currentId() }));
          }
        }
      } catch (err) {
        // Non-JSON messages are ignored (binary, etc.).
        debug(`[dashboard] Unhandled main WebSocket message: ${err}`);
      }
    });

    ws.on('error', (err) => {
      console.error('[dashboard] WebSocket client error:', err);
    });

    ws.on('close', (code, reason) => {
      debug(`[dashboard] WebSocket client disconnected, code: ${code}, reason: ${reason?.toString() || 'none'}`);
    });
  });
}
