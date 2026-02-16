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
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        !(anchorRef?.current?.contains(e.target as Node))
      ) {
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

  // Track position from anchor element, updating on scroll/resize
  const [pos, setPos] = React.useState({ top: 0, left: 0 });

  const updatePosition = React.useCallback(() => {
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const pickerHeight = 80; // approximate height of 2-row grid
    const top = rect.top > pickerHeight + 8
      ? rect.top - pickerHeight - 4
      : rect.bottom + 4;
    setPos({ top, left: rect.left });
  }, [anchorRef]);

  useEffect(() => {
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [updatePosition]);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
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
