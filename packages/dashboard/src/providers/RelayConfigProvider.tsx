'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RelayProvider } from '@relaycast/react';

interface RelayConfigResponse {
  success: boolean;
  baseUrl?: string;
  apiKey?: string;
  agentToken?: string;
  agentName?: string | null;
  channels?: string[];
  /** Workspace API key for WebSocket auth (stable across agent token rotation). */
  wsToken?: string;
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
const RELAY_CONFIG_CHANNEL = 'relay-dashboard:relay-config';

interface RelayConfigBroadcastMessage {
  type: 'relay-config-refreshed';
  config: RelayConfigResponse;
}

async function fetchRelayConfig(refresh = false): Promise<RelayConfigResponse | null> {
  const url = refresh ? '/api/relay-config?refresh=true' : '/api/relay-config';
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) return null;
  const payload = await response.json() as RelayConfigResponse;
  if (!hasUsableRelayConfig(payload)) return null;
  return payload;
}

function hasUsableRelayConfig(payload: RelayConfigResponse | null | undefined): payload is RelayConfigResponse {
  return Boolean(payload?.success && payload.baseUrl && payload.apiKey && payload.agentToken);
}

function sameRelayConfig(current: RelayConfigResponse | null, next: RelayConfigResponse): boolean {
  if (!current) return false;

  const currentChannels = current.channels ?? [];
  const nextChannels = next.channels ?? [];
  if (currentChannels.length !== nextChannels.length) return false;
  if (currentChannels.some((channel, index) => channel !== nextChannels[index])) return false;

  return current.baseUrl === next.baseUrl
    && current.apiKey === next.apiKey
    && current.agentToken === next.agentToken
    && current.wsToken === next.wsToken
    && current.agentName === next.agentName;
}

function isRelaycastUrl(url: string, baseUrl: string): boolean {
  return url.startsWith(`${baseUrl.replace(/\/+$/, '')}/`);
}

function extractRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function buildHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

function getBearerToken(headers: Headers): string | null {
  const authorization = headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice(7);
}

function withBearerToken(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return {
    ...init,
    headers,
  };
}

export function RelayConfigProvider({ children }: RelayConfigProviderProps) {
  const [config, setConfig] = useState<RelayConfigResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const configRef = useRef<RelayConfigResponse | null>(null);
  const refreshPromiseRef = useRef<Promise<RelayConfigResponse | null> | null>(null);

  const applyRelayConfig = useCallback((nextConfig: RelayConfigResponse, options?: { broadcast?: boolean }) => {
    if (!hasUsableRelayConfig(nextConfig)) return;

    configRef.current = nextConfig;
    setConfig((current) => (sameRelayConfig(current, nextConfig) ? current : nextConfig));
    setLoaded(true);

    if (options?.broadcast) {
      try {
        const message: RelayConfigBroadcastMessage = {
          type: 'relay-config-refreshed',
          config: nextConfig,
        };
        broadcastChannelRef.current?.postMessage(message);
      } catch {
        // BroadcastChannel is best-effort only.
      }
    }
  }, []);

  const refreshAgentToken = useCallback(async (): Promise<RelayConfigResponse | null> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const promise = fetchRelayConfig(true)
      .then((payload) => {
        if (payload) {
          applyRelayConfig(payload, { broadcast: true });
        }
        return payload;
      })
      .catch(() => null)
      .finally(() => {
        if (refreshPromiseRef.current === promise) {
          refreshPromiseRef.current = null;
        }
      });

    refreshPromiseRef.current = promise;
    return promise;
  }, [applyRelayConfig]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'function') return;

    const channel = new BroadcastChannel(RELAY_CONFIG_CHANNEL);
    broadcastChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<RelayConfigBroadcastMessage>) => {
      if (event.data?.type !== 'relay-config-refreshed') return;
      applyRelayConfig(event.data.config);
    };

    return () => {
      if (broadcastChannelRef.current === channel) {
        broadcastChannelRef.current = null;
      }
      channel.close();
    };
  }, [applyRelayConfig]);

  useEffect(() => {
    let cancelled = false;

    void fetchRelayConfig()
      .then((payload) => {
        if (cancelled) return;
        if (payload) applyRelayConfig(payload);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [applyRelayConfig]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (typeof globalThis.fetch !== 'function') return;

    const originalFetch = globalThis.fetch.bind(globalThis);
    const interceptedFetch: typeof globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (response.status !== 401 && response.status !== 403) {
        return response;
      }

      const currentConfig = configRef.current;
      if (!hasUsableRelayConfig(currentConfig)) {
        return response;
      }

      const url = extractRequestUrl(input);
      if (!isRelaycastUrl(url, currentConfig.baseUrl!)) {
        return response;
      }

      const headers = buildHeaders(input, init);
      const requestToken = getBearerToken(headers);
      if (!requestToken || requestToken === currentConfig.apiKey) {
        return response;
      }

      const retryWithToken = async (token: string): Promise<Response> => {
        return originalFetch(url, withBearerToken(init, token));
      };

      if (requestToken !== currentConfig.agentToken) {
        return retryWithToken(currentConfig.agentToken!);
      }

      const refreshed = await refreshAgentToken();
      if (!hasUsableRelayConfig(refreshed) || refreshed.agentToken === requestToken) {
        return response;
      }

      return retryWithToken(refreshed.agentToken!);
    };

    globalThis.fetch = interceptedFetch;

    return () => {
      if (globalThis.fetch === interceptedFetch) {
        globalThis.fetch = originalFetch;
      }
    };
  }, [refreshAgentToken]);

  const configured = Boolean(config?.baseUrl && config.apiKey && config.agentToken);
  const providerConfig = useMemo(() => {
    if (configured) {
      return {
        baseUrl: config!.baseUrl!,
        apiKey: config!.apiKey!,
        agentToken: config!.agentToken!,
        wsToken: config!.wsToken ?? config!.apiKey!,
      };
    }

    return {
      baseUrl: typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1',
      apiKey: '__relay_disabled__',
      agentToken: '__relay_disabled__',
      wsToken: '__relay_disabled__',
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
        wsToken={providerConfig.wsToken}
        channels={channels}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {children as any}
      </RelayProvider>
    </RelayConfigStatusContext.Provider>
  );
}
