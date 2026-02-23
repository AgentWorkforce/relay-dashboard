/**
 * Data, bridge, files, and trajectory route handlers.
 */

import path from 'path';
import type { Express, Request, Response } from 'express';
import {
  getTrajectoryHistory,
  getTrajectoryStatus,
  listTrajectorySteps,
} from '@agent-relay/trajectory';
import type { RouteContext } from '../lib/types.js';
import { searchFiles } from '../lib/file-search.js';

export function registerDataRoutes(app: Express, ctx: RouteContext): void {
  app.get('/api/files', async (req: Request, res: Response) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 15;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 15;
    const searchRoot = path.dirname(ctx.dataDir);

    try {
      const files = await searchFiles(searchRoot, query, limit);
      res.json({
        files,
        query,
        searchRoot: path.basename(searchRoot),
      });
    } catch (err) {
      console.error('[dashboard] File search failed:', err);
      res.status(500).json({ error: 'Failed to search files', files: [] });
    }
  });

  app.get('/api/data', async (_req: Request, res: Response) => {
    try {
      const snapshot = await ctx.getRelaycastSnapshot();
      res.json(snapshot);
    } catch (err) {
      console.error('[dashboard] Failed to fetch Relaycast dashboard data:', err);
      res.status(500).json({ error: 'Failed to load Relaycast data' });
    }
  });

  app.get('/api/bridge', async (_req: Request, res: Response) => {
    try {
      const snapshot = await ctx.getRelaycastSnapshot();
      const projectPath = path.dirname(ctx.dataDir);
      const projectName = path.basename(projectPath) || projectPath;

      res.json({
        projects: [
          {
            id: 'local',
            name: projectName,
            path: projectPath,
            connected: true,
            agents: snapshot.agents.map((agent) => ({
              name: agent.name,
              status: (agent.status ?? 'offline').toLowerCase(),
              cli: agent.cli,
              model: agent.model,
              cwd: agent.cwd,
            })),
          },
        ],
        bridgeAgents: snapshot.agents,
        messages: snapshot.messages,
        connected: ctx.brokerProxyEnabled,
        currentProjectPath: projectPath,
      });
    } catch (err) {
      console.error('[dashboard] Failed to build local bridge view:', err);
      res.status(500).json({
        projects: [],
        bridgeAgents: [],
        messages: [],
        connected: false,
        error: 'Failed to build local bridge view',
      });
    }
  });

  app.get('/api/trajectory', async (_req: Request, res: Response) => {
    try {
      const status = await getTrajectoryStatus();
      res.json(status);
    } catch (err) {
      console.error('[dashboard] Failed to fetch trajectory status:', err);
      res.status(500).json({ success: false, active: false, error: 'Failed to fetch trajectory status' });
    }
  });

  app.get('/api/trajectory/history', async (_req: Request, res: Response) => {
    try {
      const history = await getTrajectoryHistory();
      res.json(history);
    } catch (err) {
      console.error('[dashboard] Failed to fetch trajectory history:', err);
      res.status(500).json({ success: false, trajectories: [], error: 'Failed to fetch trajectory history' });
    }
  });

  app.get('/api/trajectory/steps', async (req: Request, res: Response) => {
    const trajectoryId =
      typeof req.query.trajectoryId === 'string' && req.query.trajectoryId.trim()
        ? req.query.trajectoryId.trim()
        : undefined;

    try {
      const steps = await listTrajectorySteps(trajectoryId);
      res.json(steps);
    } catch (err) {
      console.error('[dashboard] Failed to fetch trajectory steps:', err);
      res.status(500).json({ success: false, steps: [], error: 'Failed to fetch trajectory steps' });
    }
  });
}
