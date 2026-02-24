import { useState, useEffect, useCallback, useRef } from 'react';
import { useAgent as useRelayAgent } from '@relaycast/react';
import type { MessageWithMeta as RelaycastMessageWithMeta } from '@relaycast/types';
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

function mapRelayThreadMessage(message: RelaycastMessageWithMeta): Message {
  return {
    id: message.id,
    from: message.agent_name,
    to: '*',
    content: message.text,
    timestamp: message.created_at,
    thread: (message as { thread_id?: string | null }).thread_id ?? undefined,
    replyCount: message.reply_count ?? 0,
    reactions: message.reactions ?? [],
    isRead: true,
  };
}

export function useThread({ threadId, fallbackMessages }: UseThreadOptions): UseThreadReturn {
  const relayAgent = useRelayAgent();
  const { configured: relayConfigured } = useRelayConfigStatus();
  const [parentMessage, setParentMessage] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [useFallback, setUseFallback] = useState(false);

  // Use a ref to track the active threadId for cancellation of loadMore
  const activeThreadIdRef = useRef<string | null>(null);

  // Fetch thread from API when threadId changes
  useEffect(() => {
    activeThreadIdRef.current = threadId;

    if (!threadId) {
      setParentMessage(null);
      setReplies([]);
      setHasMore(false);
      setCursor(undefined);
      setUseFallback(false);
      setIsLoading(false);
      return;
    }

    // Reset state immediately when switching threads to avoid stale data flash
    setParentMessage(null);
    setReplies([]);
    setHasMore(false);
    setCursor(undefined);
    setUseFallback(false);

    let cancelled = false;
    setIsLoading(true);

    const loadThread = async () => {
      if (relayConfigured) {
        try {
          const relayThread = await relayAgent.thread(threadId);
          if (cancelled) return;
          setIsLoading(false);
          setUseFallback(false);
          setParentMessage(mapRelayThreadMessage(relayThread.parent));
          setReplies(relayThread.replies.map(mapRelayThreadMessage));
          setHasMore(false);
          setCursor(undefined);
          return;
        } catch {
          // Fall through to REST and then client-side fallback.
        }
      }

      const result = await api.getThread(threadId, { limit: 50 });
      if (cancelled) return;
      setIsLoading(false);

      if (result.success && result.data) {
        setUseFallback(false);
        const { parent, replies: fetchedReplies, nextCursor } = result.data;
        setParentMessage(parent as Message);
        setReplies(fetchedReplies);
        setHasMore(!!nextCursor);
        setCursor(nextCursor);
      } else {
        // API not available — fall back to client-side messages.
        setUseFallback(true);
      }
    };

    void loadThread();

    return () => {
      cancelled = true;
    };
  }, [threadId, relayConfigured, relayAgent]);

  // Use fallback messages when API is unavailable
  // For topic threads, the threadId is not the id of any message — it's the `thread` field on replies.
  // So we also check for the first reply whose thread matches.
  const effectiveParent = useFallback
    ? (fallbackMessages?.find((m) => m.id === threadId)
      ?? fallbackMessages?.filter((m) => m.thread === threadId)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0]
      ?? null)
    : parentMessage;

  const effectiveReplies = useFallback
    ? (fallbackMessages?.filter((m) => m.thread === threadId && m.id !== effectiveParent?.id) ?? [])
    : replies;

  const loadMore = useCallback(async () => {
    if (relayConfigured || !threadId || !hasMore || !cursor || useFallback) return;
    const loadingThreadId = threadId;
    setIsLoading(true);
    const result = await api.getThread(threadId, { cursor, limit: 50 });
    // If thread changed while loading, discard the stale response
    if (activeThreadIdRef.current !== loadingThreadId) return;
    setIsLoading(false);
    if (result.success && result.data) {
      setReplies((prev) => [...result.data!.replies, ...prev]);
      setHasMore(!!result.data.nextCursor);
      setCursor(result.data.nextCursor);
    }
  }, [threadId, hasMore, cursor, useFallback, relayConfigured]);

  const sendReply = useCallback(
    async (text: string): Promise<boolean> => {
      if (!threadId) return false;
      if (relayConfigured) {
        try {
          const reply = await relayAgent.reply(threadId, text);
          setReplies((prev) => {
            if (prev.some((message) => message.id === reply.id)) return prev;
            return [...prev, mapRelayThreadMessage(reply)];
          });
          return true;
        } catch {
          // Fall through to REST fallback.
        }
      }

      const result = await api.postReply(threadId, text);
      if (result.success && result.data) {
        setReplies((prev) => [...prev, result.data!]);
        return true;
      }
      return false;
    },
    [threadId, relayConfigured, relayAgent],
  );

  const addReply = useCallback((reply: Message) => {
    setReplies((prev) => {
      // Deduplicate
      if (prev.some((m) => m.id === reply.id)) return prev;
      return [...prev, reply];
    });
  }, []);

  return {
    parentMessage: effectiveParent,
    replies: effectiveReplies,
    isLoading,
    hasMore: useFallback ? false : hasMore,
    loadMore,
    sendReply,
    addReply,
  };
}
