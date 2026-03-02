/**
 * Health and keep-alive route handlers.
 */

import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../lib/types.js';
import { countOnlineAgents } from '../lib/utils.js';
import { mockAgents } from '../mocks/fixtures.js';

export function registerHealthRoutes(app: Express, ctx: RouteContext): void {
  const projectName = path.basename(path.resolve(ctx.dataDir, '..'));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'relay-dashboard',
      mode: ctx.mode,
      uptime: process.uptime(),
      brokerProxyEnabled: ctx.brokerProxyEnabled,
      projectName,
    });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'relay-dashboard',
      mode: ctx.mode,
      uptime: process.uptime(),
      brokerProxyEnabled: ctx.brokerProxyEnabled,
      projectName,
    });
  });

  // Return 404 quickly for auth session — local/proxy mode has no auth
  app.get('/api/auth/session', (_req: Request, res: Response) => {
    res.status(404).json({ authenticated: false });
  });

  app.get('/keep-alive', async (_req: Request, res: Response) => {
    let activeAgentCount = 0;

    if (ctx.mode === 'mock') {
      activeAgentCount = countOnlineAgents(mockAgents);
    } else {
      try {
        const snapshot = await ctx.getRelaycastSnapshot();
        activeAgentCount = countOnlineAgents(snapshot.agents);
      } catch {
        activeAgentCount = 0;
      }
    }

    res.json({
      ok: true,
      mode: ctx.mode,
      timestamp: Date.now(),
      activeAgentCount,
    });
  });
}
