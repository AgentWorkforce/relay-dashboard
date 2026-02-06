/**
 * useChannels Hook
 *
 * Manages channel-based messaging via the presence WebSocket.
 * - Join/leave channels
 * - Send/receive channel messages
 * - Send/receive direct messages
 * - Track joined channels
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWebSocketUrl } from '../../lib/config';

/** Channel message from server */
export interface ChannelMessage {
  id: string;
  type: 'channel_message' | 'direct_message';
  channel?: string;
  from: string;
  to?: string;
  body: string;
  thread?: string;
  timestamp: string;
}

export interface UseChannelsOptions {
  /** Current user info (if logged in) */
  currentUser?: {
    username: string;
    avatarUrl?: string;
  };
  /** WebSocket URL (defaults to same as main WebSocket) */
  wsUrl?: string;
  /** Whether to auto-connect */
  autoConnect?: boolean;
  /** Callback when a message is received */
  onMessage?: (message: ChannelMessage) => void;
  /** Workspace ID for cloud channel message subscription */
  workspaceId?: string;
}

/** Connection quality state for UI indicators */
export type ChannelConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export interface UseChannelsReturn {
  /** List of channels user has joined */
  channels: string[];
  /** Join a channel */
  joinChannel: (channel: string) => void;
  /** Leave a channel */
  leaveChannel: (channel: string) => void;
  /** Send a message to a channel */
  sendChannelMessage: (channel: string, body: string, thread?: string) => void;
  /** Send a direct message */
  sendDirectMessage: (to: string, body: string, thread?: string) => void;
  /** Whether connected */
  isConnected: boolean;
  /** Granular connection quality: 'connected', 'reconnecting', or 'disconnected' */
  connectionState: ChannelConnectionState;
  /** Recent messages (last 100) */
  messages: ChannelMessage[];
}

/**
 * Get the presence WebSocket URL using centralized config
 */
function getPresenceUrl(): string {
  return getWebSocketUrl('/ws/presence');
}

const MAX_MESSAGES = 100;

export function useChannels(options: UseChannelsOptions = {}): UseChannelsReturn {
  const { currentUser, wsUrl, autoConnect = true, onMessage, workspaceId } = options;

  const [channels, setChannels] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ChannelConnectionState>('disconnected');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);
  const hasConnectedBeforeRef = useRef(false);
  const currentUserRef = useRef(currentUser);
  const onMessageRef = useRef(onMessage);
  const workspaceIdRef = useRef(workspaceId);
  currentUserRef.current = currentUser;
  onMessageRef.current = onMessage;
  workspaceIdRef.current = workspaceId;

  const connect = useCallback(() => {
    const user = currentUserRef.current;
    if (!user) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (isConnectingRef.current) return;

    // Track reconnection state
    if (hasConnectedBeforeRef.current) {
      setConnectionState('reconnecting');
    }

    isConnectingRef.current = true;
    const url = wsUrl || getPresenceUrl();

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        isConnectingRef.current = false;
        setIsConnected(true);
        setConnectionState('connected');
        reconnectAttemptsRef.current = 0;
        hasConnectedBeforeRef.current = true;

        const currentUserInfo = currentUserRef.current;
        if (currentUserInfo) {
          // Announce presence (this registers with UserBridge on server)
          ws.send(JSON.stringify({
            type: 'presence',
            action: 'join',
            user: {
              username: currentUserInfo.username,
              avatarUrl: currentUserInfo.avatarUrl,
            },
          }));

          // Subscribe to channel messages for this workspace (cloud mode)
          const wsId = workspaceIdRef.current;
          if (wsId) {
            ws.send(JSON.stringify({
              type: 'subscribe_channels',
              workspaceId: wsId,
            }));
          }
        }
      };

      ws.onclose = () => {
        isConnectingRef.current = false;
        setIsConnected(false);
        wsRef.current = null;

        if (currentUserRef.current) {
          setConnectionState('reconnecting');
          const baseDelay = Math.min(
            500 * Math.pow(2, reconnectAttemptsRef.current),
            15000
          );
          // Add jitter to prevent thundering herd
          const delay = Math.round(baseDelay * (0.5 + Math.random() * 0.5));
          reconnectAttemptsRef.current++;

          console.log(`[WS:Channels] Reconnecting (attempt ${reconnectAttemptsRef.current})...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          setConnectionState('disconnected');
        }
      };

      ws.onerror = (event) => {
        console.error('[useChannels] Error:', event);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'channel_joined':
              if (msg.success) {
                setChannels((prev) => {
                  if (prev.includes(msg.channel)) return prev;
                  return [...prev, msg.channel];
                });
              }
              break;

            case 'channel_left':
              if (msg.success) {
                setChannels((prev) => prev.filter((c) => c !== msg.channel));
              }
              break;

            case 'channel_message': {
              const channelMsg: ChannelMessage = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                type: 'channel_message',
                channel: msg.channel,
                from: msg.from,
                body: msg.body,
                thread: msg.thread,
                timestamp: msg.timestamp || new Date().toISOString(),
              };
              setMessages((prev) => {
                const updated = [...prev, channelMsg];
                return updated.slice(-MAX_MESSAGES);
              });
              onMessageRef.current?.(channelMsg);
              break;
            }

            case 'direct_message': {
              const dmMsg: ChannelMessage = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                type: 'direct_message',
                from: msg.from,
                to: currentUserRef.current?.username,
                body: msg.body,
                thread: msg.thread,
                timestamp: msg.timestamp || new Date().toISOString(),
              };
              setMessages((prev) => {
                const updated = [...prev, dmMsg];
                return updated.slice(-MAX_MESSAGES);
              });
              onMessageRef.current?.(dmMsg);
              break;
            }
          }
        } catch (e) {
          console.error('[useChannels] Failed to parse message:', e);
        }
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('[useChannels] Failed to create WebSocket:', e);
    }
  }, [wsUrl]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    isConnectingRef.current = false;

    if (wsRef.current) {
      const ws = wsRef.current;
      ws.onclose = null;
      ws.onerror = null;

      const user = currentUserRef.current;
      if (ws.readyState === WebSocket.OPEN && user) {
        ws.send(JSON.stringify({
          type: 'presence',
          action: 'leave',
          username: user.username,
        }));
      }
      ws.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setConnectionState('disconnected');
    setChannels([]);
  }, []);

  const joinChannel = useCallback((channel: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'channel_join',
      channel,
    }));
  }, []);

  const leaveChannel = useCallback((channel: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'channel_leave',
      channel,
    }));
  }, []);

  const sendChannelMessage = useCallback((channel: string, body: string, thread?: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'channel_message',
      channel,
      body,
      thread,
    }));
  }, []);

  const sendDirectMessage = useCallback((to: string, body: string, thread?: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'direct_message',
      to,
      body,
      thread,
    }));
  }, []);

  // Connect when user is available
  useEffect(() => {
    if (!autoConnect || !currentUserRef.current) return;

    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      return;
    }

    connect();

    return () => {
      disconnect();
    };
  }, [autoConnect, currentUser?.username, workspaceId, connect, disconnect]);

  // Send leave on page unload
  useEffect(() => {
    const handleUnload = () => {
      const user = currentUserRef.current;
      if (wsRef.current?.readyState === WebSocket.OPEN && user) {
        wsRef.current.send(JSON.stringify({
          type: 'presence',
          action: 'leave',
          username: user.username,
        }));
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // Visibility change listener: reconnect when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Check if connection is dead and reconnect
        if (currentUserRef.current && (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)) {
          console.log('[WS:Channels] Tab visible, reconnecting...');
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
    channels,
    joinChannel,
    leaveChannel,
    sendChannelMessage,
    sendDirectMessage,
    isConnected,
    connectionState,
    messages,
  };
}
