import { describe, expect, it, vi } from 'vitest';
import { fetchCloudMetrics } from './metrics.js';

describe('metrics proxy service', () => {
  it('proxies GET /api/metrics to cloud with workspace/auth headers', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await fetchCloudMetrics({
      env: { DASHBOARD_CLOUD_URL: 'https://cloud.example' },
      request: {
        workspaceId: 'ws_test',
        authorization: 'Bearer test-token',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://cloud.example/api/metrics');
    expect(init?.method).toBe('GET');
    expect((init?.headers as Record<string, string>)['x-workspace-id']).toBe('ws_test');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer test-token');
  });

  it('supports overriding upstream path for prometheus pass-through', async () => {
    const fetchImpl = vi.fn(async () => new Response('# metrics', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }));

    await fetchCloudMetrics({
      env: { DASHBOARD_CLOUD_URL: 'https://cloud.example' },
      upstreamPath: '/api/metrics/prometheus',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://cloud.example/api/metrics/prometheus');
  });
});
