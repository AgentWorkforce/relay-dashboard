import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useThread as useRelayThread,
  useReply as useRelayReply,
} from '@relaycast/react';
import type { MessageWithMeta } from '@relaycast/sdk';
import type { Message } from '../../types';
import { api } from '../../lib/api';
import { useRelayConfigStatus } from '../../providers/RelayConfigProvider';

interface UseThreadOptions {
  threadId: string | null;
  /** Client-side fallback messages (for non-relaycast servers) */
  fallbackMessages?: Message[];
}

interface UseThreadReturn {
  parentMessage: Message | null;
  replies: Message[];
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  sendReply: (text: string) => Promise<boolean>;
  /** Append a reply from a WebSocket event */
  addReply: (reply: Message) => void;
}

function toMessage(msg: MessageWithMeta): Message {
  return {
    id: msg.id,
    from: msg.agentName ?? '',
    to: '*',
    content: msg.text,
    timestamp: msg.createdAt ?? new Date().toISOString(),
    replyCount: msg.replyCount ?? 0,
    reactions: msg.reactions ?? [],
    isRead: true,
  };
}

export function useThread({ threadId, fallbackMessages }: UseThreadOptions): UseThreadReturn {
  const { configured: relayConfigured } = useRelayConfigStatus();

  // SDK hooks — always called (hooks can't be conditional)
  const relayThread = useRelayThread(threadId ?? '');
  const { reply: relayReply } = useRelayReply();

  // REST / client-side fallback state
  const [restParent, setRestParent] = useState<Message | null>(null);
  const [restReplies, setRestReplies] = useState<Message[]>([]);
  const [restLoading, setRestLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [useFallback, setUseFallback] = useState(false);
  const activeThreadIdRef = useRef<string | null>(null);

  // REST / fallback fetch when Relaycast is not configured
  useEffect(() => {
    activeThreadIdRef.current = threadId;
    if (!threadId || relayConfigured) {
      setRestParent(null);
      setRestReplies([]);
      setHasMore(false);
      setCursor(undefined);
      setUseFallback(false);
      setRestLoading(false);
      return;
    }

    setRestParent(null);
    setRestReplies([]);
    setHasMore(false);
    setCursor(undefined);
    setUseFallback(false);

    let cancelled = false;
    setRestLoading(true);

    const loadThread = async () => {
      const result = await api.getThread(threadId, { limit: 50 });
      if (cancelled) return;
      setRestLoading(false);

      if (result.success && result.data) {
        setUseFallback(false);
        const { parent, replies: fetchedReplies, nextCursor } = result.data;
        setRestParent(parent as Message);
        setRestReplies(fetchedReplies);
        setHasMore(!!nextCursor);
        setCursor(nextCursor);
      } else {
        setUseFallback(true);
      }
    };

    void loadThread();
    return () => { cancelled = true; };
  }, [threadId, relayConfigured]);

  // --- Derive final values based on mode ---

  const isRelayMode = relayConfigured && !!threadId;

  // Relay path: map SDK MessageWithMeta → dashboard Message
  const relayParent = isRelayMode && relayThread.parent ? toMessage(relayThread.parent) : null;
  const relayReplies = isRelayMode ? relayThread.replies.map(toMessage) : [];

  // Fallback path: use client-side messages
  const fallbackParent = useFallback
    ? (fallbackMessages?.find((m) => m.id === threadId)
      ?? fallbackMessages?.filter((m) => m.thread === threadId)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0]
      ?? null)
    : null;
  const fallbackReplies = useFallback
    ? (fallbackMessages?.filter((m) => m.thread === threadId && m.id !== fallbackParent?.id) ?? [])
    : [];

  // Pick the active source
  const parentMessage = isRelayMode ? relayParent : (useFallback ? fallbackParent : restParent);
  const replies = isRelayMode ? relayReplies : (useFallback ? fallbackReplies : restReplies);
  const isLoading = isRelayMode ? relayThread.loading : restLoading;

  const loadMore = useCallback(async () => {
    if (relayConfigured || !threadId || !hasMore || !cursor || useFallback) return;
    const loadingThreadId = threadId;
    setRestLoading(true);
    const result = await api.getThread(threadId, { cursor, limit: 50 });
    if (activeThreadIdRef.current !== loadingThreadId) return;
    setRestLoading(false);
    if (result.success && result.data) {
      setRestReplies((prev) => [...result.data!.replies, ...prev]);
      setHasMore(!!result.data.nextCursor);
      setCursor(result.data.nextCursor);
    }
  }, [threadId, hasMore, cursor, useFallback, relayConfigured]);

  const sendReply = useCallback(
    async (text: string): Promise<boolean> => {
      if (!threadId) return false;
      if (relayConfigured) {
        try {
          await relayReply(threadId, text);
          return true;
        } catch {
          // Fall through to REST fallback.
        }
      }
      const result = await api.postReply(threadId, text);
      if (result.success && result.data) {
        setRestReplies((prev) => [...prev, result.data!]);
        return true;
      }
      return false;
    },
    [threadId, relayConfigured, relayReply],
  );

  const addReply = useCallback((reply: Message) => {
    setRestReplies((prev) => {
      if (prev.some((m) => m.id === reply.id)) return prev;
      return [...prev, reply];
    });
  }, []);

  return {
    parentMessage,
    replies,
    isLoading,
    hasMore: useFallback || isRelayMode ? false : hasMore,
    loadMore,
    sendReply,
    addReply,
  };
}
