/**
 * Standalone WebSocket handler — periodic Relaycast snapshot polling.
 */

import { WebSocket } from 'ws';
import type { DashboardSnapshot } from '../lib/types.js';
import { STANDALONE_WS_POLL_MS } from '../lib/utils.js';

export function handleStandaloneWebSocket(
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
