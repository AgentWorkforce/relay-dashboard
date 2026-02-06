/**
 * useAgentLogs Hook
 *
 * React hook for streaming live PTY output from agents via WebSocket.
 * Connects to the agent log streaming endpoint and provides real-time updates.
 *
 * Supports log replay on reconnect: tracks the last received timestamp and
 * requests missed log entries from the server after reconnecting.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWorkspaceWsUrl } from '../WorkspaceContext';

export interface LogLine {
  id: string;
  timestamp: number;
  content: string;
  type: 'stdout' | 'stderr' | 'system' | 'input';
  agentName?: string;
}

export interface UseAgentLogsOptions {
  agentName: string;
  /** Maximum number of lines to keep in buffer */
  maxLines?: number;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Enable reconnection on disconnect */
  reconnect?: boolean;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
}

/** Connection quality state for UI indicators */
export type LogConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export interface UseAgentLogsReturn {
  logs: LogLine[];
  isConnected: boolean;
  isConnecting: boolean;
  /** Granular connection quality: 'connected', 'reconnecting', or 'disconnected' */
  connectionState: LogConnectionState;
  error: Error | null;
  connect: () => void;
  disconnect: () => void;
  clear: () => void;
}

/**
 * Generate a unique ID for log lines
 */
let logIdCounter = 0;
function generateLogId(): string {
  return `log-${Date.now()}-${++logIdCounter}`;
}

export function useAgentLogs(options: UseAgentLogsOptions): UseAgentLogsReturn {
  const {
    agentName,
    maxLines = 5000,
    autoConnect = true,
    reconnect = true,
    maxReconnectAttempts = Infinity,
  } = options;

  const logStreamUrl = useWorkspaceWsUrl(`/ws/logs/${encodeURIComponent(agentName)}`);

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionState, setConnectionState] = useState<LogConnectionState>('disconnected');
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const agentNameRef = useRef(agentName);
  const shouldReconnectRef = useRef(true);
  const isConnectingRef = useRef(false);
  // Track manual close state per-WebSocket instance to avoid race conditions
  // when React remounts quickly (e.g., StrictMode). Using WeakMap ensures
  // each WebSocket tracks its own "was this a manual close" state.
  const manualCloseMapRef = useRef(new WeakMap<WebSocket, boolean>());
  // Track if we've successfully received data per-WebSocket instance
  const hasReceivedDataMapRef = useRef(new WeakMap<WebSocket, boolean>());

  // Replay support: track last received timestamp and known content for dedup
  const lastTimestampRef = useRef<number | null>(null);
  const hasConnectedBeforeRef = useRef(false);
  // Track recent log content hashes for deduplication during replay
  const recentLogHashesRef = useRef(new Set<string>());

  // Keep agent name ref updated
  agentNameRef.current = agentName;

  /**
   * Generate a simple hash for a log line to detect duplicates.
   */
  const logHash = useCallback((content: string, timestamp: number): string => {
    return `${timestamp}:${content.slice(0, 100)}`;
  }, []);

  const connect = useCallback(() => {
    // Ensure reconnects are allowed for this session
    shouldReconnectRef.current = true;

    // Prevent multiple connections - use ref to avoid dependency on state
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING ||
        isConnectingRef.current) {
      return;
    }

    // Track reconnection state
    if (hasConnectedBeforeRef.current) {
      setConnectionState('reconnecting');
    }

    isConnectingRef.current = true;
    setIsConnecting(true);
    setError(null);

    try {
      const ws = new WebSocket(logStreamUrl);
      wsRef.current = ws;
      // Initialize per-WebSocket state
      manualCloseMapRef.current.set(ws, false);
      hasReceivedDataMapRef.current.set(ws, false);

      ws.onopen = () => {
        isConnectingRef.current = false;
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionState('connected');
        setError(null);
        reconnectAttemptsRef.current = 0;

        // On reconnect, request replay of missed log entries
        if (hasConnectedBeforeRef.current && lastTimestampRef.current !== null) {
          console.log(`[WS:Logs] Requesting replay from timestamp ${lastTimestampRef.current}`);
          ws.send(JSON.stringify({
            type: 'replay',
            agent: agentNameRef.current,
            lastTimestamp: lastTimestampRef.current,
          }));
        }

        hasConnectedBeforeRef.current = true;

        // Add system message for connection
        setLogs((prev) => [
          ...prev,
          {
            id: generateLogId(),
            timestamp: Date.now(),
            content: `Connected to ${agentNameRef.current} log stream`,
            type: 'system',
            agentName: agentNameRef.current,
          },
        ]);
      };

      ws.onclose = (event) => {
        // Read per-WebSocket state (isolated from other connections)
        const wasManualClose = manualCloseMapRef.current.get(ws) ?? false;
        const hadReceivedData = hasReceivedDataMapRef.current.get(ws) ?? false;

        isConnectingRef.current = false;
        setIsConnected(false);
        setIsConnecting(false);
        wsRef.current = null;

        // Clear any pending reconnect when a close happens
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        // Skip logging/reconnecting for intentional disconnects (cleanup, user toggle)
        if (wasManualClose) {
          setConnectionState('disconnected');
          return;
        }

        // Don't reconnect if agent was not found (custom close code 4404)
        // This prevents infinite reconnect loops for non-existent agents
        if (event.code === 4404) {
          setConnectionState('disconnected');
          return;
        }

        // Add system message for disconnection, but only if:
        // 1. The close was not clean (code 1006 or similar)
        // 2. We had actually received data (to avoid false positives from transient connection issues)
        // Code 1006 is very common and happens during normal operations (React remounts,
        // network hiccups, etc.) - only show error if we had an established data stream
        if (!event.wasClean && hadReceivedData) {
          const willReconnect =
            shouldReconnectRef.current &&
            reconnect &&
            reconnectAttemptsRef.current < maxReconnectAttempts;

          setLogs((prev) => [
            ...prev,
            {
              id: generateLogId(),
              timestamp: Date.now(),
              content: willReconnect
                ? `Lost connection to log stream (code: ${event.code}). Reconnecting...`
                : `Disconnected from log stream (code: ${event.code})`,
              type: 'system',
              agentName: agentNameRef.current,
            },
          ]);
        }

        // Schedule reconnect if enabled
        if (
          shouldReconnectRef.current &&
          reconnect &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          setConnectionState('reconnecting');
          const baseDelay = Math.min(
            500 * Math.pow(2, reconnectAttemptsRef.current),
            15000
          );
          // Add jitter to prevent thundering herd
          const delay = Math.round(baseDelay * (0.5 + Math.random() * 0.5));
          reconnectAttemptsRef.current++;

          console.log(`[WS:Logs] Reconnecting (attempt ${reconnectAttemptsRef.current})...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          setConnectionState('disconnected');
        }
      };

      ws.onerror = () => {
        isConnectingRef.current = false;
        setError(new Error('WebSocket connection error'));
        setIsConnecting(false);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle error messages from server
          if (data.type === 'error') {
            setError(new Error(data.error || `Failed to stream logs for ${data.agent || agentNameRef.current}`));
            setLogs((prev) => [
              ...prev,
              {
                id: generateLogId(),
                timestamp: Date.now(),
                content: `Error: ${data.error || 'Unknown error'}`,
                type: 'system',
                agentName: data.agent || agentNameRef.current,
              },
            ]);
            return;
          }

          // Handle subscribed confirmation
          if (data.type === 'subscribed') {
            console.log(`[useAgentLogs] Subscribed to ${data.agent}`);
            return;
          }

          // Handle replay response: array of missed log entries
          if (data.type === 'replay' && Array.isArray(data.entries)) {
            hasReceivedDataMapRef.current.set(ws, true);
            setLogs((prev) => {
              const replayLines: LogLine[] = [];
              for (const entry of data.entries) {
                const content = entry.content || '';
                const timestamp = entry.timestamp || Date.now();
                const hash = logHash(content, timestamp);

                // Skip duplicates
                if (recentLogHashesRef.current.has(hash)) {
                  continue;
                }
                recentLogHashesRef.current.add(hash);

                replayLines.push({
                  id: generateLogId(),
                  timestamp,
                  content,
                  type: 'stdout' as const,
                  agentName: agentNameRef.current,
                });

                // Update last timestamp
                if (timestamp > (lastTimestampRef.current ?? 0)) {
                  lastTimestampRef.current = timestamp;
                }
              }

              if (replayLines.length === 0) return prev;
              return [...prev, ...replayLines].slice(-maxLines);
            });
            return;
          }

          // Handle history (initial log dump)
          if (data.type === 'history' && Array.isArray(data.lines)) {
            // Mark as having received data - connection is established
            if (data.lines.length > 0) {
              hasReceivedDataMapRef.current.set(ws, true);
            }
            setLogs((prev) => {
              const historyLines: LogLine[] = data.lines.map((line: string) => {
                const ts = Date.now();
                const hash = logHash(line, ts);
                recentLogHashesRef.current.add(hash);
                lastTimestampRef.current = ts;
                return {
                  id: generateLogId(),
                  timestamp: ts,
                  content: line,
                  type: 'stdout' as const,
                  agentName: data.agent || agentNameRef.current,
                };
              });
              return [...prev, ...historyLines].slice(-maxLines);
            });
            return;
          }

          // Handle different message formats - mark as having received data for all actual log messages
          if (typeof data === 'string') {
            // Simple string message
            hasReceivedDataMapRef.current.set(ws, true);
            const ts = Date.now();
            lastTimestampRef.current = ts;
            const hash = logHash(data, ts);
            recentLogHashesRef.current.add(hash);
            setLogs((prev) => {
              const newLogs = [
                ...prev,
                {
                  id: generateLogId(),
                  timestamp: ts,
                  content: data,
                  type: 'stdout' as const,
                  agentName: agentNameRef.current,
                },
              ];
              return newLogs.slice(-maxLines);
            });
          } else if (data.type === 'log' || data.type === 'output') {
            // Structured log message
            hasReceivedDataMapRef.current.set(ws, true);
            const ts = data.timestamp || Date.now();
            const content = data.content || data.data || data.message || '';
            lastTimestampRef.current = ts;
            const hash = logHash(content, ts);
            recentLogHashesRef.current.add(hash);
            setLogs((prev) => {
              const logType: LogLine['type'] = data.stream === 'stderr' ? 'stderr' : 'stdout';
              const newLogs: LogLine[] = [
                ...prev,
                {
                  id: generateLogId(),
                  timestamp: ts,
                  content,
                  type: logType,
                  agentName: data.agentName || agentNameRef.current,
                },
              ];
              return newLogs.slice(-maxLines);
            });
          } else if (data.lines && Array.isArray(data.lines)) {
            // Batch of lines
            hasReceivedDataMapRef.current.set(ws, true);
            setLogs((prev) => {
              const newLines: LogLine[] = data.lines.map((line: string | { content: string; type?: string }) => {
                const lineType: LogLine['type'] = (typeof line === 'object' && line.type === 'stderr') ? 'stderr' : 'stdout';
                const content = typeof line === 'string' ? line : line.content;
                const ts = Date.now();
                lastTimestampRef.current = ts;
                const hash = logHash(content, ts);
                recentLogHashesRef.current.add(hash);
                return {
                  id: generateLogId(),
                  timestamp: ts,
                  content,
                  type: lineType,
                  agentName: agentNameRef.current,
                };
              });
              return [...prev, ...newLines].slice(-maxLines);
            });
          }

          // Keep the dedup set from growing unbounded
          if (recentLogHashesRef.current.size > 2000) {
            const entries = Array.from(recentLogHashesRef.current);
            recentLogHashesRef.current = new Set(entries.slice(-1000));
          }
        } catch {
          // Handle plain text messages
          if (typeof event.data === 'string') {
            hasReceivedDataMapRef.current.set(ws, true);
            const ts = Date.now();
            lastTimestampRef.current = ts;
            setLogs((prev) => {
              const newLogs = [
                ...prev,
                {
                  id: generateLogId(),
                  timestamp: ts,
                  content: event.data,
                  type: 'stdout' as const,
                  agentName: agentNameRef.current,
                },
              ];
              return newLogs.slice(-maxLines);
            });
          }
        }
      };
    } catch (e) {
      isConnectingRef.current = false;
      setError(e instanceof Error ? e : new Error('Failed to create WebSocket'));
      setIsConnecting(false);
    }
  }, [logStreamUrl, maxLines, reconnect, maxReconnectAttempts, logHash]);

  const disconnect = useCallback(() => {
    // Prevent reconnection attempts after an intentional disconnect
    shouldReconnectRef.current = false;

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Mark this WebSocket as manually closed before closing it
    // This prevents the false positive error message on close
    if (wsRef.current) {
      manualCloseMapRef.current.set(wsRef.current, true);
      wsRef.current.close();
      wsRef.current = null;
    }

    isConnectingRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);
    setConnectionState('disconnected');
  }, []);

  const clear = useCallback(() => {
    setLogs([]);
    recentLogHashesRef.current.clear();
  }, []);

  // Auto-connect on mount or agent change
  useEffect(() => {
    if (autoConnect && agentName) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [agentName, autoConnect, connect, disconnect]);

  // Visibility change listener: reconnect when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Check if connection is dead and reconnect
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          console.log('[WS:Logs] Tab visible, reconnecting...');
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
    logs,
    isConnected,
    isConnecting,
    connectionState,
    error,
    connect,
    disconnect,
    clear,
  };
}
