'use client';

import { useEffect } from 'react';
import { useChannelStore } from '@/lib/store';

const SHORTCUTS: Record<string, string> = {
  'mod+k': 'relaycast:open-search',
  'mod+n': 'relaycast:new-dm',
  Escape: 'relaycast:close-modal',
};

export default function KeyboardShortcutProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const channels = useChannelStore((s) => s.channels);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      const mod = e.metaKey || e.ctrlKey;
      let key = e.key;
      if (mod) key = `mod+${key.toLowerCase()}`;

      if (key === 'Escape' || !isInput) {
        const event = SHORTCUTS[key];
        if (event) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(event));
        }
      }

      // Arrow key channel navigation (only when not in input)
      if (!isInput && channels.length > 0) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent('relaycast:nav-channel', {
              detail: { direction: e.key === 'ArrowUp' ? 'up' : 'down' },
            }),
          );
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [channels]);

  return <>{children}</>;
}
