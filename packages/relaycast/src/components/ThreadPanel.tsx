'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuthStore, useThreadStore, type Message } from '@/lib/store';
import { fetchReplies, sendReply } from '@/lib/relay';
import MessageComposer from './MessageComposer';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ThreadPanel() {
  const { apiKey, agentToken } = useAuthStore();
  const { parentMessage, replies, setReplies, appendReply, closeThread } =
    useThreadStore();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Load replies when thread opens
  useEffect(() => {
    if (!apiKey || !parentMessage) return;
    setLoading(true);
    fetchReplies(apiKey, parentMessage.id)
      .then(setReplies)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiKey, parentMessage, setReplies]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!agentToken || !parentMessage) return;
      setSending(true);
      const tempReply: Message = {
        id: `temp-reply-${Date.now()}`,
        agent_name: 'You',
        text,
        created_at: new Date().toISOString(),
      };
      appendReply(tempReply);
      try {
        await sendReply(agentToken, parentMessage.id, text);
      } catch {
        // keep optimistic reply
      } finally {
        setSending(false);
      }
    },
    [agentToken, parentMessage, appendReply],
  );

  if (!parentMessage) return null;

  return (
    <aside className="flex w-96 min-w-96 flex-col border-l border-border bg-bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text">Thread</h3>
        <button
          onClick={closeThread}
          className="text-text-muted transition hover:text-text"
          aria-label="Close thread"
        >
          &times;
        </button>
      </div>

      {/* Parent message */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-1">
          <span className="text-sm font-semibold text-text">
            {parentMessage.agent_name}
          </span>
          <span className="ml-2 text-xs text-text-muted">
            {formatTime(parentMessage.created_at)}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-text">
          {parentMessage.text}
        </p>
      </div>

      {/* Replies */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <p className="text-sm text-text-muted">Loading replies...</p>
        )}
        {!loading && replies.length === 0 && (
          <p className="text-sm text-text-muted">No replies yet.</p>
        )}
        {replies.map((reply) => (
          <div key={reply.id} className="mb-3">
            <div>
              <span className="text-sm font-semibold text-text">
                {reply.agent_name}
              </span>
              <span className="ml-2 text-xs text-text-muted">
                {formatTime(reply.created_at)}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-text">{reply.text}</p>
          </div>
        ))}
      </div>

      {/* Reply composer */}
      <MessageComposer
        onSend={handleSend}
        disabled={sending}
        channelName=""
        placeholder="Reply in thread..."
      />
    </aside>
  );
}
