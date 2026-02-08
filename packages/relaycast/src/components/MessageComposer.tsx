'use client';

import { useState, useRef, useCallback, type KeyboardEvent } from 'react';

interface MessageComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  channelName: string;
}

export default function MessageComposer({ onSend, disabled, channelName }: MessageComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, []);

  return (
    <div className="border-t border-border px-6 py-3">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={`Message #${channelName}`}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm text-text placeholder:text-text-muted outline-none"
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || disabled}
          className="rounded bg-accent px-3 py-1 text-sm font-medium text-white transition disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

