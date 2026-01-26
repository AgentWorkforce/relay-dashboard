/**
 * useWebSocket Hook
 *
 * React hook for managing WebSocket connection to the dashboard server.
 * Provides real-time updates for agents, messages, and fleet data.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Agent, Message, Session, AgentSummary, FleetData } from '../../types';
import { getWebSocketUrl } from '../../lib/config';

export interface DashboardData {
  agents: Agent[];
  users?: Agent[]; // Human users (cli === 'dashboard')
  messages: Message[];
  sessions?: Session[];
  summaries?: AgentSummary[];
  fleet?: FleetData;
}

export interface UseWebSocketOptions {
  url?: string;
  autoConnect?: boolean;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

export interface UseWebSocketReturn {
  data: DashboardData | null;
  isConnected: boolean;
  error: Error | null;
  connect: () => void;
  disconnect: () => void;
}

const DEFAULT_OPTIONS: Required<UseWebSocketOptions> = {
  url: '',
  autoConnect: true,
  reconnect: true,
  maxReconnectAttempts: 10,
  reconnectDelay: 1000,
};

/**
 * Get the default WebSocket URL based on the current page location.
 * Uses centralized config for consistent URL resolution.
 */
function getDefaultUrl(): string {
  return getWebSocketUrl('/ws');
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [data, setData] = useState<DashboardData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Compute URL at connection time (always on client)
    const wsUrl = opts.url || getDefaultUrl();

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;

        // Schedule reconnect if enabled
        if (opts.reconnect && reconnectAttemptsRef.current < opts.maxReconnectAttempts) {
          const delay = Math.min(
            opts.reconnectDelay * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          reconnectAttemptsRef.current++;

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = (event) => {
        setError(new Error('WebSocket connection error'));
        console.error('[useWebSocket] Error:', event);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as DashboardData;
          setData(parsed);
        } catch (e) {
          console.error('[useWebSocket] Failed to parse message:', e);
        }
      };

      wsRef.current = ws;
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to create WebSocket'));
    }
  }, [opts.url, opts.reconnect, opts.maxReconnectAttempts, opts.reconnectDelay]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (opts.autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [opts.autoConnect, connect, disconnect]);

  return {
    data,
    isConnected,
    error,
    connect,
    disconnect,
  };
}
