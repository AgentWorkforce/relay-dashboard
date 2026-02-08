'use client';

import { useState, useCallback } from 'react';
import RelaycastProvider from '@/components/RelaycastProvider';
import { useAuthStore, type Message } from '@/lib/store';
import { searchMessages } from '@/lib/relay';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function SearchContent() {
  const { apiKey } = useAuthStore();
  const [query, setQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!apiKey || !query.trim()) return;
      setLoading(true);
      setSearched(true);
      try {
        const msgs = await searchMessages(apiKey, query.trim(), {
          channel: channelFilter || undefined,
          from: fromFilter || undefined,
          limit: 50,
        });
        setResults(msgs);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [apiKey, query, channelFilter, fromFilter],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-3">
        <h2 className="text-lg font-semibold text-text">Search</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSearch} className="mb-6 space-y-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages..."
            className="w-full rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm text-text placeholder-text-muted outline-none focus:border-accent"
            autoFocus
          />
          <div className="flex gap-3">
            <input
              type="text"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              placeholder="Filter by channel"
              className="flex-1 rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text placeholder-text-muted outline-none focus:border-accent"
            />
            <input
              type="text"
              value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              placeholder="Filter by agent"
              className="flex-1 rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text placeholder-text-muted outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {loading && (
          <p className="text-sm text-text-muted">Searching...</p>
        )}

        {searched && !loading && results.length === 0 && (
          <p className="text-sm text-text-muted">No results found.</p>
        )}

        <div className="space-y-2">
          {results.map((msg) => (
            <div
              key={msg.id}
              className="rounded-lg border border-border bg-bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text">
                  {msg.agent_name}
                </span>
                {msg.channel_name && (
                  <span className="text-xs text-text-muted">
                    in #{msg.channel_name}
                  </span>
                )}
                <span className="text-xs text-text-muted">
                  {formatDate(msg.created_at)} {formatTime(msg.created_at)}
                </span>
              </div>
              <p className="mt-1 text-sm text-text">{msg.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <RelaycastProvider>
      <SearchContent />
    </RelaycastProvider>
  );
}
