/**
 * useWebSocket Hook
 *
 * React hook for managing WebSocket connection to the dashboard server.
 * Provides real-time updates for agents, messages, and fleet data.
 *
 * Supports message replay on reconnect: tracks the last received sequence
 * number (`seq`) and requests missed messages from the server after reconnecting.
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

/** Connection quality state for UI indicators */
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export interface UseWebSocketReturn {
  data: DashboardData | null;
  isConnected: boolean;
  /** Granular connection quality: 'connected', 'reconnecting', or 'disconnected' */
  connectionState: ConnectionState;
  error: Error | null;
  connect: () => void;
  disconnect: () => void;
}

const DEFAULT_OPTIONS: Omit<Required<UseWebSocketOptions>, 'onEvent'> & { onEvent?: (event: WebSocketEvent) => void } = {
  url: '',
  autoConnect: true,
  reconnect: true,
  maxReconnectAttempts: 10,
  reconnectDelay: 500,
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
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent; // Keep ref in sync with callback prop

  // Sequence tracking for replay support (refs to avoid re-renders)
  const lastSeqRef = useRef<number | null>(null);
  // Track whether the server supports replay (sends a 'sync' message on connect)
  const serverSupportsReplayRef = useRef(false);
  // Set of already-processed seq numbers for deduplication
  const processedSeqsRef = useRef(new Set<number>());
  // Whether this is a reconnection (not the first connection)
  const hasConnectedBeforeRef = useRef(false);

  /**
   * Process a single message payload, deduplicating by seq.
   * Returns true if the message was processed, false if skipped (duplicate).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processMessage = useCallback((parsed: any) => {
    // Extract seq if present
    const seq = typeof parsed.seq === 'number' ? parsed.seq : null;

    // Deduplicate: skip if we already processed this seq
    if (seq !== null && processedSeqsRef.current.has(seq)) {
      return false;
    }

    // Track this seq
    if (seq !== null) {
      processedSeqsRef.current.add(seq);
      lastSeqRef.current = seq;

      // Keep the set from growing unbounded - only track recent seqs
      if (processedSeqsRef.current.size > 1000) {
        const seqs = Array.from(processedSeqsRef.current).sort((a, b) => a - b);
        const toRemove = seqs.slice(0, seqs.length - 500);
        for (const s of toRemove) {
          processedSeqsRef.current.delete(s);
        }
      }
    }

    // Strip seq from the payload before routing (it's only for tracking, not data)
    const { seq: _seq, ...payload } = parsed;

    // Check if this is an event message (has a 'type' field like direct_message, channel_message)
    // vs dashboard data (has agents array)
    if (payload && typeof payload === 'object' && 'type' in payload && typeof payload.type === 'string') {
      // This is an event message - route to callback
      onEventRef.current?.(payload as WebSocketEvent);
    } else {
      // This is dashboard data - update state
      setData(payload as DashboardData);
    }

    return true;
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Compute URL at connection time (always on client)
    const wsUrl = opts.url || getDefaultUrl();

    // If we have had a prior connection, we are reconnecting
    if (hasConnectedBeforeRef.current) {
      setConnectionState('reconnecting');
    }

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionState('connected');
        setError(null);
        reconnectAttemptsRef.current = 0;

        // On reconnect, request replay of missed messages
        if (hasConnectedBeforeRef.current && lastSeqRef.current !== null && serverSupportsReplayRef.current) {
          console.log(`[WS] Requesting replay from seq ${lastSeqRef.current}`);
          ws.send(JSON.stringify({
            type: 'replay',
            lastSequenceId: lastSeqRef.current,
          }));
        }

        hasConnectedBeforeRef.current = true;
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;

        // Schedule reconnect if enabled
        if (opts.reconnect && reconnectAttemptsRef.current < opts.maxReconnectAttempts) {
          setConnectionState('reconnecting');
          const baseDelay = Math.min(
            opts.reconnectDelay * Math.pow(2, reconnectAttemptsRef.current),
            15000
          );
          // Add jitter to prevent thundering herd
          const delay = Math.round(baseDelay * (0.5 + Math.random() * 0.5));
          reconnectAttemptsRef.current++;

          console.log(`[WS] Reconnecting (attempt ${reconnectAttemptsRef.current})...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          setConnectionState('disconnected');
        }
      };

      ws.onerror = (event) => {
        setError(new Error('WebSocket connection error'));
        console.error('[useWebSocket] Error:', event);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);

          // Handle sync message from server (sent on initial connection)
          if (parsed && parsed.type === 'sync' && typeof parsed.sequenceId === 'number') {
            serverSupportsReplayRef.current = true;
            // If we don't have a lastSeq yet, initialize from server
            if (lastSeqRef.current === null) {
              lastSeqRef.current = parsed.sequenceId;
            }
            return;
          }

          // Handle replay response: array of missed messages
          if (parsed && parsed.type === 'replay' && Array.isArray(parsed.messages)) {
            for (const msg of parsed.messages) {
              processMessage(msg);
            }
            return;
          }

          // Normal message processing with dedup
          processMessage(parsed);
        } catch (e) {
          console.error('[useWebSocket] Failed to parse message:', e);
        }
      };

      wsRef.current = ws;
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to create WebSocket'));
    }
  }, [opts.url, opts.reconnect, opts.maxReconnectAttempts, opts.reconnectDelay, processMessage]);

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
    setConnectionState('disconnected');
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

  // Visibility change listener: reconnect when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Check if connection is dead and reconnect
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          console.log('[WS] Tab visible, reconnecting...');
          reconnectAttemptsRef.current = 0; // Reset attempts for visibility-triggered reconnect
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connect]);

  return {
    data,
    isConnected,
    connectionState,
    error,
    connect,
    disconnect,
  };
}
