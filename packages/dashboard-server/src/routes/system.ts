import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import type { Application } from 'express';
import { fetchBrokerHealth } from '../services/health-worker-manager.js';
import { searchFiles } from '../lib/file-search.js';

interface RelayClientLike {
  sendMessage: (
    to: string,
    body: string,
    kind?: string,
    data?: unknown,
    thread?: string
  ) => string | boolean | Promise<string | boolean>;
}

export interface SystemRouteDeps {
  dataDir: string;
  teamDir: string;
  projectRoot?: string;
  resolveWorkspaceId: (req: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  }) => string | undefined;
  getRelayClient: (senderName?: string, entityType?: 'agent' | 'user') => Promise<RelayClientLike>;
}

/**
 * Health, files, bridge, and operational helper routes.
 */
export function registerSystemRoutes(app: Application, deps: SystemRouteDeps): void {
  const {
    dataDir,
    teamDir,
    projectRoot,
    resolveWorkspaceId,
    getRelayClient,
  } = deps;

  app.get('/health', async (req, res) => {
    try {
      const workspaceId = resolveWorkspaceId(req);
      const response = await fetchBrokerHealth({
        request: {
          workspaceId,
          authorization: req.headers.authorization,
        },
      });
      const body = await response.text();
      const contentType = response.headers.get('content-type') ?? 'application/json; charset=utf-8';
      return res.status(response.status).setHeader('content-type', contentType).send(body);
    } catch (err) {
      return res.status(502).json({
        status: 'error',
        error: 'Broker health proxy failed',
        message: (err as Error).message,
      });
    }
  });

  app.get('/api/health', async (req, res) => {
    try {
      const workspaceId = resolveWorkspaceId(req);
      const response = await fetchBrokerHealth({
        request: {
          workspaceId,
          authorization: req.headers.authorization,
        },
      });
      const body = await response.text();
      const contentType = response.headers.get('content-type') ?? 'application/json; charset=utf-8';
      return res.status(response.status).setHeader('content-type', contentType).send(body);
    } catch (err) {
      return res.status(502).json({
        status: 'error',
        error: 'Broker health proxy failed',
        message: (err as Error).message,
      });
    }
  });

  app.get('/keep-alive', (_req, res) => {
    let activeAgents = 0;
    const agentsPath = path.join(teamDir, 'agents.json');
    if (fs.existsSync(agentsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
        const thirtySecondsAgo = Date.now() - 30 * 1000;
        activeAgents = (data.agents || []).filter((a: { lastSeen?: string }) => {
          if (!a.lastSeen) return false;
          return new Date(a.lastSeen).getTime() > thirtySecondsAgo;
        }).length;
      } catch {
        // Ignore parse errors.
      }
    }

    return res.json({
      ok: true,
      activeAgents,
      timestamp: Date.now(),
    });
  });

  app.get('/api/files', async (req, res) => {
    const query = (req.query.q as string) || '';
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 15, 50);
    const searchRoot = projectRoot || path.dirname(dataDir);

    try {
      const results = await searchFiles(searchRoot, query, limit);
      return res.json({ files: results, query, searchRoot: path.basename(searchRoot) });
    } catch (err) {
      console.error('[api] File search error:', err);
      return res.status(500).json({ error: 'Failed to search files', files: [] });
    }
  });

  app.get('/api/bridge', async (_req, res) => {
    try {
      const bridgeStatePath = path.join(dataDir, 'bridge-state.json');
      if (fs.existsSync(bridgeStatePath)) {
        const bridgeData = JSON.parse(fs.readFileSync(bridgeStatePath, 'utf-8'));
        return res.json(bridgeData);
      }

      return res.json({
        projects: [],
        messages: [],
        connected: false,
      });
    } catch (err) {
      console.error('Failed to fetch bridge data', err);
      return res.status(500).json({ error: 'Failed to load bridge data' });
    }
  });

  app.post('/api/beads', async (req, res) => {
    const { title, assignee, priority, type } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }

    const args: string[] = ['create', '--title', title.trim()];

    if (assignee !== undefined && assignee !== null) {
      if (typeof assignee !== 'string' || !assignee.trim()) {
        return res.status(400).json({ success: false, error: 'assignee must be a non-empty string' });
      }
      args.push('--assignee', assignee.trim());
    }

    if (priority !== undefined && priority !== null) {
      if (typeof priority !== 'string' && typeof priority !== 'number') {
        return res.status(400).json({ success: false, error: 'priority must be a string or number' });
      }
      args.push('--priority', String(priority));
    }

    if (typeof type === 'string' && ['task', 'bug', 'feature'].includes(type)) {
      args.push('--type', type);
    }

    console.log('[api/beads] Creating bead via bd CLI');

    execFile('bd', args, { cwd: dataDir }, (error, stdout, stderr) => {
      if (error) {
        console.error('[api/beads] bd create failed:', stderr || error.message);
        return res.status(500).json({
          success: false,
          error: stderr || error.message || 'Failed to create bead',
        });
      }

      const output = stdout.trim();
      const idMatch = output.match(/Created\s+(beads-\w+)/i) || output.match(/(beads-\w+)/);
      const beadId = idMatch ? idMatch[1] : `beads-${Date.now()}`;

      return res.json({
        success: true,
        bead: {
          id: beadId,
          title: title.trim(),
          assignee,
          priority,
          type: type || 'task',
        },
      });
    });
  });

  app.post('/api/relay/send', async (req, res) => {
    const { to, content, thread } = req.body;

    if (!to || typeof to !== 'string') {
      return res.status(400).json({ success: false, error: 'Recipient (to) is required' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'Message content is required' });
    }

    try {
      const client = await getRelayClient('Dashboard');
      if (!client) {
        return res.status(503).json({
          success: false,
          error: 'Relay client not available',
        });
      }

      const sendResult = await client.sendMessage(to, content, 'message', undefined, thread);
      const messageId = typeof sendResult === 'string' && sendResult.trim()
        ? sendResult
        : `msg-${Date.now()}`;

      return res.json({
        success: true,
        messageId,
      });
    } catch (err) {
      console.error('[api/relay/send] Failed to send message:', err);
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to send message',
      });
    }
  });
}
