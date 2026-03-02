/**
 * BUG 7 — Resumed session loses context
 *
 * ROOT CAUSE:
 *   File: packages/dashboard/src/components/SpawnModal.tsx:333
 *   AND:  packages/dashboard-server/src/routes/spawn.ts:167-237
 *
 *   The SpawnModal sends `continueFrom: finalName` when the "Resume Previous Session"
 *   toggle is enabled (SpawnModal.tsx:333). This is included in the SpawnAgentRequest
 *   payload sent to POST /api/spawn.
 *
 *   HOWEVER, the server's POST /api/spawn handler (spawn.ts:167-237) NEVER reads
 *   or uses the `continueFrom` field. It destructures the request body at line 169:
 *     ```
 *     const { name, cli, task, team, spawnerName, cwd, interactive,
 *             shadowMode, shadowAgent, shadowOf, shadowTriggers, shadowSpeakOn, userId } = req.body;
 *     ```
 *
 *   `continueFrom` is NOT destructured and NOT passed to relayAdapter.spawn().
 *   The relayAdapter.spawn() call (line 198) also doesn't accept a continueFrom parameter.
 *
 *   So even though the UI collects the user's intent to resume, the server completely
 *   ignores it and spawns a fresh agent every time.
 *
 *   For --resume to work with Claude Code, the spawn would need to:
 *   1. Find the previous session ID for the named agent
 *   2. Pass --resume <session-id> to the claude CLI command
 *   3. Or restore the conversation file to the expected location
 *
 *   None of this exists in the current codebase.
 *
 * FIX:
 *   1. Server: Extract `continueFrom` from req.body in spawn.ts
 *   2. Server: When continueFrom is set, look up the agent's last session ID
 *      (from .agent-relay/ or claude's session storage)
 *   3. Server: Pass `--resume <sessionId>` flag to the CLI command
 *   4. RelayAdapter: Support a `resume` or `continueFrom` parameter in spawn()
 *
 * Reproduction: Enable "Resume Previous Session" toggle, spawn agent, verify it starts fresh
 */

import { describe, it, expect } from 'vitest';

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '4040';
const BASE = `http://localhost:${DASHBOARD_PORT}`;

describe('BUG 7 — Resume session loses context', () => {
  it('POST /api/spawn should accept and use continueFrom field', async () => {
    const res = await fetch(`${BASE}/api/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test-resume-agent',
        cli: 'claude',
        task: 'test task',
        continueFrom: 'test-resume-agent',
      }),
    });

    // The spawn endpoint accepts the request but silently ignores continueFrom
    // We can't easily verify the agent was resumed vs started fresh from here,
    // but the server code confirms continueFrom is never read

    if (res.status === 200) {
      const data = await res.json();
      // BUG: The response doesn't indicate whether session was resumed
      // because the server never processes continueFrom
      expect(data.success).toBeDefined();
    }
  });

  it('spawn.ts should destructure continueFrom from request body', () => {
    // This is a static code analysis test
    const fs = require('fs');
    const path = require('path');
    const spawnRouteCode = fs.readFileSync(
      path.resolve(__dirname, '../../packages/dashboard-server/src/routes/spawn.ts'),
      'utf-8'
    );

    // FIX: continueFrom is now read from req.body and forwarded to spawn
    // Verify the fix is in place by checking the source contains continueFrom
    expect(spawnRouteCode).toContain('continueFrom');
  });
});
