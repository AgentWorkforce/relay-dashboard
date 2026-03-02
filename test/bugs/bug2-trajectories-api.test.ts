/**
 * BUG 2 — Trajectories API returning 404 or 500
 *
 * ROOT CAUSES (three issues):
 *
 *   1. PRIMARY (404): packages/dashboard-server/src/server.ts
 *      server.ts (the integrated/startDashboard code path) NEVER imports or calls
 *      registerDataRoutes. Only proxy-server.ts does. This means in integrated mode,
 *      no trajectory routes are registered at all → 404 for all /api/trajectory/* routes.
 *      (spawn.ts does register duplicate trajectory routes and IS loaded by server.ts,
 *      but those may not function correctly.)
 *
 *   2. (500): packages/dashboard-server/src/routes/data.ts:84-117
 *      Even when routes ARE registered (proxy-server.ts path), trajectory functions
 *      are called without a projectRoot argument. They fall back to process.cwd()
 *      via findProjectRoot(), which may not contain .trajectories/ → 500 or empty data.
 *
 *   3. DUPLICATE ROUTES: Both data.ts:84-117 and spawn.ts:563-636 register the
 *      same /api/trajectory routes. First registered wins in Express.
 *
 * FIX:
 *   1. Import and call registerDataRoutes in server.ts
 *   2. Pass explicit projectRoot to trajectory functions
 *   3. Remove duplicate route registration in spawn.ts
 *
 * Reproduction: curl http://localhost:PORT/api/trajectory/history
 */

import { describe, it, expect } from 'vitest';

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '4040';
const BASE = `http://localhost:${DASHBOARD_PORT}`;

describe('BUG 2 — Trajectory API', () => {
  it('GET /api/trajectory should return trajectory status', async () => {
    const res = await fetch(`${BASE}/api/trajectory`);
    // BUG: may return 500 if .trajectories/ dir not found from cwd
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('success', true);
  });

  it('GET /api/trajectory/history should return trajectory list', async () => {
    const res = await fetch(`${BASE}/api/trajectory/history`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('trajectories');
    expect(Array.isArray(data.trajectories)).toBe(true);
  });

  it('GET /api/trajectories (plural) should NOT 404', async () => {
    // This is the likely URL the client is calling — it will 404
    // because only /api/trajectory (singular) exists
    const res = await fetch(`${BASE}/api/trajectories`);
    // BUG: returns 404 because route doesn't exist
    expect(res.status).not.toBe(404);
  });
});
