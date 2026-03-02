/**
 * BUG 3 — Invite to channel (dashboard UI) does nothing or errors
 *
 * ROOT CAUSE:
 *   File: packages/dashboard/src/components/hooks/useChannelAdmin.ts:236-256
 *   AND:  packages/dashboard-server/src/routes/channels-integrated.ts (no POST /api/channels/:channel/agents route)
 *
 *   The ChannelAdminPanel's "Add Agent" button calls useChannelAdmin.assignAgent(),
 *   which POSTs to `/api/channels/${channelId}/agents` (line 242).
 *
 *   However, this route is NOT registered in channels-integrated.ts or channels.ts.
 *   The server has:
 *     POST /api/channels/invite        (channels.ts:273) — expects {channel, invites, invitedBy}
 *     POST /api/channels/admin-join     (channels.ts:367) — expects {channel, member}
 *
 *   But NOT:
 *     POST /api/channels/:channel/agents
 *
 *   So the client's POST gets a 404 (or falls through to another handler).
 *
 *   The ChannelAdminPanel also uses a different channel ID format. The useChannelAdmin
 *   hook receives `channelId` which could be "#general" or "general", but the
 *   POST /api/channels/invite route expects the channel name WITHOUT the # prefix
 *   in the `channel` body field (normalizeChannelName strips it).
 *
 * FIX:
 *   Option A: Change useChannelAdmin.assignAgent() to call POST /api/channels/admin-join
 *             with {channel: channelId, member: agentName}
 *   Option B: Add the missing POST /api/channels/:channel/agents route to the server
 *
 * Reproduction: POST to the agent assignment endpoint
 */

import { describe, it, expect } from 'vitest';

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '4040';
const BASE = `http://localhost:${DASHBOARD_PORT}`;

describe('BUG 3 — Invite agent to channel', () => {
  it('POST /api/channels/general/agents should not 404', async () => {
    const res = await fetch(`${BASE}/api/channels/general/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'test-agent' }),
    });

    // BUG: returns 404 because this route doesn't exist
    // The server only has /api/channels/invite and /api/channels/admin-join
    expect(res.status).not.toBe(404);
  });

  it('POST /api/channels/admin-join should accept agent assignment', async () => {
    const res = await fetch(`${BASE}/api/channels/admin-join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'general',
        member: 'test-agent',
      }),
    });

    // This is the correct endpoint that exists on the server
    // but the client doesn't call it
    expect(res.status).not.toBe(404);
  });
});
