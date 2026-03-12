'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RelayProvider, useWebSocket } from '@relaycast/react';

interface RelayConfigResponse {
  success: boolean;
  baseUrl?: string;
  apiKey?: string;
  agentToken?: string;
  agentName?: string | null;
  channels?: string[];
}

export interface RelayConfigProviderProps {
  children: React.ReactNode;
}

interface RelayConfigStatus {
  configured: boolean;
  loading: boolean;
  agentName: string | null;
}

const RelayConfigStatusContext = createContext<RelayConfigStatus>({
  configured: false,
  loading: true,
  agentName: null,
});

export function useRelayConfigStatus(): RelayConfigStatus {
  return useContext(RelayConfigStatusContext);
}

/** Default channels the dashboard agent should subscribe to via WebSocket */
const DEFAULT_CHANNELS = ['general'];

/** How long the WS must stay in reconnecting state before we try a token refresh */
const RECONNECT_STALE_MS = 10_000;

async function fetchRelayConfig(refresh = false): Promise<RelayConfigResponse | null> {
  const url = refresh ? '/api/relay-config?refresh=true' : '/api/relay-config';
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) return null;
  const payload = await response.json() as RelayConfigResponse;
  if (!payload?.success || !payload.baseUrl || !payload.apiKey || !payload.agentToken) return null;
  return payload;
}

/**
 * Child component that monitors WebSocket connection status.
 * When the connection stays in 'reconnecting' state for too long, it requests
 * a fresh token from the server and triggers a config update.
 */
function TokenRefreshMonitor({ onTokenRefresh }: { onTokenRefresh: (config: RelayConfigResponse) => void }) {
  const { status } = useWebSocket();
  const reconnectingSinceRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    if (status === 'reconnecting') {
      if (reconnectingSinceRef.current === null) {
        reconnectingSinceRef.current = Date.now();
      }

      const elapsed = Date.now() - reconnectingSinceRef.current;
      if (elapsed >= RECONNECT_STALE_MS && !refreshInFlightRef.current) {
        refreshInFlightRef.current = true;
        fetchRelayConfig(true)
          .then((payload) => {
            if (payload) {
              onTokenRefresh(payload);
            }
          })
          .catch(() => {})
          .finally(() => {
            refreshInFlightRef.current = false;
          });
      } else if (elapsed < RECONNECT_STALE_MS) {
        // Schedule a check after the threshold
        const timer = setTimeout(() => {
          if (reconnectingSinceRef.current !== null && !refreshInFlightRef.current) {
            refreshInFlightRef.current = true;
            fetchRelayConfig(true)
              .then((payload) => {
                if (payload) {
                  onTokenRefresh(payload);
                }
              })
              .catch(() => {})
              .finally(() => {
                refreshInFlightRef.current = false;
              });
          }
        }, RECONNECT_STALE_MS - elapsed);
        return () => clearTimeout(timer);
      }
    } else {
      reconnectingSinceRef.current = null;
    }
  }, [status, onTokenRefresh]);

  return null;
}

export function RelayConfigProvider({ children }: RelayConfigProviderProps) {
  const [config, setConfig] = useState<RelayConfigResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetchRelayConfig()
      .then((payload) => {
        if (cancelled) return;
        if (payload) setConfig(payload);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleTokenRefresh = useCallback((newConfig: RelayConfigResponse) => {
    setConfig(newConfig);
  }, []);

  const configured = Boolean(config?.baseUrl && config.apiKey && config.agentToken);
  const providerConfig = useMemo(() => {
    if (configured) {
      return {
        baseUrl: config!.baseUrl!,
        apiKey: config!.apiKey!,
        agentToken: config!.agentToken!,
      };
    }

    return {
      baseUrl: typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1',
      apiKey: '__relay_disabled__',
      agentToken: '__relay_disabled__',
    };
  }, [configured, config]);

  // Channels to auto-subscribe on WebSocket connect/reconnect.
  const channels = useMemo(() => {
    if (!configured) return undefined;
    const serverChannels = config?.channels;
    if (Array.isArray(serverChannels) && serverChannels.length > 0) {
      return serverChannels;
    }
    return DEFAULT_CHANNELS;
  }, [configured, config?.channels]);

  return (
    <RelayConfigStatusContext.Provider value={{ configured, loading: !loaded, agentName: config?.agentName ?? null }}>
      <RelayProvider
        baseUrl={providerConfig.baseUrl}
        apiKey={providerConfig.apiKey}
        agentToken={providerConfig.agentToken}
        channels={channels}
      >
        {configured && <TokenRefreshMonitor onTokenRefresh={handleTokenRefresh} />}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {children as any}
      </RelayProvider>
    </RelayConfigStatusContext.Provider>
  );
}
