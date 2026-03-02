/**
 * Broker proxy route handlers — forwards requests to the relay broker.
 */

import type { Express, Request, Response } from 'express';
import { createProxyMiddleware, type Options as ProxyOptions } from 'http-proxy-middleware';
import type { RouteContext } from '../lib/types.js';
import { isRecord, parseCommandDescriptor, withWorkflowConventions } from '../lib/utils.js';

export function registerBrokerProxyRoutes(app: Express, ctx: RouteContext): void {
  if (!ctx.brokerProxyEnabled || !ctx.relayUrl) {
    return;
  }

  const relayUrl = ctx.relayUrl;

  const forwardBrokerJson = async (
    req: Request,
    res: Response,
    endpoint: string,
    transformBody?: (body: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    try {
      const rawBody = isRecord(req.body) ? { ...req.body } : {};
      const body = transformBody ? transformBody(rawBody) : rawBody;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      const workspaceId = req.header('x-workspace-id');
      if (workspaceId) {
        headers['x-workspace-id'] = workspaceId;
      }

      const upstream = await fetch(`${relayUrl}${endpoint}`, {
        method: req.method,
        headers,
        body: JSON.stringify(body),
      });

      const contentType = upstream.headers.get('content-type') ?? '';
      const text = await upstream.text();
      res.status(upstream.status);
      if (contentType) {
        res.setHeader('content-type', contentType);
      }

      if (!text) {
        res.end();
        return;
      }

      if (contentType.includes('application/json')) {
        try {
          res.json(JSON.parse(text));
          return;
        } catch {
          // Fall back to raw text when upstream emits invalid JSON.
        }
      }
      res.send(text);
    } catch (err) {
      console.error('[dashboard] Broker proxy error:', (err as Error).message);
      res.status(502).json({
        success: false,
        error: 'Broker unavailable',
        message: (err as Error).message,
      });
    }
  };

  const brokerProxyOptions: ProxyOptions = {
    target: relayUrl,
    changeOrigin: true,
    ws: false,
    logger: ctx.verbose ? console : undefined,
    on: {
      error: (err, _req, res) => {
        console.error('[dashboard] Broker proxy error:', (err as Error).message);
        if (res && 'writeHead' in res && typeof res.writeHead === 'function') {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Broker unavailable',
            message: (err as Error).message,
          }));
        }
      },
    },
  };

  app.post('/api/spawn', async (req: Request, res: Response) => {
    await forwardBrokerJson(req, res, '/api/spawn', (rawBody) => {
      const includeWorkflowConventions =
        typeof rawBody.includeWorkflowConventions === 'boolean'
          ? rawBody.includeWorkflowConventions
          : true;
      const task = typeof rawBody.task === 'string' ? rawBody.task : undefined;
      const parsed = parseCommandDescriptor(
        typeof rawBody.cli === 'string' ? rawBody.cli : undefined,
        rawBody.args,
        typeof rawBody.model === 'string' ? rawBody.model : undefined,
      );
      const model = parsed.model;
      return {
        ...rawBody,
        cli: parsed.cli,
        args: parsed.args,
        model,
        includeWorkflowConventions,
        task: withWorkflowConventions(task, includeWorkflowConventions),
      };
    });
  });

  app.get('/api/spawned', createProxyMiddleware(brokerProxyOptions));
  app.delete('/api/spawned/:name', createProxyMiddleware(brokerProxyOptions));
  app.post('/api/spawn/architect', async (req: Request, res: Response) => {
    await forwardBrokerJson(req, res, '/api/spawn', (rawBody) => {
      const task = typeof rawBody.task === 'string' ? rawBody.task : undefined;
      const parsed = parseCommandDescriptor(
        typeof rawBody.cli === 'string' ? rawBody.cli : undefined,
        rawBody.args,
        typeof rawBody.model === 'string' ? rawBody.model : undefined,
      );
      return {
        ...rawBody,
        name: rawBody.name || 'architect',
        cli: parsed.cli,
        args: parsed.args,
        model: parsed.model,
        includeWorkflowConventions: true,
        task: withWorkflowConventions(task, true),
      };
    });
  });

  // Cloud broker API routes — proxied for cloud workspace features
  app.use('/api/brokers', createProxyMiddleware(brokerProxyOptions));
}
