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

/** Broker event payload forwarded by the dashboard server */
interface BrokerEvent {
  kind: string;
  name?: string;
  from?: string;
  target?: string;
  body?: string;
  event_id?: string;
  thread_id?: string | null;
  code?: number | null;
  signal?: string | null;
  cli?: string | null;
  model?: string | null;
  runtime?: string;
  reason?: string;
  idle_secs?: number;
  restart_count?: number;
  delivery_id?: string;
  error?: unknown;
  stream?: string;
  chunk?: string;
}

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

/**
 * Apply an incremental broker event to the current dashboard state.
 * Returns a new state object with the event applied, or the previous state
 * if the event is not relevant for the UI.
 */
export function applyBrokerEvent(prev: DashboardData | null, event: BrokerEvent): DashboardData | null {
  if (!prev) {
    // Bootstrap empty state so events arriving before the snapshot aren't lost
    prev = { agents: [], messages: [] };
  }

  switch (event.kind) {
    case 'relay_inbound': {
      if (!event.from || !event.target || !event.body) return prev;
      // Channel messages are handled by useChannels — skip here to avoid duplication
      if (event.target.startsWith('#')) return prev;
      const msgId = event.event_id || `broker_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      // Deduplicate by event_id — the same event can arrive via multiple paths
      if (event.event_id && prev.messages.some((m) => m.id === event.event_id)) {
        return prev;
      }
      const newMessage: Message = {
        id: msgId,
        from: event.from,
        to: event.target,
        content: event.body,
        timestamp: new Date().toISOString(),
        thread: event.thread_id ?? undefined,
        isBroadcast: event.target === '*',
      };
      // Clear thinking/processing state only when a known processing agent sends a response
      const senderIsProcessingAgent = prev.agents.some(
        (a) => a.name === event.from && a.isProcessing,
      );
      return {
        ...prev,
        messages: [...prev.messages, newMessage],
        agents: senderIsProcessingAgent
          ? prev.agents.map((a) =>
              a.name === event.from
                ? { ...a, isProcessing: false, processingStartedAt: undefined, lastLogLine: undefined }
                : a,
            )
          : prev.agents,
      };
    }

    case 'agent_spawned': {
      if (!event.name) return prev;
      // Avoid duplicates
      const exists = prev.agents.some((a) => a.name === event.name);
      if (exists) {
        return {
          ...prev,
          agents: prev.agents.map((a) =>
            a.name === event.name ? { ...a, status: 'online' as const, cli: event.cli ?? a.cli, model: event.model ?? a.model } : a,
          ),
        };
      }
      return {
        ...prev,
        agents: [
          ...prev.agents,
          {
            name: event.name,
            status: 'online' as const,
            cli: event.cli ?? undefined,
            model: event.model ?? undefined,
            isSpawned: true,
          },
        ],
      };
    }

    case 'agent_exited': {
      if (!event.name) return prev;
      return {
        ...prev,
        agents: prev.agents.filter((a) => a.name !== event.name),
      };
    }

    case 'agent_released': {
      if (!event.name) return prev;
      return {
        ...prev,
        agents: prev.agents.filter((a) => a.name !== event.name),
      };
    }

    case 'worker_ready': {
      if (!event.name) return prev;
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.name === event.name
            ? { ...a, status: 'online' as const, cli: event.cli ?? a.cli, model: event.model ?? a.model }
            : a,
        ),
      };
    }

    case 'agent_idle': {
      if (!event.name) return prev;
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.name === event.name
            ? { ...a, isProcessing: false, processingStartedAt: undefined, lastLogLine: undefined }
            : a,
        ),
      };
    }

    case 'agent_restarting': {
      if (!event.name) return prev;
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.name === event.name ? { ...a, status: 'busy' as const } : a,
        ),
      };
    }

    case 'agent_restarted': {
      if (!event.name) return prev;
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.name === event.name ? { ...a, status: 'online' as const } : a,
        ),
      };
    }

    case 'agent_permanently_dead': {
      if (!event.name) return prev;
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.name === event.name ? { ...a, status: 'offline' as const } : a,
        ),
      };
    }

    case 'delivery_verified': {
      if (!event.event_id) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === event.event_id ? { ...m, status: 'acked' as const } : m,
        ),
      };
    }

    case 'delivery_failed': {
      if (!event.event_id) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === event.event_id ? { ...m, status: 'failed' as const } : m,
        ),
      };
    }

    case 'delivery_ack':
    case 'delivery_active': {
      if (!event.name) return prev;
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.name === event.name
            ? { ...a, isProcessing: true, processingStartedAt: Date.now() }
            : a,
        ),
      };
    }

    case 'worker_stream': {
      if (!event.name) return prev;
      return {
        ...prev,
        agents: prev.agents.map((a) =>
          a.name === event.name ? { ...a, lastLogLine: event.chunk } : a,
        ),
      };
    }

    case 'worker_error': {
      // Worker error — could show in agent details
      return prev;
    }

    default:
      return prev;
  }
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

    // Check message type and route accordingly
    if (payload && typeof payload === 'object' && 'type' in payload && typeof payload.type === 'string') {
      // Incremental broker event — apply as state patch
      if (payload.type === 'broker_event' && payload.payload && typeof payload.payload === 'object' && 'kind' in payload.payload) {
        setData((prev) => applyBrokerEvent(prev, payload.payload as BrokerEvent));
      } else {
        // Other event messages (direct_message, channel_message, presence, etc.)
        onEventRef.current?.(payload as WebSocketEvent);
      }
    } else if (payload && typeof payload === 'object' && 'kind' in payload && typeof payload.kind === 'string') {
      // Raw (unwrapped) broker event — apply as incremental patch
      setData((prev) => applyBrokerEvent(prev, payload as BrokerEvent));
    } else {
      // Full dashboard snapshot — replace state
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
