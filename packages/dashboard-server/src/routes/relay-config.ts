import crypto from 'crypto';
import path from 'path';
import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../lib/types.js';
import { getDashboardAgentToken, getWriterClient } from '../relaycast-provider-helpers.js';

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

    // When refresh=true, clear cached agent token so we re-register and get
    // a fresh token. This handles cases where the token was rotated externally
    // (e.g. by another process calling registerOrRotate for the same agent).
    const forceRefresh = req.query.refresh === 'true';
    if (forceRefresh) {
      ctx.clearCachedAgentToken();
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
        // Persist the token so subsequent calls reuse it instead of rotating
        // (which would invalidate the frontend's WebSocket connection).
        ctx.setRelayAgentIdentity(agentToken, agentName);
      } catch (err) {
        res.status(503).json({
          success: false,
          error: `Failed to auto-register dashboard agent: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    }

    // Best-effort: ensure the dashboard agent has joined default channels so the
    // client-side @relaycast/react hooks (which auth with the agent token) can
    // read channel messages. New agents auto-join #general on registration, but
    // token rotation via registerOrRotate does not re-join.
    // Fire-and-forget to avoid adding latency to the config response.
    const defaultChannels = ['general'];
    const configWithToken: typeof config = { ...config, agentToken, agentName };
    getWriterClient(configWithToken, agentName, ctx.dataDir)
      .then(async (writer) => {
        for (const channel of defaultChannels) {
          await writer.channels.join(channel).catch(() => {});
        }
      })
      .catch(() => {});

    res.json({
      success: true,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      agentToken,
      agentName,
      channels: defaultChannels,
      // Workspace key for WebSocket auth — never rotated by agent operations,
      // so the WS connection survives registerOrRotate calls from other processes.
      wsToken: config.apiKey,
    });
  });
}
