/**
 * Reaction route handlers: add, remove, list reactions on messages.
 *
 * Proxies to the Relaycast `/v1/messages/:id/reactions` API.
 */

import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../lib/types.js';

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export function registerReactionRoutes(app: Express, ctx: RouteContext): void {
  /** GET /api/messages/:id/reactions */
  app.get('/api/messages/:id/reactions', async (req: Request, res: Response) => {
    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({ error: 'Relaycast not configured' });
      return;
    }
    const id = param(req.params.id);
    try {
      const upstream = await fetch(
        `${config.baseUrl}/v1/messages/${encodeURIComponent(id)}/reactions`,
        { headers: { Authorization: `Bearer ${config.apiKey}` } },
      );
      const data = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(data);
    } catch (err) {
      console.error('[dashboard] GET reactions error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/messages/:id/reactions */
  app.post('/api/messages/:id/reactions', async (req: Request, res: Response) => {
    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({ error: 'Relaycast not configured' });
      return;
    }
    const id = param(req.params.id);
    try {
      const upstream = await fetch(
        `${config.baseUrl}/v1/messages/${encodeURIComponent(id)}/reactions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(req.body),
        },
      );
      const data = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(data);
    } catch (err) {
      console.error('[dashboard] POST reactions error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /api/messages/:id/reactions/:emoji */
  app.delete('/api/messages/:id/reactions/:emoji', async (req: Request, res: Response) => {
    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({ error: 'Relaycast not configured' });
      return;
    }
    const id = param(req.params.id);
    const emoji = param(req.params.emoji);
    try {
      const upstream = await fetch(
        `${config.baseUrl}/v1/messages/${encodeURIComponent(id)}/reactions/${encodeURIComponent(emoji)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${config.apiKey}` },
        },
      );
      const data = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(data);
    } catch (err) {
      console.error('[dashboard] DELETE reactions error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
