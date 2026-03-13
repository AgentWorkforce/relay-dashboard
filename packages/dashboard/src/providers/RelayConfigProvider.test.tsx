/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockRelayProviderProps = {
  apiKey: string;
  agentToken: string;
  wsToken?: string;
  baseUrl?: string;
  channels?: string[];
  children?: React.ReactNode;
};

const relayProviderCalls: MockRelayProviderProps[] = [];

vi.mock('@relaycast/react', () => ({
  RelayProvider: ({ children, ...props }: MockRelayProviderProps) => {
    relayProviderCalls.push(props);
    return <>{children}</>;
  },
}));

import { RelayConfigProvider } from './RelayConfigProvider';

interface RelayConfigPayload {
  success: boolean;
  baseUrl: string;
  apiKey: string;
  agentToken: string;
  agentName: string;
  channels: string[];
  wsToken?: string;
}

interface QueuedFetchResponse {
  url: string;
  status?: number;
  payload?: unknown;
}

function makeConfig(agentToken: string, overrides: Partial<RelayConfigPayload> = {}): RelayConfigPayload {
  return {
    success: true,
    baseUrl: 'https://api.relaycast.dev',
    apiKey: 'rk_test',
    agentToken,
    agentName: 'relay-dashboard',
    channels: ['general'],
    ...overrides,
  };
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>();

  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    const peers = MockBroadcastChannel.channels.get(name) ?? new Set<MockBroadcastChannel>();
    peers.add(this);
    MockBroadcastChannel.channels.set(name, peers);
  }

  postMessage(data: unknown): void {
    const peers = MockBroadcastChannel.channels.get(this.name);
    if (!peers) return;

    for (const peer of peers) {
      if (peer === this) continue;
      peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    const peers = MockBroadcastChannel.channels.get(this.name);
    peers?.delete(this);
    if (peers && peers.size === 0) {
      MockBroadcastChannel.channels.delete(this.name);
    }
  }
}

describe('RelayConfigProvider', () => {
  beforeEach(() => {
    relayProviderCalls.length = 0;
    MockBroadcastChannel.channels.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('passes the stable wsToken to RelayProvider', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      status: 200,
      ok: true,
      json: async () => {
        expect(String(input)).toBe('/api/relay-config');
        return makeConfig('agt_old', { wsToken: 'rk_ws' });
      },
    }));

    vi.stubGlobal('fetch', fetchMock);

    render(
      <RelayConfigProvider>
        <div>dashboard</div>
      </RelayConfigProvider>,
    );

    await flushPromises();

    expect(relayProviderCalls.at(-1)).toMatchObject({
      apiKey: 'rk_test',
      agentToken: 'agt_old',
      wsToken: 'rk_ws',
    });
  });

  it('refreshes a stale agent token on Relaycast 401 and retries once with the new token', async () => {
    const queuedResponses: QueuedFetchResponse[] = [
      {
        url: '/api/relay-config',
        payload: makeConfig('agt_old', { wsToken: 'rk_test' }),
      },
      {
        url: 'https://api.relaycast.dev/v1/channels',
        status: 401,
        payload: { ok: false, error: { code: 'unauthorized', message: 'stale token' } },
      },
      {
        url: '/api/relay-config?refresh=true',
        payload: makeConfig('agt_new', { wsToken: 'rk_test' }),
      },
      {
        url: 'https://api.relaycast.dev/v1/channels',
        payload: { ok: true, data: [] },
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = queuedResponses.shift();
      if (!next) {
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }

      expect(String(input)).toBe(next.url);
      if (next.url === 'https://api.relaycast.dev/v1/channels') {
        const headers = new Headers(init?.headers);
        const authHeader = headers.get('Authorization');
        if (next.status === 401) {
          expect(authHeader).toBe('Bearer agt_old');
        } else {
          expect(authHeader).toBe('Bearer agt_new');
        }
      }

      const status = next.status ?? 200;
      return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => next.payload,
      };
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <RelayConfigProvider>
        <div>dashboard</div>
      </RelayConfigProvider>,
    );

    await flushPromises();

    let response: Response;
    await act(async () => {
      response = await globalThis.fetch('https://api.relaycast.dev/v1/channels', {
        headers: {
          Authorization: 'Bearer agt_old',
        },
      });
      await Promise.resolve();
    });
    await flushPromises();

    expect(response!.status).toBe(200);
    expect(relayProviderCalls.at(-1)).toMatchObject({
      agentToken: 'agt_new',
      wsToken: 'rk_test',
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/relay-config',
      'https://api.relaycast.dev/v1/channels',
      '/api/relay-config?refresh=true',
      'https://api.relaycast.dev/v1/channels',
    ]);
  });

  it('retries with the current broadcasted token before forcing another refresh', async () => {
    const queuedResponses: QueuedFetchResponse[] = [
      {
        url: '/api/relay-config',
        payload: makeConfig('agt_old', { wsToken: 'rk_test' }),
      },
      {
        url: 'https://api.relaycast.dev/v1/channels',
        status: 401,
        payload: { ok: false, error: { code: 'unauthorized', message: 'stale token' } },
      },
      {
        url: 'https://api.relaycast.dev/v1/channels',
        payload: { ok: true, data: [] },
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = queuedResponses.shift();
      if (!next) {
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }

      expect(String(input)).toBe(next.url);
      if (next.url === 'https://api.relaycast.dev/v1/channels') {
        const headers = new Headers(init?.headers);
        const authHeader = headers.get('Authorization');
        if (next.status === 401) {
          expect(authHeader).toBe('Bearer agt_old');
        } else {
          expect(authHeader).toBe('Bearer agt_new');
        }
      }

      const status = next.status ?? 200;
      return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => next.payload,
      };
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    render(
      <RelayConfigProvider>
        <div>dashboard</div>
      </RelayConfigProvider>,
    );

    await flushPromises();

    const peer = new MockBroadcastChannel('relay-dashboard:relay-config');
    await act(async () => {
      peer.postMessage({
        type: 'relay-config-refreshed',
        config: makeConfig('agt_new', { wsToken: 'rk_test' }),
      });
      await Promise.resolve();
    });

    let response: Response;
    await act(async () => {
      response = await globalThis.fetch('https://api.relaycast.dev/v1/channels', {
        headers: {
          Authorization: 'Bearer agt_old',
        },
      });
      await Promise.resolve();
    });
    await flushPromises();

    expect(response!.status).toBe(200);
    expect(relayProviderCalls.at(-1)).toMatchObject({
      agentToken: 'agt_new',
      wsToken: 'rk_test',
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/relay-config',
      'https://api.relaycast.dev/v1/channels',
      'https://api.relaycast.dev/v1/channels',
    ]);
    peer.close();
  });
});
