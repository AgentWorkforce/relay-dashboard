import { useEffect } from 'react';

type ShortcutMap = Record<string, () => void>;

function toKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  const key = e.key.toLowerCase();
  if (!['meta', 'control', 'shift', 'alt'].includes(key)) parts.push(key);
  return parts.join('+');
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      const combo = toKey(e);

      // Allow Escape even in inputs
      if (combo === 'escape' || !isInput) {
        const action = shortcuts[combo];
        if (action) {
          e.preventDefault();
          action();
        }
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}
