import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import type { Application } from 'express';
import { getAgentOutboxTemplate } from '@agent-relay/config';
import { listTrajectorySteps, getTrajectoryStatus, getTrajectoryHistory } from '@agent-relay/trajectory';
import { fetchBrokerSpawnedAgents } from '../lib/spawned-agents.js';

interface ActiveWorkerLike {
  name: string;
  cli: string;
  task: string;
  team?: string;
  spawnerName?: string;
  spawnedAt: number;
  pid?: number;
}

interface SpawnReaderLike {
  getActiveWorkers(): ActiveWorkerLike[];
  hasWorker(name: string): boolean;
  getWorkerOutput(name: string, limit?: number): string[] | undefined;
  getWorkerRawOutput(name: string): string | undefined;
  sendWorkerInput(name: string, data: string): Promise<boolean>;
}

interface RelayAdapterLike {
  spawn: (request: {
    name: string;
    cli: string;
    task?: string;
    team?: string;
    model?: string;
    cwd?: string;
    interactive?: boolean;
    shadowMode?: string;
    shadowOf?: string;
    spawnerName?: string;
    userId?: string;
    continueFrom?: string;
    includeWorkflowConventions?: boolean;
  }) => Promise<{ success: boolean; name?: string; error?: string }>;
  release: (name: string) => Promise<{ success: boolean; name?: string; error?: string }>;
}

interface SpawnPresenceEvent {
  type: string;
  agent: { name: string };
  cli?: string;
  task?: string;
  spawnedBy?: string;
  releasedBy?: string;
  timestamp: string;
}

export interface SpawnRouteDeps {
  dataDir: string;
  projectRoot?: string;
  relayAdapter: RelayAdapterLike;
  spawnReader?: SpawnReaderLike;
  agentCwdMap: Map<string, string>;
  isAgentOnline: (agentName: string) => boolean;
  resolveWorkspaceId: (req: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  }) => string | undefined;
  broadcastData: () => Promise<void>;
  broadcastPresence: (event: SpawnPresenceEvent) => void;
}

/**
 * Spawn, logs, repositories, and trajectory routes.
 */
export function registerSpawnRoutes(app: Application, deps: SpawnRouteDeps): void {
  const {
    dataDir,
    projectRoot,
    relayAdapter,
    spawnReader,
    agentCwdMap,
    isAgentOnline,
    resolveWorkspaceId,
    broadcastData,
    broadcastPresence,
  } = deps;

  // GET /api/logs/:name - Get historical logs for a spawned agent.
  app.get('/api/logs/:name', (req, res) => {
    if (!spawnReader) {
      return res.status(503).json({ error: 'Spawner not enabled' });
    }

    const { name } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 500;
    const raw = req.query.raw === 'true';

    if (!spawnReader.hasWorker(name)) {
      return res.status(404).json({ error: `Agent ${name} not found` });
    }

    try {
      if (raw) {
        const output = spawnReader.getWorkerRawOutput(name);
        return res.json({
          name,
          raw: true,
          output: output || '',
          timestamp: new Date().toISOString(),
        });
      }

      const lines = spawnReader.getWorkerOutput(name, limit);
      return res.json({
        name,
        raw: false,
        lines: lines || [],
        lineCount: lines?.length || 0,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`Failed to get logs for ${name}:`, err);
      return res.status(500).json({ error: 'Failed to get logs' });
    }
  });

  // GET /api/logs - List all agents with available logs.
  app.get('/api/logs', (_req, res) => {
    if (!spawnReader) {
      return res.status(503).json({ error: 'Spawner not enabled' });
    }

    try {
      const workers = spawnReader.getActiveWorkers();
      const agents = workers.map((w) => ({
        name: w.name,
        cli: w.cli,
        pid: w.pid,
        spawnedAt: new Date(w.spawnedAt).toISOString(),
        hasLogs: true,
      }));
      return res.json({ agents });
    } catch (err) {
      console.error('Failed to list agents with logs:', err);
      return res.status(500).json({ error: 'Failed to list agents' });
    }
  });

  // GET /api/agents/:name/online - Check if an agent is online.
  app.get('/api/agents/:name/online', (req, res) => {
    const { name } = req.params;
    const online = isAgentOnline(name);
    return res.json({ name, online });
  });

  // PUT /api/agents/:name/cwd - Register an agent's working directory.
  app.put('/api/agents/:name/cwd', (req, res) => {
    const { name } = req.params;
    const { cwd } = req.body || {};
    if (!cwd || typeof cwd !== 'string') {
      return res.status(400).json({ error: 'Missing required field: cwd' });
    }
    agentCwdMap.set(name, cwd);
    broadcastData().catch(() => {});
    return res.json({ success: true, name, cwd });
  });

  // POST /api/spawn - Spawn a new agent.
  app.post('/api/spawn', async (req, res) => {
    const {
      name,
      cli = 'claude',
      task = '',
      team,
      model,
      spawnerName,
      cwd,
      interactive,
      shadowMode,
      shadowAgent,
      shadowOf,
      shadowTriggers,
      shadowSpeakOn,
      userId,
      continueFrom,
    } = req.body;

    void shadowAgent;
    void shadowTriggers;
    void shadowSpeakOn;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: name',
      });
    }

    const effectiveCwd = cwd || (spawnerName ? agentCwdMap.get(spawnerName) : undefined);

    try {
      const result = await relayAdapter.spawn({
        name,
        cli,
        task,
        team: team || undefined,
        model: model || undefined,
        cwd: effectiveCwd || undefined,
        interactive,
        shadowMode,
        shadowOf,
        spawnerName: spawnerName || undefined,
        userId: typeof userId === 'string' ? userId : undefined,
        continueFrom: typeof continueFrom === 'string' ? continueFrom : undefined,
        includeWorkflowConventions: true,
      });

      if (result.success) {
        if (effectiveCwd) {
          agentCwdMap.set(name, effectiveCwd);
        }
        broadcastData().catch(() => {});
        broadcastPresence({
          type: 'agent_spawned',
          agent: { name },
          cli,
          task,
          spawnedBy: spawnerName || 'Dashboard',
          timestamp: new Date().toISOString(),
        });
      }

      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Spawn error:', err);
      return res.status(500).json({
        success: false,
        name,
        error: message,
      });
    }
  });

  // POST /api/repos/clone - Clone a repo into the workspace directory.
  app.post('/api/repos/clone', async (req, res) => {
    const { fullName } = req.body;

    if (!fullName || typeof fullName !== 'string' || !fullName.includes('/')) {
      return res.status(400).json({ success: false, error: 'fullName is required (e.g., "Owner/RepoName")' });
    }

    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(fullName)) {
      return res.status(400).json({ success: false, error: 'Invalid repository name format' });
    }

    const repoName = fullName.split('/').pop();
    if (!repoName) {
      return res.status(400).json({ success: false, error: 'Invalid repository name' });
    }

    const workspaceDir = process.env.WORKSPACE_DIR || path.dirname(projectRoot || dataDir);
    const targetDir = path.join(workspaceDir, repoName);

    const resolvedTarget = path.resolve(targetDir);
    const resolvedWorkspace = path.resolve(workspaceDir);
    if (!resolvedTarget.startsWith(resolvedWorkspace + path.sep)) {
      return res.status(400).json({ success: false, error: 'Invalid path' });
    }

    if (fs.existsSync(path.join(targetDir, '.git'))) {
      return res.json({ success: true, message: 'Already cloned', path: targetDir });
    }

    if (fs.existsSync(targetDir)) {
      console.log(`[api/repos/clone] Removing stale directory ${targetDir} (no .git found)`);
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    const cloneUrl = `https://github.com/${fullName}.git`;

    try {
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['clone', cloneUrl, targetDir], { timeout: 120000 }, (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve();
          }
        });
      });

      execFile('git', ['config', '--global', '--add', 'safe.directory', targetDir], () => {});
      return res.json({ success: true, path: targetDir });
    } catch (err) {
      const safeMessage = err instanceof Error ? err.message : 'Clone failed';
      console.error('[api/repos/clone] Clone failed:', safeMessage);
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
      return res.status(500).json({ success: false, error: safeMessage });
    }
  });

  // POST /api/repos/remove - Remove a cloned repo directory from the workspace.
  app.post('/api/repos/remove', async (req, res) => {
    const { fullName } = req.body;

    if (!fullName || typeof fullName !== 'string' || !fullName.includes('/')) {
      return res.status(400).json({ success: false, error: 'fullName is required (e.g., "Owner/RepoName")' });
    }

    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(fullName)) {
      return res.status(400).json({ success: false, error: 'Invalid repository name format' });
    }

    const repoName = fullName.split('/').pop();
    if (!repoName) {
      return res.status(400).json({ success: false, error: 'Invalid repository name' });
    }

    const workspaceDir = process.env.WORKSPACE_DIR || path.dirname(projectRoot || dataDir);
    const targetDir = path.join(workspaceDir, repoName);

    const resolvedTarget = path.resolve(targetDir);
    const resolvedWorkspace = path.resolve(workspaceDir);
    if (!resolvedTarget.startsWith(resolvedWorkspace + path.sep)) {
      return res.status(400).json({ success: false, error: 'Invalid path' });
    }

    if (!fs.existsSync(targetDir)) {
      return res.json({ success: true, message: 'Directory does not exist', path: targetDir });
    }

    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      console.log(`[api/repos/remove] Removed directory: ${targetDir}`);
      return res.json({ success: true, path: targetDir });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Remove failed';
      console.error('[api/repos/remove] Remove failed:', message);
      return res.status(500).json({ success: false, error: message });
    }
  });

  // POST /api/spawn/architect - Spawn an Architect agent for bridge mode.
  app.post('/api/spawn/architect', async (req, res) => {
    if (!spawnReader) {
      return res.status(503).json({
        success: false,
        error: 'Spawner not enabled. Start dashboard with enableSpawner: true',
      });
    }

    const { cli = 'claude' } = req.body;

    const activeWorkers = spawnReader.getActiveWorkers() || [];
    if (activeWorkers.some((w) => w.name.toLowerCase() === 'architect')) {
      return res.status(409).json({
        success: false,
        error: 'Architect agent already running',
      });
    }

    const bridgeStatePath = path.join(dataDir, 'bridge-state.json');
    let projectContext = 'No bridge projects connected.';

    if (fs.existsSync(bridgeStatePath)) {
      try {
        const bridgeState = JSON.parse(fs.readFileSync(bridgeStatePath, 'utf-8'));
        if (bridgeState.projects && bridgeState.projects.length > 0) {
          projectContext = bridgeState.projects
            .map((p: { id: string; path: string; name?: string; lead?: { name: string } }) =>
              `- ${p.id}: ${p.path} (Lead: ${p.lead?.name || 'none'})`
            )
            .join('\n');
        }
      } catch (e) {
        console.error('[api] Failed to read bridge state:', e);
      }
    }

    const outboxPath = getAgentOutboxTemplate().replace(/\$/g, '\\$');
    const architectPrompt = `You are the Architect, a cross-project coordinator overseeing multiple codebases.

## Connected Projects
${projectContext}

## Your Role
- Coordinate high-level work across all projects
- Assign tasks to project leads
- Ensure consistency and resolve cross-project dependencies
- Review overall architecture decisions

## Cross-Project Messaging

Write a file to your outbox, then output the trigger. Use project:AgentName syntax for cross-project messages:

\`\`\`bash
# Message specific agent in a project
cat > ${outboxPath}/msg << 'EOF'
TO: project-id:AgentName

Your message to this agent.
EOF
\`\`\`
Then output: \`->relay-file:msg\`

\`\`\`bash
# Broadcast to all agents in a project
cat > ${outboxPath}/broadcast << 'EOF'
TO: project-id:*

Broadcast to all agents in a project.
EOF
\`\`\`
Then output: \`->relay-file:broadcast\`

\`\`\`bash
# Broadcast to ALL agents in ALL projects
cat > ${outboxPath}/all << 'EOF'
TO: *:*

Broadcast to ALL agents in ALL projects.
EOF
\`\`\`
Then output: \`->relay-file:all\`

## Getting Started
1. Check in with each project lead to understand current status
2. Identify cross-project dependencies
3. Coordinate work across teams

Start by greeting the project leads and asking for status updates.`;

    try {
      const result = await relayAdapter.spawn({
        name: 'Architect',
        cli,
        task: architectPrompt,
        includeWorkflowConventions: true,
      });

      if (result.success) {
        broadcastData().catch(() => {});
      }

      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Architect spawn error:', err);
      return res.status(500).json({
        success: false,
        name: 'Architect',
        error: message,
      });
    }
  });

  // GET /api/spawned - List active spawned agents (broker pass-through).
  app.get('/api/spawned', async (req, res) => {
    try {
      const response = await fetchBrokerSpawnedAgents({
        query: new URLSearchParams(req.query as Record<string, string>),
        headers: {
          workspaceId: resolveWorkspaceId(req),
          authorization: req.headers.authorization,
        },
      });
      const body = await response.text();
      const contentType = response.headers.get('content-type') ?? 'application/json; charset=utf-8';
      return res.status(response.status).setHeader('content-type', contentType).send(body);
    } catch (err) {
      return res.status(502).json({
        success: false,
        error: 'Broker spawned-agents proxy failed',
        message: (err as Error).message,
      });
    }
  });

  // DELETE /api/spawned/:name - Release a spawned agent.
  app.delete('/api/spawned/:name', async (req, res) => {
    if (!spawnReader) {
      return res.status(503).json({
        success: false,
        error: 'Spawner not enabled',
      });
    }

    const { name } = req.params;

    try {
      const result = await relayAdapter.release(name);
      const released = result.success;

      if (released) {
        agentCwdMap.delete(name);
        broadcastData().catch(() => {});
        broadcastPresence({
          type: 'agent_released',
          agent: { name },
          releasedBy: 'Dashboard',
          timestamp: new Date().toISOString(),
        });
      }

      return res.json({
        success: released,
        name,
        error: released ? undefined : `Agent ${name} not found`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Release error:', err);
      return res.status(500).json({
        success: false,
        name,
        error: message,
      });
    }
  });

  // POST /api/agents/by-name/:name/interrupt - Send ESC sequence to interrupt an agent.
  app.post('/api/agents/by-name/:name/interrupt', async (req, res) => {
    if (!spawnReader) {
      return res.status(503).json({
        success: false,
        error: 'Spawner not enabled',
      });
    }

    const { name } = req.params;

    if (!spawnReader.hasWorker(name)) {
      return res.status(404).json({
        success: false,
        error: `Agent ${name} not found or not spawned`,
      });
    }

    try {
      const success = await spawnReader.sendWorkerInput(name, '\x1b\x1b');

      if (success) {
        console.log(`[api] Sent interrupt (ESC ESC) to agent ${name}`);
        return res.json({
          success: true,
          message: `Interrupt signal sent to ${name}`,
        });
      }

      return res.status(500).json({
        success: false,
        error: `Failed to send interrupt to ${name}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Interrupt error:', err);
      return res.status(500).json({
        success: false,
        error: message,
      });
    }
  });

  // POST /api/agents/by-name/:name/inject - Send text input to inject into agent PTY.
  app.post('/api/agents/by-name/:name/inject', async (req, res) => {
    const { name } = req.params;
    const { text } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }

    try {
      if (spawnReader && typeof (spawnReader as any).sendWorkerInput === 'function') {
        await (spawnReader as any).sendWorkerInput(name, text);
      }
      return res.json({ success: true, name, injected: text });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : `${err}`;
      return res.status(500).json({ error: `Failed to inject into ${name}: ${errorMessage}` });
    }
  });

  // GET /api/trajectory - Get current trajectory status.
  app.get('/api/trajectory', async (_req, res) => {
    try {
      const status = await getTrajectoryStatus();
      return res.json({
        success: true,
        ...status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Trajectory status error:', err);
      return res.status(500).json({
        success: false,
        error: message,
      });
    }
  });

  // GET /api/trajectory/steps - List trajectory steps.
  app.get('/api/trajectory/steps', async (req, res) => {
    try {
      const trajectoryId = typeof req.query.trajectoryId === 'string' ? req.query.trajectoryId : undefined;
      const result = await listTrajectorySteps(trajectoryId);

      if (result.success) {
        return res.json({
          success: true,
          steps: result.steps,
        });
      }

      return res.status(500).json({
        success: false,
        steps: [],
        error: result.error,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Trajectory steps error:', err);
      return res.status(500).json({
        success: false,
        steps: [],
        error: message,
      });
    }
  });

  // GET /api/trajectory/history - List all trajectories (completed and active).
  app.get('/api/trajectory/history', async (_req, res) => {
    try {
      const result = await getTrajectoryHistory();

      if (result.success) {
        return res.json({
          success: true,
          trajectories: result.trajectories,
        });
      }

      return res.status(500).json({
        success: false,
        trajectories: [],
        error: result.error,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[api] Trajectory history error:', err);
      return res.status(500).json({
        success: false,
        trajectories: [],
        error: message,
      });
    }
  });
}
