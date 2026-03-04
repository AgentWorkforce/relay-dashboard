import crypto from 'crypto';
import path from 'path';
import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../lib/types.js';
import { getDashboardAgentToken } from '../relaycast-provider-helpers.js';

export function registerRelayConfigRoutes(app: Express, ctx: RouteContext): void {
  // Allow the workflow runner (or any local caller) to push a Relaycast API key
  // into the dashboard without writing any files.
  // In cloud deployments (WORKSPACE_TOKEN set), require a valid token.
  app.post('/api/relay-config', (req: Request, res: Response) => {
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

    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (!apiKey) {
      res.status(400).json({ ok: false, error: 'Missing "apiKey" field' });
      return;
    }
    ctx.setRelayApiKey(apiKey);
    res.json({ ok: true });
  });

  app.get('/api/relay-config', async (req: Request, res: Response) => {
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

    let agentToken = config.agentToken;
    let agentName = config.agentName ?? path.basename(path.resolve(ctx.dataDir, '..'));

    if (!agentToken) {
      try {
        const registered = await getDashboardAgentToken(config, agentName);
        agentToken = registered.token;
        agentName = registered.name;
      } catch (err) {
        res.status(503).json({
          success: false,
          error: `Failed to auto-register dashboard agent: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    }

    res.json({
      success: true,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      agentToken,
      agentName,
    });
  });
}
