/**
 * Health Check Routes
 *
 * Provides endpoints for monitoring server health and liveness.
 */

import { Router, type Request, type Response } from 'express';
import type { ServerContext } from '../types/index.js';

export interface HealthRouterOptions {
  context: ServerContext;
  mode: 'full' | 'proxy' | 'mock';
  getAgentCount?: () => number;
  getMessageCount?: () => number;
}

/**
 * Create health check router
 */
export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();
  const { mode, getAgentCount, getMessageCount } = options;

  /**
   * GET /health - Basic health check
   */
  router.get('/health', async (_req: Request, res: Response) => {
    const health = {
      status: 'ok',
      service: 'relay-dashboard',
      mode,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };

    res.json(health);
  });

  /**
   * GET /api/health - Detailed health check with stats
   */
  router.get('/api/health', async (_req: Request, res: Response) => {
    const agentCount = getAgentCount?.() ?? 0;
    const messageCount = getMessageCount?.() ?? 0;

    const health = {
      status: 'ok',
      service: 'relay-dashboard',
      mode,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      stats: {
        agents: agentCount,
        messages: messageCount,
      },
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
    };

    res.json(health);
  });

  /**
   * GET /keep-alive - Simple keep-alive endpoint
   */
  router.get('/keep-alive', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return router;
}
