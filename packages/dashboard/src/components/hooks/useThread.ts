import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message } from '../../types';
import { api } from '../../lib/api';

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

export function useThread({ threadId, fallbackMessages }: UseThreadOptions): UseThreadReturn {
  const [parentMessage, setParentMessage] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [useFallback, setUseFallback] = useState(false);
  const prevThreadId = useRef<string | null>(null);

  // Fetch thread from API when threadId changes
  useEffect(() => {
    if (!threadId) {
      setParentMessage(null);
      setReplies([]);
      setHasMore(false);
      setCursor(undefined);
      setUseFallback(false);
      prevThreadId.current = null;
      return;
    }

    // Only refetch if threadId changed
    if (threadId === prevThreadId.current) return;
    prevThreadId.current = threadId;

    let cancelled = false;
    setIsLoading(true);

    api.getThread(threadId, { limit: 50 }).then((result) => {
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
        // API not available — fall back to client-side messages
        setUseFallback(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Use fallback messages when API is unavailable
  const effectiveParent = useFallback
    ? fallbackMessages?.find((m) => m.id === threadId) ?? null
    : parentMessage;

  const effectiveReplies = useFallback
    ? (fallbackMessages?.filter((m) => m.thread === threadId) ?? [])
    : replies;

  const loadMore = useCallback(async () => {
    if (!threadId || !hasMore || !cursor || useFallback) return;
    setIsLoading(true);
    const result = await api.getThread(threadId, { cursor, limit: 50 });
    setIsLoading(false);
    if (result.success && result.data) {
      setReplies((prev) => [...result.data!.replies, ...prev]);
      setHasMore(!!result.data.nextCursor);
      setCursor(result.data.nextCursor);
    }
  }, [threadId, hasMore, cursor, useFallback]);

  const sendReply = useCallback(
    async (text: string): Promise<boolean> => {
      if (!threadId) return false;
      const result = await api.postReply(threadId, text);
      if (result.success && result.data) {
        setReplies((prev) => [...prev, result.data!]);
        return true;
      }
      return false;
    },
    [threadId],
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
