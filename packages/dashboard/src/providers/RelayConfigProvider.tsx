'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { RelayProvider } from '@relaycast/react';

interface RelayConfigResponse {
  success: boolean;
  baseUrl?: string;
  apiKey?: string;
  agentToken?: string;
  agentName?: string | null;
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

export function RelayConfigProvider({ children }: RelayConfigProviderProps) {
  const [config, setConfig] = useState<RelayConfigResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetch('/api/relay-config', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<RelayConfigResponse>;
      })
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        if (!payload.baseUrl || !payload.apiKey || !payload.agentToken) return;
        setConfig(payload);
      })
      .catch(() => {
        // No relay-config is a valid local fallback.
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
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

  return (
    <RelayConfigStatusContext.Provider value={{ configured, loading: !loaded, agentName: config?.agentName ?? null }}>
      <RelayProvider
        baseUrl={providerConfig.baseUrl}
        apiKey={providerConfig.apiKey}
        agentToken={providerConfig.agentToken}
      >
        {children}
      </RelayProvider>
    </RelayConfigStatusContext.Provider>
  );
}
