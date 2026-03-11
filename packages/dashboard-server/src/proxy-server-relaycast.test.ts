import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Dashboard Server Relaycast snapshots', () => {
  let dataDir: string;
  let staticDir: string;

  beforeEach(() => {
    vi.resetModules();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-relaycast-data-'));
    staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-relaycast-static-'));
    fs.writeFileSync(path.join(staticDir, 'app.html'), '<!doctype html><h1>dashboard</h1>', 'utf-8');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock('./relaycast-provider.js');
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  it('includes Relaycast messages in /api/data snapshots', async () => {
    const fetchAgents = vi.fn(async () => ([
      {
        name: 'Lead',
        status: 'online',
        cli: 'codex',
        model: 'gpt-5',
        messageCount: 0,
      },
    ]));
    const fetchAllMessages = vi.fn(async () => ([
      {
        id: 'dm_msg_1',
        from: 'Lead',
        to: 'Fixer',
        content: 'DM visible in dashboard snapshot',
        timestamp: '2026-03-11T09:30:00.000Z',
      },
    ]));

    vi.doMock('./relaycast-provider.js', () => ({
      fetchAgents,
      fetchAllMessages,
      fetchChannels: vi.fn(async () => []),
      fetchChannelMembers: vi.fn(async () => []),
      fetchChannelMessages: vi.fn(async () => []),
      inviteToChannel: vi.fn(async () => ({ invited: [] })),
      joinChannel: vi.fn(async () => undefined),
      leaveChannel: vi.fn(async () => undefined),
      setChannelArchived: vi.fn(async () => undefined),
      createChannel: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ messageId: 'msg_1' })),
      loadRelaycastConfig: vi.fn(() => ({
        apiKey: 'rk_test',
        baseUrl: 'https://api.relaycast.dev',
        projectIdentity: 'relay',
      })),
    }));

    const { createServer } = await import('./proxy-server.js');
    const server = createServer({
      port: 0,
      mock: false,
      verbose: false,
      dataDir,
      staticDir,
    });

    try {
      await new Promise<void>((resolve) => {
        server.server.listen(0, () => resolve());
      });

      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }

      const response = await fetch(`http://localhost:${address.port}/api/data`);
      const payload = await response.json();

      expect(response.ok).toBe(true);
      expect(fetchAgents).toHaveBeenCalledTimes(1);
      expect(fetchAllMessages).toHaveBeenCalledTimes(1);
      expect(payload.agents).toHaveLength(1);
      expect(payload.messages).toEqual([
        expect.objectContaining({
          id: 'dm_msg_1',
          from: 'Lead',
          to: 'Fixer',
          content: 'DM visible in dashboard snapshot',
        }),
      ]);
    } finally {
      await server.close();
    }
  });
});
