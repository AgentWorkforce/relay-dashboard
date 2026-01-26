/**
 * Tests for metrics service
 *
 * Tests the metrics computation functions for agent, throughput, session, and system metrics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeAgentMetrics,
  computeThroughputMetrics,
  computeSessionMetrics,
  computeSystemMetrics,
  formatPrometheusMetrics,
} from './metrics.js';

describe('metrics service', () => {
  const now = Date.now();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('computeAgentMetrics', () => {
    it('should return empty array for no agents', () => {
      const result = computeAgentMetrics([]);
      expect(result).toEqual([]);
    });

    it('should compute basic agent metrics', () => {
      const agents = [
        {
          name: 'agent-1',
          messagesSent: 10,
          messagesReceived: 5,
          firstSeen: new Date(now - 3600000).toISOString(), // 1 hour ago
          lastSeen: new Date(now - 5000).toISOString(), // 5 seconds ago
        },
      ];

      const result = computeAgentMetrics(agents);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('agent-1');
      expect(result[0].messagesSent).toBe(10);
      expect(result[0].messagesReceived).toBe(5);
      expect(result[0].isOnline).toBe(true); // within 30s threshold
      expect(result[0].uptimeSeconds).toBe(3600); // 1 hour
    });

    it('should mark agent offline after 30 seconds of inactivity', () => {
      const agents = [
        {
          name: 'agent-1',
          messagesSent: 5,
          messagesReceived: 3,
          firstSeen: new Date(now - 3600000).toISOString(),
          lastSeen: new Date(now - 35000).toISOString(), // 35 seconds ago
        },
      ];

      const result = computeAgentMetrics(agents);

      expect(result[0].isOnline).toBe(false);
    });

    it('should compute metrics for multiple agents', () => {
      const agents = [
        {
          name: 'agent-1',
          messagesSent: 10,
          messagesReceived: 5,
          firstSeen: new Date(now - 3600000).toISOString(),
          lastSeen: new Date(now - 5000).toISOString(),
        },
        {
          name: 'agent-2',
          messagesSent: 20,
          messagesReceived: 15,
          firstSeen: new Date(now - 7200000).toISOString(), // 2 hours ago
          lastSeen: new Date(now - 60000).toISOString(), // 1 minute ago (offline)
        },
      ];

      const result = computeAgentMetrics(agents);

      expect(result).toHaveLength(2);
      expect(result[0].isOnline).toBe(true);
      expect(result[1].isOnline).toBe(false);
      expect(result[1].uptimeSeconds).toBe(7200); // 2 hours
    });
  });

  describe('computeThroughputMetrics', () => {
    it('should return zeros for no messages', () => {
      const result = computeThroughputMetrics([]);

      expect(result.messagesLastMinute).toBe(0);
      expect(result.messagesLastHour).toBe(0);
      expect(result.messagesLast24Hours).toBe(0);
      expect(result.avgMessagesPerMinute).toBe(0);
    });

    it('should count messages in the last minute', () => {
      const messages = [
        { timestamp: new Date(now - 30000).toISOString() }, // 30s ago
        { timestamp: new Date(now - 45000).toISOString() }, // 45s ago
        { timestamp: new Date(now - 120000).toISOString() }, // 2 min ago (outside)
      ];

      const result = computeThroughputMetrics(messages);

      expect(result.messagesLastMinute).toBe(2);
      expect(result.messagesLastHour).toBe(3);
      expect(result.messagesLast24Hours).toBe(3);
    });

    it('should count messages in the last hour', () => {
      const messages = [
        { timestamp: new Date(now - 30000).toISOString() }, // 30s ago
        { timestamp: new Date(now - 1800000).toISOString() }, // 30 min ago
        { timestamp: new Date(now - 3540000).toISOString() }, // 59 min ago
        { timestamp: new Date(now - 3660000).toISOString() }, // 61 min ago (outside)
      ];

      const result = computeThroughputMetrics(messages);

      expect(result.messagesLastMinute).toBe(1);
      expect(result.messagesLastHour).toBe(3);
      expect(result.messagesLast24Hours).toBe(4);
    });

    it('should calculate average messages per minute correctly', () => {
      // 60 messages in the last hour = 1 per minute
      const messages = Array.from({ length: 60 }, (_, i) => ({
        timestamp: new Date(now - i * 60000).toISOString(), // Every minute for the last hour
      }));

      const result = computeThroughputMetrics(messages);

      expect(result.messagesLastHour).toBe(60);
      expect(result.avgMessagesPerMinute).toBe(1);
    });
  });

  describe('computeSessionMetrics', () => {
    it('should return zeros for no sessions', () => {
      const result = computeSessionMetrics([]);

      expect(result.totalSessions).toBe(0);
      expect(result.activeSessions).toBe(0);
      expect(result.closedByAgent).toBe(0);
      expect(result.closedByDisconnect).toBe(0);
      expect(result.closedByError).toBe(0);
      expect(result.errorRate).toBe(0);
      expect(result.recentSessions).toEqual([]);
    });

    it('should count active sessions', () => {
      const sessions = [
        {
          id: 'session-1',
          agentName: 'agent-1',
          startedAt: now - 3600000,
          messageCount: 10,
        },
        {
          id: 'session-2',
          agentName: 'agent-2',
          startedAt: now - 7200000,
          messageCount: 5,
        },
      ];

      const result = computeSessionMetrics(sessions);

      expect(result.totalSessions).toBe(2);
      expect(result.activeSessions).toBe(2);
    });

    it('should count sessions closed by different methods', () => {
      const sessions = [
        {
          id: 'session-1',
          agentName: 'agent-1',
          startedAt: now - 3600000,
          endedAt: now - 1800000,
          closedBy: 'agent' as const,
          messageCount: 10,
        },
        {
          id: 'session-2',
          agentName: 'agent-2',
          startedAt: now - 7200000,
          endedAt: now - 3600000,
          closedBy: 'disconnect' as const,
          messageCount: 5,
        },
        {
          id: 'session-3',
          agentName: 'agent-3',
          startedAt: now - 10800000,
          endedAt: now - 7200000,
          closedBy: 'error' as const,
          messageCount: 3,
        },
      ];

      const result = computeSessionMetrics(sessions);

      expect(result.totalSessions).toBe(3);
      expect(result.activeSessions).toBe(0);
      expect(result.closedByAgent).toBe(1);
      expect(result.closedByDisconnect).toBe(1);
      expect(result.closedByError).toBe(1);
    });

    it('should treat sessions with no closedBy as disconnect', () => {
      const sessions = [
        {
          id: 'session-1',
          agentName: 'agent-1',
          startedAt: now - 3600000,
          endedAt: now - 1800000,
          messageCount: 10,
          // no closedBy
        },
      ];

      const result = computeSessionMetrics(sessions);

      expect(result.closedByDisconnect).toBe(1);
    });

    it('should calculate error rate correctly', () => {
      const sessions = [
        {
          id: 'session-1',
          agentName: 'agent-1',
          startedAt: now - 3600000,
          endedAt: now - 1800000,
          closedBy: 'agent' as const,
          messageCount: 10,
        },
        {
          id: 'session-2',
          agentName: 'agent-2',
          startedAt: now - 7200000,
          endedAt: now - 3600000,
          closedBy: 'error' as const,
          messageCount: 5,
        },
      ];

      const result = computeSessionMetrics(sessions);

      // 1 error out of 2 closed = 50%
      expect(result.errorRate).toBe(50);
    });

    it('should include recent sessions in output', () => {
      const sessions = [
        {
          id: 'session-1',
          agentName: 'agent-1',
          startedAt: now - 3600000,
          messageCount: 10,
        },
      ];

      const result = computeSessionMetrics(sessions);

      expect(result.recentSessions).toHaveLength(1);
      expect(result.recentSessions[0].id).toBe('session-1');
      expect(result.recentSessions[0].agentName).toBe('agent-1');
      expect(result.recentSessions[0].messageCount).toBe(10);
    });

    it('should limit recent sessions to 10', () => {
      const sessions = Array.from({ length: 15 }, (_, i) => ({
        id: `session-${i}`,
        agentName: `agent-${i}`,
        startedAt: now - i * 3600000,
        messageCount: i,
      }));

      const result = computeSessionMetrics(sessions);

      expect(result.recentSessions).toHaveLength(10);
    });
  });

  describe('computeSystemMetrics', () => {
    it('should aggregate all metrics correctly', () => {
      const agents = [
        {
          name: 'agent-1',
          messagesSent: 10,
          messagesReceived: 10,
          firstSeen: new Date(now - 3600000).toISOString(),
          lastSeen: new Date(now - 5000).toISOString(),
        },
        {
          name: 'agent-2',
          messagesSent: 20,
          messagesReceived: 20,
          firstSeen: new Date(now - 7200000).toISOString(),
          lastSeen: new Date(now - 60000).toISOString(), // offline
        },
      ];

      const messages = [
        { timestamp: new Date(now - 30000).toISOString() },
        { timestamp: new Date(now - 120000).toISOString() },
      ];

      const sessions = [
        {
          id: 'session-1',
          agentName: 'agent-1',
          startedAt: now - 3600000,
          messageCount: 10,
        },
      ];

      const result = computeSystemMetrics(agents, messages, sessions);

      expect(result.totalAgents).toBe(2);
      expect(result.onlineAgents).toBe(1);
      expect(result.offlineAgents).toBe(1);
      expect(result.totalMessages).toBe(30); // (10+10+20+20)/2 = 30
      expect(result.throughput).toBeDefined();
      expect(result.sessions).toBeDefined();
      expect(result.agents).toHaveLength(2);
      expect(result.timestamp).toBeDefined();
    });

    it('should work with empty sessions', () => {
      const agents = [
        {
          name: 'agent-1',
          messagesSent: 10,
          messagesReceived: 5,
          firstSeen: new Date(now - 3600000).toISOString(),
          lastSeen: new Date(now - 5000).toISOString(),
        },
      ];

      const messages = [{ timestamp: new Date(now - 30000).toISOString() }];

      const result = computeSystemMetrics(agents, messages);

      expect(result.sessions.totalSessions).toBe(0);
    });
  });

  describe('formatPrometheusMetrics', () => {
    it('should format metrics in Prometheus exposition format', () => {
      const metrics = computeSystemMetrics(
        [
          {
            name: 'agent-1',
            messagesSent: 10,
            messagesReceived: 5,
            firstSeen: new Date(now - 3600000).toISOString(),
            lastSeen: new Date(now - 5000).toISOString(),
          },
        ],
        [{ timestamp: new Date(now - 30000).toISOString() }],
        [
          {
            id: 'session-1',
            agentName: 'agent-1',
            startedAt: now - 3600000,
            messageCount: 10,
          },
        ]
      );

      const output = formatPrometheusMetrics(metrics);

      // Check format
      expect(output).toContain('# HELP agent_relay_agents_total');
      expect(output).toContain('# TYPE agent_relay_agents_total gauge');
      expect(output).toContain('agent_relay_agents_total 1');

      expect(output).toContain('# HELP agent_relay_agents_online');
      expect(output).toContain('agent_relay_agents_online 1');

      expect(output).toContain('# HELP agent_relay_messages_total');
      expect(output).toContain('# TYPE agent_relay_messages_total counter');

      // Check per-agent metrics with labels
      expect(output).toContain('agent_relay_agent_messages_sent{agent="agent-1"} 10');
      expect(output).toContain('agent_relay_agent_messages_received{agent="agent-1"} 5');
      expect(output).toContain('agent_relay_agent_online{agent="agent-1"} 1');

      // Session metrics
      expect(output).toContain('# HELP agent_relay_sessions_total');
      expect(output).toContain('agent_relay_sessions_total 1');
      expect(output).toContain('agent_relay_sessions_active 1');
    });

    it('should end with newline', () => {
      const metrics = computeSystemMetrics([], [], []);
      const output = formatPrometheusMetrics(metrics);

      expect(output.endsWith('\n')).toBe(true);
    });

    it('should include session closure breakdown', () => {
      const metrics = computeSystemMetrics(
        [],
        [],
        [
          {
            id: 'session-1',
            agentName: 'agent-1',
            startedAt: now - 3600000,
            endedAt: now - 1800000,
            closedBy: 'agent' as const,
            messageCount: 10,
          },
          {
            id: 'session-2',
            agentName: 'agent-2',
            startedAt: now - 7200000,
            endedAt: now - 3600000,
            closedBy: 'error' as const,
            messageCount: 5,
          },
        ]
      );

      const output = formatPrometheusMetrics(metrics);

      expect(output).toContain('agent_relay_sessions_closed_total{closed_by="agent"} 1');
      expect(output).toContain('agent_relay_sessions_closed_total{closed_by="error"} 1');
      expect(output).toContain('agent_relay_sessions_error_rate 50');
    });
  });
});
