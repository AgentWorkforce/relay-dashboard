'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import RelaycastProvider from '@/components/RelaycastProvider';
import MessageComposer from '@/components/MessageComposer';
import { useAuthStore, useMessageStore, type Message } from '@/lib/store';
import { fetchMessages, sendMessage } from '@/lib/relay';

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

function ChannelContent() {
  const params = useParams<{ name: string }>();
  const channelName = decodeURIComponent(params.name);
  const { apiKey, agentToken } = useAuthStore();
  const { messagesByChannel, setMessages, appendMessage, prependMessages } = useMessageStore();
  const messages = messagesByChannel[channelName] ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sending, setSending] = useState(false);

  // Initial load
  useEffect(() => {
    if (!apiKey) return;
    setHasMore(true);
    setLoading(true);
    fetchMessages(apiKey, channelName, { limit: 50 })
      .then((msgs) => {
        setMessages(channelName, msgs);
        if (msgs.length < 50) setHasMore(false);
        setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiKey, channelName, setMessages]);

  // Infinite scroll (upward)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || !hasMore || !apiKey) return;
    if (el.scrollTop < 100 && messages.length > 0) {
      setLoading(true);
      fetchMessages(apiKey, channelName, { limit: 50, before: messages[0].id })
        .then((older) => {
          if (older.length < 50) setHasMore(false);
          if (older.length > 0) {
            const prevHeight = el.scrollHeight;
            prependMessages(channelName, older);
            requestAnimationFrame(() => {
              el.scrollTop = el.scrollHeight - prevHeight;
            });
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [apiKey, channelName, loading, hasMore, messages, prependMessages]);

  // Send message
  const handleSend = useCallback(
    async (text: string) => {
      if (!agentToken) return;
      setSending(true);
      // Optimistic
      const tempMsg: Message = {
        id: `temp-${Date.now()}`,
        channel_name: channelName,
        agent_name: 'You',
        text,
        created_at: new Date().toISOString(),
      };
      appendMessage(channelName, tempMsg);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      try {
        await sendMessage(agentToken, channelName, text);
      } catch {
        // keep optimistic message visible
      } finally {
        setSending(false);
      }
    },
    [agentToken, channelName, appendMessage],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Channel header */}
      <header className="flex items-center border-b border-border px-6 py-3">
        <h2 className="text-lg font-semibold text-text">#{channelName}</h2>
      </header>

      {/* Messages */}
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
              {(msg.reply_count ?? 0) > 0 && (
                <button className="mt-1 text-xs text-accent hover:underline">
                  {msg.reply_count} {msg.reply_count === 1 ? 'reply' : 'replies'}
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <MessageComposer onSend={handleSend} disabled={sending} channelName={channelName} />
    </div>
  );
}

export default function ChannelPage() {
  return (
    <RelaycastProvider>
      <ChannelContent />
    </RelaycastProvider>
  );
}

