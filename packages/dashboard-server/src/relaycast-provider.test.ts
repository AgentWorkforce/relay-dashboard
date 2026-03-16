import fs from 'fs';
import os from 'os';
import path from 'path';
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

/**
 * Helper to create a mock @relaycast/sdk module with both:
 * - RelayCast class (workspace-level DM operations)
 * - createRelaycastClient (agent-level channel operations)
 */
function makeSdkMocks(options: {
  channels?: unknown[];
  channelMessages?: Record<string, unknown[]>;
  dmConversations?: unknown[];
  dmMessages?: Record<string, unknown[]> | (() => Promise<unknown[]>);
}) {
  const allDmConversations = vi.fn(async () => options.dmConversations ?? []);
  const dmMessagesFn = vi.fn(async (conversationId: string) => {
    if (typeof options.dmMessages === 'function') return options.dmMessages();
    return (options.dmMessages as Record<string, unknown[]>)?.[conversationId] ?? [];
  });

  const RelayCast = vi.fn(() => ({
    allDmConversations,
    dmMessages: dmMessagesFn,
  }));

  const createRelaycastClient = vi.fn(async () => ({
    client: {
      get: vi.fn(async (urlPath: string) => {
        for (const [channelName, msgs] of Object.entries(options.channelMessages ?? {})) {
          if (urlPath.includes(`/v1/channels/${channelName}/messages`)) return msgs;
        }
        return [];
      }),
    },
    channels: {
      list: vi.fn(async () => options.channels ?? []),
    },
    dms: {
      conversations: vi.fn(async () => []),
      messages: vi.fn(async () => []),
    },
    send: vi.fn(),
  }));

  return { RelayCast, createRelaycastClient, allDmConversations, dmMessages: dmMessagesFn };
}

describe('relaycast-provider fetchAllMessages', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock('@agent-relay/sdk');
    vi.doUnmock('@relaycast/sdk');
  });

  it('includes DM conversation messages and maps broker identity to Dashboard', async () => {
    const mocks = makeSdkMocks({
      channels: [{
        id: 'ch_1',
        name: 'general',
        topic: null,
        memberCount: 1,
        createdAt: '2026-02-23T10:00:00.000Z',
        isArchived: false,
      }],
      channelMessages: {
        general: [{
          id: 'ch_msg_1',
          agentName: 'Lead',
          text: 'Channel update',
          createdAt: '2026-02-23T10:00:00.000Z',
        }],
      },
      dmConversations: [{
        id: 'dm_1',
        participants: ['broker-951762d5', 'Lead'],
        last_message: { text: 'Done', agent_name: 'Lead', created_at: '2026-02-23T10:01:00.000Z' },
        message_count: 1,
      }],
      dmMessages: {
        dm_1: [{
          id: 'dm_msg_1',
          agentName: 'Lead',
          text: 'Done',
          createdAt: '2026-02-23T10:01:00.000Z',
        }],
      },
    });

    vi.doMock('@agent-relay/sdk', () => ({
      createRelaycastClient: mocks.createRelaycastClient,
    }));
    vi.doMock('@relaycast/sdk', () => ({
      RelayCast: mocks.RelayCast,
    }));

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

    const mocks = makeSdkMocks({
      dmConversations: [{
        id: 'dm_1',
        participants: ['Dashboard', 'Lead'],
        last_message: { text: 'Ping', agent_name: 'Lead', created_at: '2026-02-23T10:01:00.000Z' },
        message_count: 1,
      }],
      dmMessages: async () => {
        dmHistoryFetches += 1;
        return [{
          id: 'dm_msg_1',
          agentName: 'Lead',
          text: 'Ping',
          createdAt: '2026-02-23T10:01:00.000Z',
        }];
      },
    });

    vi.doMock('@agent-relay/sdk', () => ({
      createRelaycastClient: mocks.createRelaycastClient,
    }));
    vi.doMock('@relaycast/sdk', () => ({
      RelayCast: mocks.RelayCast,
    }));

    const { fetchAllMessages } = await import('./relaycast-provider.js');
    await fetchAllMessages(CONFIG);
    await fetchAllMessages(CONFIG);

    expect(dmHistoryFetches).toBe(2);
  });

  it('returns no DM messages when DM history endpoint fails', async () => {
    const mocks = makeSdkMocks({
      dmConversations: [{
        id: 'dm_1',
        participants: ['Dashboard', 'Lead'],
        last_message: { text: 'Fallback DM', agent_name: 'Lead', created_at: '2026-02-23T10:05:00.000Z' },
        message_count: 1,
      }],
      dmMessages: async () => {
        throw new Error('history unavailable');
      },
    });

    vi.doMock('@agent-relay/sdk', () => ({
      createRelaycastClient: mocks.createRelaycastClient,
    }));
    vi.doMock('@relaycast/sdk', () => ({
      RelayCast: mocks.RelayCast,
    }));

    const { fetchAllMessages } = await import('./relaycast-provider.js');
    const messages = await fetchAllMessages(CONFIG);

    expect(messages).toHaveLength(0);
  });
});

describe('relaycast-provider loadRelaycastConfig', () => {
  const originalRelayApiKey = process.env.RELAY_API_KEY;

  afterEach(() => {
    if (originalRelayApiKey === undefined) {
      delete process.env.RELAY_API_KEY;
    } else {
      process.env.RELAY_API_KEY = originalRelayApiKey;
    }
    vi.resetModules();
  });

  it('reads project identity fields from RELAY_API_KEY without any file-backed credentials', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-config-'));
    process.env.RELAY_API_KEY = 'rk_test';

    const { loadRelaycastConfig } = await import('./relaycast-provider.js');
    const { resolveIdentity } = await import('./lib/identity.js');
    const loaded = loadRelaycastConfig(dataDir);

    expect(loaded).toMatchObject({
      apiKey: 'rk_test',
      projectIdentity: os.userInfo().username,
    });
    expect(loaded?.agentName).toBeUndefined();
    expect(loaded?.agentToken).toBeUndefined();
    const identityConfig = { projectIdentity: loaded?.projectIdentity ?? '' };
    expect(resolveIdentity(identityConfig.projectIdentity, identityConfig)).toBe(identityConfig.projectIdentity);
    expect(resolveIdentity('worker-1', identityConfig)).toBe('worker-1');

    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

describe('relaycast-provider broker identity detection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock('@agent-relay/sdk');
    vi.doUnmock('@relaycast/sdk');
  });

  async function fetchDmTarget(participants: string[]): Promise<string> {
    const mocks = makeSdkMocks({
      dmConversations: [{
        id: 'dm_1',
        participants,
        last_message: { text: 'Done', agent_name: 'Lead', created_at: '2026-02-23T10:01:00.000Z' },
        message_count: 1,
      }],
      dmMessages: {
        dm_1: [{
          id: 'dm_msg_1',
          agentName: 'Lead',
          text: 'Done',
          createdAt: '2026-02-23T10:01:00.000Z',
        }],
      },
    });

    vi.doMock('@agent-relay/sdk', () => ({
      createRelaycastClient: mocks.createRelaycastClient,
    }));
    vi.doMock('@relaycast/sdk', () => ({
      RelayCast: mocks.RelayCast,
    }));

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
    vi.doUnmock('@relaycast/sdk');
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

  it('reuses project token when sender matches configured project identity', async () => {
    const dm = vi.fn(async () => undefined);
    const send = vi.fn(async () => undefined);
    const createRelaycastClient = vi.fn(async () => ({
      dm,
      send,
    }));
    const tokenDm = vi.fn(async () => undefined);
    const tokenSend = vi.fn(async () => undefined);
    const relayAs = vi.fn(() => ({
      dm: tokenDm,
      send: tokenSend,
    }));
    const relayCastCtor = vi.fn(() => ({ as: relayAs }));

    vi.doMock('@agent-relay/sdk', () => ({
      createRelaycastClient,
    }));
    vi.doMock('@relaycast/sdk', () => ({
      RelayCast: relayCastCtor,
    }));

    const { sendMessage } = await import('./relaycast-provider.js');

    await sendMessage({
      apiKey: 'rk_test',
      baseUrl: 'https://api.relaycast.dev',
      agentName: 'my-project',
      agentToken: 'agt_test',
    }, {
      to: 'Lead',
      message: 'hello',
      from: 'my-project',
      dataDir: '/tmp/dashboard-test',
    });

    expect(relayCastCtor).toHaveBeenCalledWith({
      apiKey: 'rk_test',
      baseUrl: 'https://api.relaycast.dev',
    });
    expect(relayAs).toHaveBeenCalledWith('agt_test');
    expect(createRelaycastClient).not.toHaveBeenCalled();
    expect(tokenDm).toHaveBeenCalledWith('Lead', 'hello');
  });

  it('keeps Dashboard sender on human client even when project token is present', async () => {
    const dm = vi.fn(async () => undefined);
    const send = vi.fn(async () => undefined);
    const createRelaycastClient = vi.fn(async () => ({
      dm,
      send,
    }));
    const relayAs = vi.fn(() => ({
      dm: vi.fn(async () => undefined),
      send: vi.fn(async () => undefined),
    }));
    const relayCastCtor = vi.fn(() => ({ as: relayAs }));

    vi.doMock('@agent-relay/sdk', () => ({
      createRelaycastClient,
    }));
    vi.doMock('@relaycast/sdk', () => ({
      RelayCast: relayCastCtor,
    }));

    const { sendMessage } = await import('./relaycast-provider.js');

    await sendMessage({
      apiKey: 'rk_test',
      baseUrl: 'https://api.relaycast.dev',
      agentName: 'my-project',
      agentToken: 'agt_test',
    }, {
      to: 'Lead',
      message: 'hello',
      from: 'Dashboard',
      dataDir: '/tmp/dashboard-test',
    });

    expect(createRelaycastClient).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'Dashboard',
      agentType: 'human',
    }));
    expect(relayCastCtor).not.toHaveBeenCalled();
    expect(relayAs).not.toHaveBeenCalled();
    expect(dm).toHaveBeenCalledWith('Lead', 'hello');
  });

  it('returns SDK-provided event_id as messageId when available', async () => {
    const dm = vi.fn(async () => ({ event_id: 'evt_sdk_dm_1' }));
    const send = vi.fn(async () => ({ event_id: 'evt_sdk_channel_1' }));
    const createRelaycastClient = vi.fn(async () => ({
      dm,
      send,
    }));

    vi.doMock('@agent-relay/sdk', () => ({
      createRelaycastClient,
    }));

    const { sendMessage } = await import('./relaycast-provider.js');

    const result = await sendMessage(CONFIG, {
      to: 'Lead',
      message: 'hello',
      from: 'Dashboard',
      dataDir: '/tmp/dashboard-test',
    });

    expect(result.messageId).toBe('evt_sdk_dm_1');
    expect(dm).toHaveBeenCalledWith('Lead', 'hello');
  });

  it('falls back to synthetic messageId when SDK response has no id fields', async () => {
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

    const result = await sendMessage(CONFIG, {
      to: 'Lead',
      message: 'hello',
      from: 'Dashboard',
      dataDir: '/tmp/dashboard-test',
    });

    expect(result.messageId).toMatch(/^relaycast-\d+$/);
  });
});
