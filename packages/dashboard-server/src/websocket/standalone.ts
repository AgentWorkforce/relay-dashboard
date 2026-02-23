/**
 * Standalone WebSocket handler — periodic Relaycast snapshot polling.
 */

import { WebSocket } from 'ws';
import type { DashboardSnapshot } from '../lib/types.js';
import { STANDALONE_WS_POLL_MS } from '../lib/utils.js';

/**
 * Reconnect delay for broker WS connection (ms).
 */
const BROKER_WS_RECONNECT_MS = 3_000;

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

/**
 * Hybrid WebSocket handler for proxy mode.
 *
 * On connect: fetches ONE Relaycast snapshot and sends it (same as standalone).
 * Then connects to the broker's /ws endpoint for incremental real-time events.
 * The 3s polling loop is eliminated — all updates come from the broker event stream.
 *
 * Falls back to standalone polling if the broker WS is unavailable.
 */
export function handleHybridWebSocket(
  ws: WebSocket,
  getSnapshot: () => Promise<DashboardSnapshot>,
  relayUrl: string,
  verbose: boolean,
): void {
  if (verbose) {
    console.log('[dashboard] Hybrid WebSocket client connected');
  }

  let closed = false;
  let brokerWs: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackInterval: ReturnType<typeof setInterval> | null = null;
  let reconnectAttempts = 0;

  // Send initial snapshot BEFORE connecting to broker WS.
  // This ensures `data` is non-null in the browser before incremental
  // broker events arrive (which would otherwise be silently dropped).
  void getSnapshot()
    .then((snapshot) => {
      if (!closed && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(snapshot));
      }
    })
    .catch((err) => {
      if (verbose) {
        console.warn('[dashboard] Hybrid WS initial snapshot error:', (err as Error).message);
      }
    })
    .finally(() => {
      // Only start streaming broker events after the snapshot is sent
      if (!closed) {
        connectBrokerWs();
      }
    });

  /**
   * Connect to broker WS for real-time events.
   * Automatically reconnects on close with exponential backoff.
   */
  function connectBrokerWs(): void {
    if (closed) return;

    let brokerWsUrl: string;
    try {
      const relayUrlObj = new URL(relayUrl);
      const wsProtocol = relayUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      brokerWsUrl = `${wsProtocol}//${relayUrlObj.host}/ws`;
    } catch (err) {
      console.error('[dashboard] Invalid relay URL for broker WS:', relayUrl, (err as Error).message);
      startFallbackPolling();
      return;
    }

    if (verbose) {
      console.log(`[dashboard] Connecting to broker WS: ${brokerWsUrl}`);
    }

    const bws = new WebSocket(brokerWsUrl);
    brokerWs = bws;

    bws.on('open', () => {
      if (verbose) {
        console.log('[dashboard] Broker WS connected — streaming events');
      }
      reconnectAttempts = 0;
      // Stop fallback polling if it was running
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    });

    bws.on('message', (data) => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;

      try {
        const event = JSON.parse(data.toString());
        ws.send(JSON.stringify({ type: 'broker_event', payload: event }));
      } catch {
        // Forward raw if JSON parse fails
        if (verbose) {
          console.warn('[dashboard] Broker WS non-JSON message, skipping');
        }
      }
    });

    bws.on('close', () => {
      if (closed) return;
      if (verbose) {
        console.log('[dashboard] Broker WS disconnected — will reconnect');
      }
      brokerWs = null;
      // Start fallback polling while disconnected
      startFallbackPolling();
      // Schedule reconnect
      scheduleReconnect();
    });

    bws.on('error', (err) => {
      if (verbose) {
        console.warn('[dashboard] Broker WS error:', err.message);
      }
      // close event will fire after error, triggering reconnect
    });
  }

  /**
   * Schedule a broker WS reconnect after a delay.
   */
  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    const delay = Math.min(
      BROKER_WS_RECONNECT_MS * Math.pow(2, reconnectAttempts),
      30_000, // cap at 30s
    );
    reconnectAttempts++;
    if (verbose) {
      console.log(`[dashboard] Broker WS reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectBrokerWs();
    }, delay);
  }

  /**
   * Start fallback snapshot polling (used when broker WS is down).
   */
  function startFallbackPolling(): void {
    if (closed || fallbackInterval) return;
    if (verbose) {
      console.log('[dashboard] Starting fallback snapshot polling');
    }
    let lastPayload = '';
    fallbackInterval = setInterval(() => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      void getSnapshot()
        .then((snapshot) => {
          if (closed || ws.readyState !== WebSocket.OPEN) return;
          const payload = JSON.stringify(snapshot);
          if (payload !== lastPayload) {
            lastPayload = payload;
            ws.send(payload);
          }
        })
        .catch(() => {
          // Ignore — next poll will retry
        });
    }, STANDALONE_WS_POLL_MS);
  }

  /**
   * Clean up all resources.
   */
  function cleanup(): void {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }
    if (brokerWs) {
      brokerWs.close();
      brokerWs = null;
    }
  }

  // Handle client-side messages (ping, subscribe, refresh)
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (message.type === 'subscribe' || message.type === 'refresh' || message.type === 'replay') {
        // Re-send a fresh snapshot
        void getSnapshot()
          .then((snapshot) => {
            if (!closed && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(snapshot));
            }
          })
          .catch(() => {});
      }
    } catch {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    if (verbose) {
      console.log('[dashboard] Hybrid WebSocket client disconnected');
    }
    cleanup();
  });

  ws.on('error', (err) => {
    if (verbose) {
      console.warn('[dashboard] Hybrid WebSocket error:', err.message);
    }
    cleanup();
  });

  // Broker WS connection is started in the getSnapshot().finally() above
  // to ensure the initial snapshot is sent before streaming events.
}
