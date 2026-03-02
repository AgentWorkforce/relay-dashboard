import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Application } from 'express';
import type { WebSocketServer } from 'ws';
import type { Decision } from './decisions.js';
import type { TaskAssignment } from './tasks.js';

interface ActiveWorkerLike {
  name: string;
  status?: string;
}

interface SpawnReaderLike {
  getActiveWorkers(): ActiveWorkerLike[];
}

interface FleetServer {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'offline';
  agents: { name: string; status: string }[];
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: number;
  uptime: number;
  lastHeartbeat: string;
}

export interface FleetRouteDeps {
  dataDir: string;
  spawnReader?: SpawnReaderLike;
  wss: WebSocketServer;
  decisions: Map<string, Decision>;
  tasks: Map<string, TaskAssignment>;
}

async function loadAgentStatuses(dataDir: string): Promise<Record<string, { status: string }>> {
  const agentsFile = path.join(dataDir, 'agents.json');
  try {
    if (fs.existsSync(agentsFile)) {
      const data = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
      const result: Record<string, { status: string }> = {};
      for (const agent of data.agents || []) {
        if (agent && typeof agent.name === 'string') {
          result[agent.name] = { status: agent.status || 'offline' };
        }
      }
      return result;
    }
  } catch (err) {
    console.warn('[api] Failed to load agent statuses:', err);
  }
  return {};
}

/**
 * Fleet overview and aggregate stats routes.
 */
export function registerFleetRoutes(app: Application, deps: FleetRouteDeps): void {
  const { dataDir, spawnReader, wss, decisions, tasks } = deps;

  // GET /api/fleet/servers - Get fleet server overview.
  app.get('/api/fleet/servers', async (_req, res) => {
    const servers: FleetServer[] = [];
    const localAgents = spawnReader?.getActiveWorkers() || [];
    const agentStatuses = await loadAgentStatuses(dataDir);
    let hasBridgeProjects = false;

    const bridgeStatePath = path.join(dataDir, 'bridge-state.json');
    if (fs.existsSync(bridgeStatePath)) {
      try {
        const bridgeState = JSON.parse(fs.readFileSync(bridgeStatePath, 'utf-8'));
        if (bridgeState.projects && bridgeState.projects.length > 0) {
          hasBridgeProjects = true;

          for (const project of bridgeState.projects) {
            let projectAgents: { name: string; status: string }[] = [];

            if (project.path) {
              const projectHash = crypto.createHash('sha256').update(project.path).digest('hex').slice(0, 12);
              const projectDataDir = path.join(path.dirname(dataDir), projectHash);
              const projectTeamDir = path.join(projectDataDir, 'team');
              const agentsPath = path.join(projectTeamDir, 'agents.json');

              if (fs.existsSync(agentsPath)) {
                try {
                  const agentsData = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
                  if (agentsData.agents && Array.isArray(agentsData.agents)) {
                    const thirtySecondsAgo = Date.now() - 30 * 1000;
                    projectAgents = agentsData.agents
                      .filter((a: { lastSeen?: string }) => {
                        if (!a.lastSeen) return false;
                        return new Date(a.lastSeen).getTime() > thirtySecondsAgo;
                      })
                      .map((a: { name: string }) => ({
                        name: a.name,
                        status: 'online',
                      }));
                  }
                } catch (e) {
                  console.warn(`[api] Failed to read agents for ${project.path}:`, e);
                }
              }
            }

            servers.push({
              id: project.id,
              name: project.name || project.path.split('/').pop() || project.id,
              status: project.connected ? 'healthy' : 'offline',
              agents: projectAgents,
              cpuUsage: 0,
              memoryUsage: 0,
              activeConnections: project.connected ? 1 : 0,
              uptime: 0,
              lastHeartbeat: project.lastSeen || new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.warn('[api] Failed to read bridge state:', err);
      }
    }

    if (!hasBridgeProjects) {
      servers.push({
        id: 'local',
        name: 'Local Daemon',
        status: 'healthy',
        agents: localAgents.map((a) => ({
          name: a.name,
          status: agentStatuses[a.name]?.status || 'unknown',
        })),
        cpuUsage: Math.random() * 30,
        memoryUsage: Math.random() * 50,
        activeConnections: wss.clients.size,
        uptime: process.uptime(),
        lastHeartbeat: new Date().toISOString(),
      });
    }

    return res.json({ success: true, servers });
  });

  // GET /api/fleet/stats - Get aggregate fleet statistics.
  app.get('/api/fleet/stats', async (_req, res) => {
    const localAgents = spawnReader?.getActiveWorkers() || [];
    const agentStatuses = await loadAgentStatuses(dataDir);

    const totalAgents = localAgents.length;
    let onlineAgents = 0;
    let busyAgents = 0;

    for (const agent of localAgents) {
      const status = agentStatuses[agent.name]?.status;
      if (status === 'online') onlineAgents++;
      if (status === 'busy') busyAgents++;
    }

    return res.json({
      success: true,
      stats: {
        totalAgents,
        onlineAgents,
        busyAgents,
        pendingDecisions: decisions.size,
        activeTasks: Array.from(tasks.values()).filter((t) =>
          t.status === 'assigned' || t.status === 'in_progress'
        ).length,
      },
    });
  });
}
