import { WebSocket } from 'ws';
import type { ServerState } from './server-state.js';

export interface BroadcastDependencies {
  getAllData: () => Promise<unknown>;
  getBridgeData: () => Promise<unknown>;
  debug?: (message: string) => void;
}

export interface Broadcasters {
  broadcastData: () => Promise<void>;
  broadcastBridgeData: () => Promise<void>;
  broadcastPresence: (message: object, exclude?: WebSocket) => void;
  broadcastLogOutput: (agentName: string, output: string) => void;
}

/**
 * Build reusable broadcaster functions backed by shared ServerState.
 */
export function createBroadcasters(
  state: ServerState,
  deps: BroadcastDependencies,
): Broadcasters {
  let lastBroadcastPayload = '';
  let lastBridgeBroadcastPayload = '';

  // Deduplication for log output - prevent same content from being broadcast multiple times.
  // Key: agentName -> Set of recent content hashes (rolling window).
  const recentLogHashes = new Map<string, Set<string>>();
  const MAX_LOG_HASH_WINDOW = 50; // Keep last 50 hashes per agent.

  // Simple hash function for log dedup.
  const hashLogContent = (content: string): string => {
    const normalized = content.replace(/\s+/g, ' ').trim().slice(0, 200);
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  };

  const broadcastData = async (): Promise<void> => {
    try {
      const data = await deps.getAllData();

      // Skip broadcast when team data is temporarily unavailable.
      if (!data) {
        return;
      }

      const rawPayload = JSON.stringify(data);
      if (!rawPayload || rawPayload.length === 0) {
        console.warn('[dashboard] Skipping broadcast - empty payload');
        return;
      }

      if (rawPayload === lastBroadcastPayload) {
        return;
      }
      lastBroadcastPayload = rawPayload;

      const seq = state.mainMessageBuffer.push('data', rawPayload);
      const payload = JSON.stringify(
        typeof data === 'object' && data !== null
          ? { seq, ...(data as Record<string, unknown>) }
          : { seq, data },
      );

      state.refs.wss.clients.forEach((client) => {
        // Skip clients still being initialized by the connection handler.
        if (state.initializingClients.has(client)) {
          return;
        }
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(payload);
          } catch (err) {
            console.error('[dashboard] Failed to send to client:', err);
          }
        }
      });
    } catch (err) {
      console.error('[dashboard] Failed to broadcast data:', err);
    }
  };

  const broadcastBridgeData = async (): Promise<void> => {
    try {
      const data = await deps.getBridgeData();
      const payload = JSON.stringify(data);

      if (!payload || payload.length === 0) {
        console.warn('[dashboard] Skipping bridge broadcast - empty payload');
        return;
      }

      if (payload === lastBridgeBroadcastPayload) {
        return;
      }
      lastBridgeBroadcastPayload = payload;

      state.refs.wssBridge.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(payload);
          } catch (err) {
            console.error('[dashboard] Failed to send to bridge client:', err);
          }
        }
      });
    } catch (err) {
      console.error('[dashboard] Failed to broadcast bridge data:', err);
    }
  };

  const broadcastPresence = (message: object, exclude?: WebSocket): void => {
    const payload = JSON.stringify(message);
    state.refs.wssPresence.clients.forEach((client) => {
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  const broadcastLogOutput = (agentName: string, output: string): void => {
    const clients = state.logSubscriptions.get(agentName);
    if (!clients || clients.size === 0) return;

    const trimmed = output.trim();
    if (!trimmed) return;

    const hash = hashLogContent(output);
    let agentHashes = recentLogHashes.get(agentName);
    if (!agentHashes) {
      agentHashes = new Set();
      recentLogHashes.set(agentName, agentHashes);
    }

    if (agentHashes.has(hash)) {
      return;
    }

    agentHashes.add(hash);
    if (agentHashes.size > MAX_LOG_HASH_WINDOW) {
      const oldest = agentHashes.values().next().value;
      if (oldest !== undefined) {
        agentHashes.delete(oldest);
      }
    }

    const logPayload = {
      type: 'output',
      agent: agentName,
      data: output,
      timestamp: new Date().toISOString(),
    };
    const payload = JSON.stringify(logPayload);

    state.getAgentLogBuffer(agentName).push('output', payload);

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }

    if (deps.debug) {
      deps.debug(`[dashboard] Broadcasted log output for ${agentName} to ${clients.size} client(s)`);
    }
  };

  return {
    broadcastData,
    broadcastBridgeData,
    broadcastPresence,
    broadcastLogOutput,
  };
}
