/**
 * BUG 1 — Metrics API returning 404 or 500
 *
 * ROOT CAUSE:
 *   File: packages/dashboard-server/src/routes/metrics.ts:125-146
 *   The GET /api/metrics handler proxies to a cloud upstream via fetchCloudMetrics().
 *   fetchCloudMetrics() (services/metrics.ts:16-34) uses getDashboardProxyRoute('cloudMetrics')
 *   which resolves to an upstream URL from env var (RELAY_CLOUD_URL or similar).
 *
 *   When the cloud upstream URL is NOT configured (local-only mode), fetchCloudMetrics
 *   throws "Cloud upstream URL is not configured". The handler catches this specific error
 *   and falls back to buildLocalMetrics() (line 139-141).
 *
 *   However, when the cloud upstream IS configured but unreachable (502/timeout), or
 *   returns a non-200 status, the handler forwards the upstream status directly (line 136).
 *   This means a cloud 404 or 500 gets passed through as-is to the dashboard.
 *
 *   Additionally, fetchCloudMetrics needs a workspaceId header (resolveWorkspaceId).
 *   If the client doesn't send a workspace ID (e.g., no cookie/header), the upstream
 *   may reject with 401/403, which also gets forwarded.
 *
 * FIX: Add fallback to buildLocalMetrics() when the cloud upstream returns non-200,
 *   not just when the URL isn't configured. Also handle missing workspaceId gracefully.
 *
 * Reproduction: curl http://localhost:PORT/api/metrics (when cloud is unreachable)
 */

import { describe, it, expect } from 'vitest';

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '4040';
const BASE = `http://localhost:${DASHBOARD_PORT}`;

describe('BUG 1 — GET /api/metrics', () => {
  it('should return 200 with valid JSON metrics shape', async () => {
    const res = await fetch(`${BASE}/api/metrics`);
    // BUG: This may return 404, 500, or 502 instead of 200
    expect(res.status).toBe(200);

    const data = await res.json();
    // Expected shape from buildLocalMetrics or cloud proxy
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('totalAgents');
    expect(data).toHaveProperty('onlineAgents');
    expect(data).toHaveProperty('totalMessages');
    expect(data).toHaveProperty('throughput');
    expect(data.throughput).toHaveProperty('messagesLastMinute');
    expect(data).toHaveProperty('agents');
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it('should return 200 for /api/metrics/agents', async () => {
    const res = await fetch(`${BASE}/api/metrics/agents`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('agents');
    expect(data).toHaveProperty('system');
    expect(data.system).toHaveProperty('totalMemory');
    expect(data.system).toHaveProperty('freeMemory');
  });
});
