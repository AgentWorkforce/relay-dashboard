'use client';

import { useEffect, useRef, useCallback } from 'react';
import { create } from 'zustand';
import { useAuthStore, useMessageStore, useThreadStore, type Message } from '@/lib/store';

/* ------------------------------------------------------------------ */
/*  Connection state store                                             */
/* ------------------------------------------------------------------ */

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface WsState {
  status: ConnectionState;
  setStatus: (s: ConnectionState) => void;
}

export const useWsStore = create<WsState>()((set) => ({
  status: 'disconnected',
  setStatus: (status) => set({ status }),
}));

/* ------------------------------------------------------------------ */
/*  WebSocket event types from the server                              */
/* ------------------------------------------------------------------ */

interface WsEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

const WS_URL =
  (typeof window !== 'undefined'
    ? process.env.NEXT_PUBLIC_WS_URL
    : undefined) ?? 'wss://api.relaycast.dev';

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];

export function useWebSocket() {
  const agentToken = useAuthStore((s) => s.agentToken);
  const setStatus = useWsStore((s) => s.setStatus);
  const appendMessage = useMessageStore((s) => s.appendMessage);
  const appendReply = useThreadStore((s) => s.appendReply);
  const parentMessage = useThreadStore((s) => s.parentMessage);

  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);

  const handleEvent = useCallback(
    (event: WsEvent) => {
      switch (event.type) {
        case 'message.created': {
          const msg: Message = event.data;
          if (msg.channel_name) {
            appendMessage(msg.channel_name, msg);
          }
          break;
        }
        case 'thread.reply': {
          const reply: Message = event.data;
          if (parentMessage && event.data.parent_id === parentMessage.id) {
            appendReply(reply);
          }
          break;
        }
        case 'reaction.added':
        case 'reaction.removed':
          // Future: update reactions on the specific message
          break;
        case 'channel.created':
        case 'channel.updated':
        case 'channel.deleted':
          // Future: update channel list in sidebar
          break;
        case 'agent.online':
        case 'agent.offline':
          // Future: update presence indicators
          break;
        default:
          break;
      }
    },
    [appendMessage, appendReply, parentMessage],
  );

  const connect = useCallback(() => {
    if (!agentToken || wsRef.current) return;

    setStatus('connecting');
    const ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(agentToken)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus('connected');
      retriesRef.current = 0;
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const event: WsEvent = JSON.parse(e.data);
        handleEvent(event);
      } catch {
        // ignore malformed events
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      setStatus('disconnected');

      // Reconnect with exponential backoff
      const delay =
        RECONNECT_DELAYS[
          Math.min(retriesRef.current, RECONNECT_DELAYS.length - 1)
        ];
      retriesRef.current += 1;
      setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror
      ws.close();
    };
  }, [agentToken, setStatus, handleEvent]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
}
