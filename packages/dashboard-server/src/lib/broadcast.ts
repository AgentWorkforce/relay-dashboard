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
    if (output.length === 0) return;

    const basePayload = {
      type: 'output',
      agent: agentName,
      data: output,
      content: output,
      timestamp: new Date().toISOString(),
    };
    const serializedBase = JSON.stringify(basePayload);
    const seq = state.getAgentLogBuffer(agentName).push('output', serializedBase);
    const payload = JSON.stringify({
      ...basePayload,
      seq,
    });

    if (!clients || clients.size === 0) {
      return;
    }

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
