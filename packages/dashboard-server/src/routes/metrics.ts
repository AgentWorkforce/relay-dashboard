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
      return res.status(502).json({
        error: 'Cloud needs-attention proxy failed',
        message: (err as Error).message,
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
      return res.status(502).json({
        error: 'Cloud metrics proxy failed',
        message: (err as Error).message,
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
