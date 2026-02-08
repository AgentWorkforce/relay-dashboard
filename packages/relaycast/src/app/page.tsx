'use client';

import { useEffect, useState } from 'react';
import RelaycastProvider from '@/components/RelaycastProvider';
import { useAuthStore } from '@/lib/store';
import {
  fetchWorkspaceStats,
  fetchActivity,
  fetchAgents,
  type WorkspaceStats,
  type ActivityItem,
  type AgentSummary,
} from '@/lib/relay';

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text">{value}</p>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const time = new Date(item.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div className="flex items-start gap-3 border-b border-white/5 py-2 last:border-0">
      <span className="mt-0.5 text-xs text-text-muted">{time}</span>
      <div className="min-w-0 flex-1">
        <span className="font-medium text-accent">{item.agent_name}</span>
        {item.channel_name && (
          <span className="text-text-muted"> in #{item.channel_name}</span>
        )}
        {item.text && (
          <p className="truncate text-sm text-text-muted">{item.text}</p>
        )}
      </div>
    </div>
  );
}

function AgentDot({ agent }: { agent: AgentSummary }) {
  const online = agent.status === 'online';
  return (
    <div className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-2">
      <span
        className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-gray-500'}`}
      />
      <span className="text-sm text-text">{agent.name}</span>
      <span className="text-xs text-text-muted">{agent.type ?? 'agent'}</span>
    </div>
  );
}

function OverviewContent() {
  const workspace = useAuthStore((s) => s.workspace);
  const apiKey = useAuthStore((s) => s.apiKey);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  useEffect(() => {
    if (!apiKey) return;
    fetchWorkspaceStats(apiKey).then(setStats).catch(() => {});
    fetchActivity(apiKey, { limit: 10 }).then(setActivity).catch(() => {});
    fetchAgents(apiKey).then(setAgents).catch(() => {});
  }, [apiKey]);

  return (
    <div className="p-8">
      <h1 className="mb-1 text-2xl font-semibold text-text">
        {workspace?.name ?? 'Relaycast'}
      </h1>
      <p className="mb-6 text-sm text-text-muted">
        {workspace?.plan ? `${workspace.plan} plan` : 'Workspace overview'}
      </p>

      {/* Stats cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Agents"
          value={
            stats
              ? `${stats.online_agents} / ${stats.total_agents}`
              : '-'
          }
        />
        <StatCard
          label="Channels"
          value={stats ? String(stats.total_channels) : '-'}
        />
        <StatCard
          label="Messages Today"
          value={stats ? String(stats.messages_today) : '-'}
        />
        <StatCard
          label="Active Conversations"
          value={stats ? String(stats.active_conversations) : '-'}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Activity feed */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
            Recent Activity
          </h2>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            {activity.length === 0 ? (
              <p className="text-sm text-text-muted">No recent activity</p>
            ) : (
              activity.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))
            )}
          </div>
        </div>

        {/* Agent grid */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
            Agents
          </h2>
          <div className="flex flex-wrap gap-2">
            {agents.length === 0 ? (
              <p className="text-sm text-text-muted">No agents registered</p>
            ) : (
              agents.map((a) => <AgentDot key={a.name} agent={a} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <RelaycastProvider>
      <OverviewContent />
    </RelaycastProvider>
  );
}
