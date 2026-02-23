/**
 * Health and keep-alive route handlers.
 */

import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../lib/types.js';
import { countOnlineAgents } from '../lib/utils.js';
import { mockAgents } from '../mocks/fixtures.js';

export function registerHealthRoutes(app: Express, ctx: RouteContext): void {
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'relay-dashboard',
      mode: ctx.mode,
      uptime: process.uptime(),
      brokerProxyEnabled: ctx.brokerProxyEnabled,
    });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'relay-dashboard',
      mode: ctx.mode,
      uptime: process.uptime(),
      brokerProxyEnabled: ctx.brokerProxyEnabled,
    });
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
