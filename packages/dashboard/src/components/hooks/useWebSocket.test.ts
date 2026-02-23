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
  it('adds outbound relay_inbound messages as sending', () => {
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
      status: 'sending',
    });
  });

  it('marks matching message as acked on delivery_verified', () => {
    const state = applyBrokerEvent(emptyState(), {
      kind: 'relay_inbound',
      event_id: 'evt_2',
      from: 'Dashboard',
      target: 'Lead',
      body: 'hello',
    });
    const next = applyBrokerEvent(state, {
      kind: 'delivery_verified',
      event_id: 'evt_2',
      delivery_id: 'del_2',
    });

    expect(next?.messages[0]?.status).toBe('acked');
  });

  it('marks matching message as failed on delivery_failed', () => {
    const state = applyBrokerEvent(emptyState(), {
      kind: 'relay_inbound',
      event_id: 'evt_3',
      from: 'Dashboard',
      target: 'Lead',
      body: 'hello',
    });
    const next = applyBrokerEvent(state, {
      kind: 'delivery_failed',
      event_id: 'evt_3',
      delivery_id: 'del_3',
      reason: 'agent_exit',
    });

    expect(next?.messages[0]?.status).toBe('failed');
  });

  it('does not duplicate relay_inbound events with same event_id', () => {
    const first = applyBrokerEvent(emptyState(), {
      kind: 'relay_inbound',
      event_id: 'evt_4',
      from: 'Dashboard',
      target: 'Lead',
      body: 'first',
    });
    const second = applyBrokerEvent(first, {
      kind: 'relay_inbound',
      event_id: 'evt_4',
      from: 'Dashboard',
      target: 'Lead',
      body: 'second',
    });

    expect(second?.messages).toHaveLength(1);
    expect(second?.messages[0]?.content).toBe('first');
  });
});

