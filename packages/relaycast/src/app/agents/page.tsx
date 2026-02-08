'use client';

import { useEffect, useState } from 'react';
import RelaycastProvider from '@/components/RelaycastProvider';
import { useAuthStore } from '@/lib/store';
import { fetchAgents, type AgentSummary } from '@/lib/relay';

function AgentsContent() {
  const { apiKey } = useAuthStore();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!apiKey) return;
    fetchAgents(apiKey)
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiKey]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center border-b border-border px-6 py-3">
        <h2 className="text-lg font-semibold text-text">Agents</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <p className="text-sm text-text-muted">Loading agents...</p>
        )}
        {!loading && agents.length === 0 && (
          <p className="text-sm text-text-muted">No agents registered.</p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <div
              key={agent.name}
              className="rounded-lg border border-border bg-bg-card p-4"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`h-3 w-3 rounded-full ${
                    agent.status === 'online'
                      ? 'bg-green'
                      : 'bg-text-muted'
                  }`}
                />
                <div>
                  <h3 className="text-sm font-semibold text-text">
                    {agent.name}
                  </h3>
                  <p className="text-xs text-text-muted">
                    {agent.type ?? 'agent'} &middot;{' '}
                    {agent.status ?? 'offline'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <RelaycastProvider>
      <AgentsContent />
    </RelaycastProvider>
  );
}
