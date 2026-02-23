import { describe, expect, it, vi } from 'vitest';
import { fetchCloudNeedsAttention, parseNeedsAttentionAgents } from './needs-attention.js';

describe('needs-attention proxy service', () => {
  it('proxies GET /api/agents/needs-attention to cloud', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await fetchCloudNeedsAttention({
      env: { DASHBOARD_CLOUD_URL: 'https://cloud.example' },
      request: { workspaceId: 'ws_test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://cloud.example/api/agents/needs-attention');
    expect(init?.method).toBe('GET');
    expect((init?.headers as Record<string, string>)['x-workspace-id']).toBe('ws_test');
  });

  it('normalizes list/object payload shapes into a set of agent names', () => {
    const direct = parseNeedsAttentionAgents(['AgentA', 'AgentB']);
    expect(direct).toEqual(new Set(['AgentA', 'AgentB']));

    const wrapped = parseNeedsAttentionAgents({ agents: [{ name: 'AgentC' }, 'AgentD'] });
    expect(wrapped).toEqual(new Set(['AgentC', 'AgentD']));

    const nested = parseNeedsAttentionAgents({ data: { agents: [{ name: 'AgentE' }] } });
    expect(nested).toEqual(new Set(['AgentE']));
  });
});
