/**
 * Proxy Server Tests
 *
 * Tests for the proxy/mock server in both proxy and mock modes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type DashboardServer } from './proxy-server.js';

describe('Dashboard Server', () => {
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
        body: JSON.stringify({ to: 'claude-1', content: 'Hello!' }),
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
