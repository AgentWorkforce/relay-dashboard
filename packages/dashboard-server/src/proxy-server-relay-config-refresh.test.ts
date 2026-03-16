import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Dashboard Server relay-config refresh', () => {
  let dataDir: string;
  let staticDir: string;

  beforeEach(() => {
    vi.resetModules();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-relay-config-data-'));
    staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-relay-config-static-'));
    fs.writeFileSync(path.join(staticDir, 'app.html'), '<!doctype html><h1>dashboard</h1>', 'utf-8');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock('./relaycast-provider.js');
    vi.doUnmock('./relaycast-provider-helpers.js');
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  it('reuses the refreshed in-memory token for later relay-config reads without any file persistence', async () => {
    const expectedProjectIdentity = os.userInfo().username;
    const getDashboardAgentToken = vi.fn()
      .mockResolvedValueOnce({
        token: 'agt_old',
        name: 'relay-dashboard',
      })
      .mockResolvedValueOnce({
        token: 'agt_fresh',
        name: 'relay-dashboard',
      });
    const join = vi.fn(async () => undefined);

    vi.doMock('./relaycast-provider-helpers.js', () => ({
      clearRegistrationCache: vi.fn(),
      getDashboardAgentToken,
      getWriterClient: vi.fn(async () => ({
        channels: {
          join,
        },
      })),
    }));

    const { createServer } = await import('./proxy-server.js');
      const server = createServer({
        port: 0,
        mock: false,
        verbose: false,
        dataDir,
        staticDir,
        relayApiKey: 'rk_test',
      });

    try {
      await new Promise<void>((resolve) => {
        server.server.listen(0, () => resolve());
      });

      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }

      const firstResponse = await fetch(`http://localhost:${address.port}/api/relay-config`);
      const firstPayload = await firstResponse.json();
      expect(firstResponse.ok).toBe(true);
      expect(firstPayload.agentToken).toBe('agt_old');
      expect(firstPayload.wsToken).toBe('rk_test');

      const refreshResponse = await fetch(`http://localhost:${address.port}/api/relay-config?refresh=true`);
      const refreshPayload = await refreshResponse.json();
      expect(refreshResponse.ok).toBe(true);
      expect(refreshPayload.agentToken).toBe('agt_fresh');
      expect(refreshPayload.wsToken).toBe('rk_test');
      expect(getDashboardAgentToken).toHaveBeenCalledTimes(2);
      expect(getDashboardAgentToken).toHaveBeenNthCalledWith(1, expect.objectContaining({
        apiKey: 'rk_test',
        agentToken: undefined,
      }), expectedProjectIdentity);
      expect(getDashboardAgentToken).toHaveBeenNthCalledWith(2, expect.objectContaining({
        apiKey: 'rk_test',
        agentToken: undefined,
      }), expectedProjectIdentity);

      const secondResponse = await fetch(`http://localhost:${address.port}/api/relay-config`);
      const secondPayload = await secondResponse.json();
      expect(secondResponse.ok).toBe(true);
      expect(secondPayload.agentToken).toBe('agt_fresh');
      expect(secondPayload.wsToken).toBe('rk_test');
    } finally {
      await server.close();
    }
  });
});
