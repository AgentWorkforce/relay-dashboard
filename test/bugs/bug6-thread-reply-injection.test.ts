/**
 * BUG 6 — Threads: reply → agent PTY injection broken
 *
 * ROOT CAUSES (two bugs in two code paths):
 *
 *   1. PROXY/STANDALONE MODE: packages/dashboard-server/src/routes/channels.ts:455-482
 *      POST /api/channels/message handler extracts username, channel, body from req.body
 *      but completely IGNORES req.body.thread. The thread parameter is lost. It then
 *      calls sendRelaycastMessage() which has no thread param in its SendRequest interface
 *      (send-strategy.ts:31-35). Message arrives at broker as regular channel message.
 *      NOTE: channels-integrated.ts:689 (broker mode) DOES correctly pass thread.
 *
 *   2. DM THREAD REPLIES: packages/dashboard-server/src/mocks/routes.ts:747
 *      POST /api/messages/:id/replies only exists in mock routes. In production
 *      (proxy/standalone), this route returns 404. The frontend useThread.ts:138
 *      falls back to api.postReply() which hits this nonexistent route.
 *
 *   3. NO PTY INJECTION PATH: Even when thread replies are stored in Relaycast,
 *      there is no mechanism to inject them into an agent's PTY session. The server
 *      would need to: look up parent message author → find their active PTY session
 *      → call sendWorkerInput(agentName, replyText). This path doesn't exist.
 *
 * FIX:
 *   1. In channels.ts:455: Extract thread from req.body, add thread to SendRequest
 *      interface, and forward through send strategies
 *   2. Add production POST /api/messages/:id/replies route (not just in mocks)
 *   3. Add PTY injection: POST /api/agents/by-name/:name/inject route that calls
 *      spawnReader.sendWorkerInput(name, text)
 *   4. When a thread reply is posted, look up parent author and inject into their PTY
 *
 * Reproduction: Post a thread reply to an agent's message, check if agent sees it
 */

import { describe, it, expect } from 'vitest';

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '4040';
const BASE = `http://localhost:${DASHBOARD_PORT}`;

describe('BUG 6 — Thread reply → PTY injection', () => {
  it('should have an endpoint to inject text into agent PTY', async () => {
    // There should be an injection route, but only /interrupt exists
    const res = await fetch(`${BASE}/api/agents/by-name/test-agent/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Thread reply test' }),
    });

    // BUG: Returns 404 because no inject route exists
    // Only /api/agents/by-name/:name/interrupt exists (spawn.ts:521)
    expect(res.status).not.toBe(404);
  });

  it('POST /api/channels/message with thread param should trigger PTY injection', async () => {
    // When posting a threaded reply, it should also inject into the agent's PTY
    const res = await fetch(`${BASE}/api/channels/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'human-user',
        channel: '#general',
        body: 'This is a thread reply',
        thread: 'parent-message-id-123',
      }),
    });

    // The message posts successfully to the channel thread,
    // but the agent never receives it in their PTY
    // This test documents the missing behavior
    if (res.status === 200) {
      const data = await res.json();
      // The response doesn't indicate whether PTY injection occurred
      // because the injection path doesn't exist
      expect(data).not.toHaveProperty('injectedTo');
    }
  });
});
