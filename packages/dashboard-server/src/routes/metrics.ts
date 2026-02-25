import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Application } from 'express';
import { fetchCloudNeedsAttention } from '../services/needs-attention.js';
import { fetchCloudMetrics } from '../services/metrics.js';
import { createProcessMetrics } from '../lib/process-metrics.js';

interface ActiveWorkerLike {
  name: string;
  pid?: number;
  spawnedAt: number;
  task?: string;
  cli?: string;
}

interface SpawnReaderLike {
  getActiveWorkers(): ActiveWorkerLike[];
}

export interface MetricsRouteDeps {
  teamDir: string;
  spawnReader?: SpawnReaderLike;
  resolveWorkspaceId: (req: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  }) => string | undefined;
}

/**
 * Cloud proxy metrics and local process metrics routes.
 */
export function registerMetricsRoutes(app: Application, deps: MetricsRouteDeps): void {
  const { teamDir, spawnReader, resolveWorkspaceId } = deps;
  const { getProcTreeUsage } = createProcessMetrics();

  function buildLocalMetrics() {
    const now = new Date().toISOString();
    const workers = spawnReader?.getActiveWorkers() || [];
    const totalAgents = workers.length;
    const onlineAgents = workers.filter((worker) => worker.pid).length;

    const agents = workers.map((worker) => {
      const rssBytes = worker.pid ? getProcTreeUsage(worker.pid).rssBytes : undefined;
      const firstSeen = worker.spawnedAt ? new Date(worker.spawnedAt).toISOString() : now;

      return {
        name: worker.name,
        messagesSent: 0,
        messagesReceived: 0,
        firstSeen,
        lastSeen: now,
        uptimeSeconds: worker.spawnedAt ? Math.max(0, Math.floor((Date.now() - worker.spawnedAt) / 1000)) : 0,
        isOnline: Boolean(worker.pid),
        task: worker.task ?? 'idle',
        cli: worker.cli ?? 'unknown',
        rssBytes,
      };
    });

    return {
      timestamp: now,
      totalAgents,
      onlineAgents,
      offlineAgents: Math.max(0, totalAgents - onlineAgents),
      totalMessages: 0,
      throughput: {
        messagesLastMinute: 0,
        messagesLastHour: 0,
        messagesLast24Hours: 0,
        avgMessagesPerMinute: 0,
      },
      agents: agents.map((agent) => ({
        name: agent.name,
        messagesSent: agent.messagesSent,
        messagesReceived: agent.messagesReceived,
        firstSeen: agent.firstSeen,
        lastSeen: agent.lastSeen,
        uptimeSeconds: agent.uptimeSeconds,
        isOnline: agent.isOnline,
      })),
      sessions: {
        totalSessions: 0,
        activeSessions: 0,
        closedByAgent: 0,
        closedByDisconnect: 0,
        closedByError: 0,
        errorRate: 0,
        recentSessions: [],
      },
      system: {
        totalAgents,
        onlineAgents,
        totalMessages: 0,
        totalSessions: 0,
        activeSessions: 0,
      },
    };
  }

  // GET /api/agents/needs-attention - Pass-through to cloud needs-attention endpoint.
  app.get('/api/agents/needs-attention', async (req, res) => {
    try {
      const response = await fetchCloudNeedsAttention({
        query: new URLSearchParams(req.query as Record<string, string>),
        request: {
          workspaceId: resolveWorkspaceId(req),
          authorization: req.headers.authorization,
        },
      });
      const body = await response.text();
      const contentType = response.headers.get('content-type') ?? 'application/json; charset=utf-8';
      return res.status(response.status).setHeader('content-type', contentType).send(body);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : `${err}`;
      return res.status(502).json({
        error: 'Cloud needs-attention proxy failed',
        message: errorMessage,
      });
    }
  });

  // GET /api/metrics - JSON format metrics for dashboard.
  app.get('/api/metrics', async (req, res) => {
    try {
      const response = await fetchCloudMetrics({
        query: new URLSearchParams(req.query as Record<string, string>),
        request: {
          workspaceId: resolveWorkspaceId(req),
          authorization: req.headers.authorization,
        },
      });
      const body = await response.text();
      const contentType = response.headers.get('content-type') ?? 'application/json; charset=utf-8';
      return res.status(response.status).setHeader('content-type', contentType).send(body);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : `${err}`;
      if (errorMessage.includes('Cloud upstream URL is not configured')) {
        return res.json(buildLocalMetrics());
      }
      return res.status(502).json({
        error: 'Cloud metrics proxy failed',
        message: errorMessage,
      });
    }
  });

  // GET /api/metrics/prometheus - Prometheus exposition format.
  app.get('/api/metrics/prometheus', async (req, res) => {
    try {
      const query = new URLSearchParams(req.query as Record<string, string>);
      const response = await fetchCloudMetrics({
        query,
        request: {
          workspaceId: resolveWorkspaceId(req),
          authorization: req.headers.authorization,
        },
        upstreamPath: '/api/metrics/prometheus',
      });
      const body = await response.text();
      const contentType = response.headers.get('content-type') ?? 'text/plain; charset=utf-8';
      return res.status(response.status).setHeader('content-type', contentType).send(body);
    } catch {
      return res.status(502).send('# Cloud metrics proxy failed\n');
    }
  });

  // GET /api/metrics/agents - Detailed agent memory and resource metrics.
  app.get('/api/metrics/agents', async (_req, res) => {
    try {
      const agents: Array<{
        name: string;
        pid?: number;
        status: string;
        rssBytes?: number;
        heapUsedBytes?: number;
        cpuPercent?: number;
        trend?: string;
        trendRatePerMinute?: number;
        alertLevel?: string;
        highWatermark?: number;
        averageRss?: number;
        uptimeMs?: number;
        startedAt?: string;
      }> = [];

      if (spawnReader) {
        const activeWorkers = spawnReader.getActiveWorkers();
        for (const worker of activeWorkers) {
          let rssBytes = 0;
          let cpuPercent = 0;

          if (worker.pid) {
            const processUsage = getProcTreeUsage(worker.pid);
            rssBytes = processUsage.rssBytes;
            cpuPercent = processUsage.cpuPercent;
          }

          agents.push({
            name: worker.name,
            pid: worker.pid,
            status: worker.pid ? 'running' : 'unknown',
            rssBytes,
            cpuPercent,
            trend: 'unknown',
            alertLevel: rssBytes > 1024 * 1024 * 1024 ? 'critical'
              : rssBytes > 512 * 1024 * 1024 ? 'warning' : 'normal',
            highWatermark: rssBytes,
            uptimeMs: worker.spawnedAt ? Date.now() - worker.spawnedAt : 0,
            startedAt: worker.spawnedAt ? new Date(worker.spawnedAt).toISOString() : undefined,
          });
        }
      }

      return res.json({
        agents,
        system: {
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          heapUsed: process.memoryUsage().heapUsed,
        },
      });
    } catch (err) {
      console.error('Failed to get agent metrics', err);
      return res.status(500).json({ error: 'Failed to get agent metrics' });
    }
  });

  // GET /api/metrics/health - System health and crash insights.
  app.get('/api/metrics/health', async (_req, res) => {
    try {
      let healthScore = 100;
      const issues: Array<{ severity: string; message: string }> = [];
      const recommendations: string[] = [];
      const crashes: Array<{
        id: string;
        agentName: string;
        crashedAt: string;
        likelyCause: string;
        summary: string;
      }> = [];
      const alerts: Array<{
        id: string;
        agentName: string;
        alertType: string;
        message: string;
        createdAt: string;
      }> = [];

      let agentCount = 0;
      const totalCrashes24h = 0;
      let totalAlerts24h = 0;

      if (spawnReader) {
        const workers = spawnReader.getActiveWorkers();
        agentCount = workers.length;

        for (const worker of workers) {
          if (worker.pid) {
            const { rssBytes } = getProcTreeUsage(worker.pid);

            if (rssBytes > 1.5 * 1024 * 1024 * 1024) {
              healthScore -= 20;
              issues.push({
                severity: 'critical',
                message: `Agent "${worker.name}" is using ${Math.round(rssBytes / 1024 / 1024)}MB of memory`,
              });
              totalAlerts24h++;
              alerts.push({
                id: `alert-${Date.now()}-${worker.name}`,
                agentName: worker.name,
                alertType: 'oom_imminent',
                message: `Memory usage critical: ${Math.round(rssBytes / 1024 / 1024)}MB`,
                createdAt: new Date().toISOString(),
              });
            } else if (rssBytes > 1024 * 1024 * 1024) {
              healthScore -= 10;
              issues.push({
                severity: 'high',
                message: `Agent "${worker.name}" memory usage is elevated (${Math.round(rssBytes / 1024 / 1024)}MB)`,
              });
            }
          }
        }
      }

      const agentsPath = path.join(teamDir, 'agents.json');
      if (fs.existsSync(agentsPath)) {
        const data = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
        const registeredAgents = data.agents || [];
        const activeAgents = registeredAgents.filter((a: { lastSeen?: string }) => {
          const lastSeen = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
          return Date.now() - lastSeen < 30000;
        });
        agentCount = Math.max(agentCount, activeAgents.length);
      }

      if (issues.some((i) => i.severity === 'critical')) {
        recommendations.push('Consider restarting agents with high memory usage');
        recommendations.push('Monitor system resources closely');
      }
      if (agentCount === 0) {
        recommendations.push('No active agents detected - start agents to begin monitoring');
      }

      healthScore = Math.max(0, Math.min(100, healthScore));

      let summary: string;
      if (healthScore >= 90) {
        summary = 'System is healthy. All agents operating normally.';
      } else if (healthScore >= 70) {
        summary = 'Some issues detected. Review warnings and recommendations.';
      } else if (healthScore >= 50) {
        summary = 'Multiple issues detected. Action recommended.';
      } else {
        summary = 'Critical issues detected. Immediate action required.';
      }

      return res.json({
        healthScore,
        summary,
        issues,
        recommendations,
        crashes,
        alerts,
        stats: {
          totalCrashes24h,
          totalAlerts24h,
          agentCount,
        },
      });
    } catch (err) {
      console.error('Failed to compute health metrics', err);
      return res.status(500).json({ error: 'Failed to compute health metrics' });
    }
  });
}
