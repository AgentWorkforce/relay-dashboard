import path from 'path';
import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../lib/types.js';

export function registerRelayConfigRoutes(app: Express, ctx: RouteContext): void {
  app.get('/api/relay-config', (_req: Request, res: Response) => {
    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({
        success: false,
        error: `Relaycast credentials not found in ${path.join(ctx.dataDir, 'relaycast.json')}`,
      });
      return;
    }

    if (!config.agentToken) {
      res.status(503).json({
        success: false,
        error: 'Relaycast agent token is missing from relaycast.json',
      });
      return;
    }

    res.json({
      success: true,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      agentToken: config.agentToken,
      agentName: config.agentName ?? path.basename(path.resolve(ctx.dataDir, '..')),
    });
  });
}
