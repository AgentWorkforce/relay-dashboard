import crypto from 'crypto';
import path from 'path';
import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../lib/types.js';

export function registerRelayConfigRoutes(app: Express, ctx: RouteContext): void {
  app.get('/api/relay-config', (req: Request, res: Response) => {
    // In cloud deployments (WORKSPACE_TOKEN set), require a valid token.
    // Skip auth check in standalone mode (local development).
    const expectedToken = process.env.WORKSPACE_TOKEN;
    if (expectedToken && ctx.mode !== 'standalone') {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7)
        : null;

      if (!token) {
        res.status(401).json({ error: 'Unauthorized - missing workspace token' });
        return;
      }

      const tokenBuffer = Buffer.from(token);
      const expectedBuffer = Buffer.from(expectedToken);
      const isValidToken =
        tokenBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(tokenBuffer, expectedBuffer);

      if (!isValidToken) {
        res.status(401).json({ error: 'Unauthorized - invalid workspace token' });
        return;
      }
    }

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({
        success: false,
        error: "Relaycast credentials not configured. Set RELAY_API_KEY or create .agent-relay/relaycast.json",
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
