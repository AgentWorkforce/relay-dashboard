import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCloudApiAdapter, setCloudCsrfToken } from './cloudFetchAdapter';

describe('createCloudApiAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setCloudCsrfToken(null);
  });

  it('includes reasoningEffort in workspace spawn requests when provided', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        name: 'codex-1',
        sandboxId: 'sandbox-1',
        status: 'online',
        cli: 'codex',
        workspaceId: 'ws-1',
        createdAt: '2026-03-17T00:00:00.000Z',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    const adapter = createCloudApiAdapter();
    await adapter.spawnAgent('ws-1', {
      name: 'codex-1',
      provider: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      cwd: 'repo-a',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/workspaces/ws-1/agents');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'codex-1',
      provider: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      cwd: 'repo-a',
    });
  });
});
