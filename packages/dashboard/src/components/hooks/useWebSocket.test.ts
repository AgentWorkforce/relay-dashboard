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
});
