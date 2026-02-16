import React, { useState, useRef } from 'react';
import type { Reaction } from '../types';
import { ReactionPicker } from './ReactionPicker';

interface ReactionChipsProps {
  reactions: Reaction[];
  messageId: string;
  currentUser?: string;
  onToggleReaction: (messageId: string, emoji: string, hasReacted: boolean) => void;
}

export function ReactionChips({
  reactions,
  messageId,
  currentUser,
  onToggleReaction,
}: ReactionChipsProps) {
  const [showPicker, setShowPicker] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const hasReactions = reactions && reactions.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      {hasReactions && reactions.map((reaction) => {
        const hasReacted = currentUser
          ? (reaction.agents || []).includes(currentUser)
          : false;
        return (
          <button
            key={reaction.emoji}
            type="button"
            onClick={() => onToggleReaction(messageId, reaction.emoji, hasReacted)}
            className={`
              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border cursor-pointer transition-colors
              ${
                hasReacted
                  ? 'bg-accent-cyan/15 border-accent-cyan/40 text-accent-cyan'
                  : 'bg-bg-tertiary border-border-subtle text-text-muted hover:bg-bg-hover'
              }
            `}
          >
            <span>{reaction.emoji}</span>
            <span className="font-medium">{reaction.count}</span>
          </button>
        );
      })}
      <button
        ref={addBtnRef}
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs text-text-muted bg-transparent border border-border-subtle hover:bg-bg-hover cursor-pointer transition-colors"
        title="Add reaction"
      >
        +
      </button>
      {showPicker && (
        <ReactionPicker
          anchorRef={addBtnRef}
          onSelect={(emoji) => {
            const existing = reactions.find((r) => r.emoji === emoji);
            const alreadyReacted = !!(currentUser && existing?.agents.includes(currentUser));
            onToggleReaction(messageId, emoji, alreadyReacted);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
