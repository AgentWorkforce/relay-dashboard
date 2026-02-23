import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_PROXY_ROUTE_TABLE,
  buildDashboardProxyUrl,
  getDashboardProxyRoute,
} from './proxy-route-table.js';

describe('dashboard proxy route table', () => {
  it('declares expected pass-through mappings', () => {
    expect(
      DASHBOARD_PROXY_ROUTE_TABLE.map((route) => [route.routePath, route.upstream, route.upstreamPath])
    ).toEqual([
      ['/health', 'broker', '/health'],
      ['/api/metrics', 'cloud', '/api/metrics'],
      ['/api/agents/needs-attention', 'cloud', '/api/agents/needs-attention'],
      ['/api/spawned', 'broker', '/api/spawned'],
    ]);
  });

  it('builds cloud and broker upstream URLs without rewriting endpoint paths', () => {
    const env = {
      DASHBOARD_CLOUD_URL: 'https://cloud.example',
      DASHBOARD_BROKER_URL: 'http://broker.internal:3889',
    };

    const metrics = buildDashboardProxyUrl(getDashboardProxyRoute('cloudMetrics'), { env });
    const needsAttention = buildDashboardProxyUrl(getDashboardProxyRoute('cloudNeedsAttention'), { env });
    const health = buildDashboardProxyUrl(getDashboardProxyRoute('brokerHealth'), { env });
    const spawned = buildDashboardProxyUrl(getDashboardProxyRoute('brokerSpawned'), { env });

    expect(metrics).toBe('https://cloud.example/api/metrics');
    expect(needsAttention).toBe('https://cloud.example/api/agents/needs-attention');
    expect(health).toBe('http://broker.internal:3889/health');
    expect(spawned).toBe('http://broker.internal:3889/api/spawned');
  });
});
