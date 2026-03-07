import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { getRelayDmParticipantName, normalizeRelayDmMessageTargets } from './relaycastMessageAdapters.js';

function setRelayUsername(value?: string): void {
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  if (!storage) {
    return;
  }

  if (value) {
    storage.setItem('relay_username', value);
  } else {
    storage.removeItem('relay_username');
  }
}

function installMockLocalStorage(): void {
  if ((globalThis as { localStorage?: Storage }).localStorage) {
    return;
  }

  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } satisfies Storage;

  vi.stubGlobal('localStorage', mockStorage);
}

describe('normalizeRelayDmMessageTargets', () => {
  beforeEach(() => {
    installMockLocalStorage();
    setRelayUsername(undefined);
  });

  afterEach(() => {
    setRelayUsername(undefined);
  });

  it('maps dm_* targets to the other participant for incoming replies', () => {
    const messages: Message[] = [
      {
        id: 'msg-1',
        from: 'Natty',
        to: 'dm_7b62c72644b9316e7e10a992',
        content: 'hello',
        timestamp: '2026-02-24T12:00:00.000Z',
      },
    ];

    const normalized = normalizeRelayDmMessageTargets(messages, [
      {
        id: 'dm_7b62c72644b9316e7e10a992',
        participants: ['Natty', 'test-broker-new'],
      },
    ]);

    expect(normalized[0]?.to).toBe('test-broker-new');
  });

  it('maps dm_* targets to the opposite participant for sent replies', () => {
    const messages: Message[] = [
      {
        id: 'msg-2',
        from: 'test-broker-new',
        to: 'dm_7b62c72644b9316e7e10a992',
        content: 'ack',
        timestamp: '2026-02-24T12:00:01.000Z',
      },
    ];

    const normalized = normalizeRelayDmMessageTargets(messages, [
      {
        id: 'dm_7b62c72644b9316e7e10a992',
        participants: ['Natty', 'test-broker-new'],
      },
    ]);

    expect(normalized[0]?.to).toBe('Natty');
  });

  it('maps dm_* targets to object participants using agent_name', () => {
    const messages: Message[] = [
      {
        id: 'msg-2a',
        from: 'Natty',
        to: 'dm_7b62c72644b9316e7e10a992',
        content: 'hello',
        timestamp: '2026-02-24T12:00:06.000Z',
      },
    ];

    const normalized = normalizeRelayDmMessageTargets(messages, [
      {
        id: 'dm_7b62c72644b9316e7e10a992',
        participants: [{ agent_name: 'Natty' }, { agent_name: 'test-broker-new' }],
      },
    ]);

    expect(normalized[0]?.to).toBe('test-broker-new');
  });

  it('normalizes participant names using getRelayDmParticipantName', () => {
    expect(getRelayDmParticipantName({ agent_name: 'Lead', name: 'ignored' })).toBe('Lead');
    expect(getRelayDmParticipantName({ agentName: 'Codex-Worker' })).toBe('Codex-Worker');
    expect(getRelayDmParticipantName('Test-Broker')).toBe('Test-Broker');
    expect(getRelayDmParticipantName({ username: 'human-user' })).toBe('human-user');
    expect(getRelayDmParticipantName(123)).toBeNull();
  });

  it('leaves non-dm and unknown dm targets unchanged', () => {
    const messages: Message[] = [
      {
        id: 'msg-3',
        from: 'Natty',
        to: '#general',
        content: 'channel',
        timestamp: '2026-02-24T12:00:02.000Z',
      },
      {
        id: 'msg-4',
        from: 'Natty',
        to: 'dm_missing',
        content: 'unmapped',
        timestamp: '2026-02-24T12:00:03.000Z',
      },
    ];

    const normalized = normalizeRelayDmMessageTargets(messages, [
      {
        id: 'dm_7b62c72644b9316e7e10a992',
        participants: ['Natty', 'test-broker-new'],
      },
    ]);

    expect(normalized).toBe(messages);
    expect(normalized[0]?.to).toBe('#general');
    expect(normalized[1]?.to).toBe('dm_missing');
  });

  it('maps Dashboard-<suffix> targets to the project display identity when available', () => {
    setRelayUsername('test-broker-new');

    const messages: Message[] = [
      {
        id: 'msg-5',
        from: 'Natty',
        to: 'Dashboard-5b8c70e5',
        content: 'reply',
        timestamp: '2026-02-24T12:00:04.000Z',
      },
    ];

    const normalized = normalizeRelayDmMessageTargets(messages, []);

    expect(normalized[0]?.to).toBe('test-broker-new');
  });

  it('falls back to Dashboard when no project display identity is stored', () => {
    const messages: Message[] = [
      {
        id: 'msg-6',
        from: 'Natty',
        to: 'Dashboard-5b8c70e5',
        content: 'reply',
        timestamp: '2026-02-24T12:00:05.000Z',
      },
    ];

    const normalized = normalizeRelayDmMessageTargets(messages, []);

    expect(normalized[0]?.to).toBe('Dashboard');
  });

  it('normalizes Dashboard-<suffix> participants when resolving dm_* targets', () => {
    setRelayUsername('test-broker-new');

    const messages: Message[] = [
      {
        id: 'msg-7',
        from: 'Natty',
        to: 'dm_7b62c72644b9316e7e10a992',
        content: 'hello',
        timestamp: '2026-02-24T12:00:06.000Z',
      },
    ];

    const normalized = normalizeRelayDmMessageTargets(messages, [
      {
        id: 'dm_7b62c72644b9316e7e10a992',
        participants: ['Natty', 'Dashboard-5b8c70e5'],
      },
    ]);

    expect(normalized[0]?.to).toBe('test-broker-new');
  });
});
