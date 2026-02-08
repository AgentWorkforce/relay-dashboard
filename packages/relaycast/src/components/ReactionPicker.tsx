'use client';

import { useState, useRef, useEffect } from 'react';

const COMMON_EMOJI = [
  '\u{1F44D}', '\u{1F44E}', '\u{2764}\u{FE0F}', '\u{1F389}', '\u{1F604}', '\u{1F622}',
  '\u{1F525}', '\u{1F440}', '\u{1F680}', '\u{2705}', '\u{274C}', '\u{1F4AF}',
  '\u{1F914}', '\u{1F44F}', '\u{1F602}', '\u{1F64F}',
];

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
}

export default function ReactionPicker({ onSelect }: ReactionPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="rounded p-1 text-text-muted opacity-0 transition group-hover:opacity-100 hover:bg-bg-elevated hover:text-text"
        title="Add reaction"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1 grid grid-cols-8 gap-1 rounded-lg border border-border bg-bg-card p-2 shadow-lg">
          {COMMON_EMOJI.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onSelect(emoji);
                setOpen(false);
              }}
              className="rounded p-1 text-base transition hover:bg-bg-elevated"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
