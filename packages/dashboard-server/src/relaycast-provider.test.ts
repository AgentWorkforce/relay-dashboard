import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelaycastConfig } from './relaycast-provider.js';

const CONFIG: RelaycastConfig = {
  apiKey: 'rk_test',
  baseUrl: 'https://api.relaycast.dev',
};

function makeJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function getRequestUrl(input: string | URL | Request): URL {
  if (typeof input === 'string') {
    return new URL(input);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input.url);
}

describe('relaycast-provider fetchAllMessages', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('includes DM conversation messages and maps broker identity to Dashboard', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getRequestUrl(input);
      const pathname = url.pathname;

      if (pathname === '/v1/agents') {
        return makeJsonResponse({
          ok: true,
          data: [],
        });
      }

      if (pathname === '/v1/channels') {
        return makeJsonResponse({
          ok: true,
          data: [{
            id: 'ch_1',
            name: 'general',
            topic: null,
            member_count: 1,
            created_at: '2026-02-23T10:00:00.000Z',
            is_archived: false,
          }],
        });
      }

      if (pathname === '/v1/channels/general/messages') {
        return makeJsonResponse({
          ok: true,
          data: [{
            id: 'ch_msg_1',
            agent_name: 'Lead',
            text: 'Channel update',
            created_at: '2026-02-23T10:00:00.000Z',
          }],
        });
      }

      if (pathname === '/v1/dm/conversations/all' || pathname === '/v1/dm/conversations') {
        return makeJsonResponse({
          ok: true,
          data: [{
            id: 'dm_1',
            participants: ['broker-951762d5', 'Lead'],
            last_message: {
              text: 'Done',
              agent_name: 'Lead',
              created_at: '2026-02-23T10:01:00.000Z',
            },
            message_count: 1,
          }],
        });
      }

      if (pathname === '/v1/dm/conversations/dm_1/messages') {
        return makeJsonResponse({
          ok: true,
          data: [{
            id: 'dm_msg_1',
            agent_name: 'Lead',
            text: 'Done',
            created_at: '2026-02-23T10:01:00.000Z',
          }],
        });
      }

      throw new Error(`Unexpected fetch path: ${pathname}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { fetchAllMessages } = await import('./relaycast-provider.js');
    const messages = await fetchAllMessages(CONFIG);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: 'ch_msg_1',
      from: 'Lead',
      to: '#general',
    });
    expect(messages[1]).toMatchObject({
      id: 'dm_msg_1',
      from: 'Lead',
      to: 'Dashboard',
      content: 'Done',
    });
  });

  it('fetches DM history for each refresh when using SDK readers', async () => {
    let dmHistoryFetches = 0;

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getRequestUrl(input);
      const pathname = url.pathname;

      if (pathname === '/v1/agents') {
        return makeJsonResponse({
          ok: true,
          data: [],
        });
      }

      if (pathname === '/v1/channels') {
        return makeJsonResponse({
          ok: true,
          data: [],
        });
      }

      if (pathname === '/v1/dm/conversations/all' || pathname === '/v1/dm/conversations') {
        return makeJsonResponse({
          ok: true,
          data: [{
            id: 'dm_1',
            participants: ['Dashboard', 'Lead'],
            last_message: {
              text: 'Ping',
              agent_name: 'Lead',
              created_at: '2026-02-23T10:01:00.000Z',
            },
            message_count: 1,
          }],
        });
      }

      if (pathname === '/v1/dm/conversations/dm_1/messages') {
        dmHistoryFetches += 1;
        return makeJsonResponse({
          ok: true,
          data: [{
            id: 'dm_msg_1',
            agent_name: 'Lead',
            text: 'Ping',
            created_at: '2026-02-23T10:01:00.000Z',
          }],
        });
      }

      throw new Error(`Unexpected fetch path: ${pathname}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { fetchAllMessages } = await import('./relaycast-provider.js');
    await fetchAllMessages(CONFIG);
    await fetchAllMessages(CONFIG);

    expect(dmHistoryFetches).toBe(2);
  });

  it('returns no DM messages when DM history endpoint fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getRequestUrl(input);
      const pathname = url.pathname;

      if (pathname === '/v1/agents') {
        return makeJsonResponse({
          ok: true,
          data: [],
        });
      }

      if (pathname === '/v1/channels') {
        return makeJsonResponse({
          ok: true,
          data: [],
        });
      }

      if (pathname === '/v1/dm/conversations/all' || pathname === '/v1/dm/conversations') {
        return makeJsonResponse({
          ok: true,
          data: [{
            id: 'dm_1',
            participants: ['Dashboard', 'Lead'],
            last_message: {
              text: 'Fallback DM',
              agent_name: 'Lead',
              created_at: '2026-02-23T10:05:00.000Z',
            },
            message_count: 1,
          }],
        });
      }

      if (pathname === '/v1/dm/conversations/dm_1/messages') {
        return makeJsonResponse({
          ok: false,
          error: { message: 'history unavailable' },
        }, 500);
      }

      throw new Error(`Unexpected fetch path: ${pathname}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { fetchAllMessages } = await import('./relaycast-provider.js');
    const messages = await fetchAllMessages(CONFIG);

    expect(messages).toHaveLength(0);
  });
});

describe('relaycast-provider broker identity detection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function fetchDmTarget(participants: string[]): Promise<string> {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getRequestUrl(input);
      const pathname = url.pathname;

      if (pathname === '/v1/agents') {
        return makeJsonResponse({
          ok: true,
          data: [],
        });
      }

      if (pathname === '/v1/channels') {
        return makeJsonResponse({ ok: true, data: [] });
      }

      if (pathname === '/v1/dm/conversations/all' || pathname === '/v1/dm/conversations') {
        return makeJsonResponse({
          ok: true,
          data: [{
            id: 'dm_1',
            participants,
            last_message: {
              text: 'Done',
              agent_name: 'Lead',
              created_at: '2026-02-23T10:01:00.000Z',
            },
            message_count: 1,
          }],
        });
      }

      if (pathname === '/v1/dm/conversations/dm_1/messages') {
        return makeJsonResponse({
          ok: true,
          data: [{
            id: 'dm_msg_1',
            agent_name: 'Lead',
            text: 'Done',
            created_at: '2026-02-23T10:01:00.000Z',
          }],
        });
      }

      throw new Error(`Unexpected fetch path: ${pathname}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { fetchAllMessages } = await import('./relaycast-provider.js');
    const messages = await fetchAllMessages(CONFIG);
    expect(messages).toHaveLength(1);
    return messages[0]?.to ?? '';
  }

  it('broker matches', async () => {
    await expect(fetchDmTarget(['broker', 'Lead'])).resolves.toBe('Dashboard');
  });

  it('broker-abc123 matches', async () => {
    await expect(fetchDmTarget(['broker-abc123', 'Lead'])).resolves.toBe('Dashboard');
  });

  it('alice rejects', async () => {
    await expect(fetchDmTarget(['alice', 'Lead'])).resolves.toBe('alice');
  });
});

describe('relaycast-provider writer registration type', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock('@agent-relay/sdk');
  });

  it('registers Dashboard sender as human', async () => {
    const dm = vi.fn(async () => undefined);
    const send = vi.fn(async () => undefined);
    const createRelaycastClient = vi.fn(async () => ({
      dm,
      send,
    }));

    vi.doMock('@agent-relay/sdk', () => ({
      createRelaycastClient,
    }));

    const { sendMessage } = await import('./relaycast-provider.js');

    await sendMessage(CONFIG, {
      to: 'Lead',
      message: 'hello',
      from: 'Dashboard',
      dataDir: '/tmp/dashboard-test',
    });

    expect(createRelaycastClient).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'Dashboard',
      agentType: 'human',
    }));
    expect(dm).toHaveBeenCalledWith('Lead', 'hello');
  });

  it('registers non-Dashboard sender as agent', async () => {
    const dm = vi.fn(async () => undefined);
    const send = vi.fn(async () => undefined);
    const createRelaycastClient = vi.fn(async () => ({
      dm,
      send,
    }));

    vi.doMock('@agent-relay/sdk', () => ({
      createRelaycastClient,
    }));

    const { sendMessage } = await import('./relaycast-provider.js');

    await sendMessage(CONFIG, {
      to: 'Lead',
      message: 'hello',
      from: 'Lead',
      dataDir: '/tmp/dashboard-test',
    });

    expect(createRelaycastClient).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'Lead',
      agentType: 'agent',
    }));
    expect(dm).toHaveBeenCalledWith('Lead', 'hello');
  });
});
