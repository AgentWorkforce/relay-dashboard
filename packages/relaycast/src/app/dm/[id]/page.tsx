'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import RelaycastProvider from '@/components/RelaycastProvider';
import MessageComposer from '@/components/MessageComposer';
import { useAuthStore, useMessageStore, type Message } from '@/lib/store';
import { fetchDmMessages, sendDmMessage } from '@/lib/relay';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function shouldShowHeader(messages: Message[], index: number): boolean {
  if (index === 0) return true;
  const prev = messages[index - 1];
  const curr = messages[index];
  if (prev.agent_name !== curr.agent_name) return true;
  const diff = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
  return diff > 5 * 60 * 1000;
}

function shouldShowDateDivider(messages: Message[], index: number): boolean {
  if (index === 0) return true;
  const prevDate = new Date(messages[index - 1].created_at).toDateString();
  const currDate = new Date(messages[index].created_at).toDateString();
  return prevDate !== currDate;
}

function DmContent() {
  const params = useParams<{ id: string }>();
  const conversationId = params.id;
  const { agentToken } = useAuthStore();
  const { messagesByChannel, setMessages, appendMessage, prependMessages } = useMessageStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sending, setSending] = useState(false);

  const storeKey = `dm:${conversationId}`;
  const messages = messagesByChannel[storeKey] ?? [];

  useEffect(() => {
    if (!agentToken) return;
    setHasMore(true);
    setLoading(true);
    fetchDmMessages(agentToken, conversationId, { limit: 50 })
      .then((msgs) => {
        setMessages(storeKey, msgs);
        if (msgs.length < 50) setHasMore(false);
        setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentToken, conversationId, storeKey, setMessages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || !hasMore || !agentToken) return;
    if (el.scrollTop < 100 && messages.length > 0) {
      setLoading(true);
      fetchDmMessages(agentToken, conversationId, { limit: 50, before: messages[0].id })
        .then((older) => {
          if (older.length < 50) setHasMore(false);
          if (older.length > 0) {
            const prevHeight = el.scrollHeight;
            prependMessages(storeKey, older);
            requestAnimationFrame(() => {
              el.scrollTop = el.scrollHeight - prevHeight;
            });
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [agentToken, conversationId, storeKey, loading, hasMore, messages, prependMessages]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!agentToken) return;
      setSending(true);
      const tempMsg: Message = {
        id: `temp-${Date.now()}`,
        agent_name: 'You',
        text,
        created_at: new Date().toISOString(),
      };
      appendMessage(storeKey, tempMsg);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      try {
        await sendDmMessage(agentToken, conversationId, text);
      } catch {
        // keep optimistic message
      } finally {
        setSending(false);
      }
    },
    [agentToken, conversationId, storeKey, appendMessage],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center border-b border-border px-6 py-3">
        <h2 className="text-lg font-semibold text-text">Direct Message</h2>
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        {loading && messages.length === 0 && (
          <p className="text-sm text-text-muted">Loading messages...</p>
        )}
        {messages.map((msg, i) => (
          <div key={msg.id}>
            {shouldShowDateDivider(messages, i) && (
              <div className="my-4 flex items-center gap-3">
                <div className="flex-1 border-t border-border" />
                <span className="text-xs font-medium text-text-muted">
                  {formatDate(msg.created_at)}
                </span>
                <div className="flex-1 border-t border-border" />
              </div>
            )}
            <div className="group rounded px-2 py-0.5 hover:bg-bg-elevated -mx-2">
              {shouldShowHeader(messages, i) ? (
                <div className="mt-3">
                  <span className="text-sm font-semibold text-text">{msg.agent_name}</span>
                  <span className="ml-2 text-xs text-text-muted">{formatTime(msg.created_at)}</span>
                </div>
              ) : null}
              <p className="text-sm text-text leading-relaxed">{msg.text}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <MessageComposer onSend={handleSend} disabled={sending} channelName="DM" />
    </div>
  );
}

export default function DmPage() {
  return (
    <RelaycastProvider>
      <DmContent />
    </RelaycastProvider>
  );
}
