/**
 * BUG 4 — Inter-agent DMs show in Relaycast but not in dashboard
 *
 * Regression checks for the fixed dashboard visibility path:
 * 1) non-broker DM conversations should be discoverable from threaded messages
 * 2) DM participant names should render with ↔ separators
 * 3) object-form participant payloads should resolve to readable names
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChannelSidebar from '../../packages/dashboard/src/components/ChannelSidebar';
import { ChannelChat } from '../../packages/dashboard/src/components/ChannelChat';
import type { Message } from '../../packages/dashboard/src/types/index.js';
import {
  getRelayDmParticipantName,
  normalizeRelayDmMessageTargets,
} from '../../packages/dashboard/src/lib/relaycastMessageAdapters.js';

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '4040';
const BASE = `http://localhost:${DASHBOARD_PORT}`;

function normalizeThreadInfos(messages: Message[]) {
  const messageIds = new Set(messages.map((m) => m.id));
  const threadMap = new Map<string, Message[]>();

  for (const msg of messages) {
    if (!msg.thread) continue;
    const entries = threadMap.get(msg.thread) || [];
    entries.push(msg);
    threadMap.set(msg.thread, entries);
  }

  const threads = [] as Array<{
    id: string;
    name: string;
    lastMessage: Message;
    messageCount: number;
    unreadCount: number;
    participants: string[];
  }>;

  for (const [threadId, threadMsgs] of threadMap.entries()) {
    const sorted = [...threadMsgs].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const participants = [...new Set(threadMsgs.flatMap((m) => [m.from, m.to]))].filter(
      (p) => p !== '*',
    );

    let name = threadId;
    if (messageIds.has(threadId)) {
      const originalMsg = messages.find((m) => m.id === threadId);
      if (originalMsg) {
        const firstLine = originalMsg.content.split('\n')[0];
        name = firstLine.length > 30 ? firstLine.substring(0, 30) + '...' : firstLine;
      }
    }

    threads.push({
      id: threadId,
      name,
      lastMessage: sorted[0]!,
      messageCount: threadMsgs.length,
      unreadCount: 0,
      participants,
    });
  }

  return threads.sort(
    (a, b) => new Date(b.lastMessage.timestamp).getTime() - new Date(a.lastMessage.timestamp).getTime(),
  );
}

async function sendDashboardMessage({
  from,
  to,
  content,
  thread,
}: {
  from?: string;
  to: string;
  content: string;
  thread?: string;
}): Promise<string> {
  const res = await fetch(`${BASE}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      from,
      message: content,
      thread,
    }),
  });

  expect(res.status).toBe(200);
  const payload = await res.json();
  expect(payload).toHaveProperty('messageId');
  return payload.messageId as string;
}

describe('BUG 4 — Inter-agent DM visibility in dashboard threads', () => {
  it('should include a non-broker DM thread in derived thread list data', async () => {
    const threadRootId = `dm-b4-${Date.now()}`;

    await sendDashboardMessage({
      from: 'agent-lead',
      to: 'agent-codex',
      thread: threadRootId,
      content: 'Can we coordinate next step?',
    });

    await sendDashboardMessage({
      from: 'agent-codex',
      to: 'agent-lead',
      thread: threadRootId,
      content: 'Absolutely, I can help with that.',
    });

    const dataRes = await fetch(`${BASE}/api/data`);
    expect(dataRes.status).toBe(200);

    const payload = await dataRes.json();
    const messages = Array.isArray(payload.messages)
      ? payload.messages as Message[]
      : [];

    const threadInfos = normalizeThreadInfos(messages);
    const dmThread = threadInfos.find((thread) => thread.id === threadRootId);

    expect(dmThread).toBeDefined();
    expect(dmThread?.participants).toEqual(expect.arrayContaining(['agent-lead', 'agent-codex']));
    expect(dmThread?.messageCount).toBe(2);
  });

  it('should render DM participant labels with the ↔ separator', () => {
    const sidebarHtml = renderToStaticMarkup(React.createElement(ChannelSidebar, {
      channels: ['dm:agent-lead:agent-codex'],
      selectedChannel: 'dm:agent-lead:agent-codex',
      onSelectChannel: () => {},
      onJoinChannel: () => {},
      onLeaveChannel: () => {},
      unreadCounts: {
        'dm:agent-lead:agent-codex': 1,
      },
    }));
    const chatHtml = renderToStaticMarkup(
      React.createElement(ChannelChat, {
        channel: 'dm:agent-lead:agent-codex',
        messages: [],
        currentUser: 'agent-lead',
        onSendMessage: () => Promise.resolve(true),
      })
    );

    expect(sidebarHtml).toContain('agent-lead ↔ agent-codex');
    expect(chatHtml).toContain('Start a conversation with agent-codex');
  });

  it('should resolve object-form DM participants to the opposite human-readable names', () => {
    const messages: Message[] = [
      {
        id: 'msg-obj-1',
        from: 'agent-lead',
        to: 'dm_obj_participants',
        content: 'Object-form participant payload test',
        timestamp: new Date().toISOString(),
      },
    ];

    const resolved = normalizeRelayDmMessageTargets(messages, [
      {
        id: 'dm_obj_participants',
        participants: [
          { agent_name: 'agent-lead' },
          { agentName: 'agent-codex' },
          { name: 'Ignored Alias' },
          { username: 'agent-observer' },
        ],
      },
    ]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toBeDefined();
    expect(resolved[0]?.to).toBe('agent-codex');
    expect(getRelayDmParticipantName({ agentName: 'agent-codex' })).toBe('agent-codex');
  });
});
