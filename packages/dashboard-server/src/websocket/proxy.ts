/**
 * Proxy WebSocket handler — bidirectional relay to broker.
 */

import { WebSocket } from 'ws';

export function handleProxyWebSocket(ws: WebSocket, relayUrl: string, verbose: boolean, targetPath = '/ws'): void {
  const relayUrlObj = new URL(relayUrl);
  const wsProtocol = relayUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
  const relayWs = new WebSocket(`${wsProtocol}//${relayUrlObj.host}${targetPath}`);

  relayWs.on('open', () => {
    if (verbose) {
      console.log(`[dashboard] WebSocket connected to broker (${targetPath})`);
    }
  });

  ws.on('message', (data) => {
    if (relayWs.readyState === WebSocket.OPEN) {
      relayWs.send(data);
    }
  });

  relayWs.on('message', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on('close', () => {
    relayWs.close();
  });

  relayWs.on('close', () => {
    ws.close();
  });

  ws.on('error', (err) => {
    console.error('[dashboard] Client WebSocket error:', err.message);
    relayWs.close();
  });

  relayWs.on('error', (err) => {
    console.error('[dashboard] Relay WebSocket error:', err.message);
    ws.close();
  });
}
