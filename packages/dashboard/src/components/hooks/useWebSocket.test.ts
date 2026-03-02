import { describe, expect, it } from 'vitest';
import type { DashboardData } from './useWebSocket';
import { applyBrokerEvent } from './useWebSocket';

function emptyState(): DashboardData {
  return {
    agents: [],
    messages: [],
  };
}

describe('applyBrokerEvent', () => {
  it('adds relay_inbound DM to messages', () => {
    const next = applyBrokerEvent(emptyState(), {
      kind: 'relay_inbound',
      event_id: 'evt_1',
      from: 'Dashboard',
      target: 'Lead',
      body: 'hello',
    });

    expect(next?.messages).toHaveLength(1);
    expect(next?.messages[0]).toMatchObject({
      id: 'evt_1',
      from: 'Dashboard',
      to: 'Lead',
      content: 'hello',
    });
  });

  it('skips relay_inbound channel messages (handled by useChannels)', () => {
    const next = applyBrokerEvent(emptyState(), {
      kind: 'relay_inbound',
      event_id: 'evt_ch',
      from: 'Hero',
      target: '#general',
      body: 'hello channel',
    });

    expect(next?.messages).toHaveLength(0);
  });

  it('bootstraps empty state when prev is null', () => {
    const next = applyBrokerEvent(null, {
      kind: 'relay_inbound',
      event_id: 'evt_null',
      from: 'Dashboard',
      target: 'Lead',
      body: 'hello',
    });

    expect(next).not.toBeNull();
    expect(next?.messages).toHaveLength(1);
  });

  it('skips relay_inbound with missing fields', () => {
    const next = applyBrokerEvent(emptyState(), {
      kind: 'relay_inbound',
      event_id: 'evt_bad',
      from: '',
      target: 'Lead',
      body: 'hello',
    });

    expect(next?.messages).toHaveLength(0);
  });

  // --- Delivery Status ---

  describe('delivery status events', () => {
    it('delivery_verified sets message status to acked by event_id', () => {
      const state: DashboardData = {
        agents: [],
        messages: [
          { id: 'evt_1', from: 'Dashboard', to: 'Lead', content: 'hello', timestamp: '2024-01-01', status: 'sending' },
        ],
      };

      const next = applyBrokerEvent(state, {
        kind: 'delivery_verified',
        name: 'Lead',
        delivery_id: 'del_1',
        event_id: 'evt_1',
      });

      expect(next?.messages[0]?.status).toBe('acked');
    });

    it('delivery_verified does not modify messages with different event_id', () => {
      const state: DashboardData = {
        agents: [],
        messages: [
          { id: 'evt_other', from: 'Dashboard', to: 'Lead', content: 'hello', timestamp: '2024-01-01', status: 'sending' },
        ],
      };

      const next = applyBrokerEvent(state, {
        kind: 'delivery_verified',
        name: 'Lead',
        delivery_id: 'del_1',
        event_id: 'evt_1',
      });

      expect(next?.messages[0]?.status).toBe('sending');
    });

    it('delivery_verified with missing event_id returns prev state', () => {
      const state = emptyState();
      const next = applyBrokerEvent(state, {
        kind: 'delivery_verified',
        name: 'Lead',
        delivery_id: 'del_1',
      });
      expect(next).toBe(state);
    });

    it('delivery_failed sets message status to failed by event_id', () => {
      const state: DashboardData = {
        agents: [],
        messages: [
          { id: 'evt_2', from: 'Dashboard', to: 'Lead', content: 'hello', timestamp: '2024-01-01', status: 'sending' },
        ],
      };

      const next = applyBrokerEvent(state, {
        kind: 'delivery_failed',
        name: 'Lead',
        delivery_id: 'del_2',
        event_id: 'evt_2',
        reason: 'timeout',
      });

      expect(next?.messages[0]?.status).toBe('failed');
    });

    it('delivery_failed with missing event_id returns prev state', () => {
      const state = emptyState();
      const next = applyBrokerEvent(state, {
        kind: 'delivery_failed',
        name: 'Lead',
        delivery_id: 'del_2',
        reason: 'timeout',
      });
      expect(next).toBe(state);
    });
  });

  // --- Thinking / Processing State ---

  describe('thinking/processing state events', () => {
    function stateWithAgent(name: string): DashboardData {
      return {
        agents: [{ name, status: 'online' }],
        messages: [],
      };
    }

    it('delivery_ack sets agent isProcessing and processingStartedAt', () => {
      const state = stateWithAgent('Lead');
      const before = Date.now();

      const next = applyBrokerEvent(state, {
        kind: 'delivery_ack',
        delivery_id: 'del_1',
        name: 'Lead',
      });

      const agent = next?.agents.find((a) => a.name === 'Lead');
      expect(agent?.isProcessing).toBe(true);
      expect(agent?.processingStartedAt).toBeGreaterThanOrEqual(before);
      expect(agent?.processingStartedAt).toBeLessThanOrEqual(Date.now());
    });

    it('delivery_active sets agent isProcessing and processingStartedAt', () => {
      const state = stateWithAgent('Lead');
      const before = Date.now();

      const next = applyBrokerEvent(state, {
        kind: 'delivery_active',
        delivery_id: 'del_1',
        name: 'Lead',
      });

      const agent = next?.agents.find((a) => a.name === 'Lead');
      expect(agent?.isProcessing).toBe(true);
      expect(agent?.processingStartedAt).toBeGreaterThanOrEqual(before);
    });

    it('delivery_ack with missing name field returns prev state', () => {
      const state = stateWithAgent('Lead');
      const next = applyBrokerEvent(state, {
        kind: 'delivery_ack',
        delivery_id: 'del_1',
      });
      expect(next).toBe(state);
    });

    it('delivery_active with missing name field returns prev state', () => {
      const state = stateWithAgent('Lead');
      const next = applyBrokerEvent(state, {
        kind: 'delivery_active',
        delivery_id: 'del_1',
      });
      expect(next).toBe(state);
    });

    it('delivery_ack does not modify unrelated agents', () => {
      const state: DashboardData = {
        agents: [
          { name: 'Lead', status: 'online' },
          { name: 'Helper', status: 'online' },
        ],
        messages: [],
      };

      const next = applyBrokerEvent(state, {
        kind: 'delivery_ack',
        delivery_id: 'del_1',
        name: 'Lead',
      });

      expect(next?.agents.find((a) => a.name === 'Helper')?.isProcessing).toBeUndefined();
    });

    it('agent_idle clears processingStartedAt and lastLogLine', () => {
      const state: DashboardData = {
        agents: [{ name: 'Lead', status: 'online', isProcessing: true, processingStartedAt: 12345, lastLogLine: 'some log' }],
        messages: [],
      };

      const next = applyBrokerEvent(state, {
        kind: 'agent_idle',
        name: 'Lead',
        idle_secs: 5,
      });

      const agent = next?.agents.find((a) => a.name === 'Lead');
      expect(agent?.isProcessing).toBe(false);
      expect(agent?.processingStartedAt).toBeUndefined();
      expect(agent?.lastLogLine).toBeUndefined();
    });
  });

  // --- Worker Stream Logs ---

  describe('worker stream events', () => {
    it('worker_stream sets lastLogLine on the matching agent', () => {
      const state: DashboardData = {
        agents: [{ name: 'Lead', status: 'online', isProcessing: true }],
        messages: [],
      };

      const next = applyBrokerEvent(state, {
        kind: 'worker_stream',
        name: 'Lead',
        stream: 'stdout',
        chunk: 'Running tests...',
      });

      expect(next?.agents.find((a) => a.name === 'Lead')?.lastLogLine).toBe('Running tests...');
    });

    it('worker_stream does not modify unrelated agents', () => {
      const state: DashboardData = {
        agents: [
          { name: 'Lead', status: 'online' },
          { name: 'Helper', status: 'online' },
        ],
        messages: [],
      };

      const next = applyBrokerEvent(state, {
        kind: 'worker_stream',
        name: 'Lead',
        stream: 'stdout',
        chunk: 'log line',
      });

      expect(next?.agents.find((a) => a.name === 'Helper')?.lastLogLine).toBeUndefined();
    });

    it('worker_stream with missing name returns prev state', () => {
      const state = emptyState();
      const next = applyBrokerEvent(state, {
        kind: 'worker_stream',
        stream: 'stdout',
        chunk: 'text',
      });
      expect(next).toBe(state);
    });

    it('worker_stream overwrites previous lastLogLine', () => {
      const state: DashboardData = {
        agents: [{ name: 'Lead', status: 'online', lastLogLine: 'old line' }],
        messages: [],
      };

      const next = applyBrokerEvent(state, {
        kind: 'worker_stream',
        name: 'Lead',
        stream: 'stdout',
        chunk: 'new line',
      });

      expect(next?.agents.find((a) => a.name === 'Lead')?.lastLogLine).toBe('new line');
    });
  });

  // --- Full Lifecycle Integration ---

  describe('full delivery lifecycle', () => {
    it('sending -> acked -> processing -> stream -> idle clears all state', () => {
      let state: DashboardData = {
        agents: [{ name: 'Lead', status: 'online' }],
        messages: [
          { id: 'evt_lc', from: 'Dashboard', to: 'Lead', content: 'do stuff', timestamp: '2024-01-01', status: 'sending' },
        ],
      };

      // 1. delivery_verified -> message becomes acked
      state = applyBrokerEvent(state, {
        kind: 'delivery_verified',
        name: 'Lead',
        delivery_id: 'del_lc',
        event_id: 'evt_lc',
      })!;
      expect(state.messages[0]?.status).toBe('acked');

      // 2. delivery_ack -> agent starts processing
      state = applyBrokerEvent(state, {
        kind: 'delivery_ack',
        delivery_id: 'del_lc',
        name: 'Lead',
      })!;
      expect(state.agents[0]?.isProcessing).toBe(true);
      expect(state.agents[0]?.processingStartedAt).toBeDefined();

      // 3. worker_stream -> log line appears
      state = applyBrokerEvent(state, {
        kind: 'worker_stream',
        name: 'Lead',
        stream: 'stdout',
        chunk: 'Compiling...',
      })!;
      expect(state.agents[0]?.lastLogLine).toBe('Compiling...');

      // 4. agent_idle -> processing state fully cleared
      state = applyBrokerEvent(state, {
        kind: 'agent_idle',
        name: 'Lead',
        idle_secs: 3,
      })!;
      expect(state.agents[0]?.isProcessing).toBe(false);
      expect(state.agents[0]?.processingStartedAt).toBeUndefined();
      expect(state.agents[0]?.lastLogLine).toBeUndefined();
    });
  });
});
