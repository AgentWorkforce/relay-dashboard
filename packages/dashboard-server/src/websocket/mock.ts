/**
 * Mock WebSocket handler — sends fixture data on connect.
 */

import { WebSocket } from 'ws';
import {
  mockAgents,
  mockMessages,
  mockSessions,
} from '../mocks/fixtures.js';

export function handleMockWebSocket(ws: WebSocket, verbose: boolean): void {
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
