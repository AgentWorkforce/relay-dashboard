/**
 * Agent-related route handlers: spawned agents, spawn, release, online status, logs.
 */

import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../lib/types.js';
import { normalizeAgentName } from '../lib/utils.js';
import { readStandaloneStateAgents } from '../lib/spawned-agents.js';
import {
  listStandaloneLogAgents,
  sanitizeLogAgentName,
  getWorkerLogsDir,
  readRecentLogLines,
} from '../lib/log-reader.js';

export function registerAgentRoutes(app: Express, ctx: RouteContext): void {
  const daemonEndpointRemoved = (req: Request, res: Response): void => {
    res.status(410).json({
      success: false,
      code: 'daemon_removed',
      error: 'BREAKING CHANGE: daemon API endpoints were removed.',
      details: `Update dashboard/broker integrations to broker endpoints. Requested: ${req.path}`,
      requiredEndpoints: [
        '/api/brokers/*',
        '/api/brokers/workspace/:workspaceId/agents',
        '/api/brokers/link',
      ],
    });
  };

  const legacyBrokerAliasRemoved = (req: Request, res: Response): void => {
    res.status(410).json({
      success: false,
      code: 'endpoint_removed',
      error: 'BREAKING CHANGE: legacy broker alias endpoint was removed.',
      details: `Requested: ${req.path}`,
      migration: {
        '/api/release': 'DELETE /api/spawned/:name',
        '/api/agents/:name/cwd': 'Pass cwd in POST /api/spawn payload when creating agent.',
      },
    });
  };

  app.all('/api/daemons', daemonEndpointRemoved);
  app.all('/api/daemons/{*path}', daemonEndpointRemoved);
  app.all('/api/release', legacyBrokerAliasRemoved);
  app.all('/api/agents/:name/cwd', legacyBrokerAliasRemoved);

  if (!ctx.brokerProxyEnabled) {
    const unsupportedBrokerOperation = (
      res: Response,
      operation: string,
      extra: Record<string, unknown> = {},
    ): void => {
      res.status(501).json({
        success: false,
        code: 'unsupported_operation',
        mode: 'standalone',
        error: `${operation} is unavailable in standalone mode.`,
        suggestion: 'Start dashboard in proxy mode with a broker API relay URL to enable broker-managed operations.',
        ...extra,
      });
    };

    app.all('/api/brokers', (_req: Request, res: Response) => {
      unsupportedBrokerOperation(res, 'Broker API');
    });

    app.all('/api/brokers/{*path}', (req: Request, res: Response) => {
      unsupportedBrokerOperation(res, 'Broker API', { path: req.path });
    });

    app.get('/api/spawned', (_req: Request, res: Response) => {
      const agents = readStandaloneStateAgents(ctx.dataDir);
      res.json({
        success: true,
        agents: agents.map((agent) => ({
          name: agent.name,
          cli: agent.cli,
          startedAt: agent.startedAt,
          online: agent.online,
          pid: agent.pid,
          cwd: agent.cwd,
        })),
      });
    });

    app.post('/api/spawn', (req: Request, res: Response) => {
      const requestedName =
        typeof req.body?.name === 'string' && req.body.name.trim()
          ? req.body.name.trim()
          : 'unknown';
      unsupportedBrokerOperation(res, 'Agent spawn', { name: requestedName });
    });

    app.post('/api/spawn/architect', (_req: Request, res: Response) => {
      unsupportedBrokerOperation(res, 'Architect spawn');
    });

    app.delete('/api/spawned/:name', (req: Request, res: Response) => {
      const name = typeof req.params.name === 'string' ? decodeURIComponent(req.params.name) : '';
      unsupportedBrokerOperation(res, 'Agent release', { name });
    });

    app.post('/api/agents/by-name/:name/interrupt', (req: Request, res: Response) => {
      const name = typeof req.params.name === 'string' ? decodeURIComponent(req.params.name) : '';
      unsupportedBrokerOperation(res, 'Agent interrupt', { name });
    });
  }

  // Agent interrupt — broker does not have this endpoint yet.
  app.post('/api/agents/by-name/:name/interrupt', (req: Request, res: Response) => {
    const name = typeof req.params.name === 'string' ? decodeURIComponent(req.params.name) : '';
    res.status(501).json({
      success: false,
      error: 'Agent interrupt is not yet supported by the broker HTTP API.',
      name,
    });
  });

  // Always serve agent-online and logs locally.
  app.get('/api/agents/:name/online', async (req: Request, res: Response) => {
    const name = typeof req.params.name === 'string' ? decodeURIComponent(req.params.name) : '';
    const normalizedName = normalizeAgentName(name);

    try {
      const snapshot = await ctx.getRelaycastSnapshot();
      const relayAgent = snapshot.agents.find(
        (a) => normalizeAgentName(a.name) === normalizedName,
      );
      if (relayAgent) {
        res.json({
          success: true,
          name,
          online: (relayAgent.status ?? 'offline').toLowerCase() === 'online',
          pid: null,
        });
        return;
      }
    } catch {
      // Fall through to local state
    }

    const agent = readStandaloneStateAgents(ctx.dataDir).find(
      (item) => normalizeAgentName(item.name) === normalizedName,
    );
    res.json({
      success: true,
      name,
      online: agent?.online ?? false,
      pid: agent?.pid ?? null,
    });
  });

  app.get('/api/logs', (_req: Request, res: Response) => {
    const agents = listStandaloneLogAgents(ctx.dataDir);
    res.json({ success: true, agents });
  });

  app.get('/api/logs/:name', (req: Request, res: Response) => {
    const raw = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    const decoded = decodeURIComponent(raw ?? '');
    const agentName = sanitizeLogAgentName(decoded);

    if (!agentName) {
      res.status(400).json({ error: 'Agent name is required' });
      return;
    }

    const logsDir = getWorkerLogsDir(ctx.dataDir);
    const logFile = path.join(logsDir, `${agentName}.log`);
    const availableAgents = listStandaloneLogAgents(ctx.dataDir);

    if (!fs.existsSync(logFile)) {
      res.status(404).json({
        agent: agentName,
        found: false,
        lineCount: 0,
        content: '',
        availableAgents,
        error: `No local logs for '${agentName}'.`,
      });
      return;
    }

    const lines = readRecentLogLines(logFile);
    res.json({
      agent: agentName,
      found: true,
      lineCount: lines.length,
      content: lines.join('\n'),
      availableAgents,
    });
  });

  if (ctx.mode !== 'mock') {
    app.get('/api/workspaces/primary', (_req: Request, res: Response) => {
      res.json({
        success: true,
        data: {
          exists: false,
          statusMessage: 'Running locally',
          workspace: null,
        },
      });
    });

    app.get('/api/usage', (_req: Request, res: Response) => {
      res.json({ success: true, data: null });
    });
  }
}
