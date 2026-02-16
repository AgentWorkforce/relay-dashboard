import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const EMOJIS = [
  '👍', '👎', '❤️', '🔥', '👀',
  '🎉', '😂', '🤔', '✅', '❌',
  '🚀', '💯', '⚡', '🙏', '👏',
  '🤖',
];

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function ReactionPicker({ onSelect, onClose, anchorRef }: ReactionPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Compute position from anchor element
  let top = 0;
  let left = 0;
  if (anchorRef?.current) {
    const rect = anchorRef.current.getBoundingClientRect();
    const pickerHeight = 80; // approximate height of 2-row grid
    // Prefer opening above; fall back to below if not enough space
    if (rect.top > pickerHeight + 8) {
      top = rect.top - pickerHeight - 4 + window.scrollY;
    } else {
      top = rect.bottom + 4 + window.scrollY;
    }
    left = rect.left + window.scrollX;
  }

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top,
        left,
        zIndex: 9999,
        background: 'var(--color-bg-elevated, #202030)',
        border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
        borderRadius: 8,
        padding: 8,
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          gap: 2,
        }}
      >
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onSelect(emoji);
              onClose();
            }}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              fontSize: 18,
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              transition: 'background 150ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-bg-hover, rgba(255,255,255,0.08))';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
