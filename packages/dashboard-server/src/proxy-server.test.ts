/**
 * Proxy Server Tests
 *
 * Tests for the proxy/mock server in both proxy and mock modes.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer as createHttpServer, type Server as HttpServer } from 'http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type DashboardServer } from './proxy-server.js';

describe('Dashboard Server', () => {
  describe('Static Route Fallbacks', () => {
    let server: DashboardServer;
    let staticDir: string;

    beforeAll(async () => {
      staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-static-fallback-'));
      fs.writeFileSync(path.join(staticDir, 'app.html'), '<!doctype html><h1>app-fallback</h1>', 'utf-8');

      server = createServer({
        port: 0,
        mock: false,
        staticDir,
        verbose: false,
      });
      await new Promise<void>((resolve) => {
        server.server.listen(0, () => resolve());
      });
    });

    afterAll(async () => {
      await server.close();
      fs.rmSync(staticDir, { recursive: true, force: true });
    });

    it('should serve /metrics from app.html when metrics.html is missing', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/metrics`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('app-fallback');
    });
  });

  describe('Mock Mode', () => {
    let server: DashboardServer;

    beforeAll(async () => {
      server = createServer({
        port: 0, // Use any available port
        mock: true,
        verbose: false,
      });
      await new Promise<void>((resolve) => {
        server.server.listen(0, () => resolve());
      });
    });

    afterAll(async () => {
      await server.close();
    });

    it('should start in mock mode', () => {
      expect(server.mode).toBe('mock');
    });

    it('should respond to health check', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/health`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.status).toBe('ok');
      expect(data.mode).toBe('mock');
    });

    it('should return mock agents from /api/data', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/data`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.agents).toBeDefined();
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.length).toBeGreaterThan(0);
    });

    it('should return mock decisions from /api/decisions', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/decisions`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.decisions).toBeDefined();
      expect(Array.isArray(data.decisions)).toBe(true);
    });

    it('should return mock tasks from /api/tasks', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/tasks`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.tasks).toBeDefined();
      expect(Array.isArray(data.tasks)).toBe(true);
    });

    it('should return mock metrics from /api/metrics', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/metrics`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.agents).toBeDefined();
      expect(data.system).toBeDefined();
    });

    it('should return mock channels from /api/channels', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/channels`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.channels).toBeDefined();
      expect(Array.isArray(data.channels)).toBe(true);
    });

    it('should return mock fleet stats from /api/fleet/stats', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/fleet/stats`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.stats).toBeDefined();
      expect(data.stats.totalAgents).toBeGreaterThan(0);
    });

    it('should accept POST to /api/spawn', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-agent', cli: 'claude-code' }),
      });
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.name).toBe('test-agent');
    });

    it('should accept POST to /api/send', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'claude-1', message: 'Hello!' }),
      });
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.messageId).toBeDefined();
    });

    it('should return 404 for unknown API routes', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/unknown-route`);

      expect(response.status).toBe(404);
    });
  });

  describe('Proxy Mode (Configuration)', () => {
    let server: DashboardServer;

    beforeAll(async () => {
      server = createServer({
        port: 0,
        mock: false,
        relayUrl: 'http://localhost:3889',
        verbose: false,
      });
      await new Promise<void>((resolve) => {
        server.server.listen(0, () => resolve());
      });
    });

    afterAll(async () => {
      await server.close();
    });

    it('should start in proxy mode', () => {
      expect(server.mode).toBe('proxy');
    });

    it('should respond to health check', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/health`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.status).toBe('ok');
      expect(data.mode).toBe('proxy');
    });

    it('should respond to keep-alive', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/keep-alive`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.ok).toBe(true);
    });

    it('should proxy /api/brokers/* routes in proxy mode', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      // No broker server is running in this test, so proxy should fail.
      // Depending on proxy middleware timing/instrumentation, this can surface as:
      // - 502 from explicit proxy error handling, or
      // - 404 when the request falls through before proxy connect.
      const response = await fetch(`http://localhost:${port}/api/brokers/workspace/ws-123/agents`);
      expect([404, 502]).toContain(response.status);
    });

    it('should return breaking-change guidance for removed legacy broker alias routes in proxy mode', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const releaseResponse = await fetch(`http://localhost:${port}/api/release`, { method: 'POST' });
      const releaseData = await releaseResponse.json();
      expect(releaseResponse.status).toBe(410);
      expect(releaseData.success).toBe(false);
      expect(releaseData.code).toBe('endpoint_removed');

      const cwdResponse = await fetch(`http://localhost:${port}/api/agents/WorkerA/cwd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/project' }),
      });
      const cwdData = await cwdResponse.json();
      expect(cwdResponse.status).toBe(410);
      expect(cwdData.success).toBe(false);
      expect(cwdData.code).toBe('endpoint_removed');
    });
  });

  describe('Standalone Mode (Local Logs)', () => {
    let server: DashboardServer;
    let dataDir: string;

    beforeAll(async () => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-standalone-logs-'));
      const logsDir = path.join(dataDir, 'team', 'worker-logs');
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(path.join(logsDir, 'WorkerA.log'), 'line-one\nline-two\n', 'utf-8');
      fs.writeFileSync(
        path.join(dataDir, 'state.json'),
        JSON.stringify(
          {
            agents: {
              WorkerA: {
                pid: 999999,
                started_at: 1700000000,
                spec: {
                  cli: 'codex',
                  cwd: '/tmp/workspace',
                },
              },
            },
          },
          null,
          2,
        ),
        'utf-8',
      );

      server = createServer({
        port: 0,
        mock: false,
        verbose: false,
        dataDir,
      });
      await new Promise<void>((resolve) => {
        server.server.listen(0, () => resolve());
      });
    });

    afterAll(async () => {
      await server.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('should start in standalone mode when relay URL is not provided', () => {
      expect(server.mode).toBe('standalone');
    });

    it('returns 503 from /api/relay-config when relaycast credentials are missing', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/relay-config`);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
    });

    it('registers thread reply routes when relaycast credentials are missing', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const getResponse = await fetch(`http://localhost:${port}/api/messages/msg-1/replies`);
      const getData = await getResponse.json();
      expect(getResponse.status).toBe(503);
      expect(getData.ok).toBe(false);
      expect(typeof getData.error).toBe('string');

      const postResponse = await fetch(`http://localhost:${port}/api/messages/msg-1/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });
      const postData = await postResponse.json();
      expect(postResponse.status).toBe(503);
      expect(postData.ok).toBe(false);
      expect(typeof postData.error).toBe('string');
    });

    it('should list local worker logs in standalone mode', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/logs`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.agents).toContain('WorkerA');
    });

    it('should return local worker log content in standalone mode', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/logs/WorkerA`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.found).toBe(true);
      expect(data.content).toContain('line-one');
      expect(data.content).toContain('line-two');
    });

    it('should return standalone spawned agents from local state', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/spawned`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.some((agent: { name: string }) => agent.name === 'WorkerA')).toBe(true);
    });

    it('should provide actionable error for spawn in standalone mode', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'TestSpawn', cli: 'codex' }),
      });
      const data = await response.json();

      expect(response.status).toBe(501);
      expect(data.success).toBe(false);
      expect(data.code).toBe('unsupported_operation');
      expect(typeof data.error).toBe('string');
    });

    it('should return actionable error for broker API routes in standalone mode', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/brokers/workspace/ws-123/agents`);
      const data = await response.json();

      expect(response.status).toBe(501);
      expect(data.success).toBe(false);
      expect(data.code).toBe('unsupported_operation');
      expect(data.error).toContain('standalone mode');
    });

    it('should return breaking-change guidance for daemon API routes', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const response = await fetch(`http://localhost:${port}/api/daemons/workspace/ws-123/agents`);
      const data = await response.json();

      expect(response.status).toBe(410);
      expect(data.success).toBe(false);
      expect(data.code).toBe('daemon_removed');
      expect(data.error).toContain('BREAKING CHANGE');
      expect(Array.isArray(data.requiredEndpoints)).toBe(true);
      expect(data.requiredEndpoints).toContain('/api/brokers/*');
    });

    it('should return breaking-change guidance for removed legacy broker alias routes in standalone mode', async () => {
      const address = server.server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address not available');
      }
      const port = address.port;

      const releaseResponse = await fetch(`http://localhost:${port}/api/release`, { method: 'POST' });
      const releaseData = await releaseResponse.json();
      expect(releaseResponse.status).toBe(410);
      expect(releaseData.success).toBe(false);
      expect(releaseData.code).toBe('endpoint_removed');

      const cwdResponse = await fetch(`http://localhost:${port}/api/agents/WorkerA/cwd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/project' }),
      });
      const cwdData = await cwdResponse.json();
      expect(cwdResponse.status).toBe(410);
      expect(cwdData.success).toBe(false);
      expect(cwdData.code).toBe('endpoint_removed');
    });
  });
});

describe('Mock Fixtures', () => {
  it('should export valid agent fixtures', async () => {
    const { mockAgents } = await import('./mocks/fixtures.js');

    expect(mockAgents).toBeDefined();
    expect(Array.isArray(mockAgents)).toBe(true);
    expect(mockAgents.length).toBeGreaterThan(0);

    for (const agent of mockAgents) {
      expect(agent.name).toBeDefined();
      expect(agent.status).toBeDefined();
    }
  });

  it('should export valid message fixtures', async () => {
    const { mockMessages } = await import('./mocks/fixtures.js');

    expect(mockMessages).toBeDefined();
    expect(Array.isArray(mockMessages)).toBe(true);
    expect(mockMessages.length).toBeGreaterThan(0);

    for (const msg of mockMessages) {
      expect(msg.id).toBeDefined();
      expect(msg.from).toBeDefined();
      expect(msg.to).toBeDefined();
      expect(msg.content).toBeDefined();
      expect(msg.timestamp).toBeDefined();
    }
  });

  it('should export valid session fixtures', async () => {
    const { mockSessions } = await import('./mocks/fixtures.js');

    expect(mockSessions).toBeDefined();
    expect(Array.isArray(mockSessions)).toBe(true);
    expect(mockSessions.length).toBeGreaterThan(0);

    for (const session of mockSessions) {
      expect(session.id).toBeDefined();
      expect(session.agentName).toBeDefined();
      expect(session.startedAt).toBeDefined();
    }
  });

  it('should export valid decision fixtures', async () => {
    const { mockDecisions } = await import('./mocks/fixtures.js');

    expect(mockDecisions).toBeDefined();
    expect(Array.isArray(mockDecisions)).toBe(true);
    expect(mockDecisions.length).toBeGreaterThan(0);

    for (const decision of mockDecisions) {
      expect(decision.id).toBeDefined();
      expect(decision.agentName).toBeDefined();
      expect(decision.title).toBeDefined();
      expect(decision.urgency).toBeDefined();
      expect(decision.category).toBeDefined();
    }
  });

  it('should export valid task fixtures', async () => {
    const { mockTasks } = await import('./mocks/fixtures.js');

    expect(mockTasks).toBeDefined();
    expect(Array.isArray(mockTasks)).toBe(true);
    expect(mockTasks.length).toBeGreaterThan(0);

    for (const task of mockTasks) {
      expect(task.id).toBeDefined();
      expect(task.agentName).toBeDefined();
      expect(task.title).toBeDefined();
      expect(task.priority).toBeDefined();
      expect(task.status).toBeDefined();
    }
  });
});

describe('Proxy Send Routing', () => {
  let brokerServer: HttpServer;
  let dashboard: DashboardServer;
  let brokerPayload: Record<string, unknown> | null = null;

  beforeAll(async () => {
    brokerServer = createHttpServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/send') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          brokerPayload = body ? JSON.parse(body) as Record<string, unknown> : {};
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            event_id: 'http_evt_proxy_send',
            local: true,
          }));
        });
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'not found' }));
    });

    await new Promise<void>((resolve) => {
      brokerServer.listen(0, () => resolve());
    });

    const brokerAddress = brokerServer.address();
    if (!brokerAddress || typeof brokerAddress === 'string') {
      throw new Error('Broker address not available');
    }

    dashboard = createServer({
      port: 0,
      mock: false,
      verbose: false,
      relayUrl: `http://127.0.0.1:${brokerAddress.port}`,
    });
    await new Promise<void>((resolve) => {
      dashboard.server.listen(0, () => resolve());
    });
  });

  afterAll(async () => {
    await dashboard.close();
    await new Promise<void>((resolve, reject) => {
      brokerServer.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  it('routes /api/send through broker and returns broker event_id as messageId', async () => {
    const address = dashboard.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address not available');
    }
    const port = address.port;

    const response = await fetch(`http://localhost:${port}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'Lead', message: 'hello from proxy mode', from: 'Dashboard' }),
    });
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.messageId).toBe('http_evt_proxy_send');
    expect(brokerPayload).toMatchObject({
      to: 'Lead',
      message: 'hello from proxy mode',
    });
    expect(typeof brokerPayload?.from).toBe('string');
  });

  it('forwards thread id through /api/send in proxy mode', async () => {
    const address = dashboard.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address not available');
    }
    const port = address.port;

    const response = await fetch(`http://localhost:${port}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'Lead',
        message: 'threaded hello',
        from: 'Dashboard',
        thread: 'msg-parent-123',
      }),
    });
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.messageId).toBe('http_evt_proxy_send');
    expect(brokerPayload).toMatchObject({
      to: 'Lead',
      message: 'threaded hello',
      thread: 'msg-parent-123',
    });
  });
});
