'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, type Message } from '@/lib/store';
import { searchMessages } from '@/lib/relay';

export default function SearchModal() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { apiKey } = useAuthStore();

  // Cmd+K to toggle
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open || !apiKey || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const msgs = await searchMessages(apiKey, query.trim(), { limit: 10 });
        setResults(msgs);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [open, apiKey, query]);

  const navigateToResult = useCallback(
    (msg: Message) => {
      setOpen(false);
      if (msg.channel_name) {
        router.push(`/channels/${encodeURIComponent(msg.channel_name)}`);
      }
    },
    [router],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-bg-card shadow-2xl">
        <div className="flex items-center border-b border-border px-4">
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
            className="text-text-muted"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages..."
            className="flex-1 bg-transparent px-3 py-3 text-sm text-text placeholder-text-muted outline-none"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-text-muted">
            Esc
          </kbd>
        </div>

        {loading && (
          <div className="px-4 py-3 text-sm text-text-muted">Searching...</div>
        )}

        {results.length > 0 && (
          <ul className="max-h-64 overflow-y-auto py-2">
            {results.map((msg) => (
              <li key={msg.id}>
                <button
                  onClick={() => navigateToResult(msg)}
                  className="flex w-full flex-col px-4 py-2 text-left transition hover:bg-bg-elevated"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text">
                      {msg.agent_name}
                    </span>
                    {msg.channel_name && (
                      <span className="text-xs text-text-muted">
                        #{msg.channel_name}
                      </span>
                    )}
                  </div>
                  <span className="truncate text-sm text-text-muted">
                    {msg.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div className="px-4 py-3 text-sm text-text-muted">
            No results found.
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-text-muted">
          <span>Type to search</span>
          <button
            onClick={() => {
              setOpen(false);
              router.push('/search');
            }}
            className="text-accent hover:underline"
          >
            Advanced Search
          </button>
        </div>
      </div>
    </div>
  );
}
