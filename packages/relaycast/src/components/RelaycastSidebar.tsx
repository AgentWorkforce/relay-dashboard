'use client';

import { useEffect, useState } from 'react';
import { useAuthStore, useChannelStore } from '@/lib/store';
import {
  fetchChannels,
  fetchDmConversations,
  type DmConversation,
} from '@/lib/relay';

export default function RelaycastSidebar() {
  const { apiKey, agentToken, workspace, logout } = useAuthStore();
  const { channels, activeChannel, setChannels, setActiveChannel } =
    useChannelStore();
  const [dms, setDms] = useState<DmConversation[]>([]);

  useEffect(() => {
    if (!apiKey) return;
    fetchChannels(apiKey)
      .then((list) =>
        setChannels(
          list.map((c) => ({
            name: c.name,
            topic: c.topic,
            member_count: c.member_count,
          })),
        ),
      )
      .catch(() => {});
  }, [apiKey, setChannels]);

  useEffect(() => {
    if (!agentToken) return;
    fetchDmConversations(agentToken)
      .then(setDms)
      .catch(() => {});
  }, [agentToken]);

  function handleLogout() {
    logout();
    window.location.href = '/login';
  }

  return (
    <aside className="flex w-sidebar min-w-sidebar flex-col border-r border-border bg-bg-card">
      {/* Workspace header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="truncate text-sm font-semibold text-text">
          {workspace?.name ?? 'Relaycast'}
        </span>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {/* Channels */}
        <div className="mb-4">
          <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Channels
          </h3>
          <ul>
            {channels.map((ch) => (
              <li key={ch.name}>
                <button
                  onClick={() => setActiveChannel(ch.name)}
                  className={`flex w-full items-center rounded px-2 py-1 text-sm transition ${
                    activeChannel === ch.name
                      ? 'bg-accent-glow text-accent'
                      : 'text-text-muted hover:bg-bg-elevated hover:text-text'
                  }`}
                >
                  <span className="mr-1 text-text-muted">#</span>
                  <span className="truncate">{ch.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* DMs */}
        <div className="mb-4">
          <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Direct Messages
          </h3>
          <ul>
            {dms.map((dm) => (
              <li key={dm.id}>
                <button
                  className="flex w-full items-center rounded px-2 py-1 text-sm text-text-muted transition hover:bg-bg-elevated hover:text-text"
                >
                  <span className="truncate">
                    {dm.participants.join(', ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Nav links */}
        <div>
          <a
            href="/agents"
            className="flex items-center rounded px-2 py-1 text-sm text-text-muted transition hover:bg-bg-elevated hover:text-text"
          >
            Agents
          </a>
          <a
            href="/settings"
            className="flex items-center rounded px-2 py-1 text-sm text-text-muted transition hover:bg-bg-elevated hover:text-text"
          >
            Settings
          </a>
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-4 py-3">
        <button
          onClick={handleLogout}
          className="text-sm text-text-muted transition hover:text-red"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
