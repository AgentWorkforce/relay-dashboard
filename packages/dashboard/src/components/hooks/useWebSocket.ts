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
  /** Callback for non-data events like direct_message, channel_message */
  onEvent?: (event: WebSocketEvent) => void;
}

/** Event types received on the WebSocket (non-data messages) */
export interface WebSocketEvent {
  type: 'direct_message' | 'channel_message' | 'presence_update' | 'typing' | string;
  [key: string]: unknown;
}

export interface UseWebSocketReturn {
  data: DashboardData | null;
  isConnected: boolean;
  error: Error | null;
  connect: () => void;
  disconnect: () => void;
}

const DEFAULT_OPTIONS: Omit<Required<UseWebSocketOptions>, 'onEvent'> & { onEvent?: (event: WebSocketEvent) => void } = {
  url: '',
  autoConnect: true,
  reconnect: true,
  maxReconnectAttempts: 10,
  reconnectDelay: 1000,
  onEvent: undefined,
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
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent; // Keep ref in sync with callback prop

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
          const parsed = JSON.parse(event.data);

          // Check if this is an event message (has a 'type' field like direct_message, channel_message)
          // vs dashboard data (has agents array)
          if (parsed && typeof parsed === 'object' && 'type' in parsed && typeof parsed.type === 'string') {
            // This is an event message - route to callback
            onEventRef.current?.(parsed as WebSocketEvent);
          } else {
            // This is dashboard data - update state
            setData(parsed as DashboardData);
          }
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
