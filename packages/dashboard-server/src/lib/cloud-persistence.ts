import type { CloudPersistenceHandler } from '@agent-relay/bridge';

/**
 * Initialize cloud persistence for session tracking via API.
 */
export async function initCloudPersistence(workspaceId: string): Promise<CloudPersistenceHandler | null> {
  if (process.env.RELAY_CLOUD_ENABLED !== 'true') {
    return null;
  }

  const cloudApiUrl = process.env.CLOUD_API_URL;
  const workspaceToken = process.env.WORKSPACE_TOKEN;

  if (!cloudApiUrl || !workspaceToken) {
    console.warn('[dashboard] Cloud persistence enabled but CLOUD_API_URL or WORKSPACE_TOKEN not set');
    return null;
  }

  console.log('[dashboard] Cloud persistence enabled (API mode)');

  const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_SESSIONS = 10000;
  const agentSessionIds = new Map<string, { id: string; lastActivity: number }>();
  const pendingSessionCreation = new Map<string, Promise<string>>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    let evicted = 0;
    for (const [name, { lastActivity }] of agentSessionIds.entries()) {
      if (now - lastActivity > SESSION_TTL_MS) {
        agentSessionIds.delete(name);
        evicted++;
      }
    }
    if (evicted > 0) {
      console.log(`[cloud] Evicted ${evicted} stale session entries`);
    }
  }, 5 * 60 * 1000);
  cleanupInterval.unref();

  const callCloudApi = async (endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await fetch(`${cloudApiUrl}/api/sessions/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${workspaceToken}`,
      },
      body: JSON.stringify({ workspaceId, ...body }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API call failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  };

  const getOrCreateSession = async (agentName: string): Promise<string> => {
    const cached = agentSessionIds.get(agentName);
    if (cached) {
      return cached.id;
    }

    const pending = pendingSessionCreation.get(agentName);
    if (pending) {
      return pending;
    }

    const creationPromise = (async () => {
      try {
        const rechecked = agentSessionIds.get(agentName);
        if (rechecked) {
          return rechecked.id;
        }

        if (agentSessionIds.size >= MAX_SESSIONS) {
          let oldest: { name: string; time: number } | null = null;
          for (const [name, { lastActivity }] of agentSessionIds.entries()) {
            if (!oldest || lastActivity < oldest.time) {
              oldest = { name, time: lastActivity };
            }
          }
          if (oldest) {
            agentSessionIds.delete(oldest.name);
            console.log(`[cloud] Evicted oldest session for ${oldest.name} (max sessions reached)`);
          }
        }

        const result = await callCloudApi('create', { agentName });
        const sessionId = result.sessionId as string;

        if (!sessionId) {
          throw new Error(`Failed to create session for agent ${agentName}`);
        }

        agentSessionIds.set(agentName, { id: sessionId, lastActivity: Date.now() });
        return sessionId;
      } finally {
        pendingSessionCreation.delete(agentName);
      }
    })();

    pendingSessionCreation.set(agentName, creationPromise);
    return creationPromise;
  };

  return {
    onSummary: async (agentName, event) => {
      try {
        const sessionId = await getOrCreateSession(agentName);
        agentSessionIds.set(agentName, { id: sessionId, lastActivity: Date.now() });

        await callCloudApi('summary', {
          sessionId,
          agentName,
          summary: event.summary,
        });

        console.log(`[cloud] Saved summary for ${agentName}: ${event.summary.currentTask || 'no task'}`);
      } catch (err) {
        console.error(`[cloud] Failed to save summary for ${agentName}:`, err);
      }
    },

    onSessionEnd: async (agentName, event) => {
      try {
        const cached = agentSessionIds.get(agentName);
        if (cached) {
          await callCloudApi('end', {
            sessionId: cached.id,
            endMarker: event.marker,
          });

          agentSessionIds.delete(agentName);
          console.log(`[cloud] Session ended for ${agentName}: ${event.marker.summary || 'no summary'}`);
        }
      } catch (err) {
        console.error(`[cloud] Failed to end session for ${agentName}:`, err);
      }
    },

    destroy: () => {
      clearInterval(cleanupInterval);
      agentSessionIds.clear();
      pendingSessionCreation.clear();
      console.log('[cloud] Cloud persistence handler destroyed');
    },
  };
}
