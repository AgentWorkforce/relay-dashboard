import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BrokerSendStrategy,
  DirectSendStrategy,
  createSendStrategy,
} from './send-strategy.js';
import type { SendRequest, SendOutcome } from './send-strategy.js';
import type { RelaycastConfig } from '../relaycast-provider-types.js';

// ---------------------------------------------------------------------------
// Mock relaycast-provider sendMessage
// ---------------------------------------------------------------------------

const mockSendMessage = vi.fn();
vi.mock('../relaycast-provider.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dummyConfig: RelaycastConfig = {
  apiKey: 'rk_live_test',
  baseUrl: 'https://api.relaycast.dev',
  agentName: 'test-agent',
};

const baseRequest: SendRequest = {
  to: '#general',
  message: 'hello world',
  from: 'Dashboard',
};

function mockFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// BrokerSendStrategy
// ---------------------------------------------------------------------------

describe('BrokerSendStrategy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends via broker and extracts event_id', async () => {
    const fetchSpy = mockFetch(200, JSON.stringify({ event_id: 'evt_123' }));
    vi.stubGlobal('fetch', fetchSpy);

    const strategy = new BrokerSendStrategy('http://broker:4000');
    const result = await strategy.send(baseRequest);

    expect(result).toEqual({ success: true, messageId: 'evt_123' });
    expect(fetchSpy).toHaveBeenCalledWith('http://broker:4000/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: baseRequest.to,
        message: baseRequest.message,
        from: baseRequest.from,
      }),
    });
  });

  it('returns error when broker responds with non-ok status', async () => {
    vi.stubGlobal('fetch', mockFetch(400, JSON.stringify({ error: 'bad request' })));

    const strategy = new BrokerSendStrategy('http://broker:4000');
    const result = await strategy.send(baseRequest);

    expect(result).toEqual({
      success: false,
      status: 400,
      error: 'bad request',
    });
  });

  it('returns error when broker responds with non-JSON body on failure', async () => {
    vi.stubGlobal('fetch', mockFetch(500, 'Internal Server Error'));

    const strategy = new BrokerSendStrategy('http://broker:4000');
    const result = await strategy.send(baseRequest);

    expect(result).toEqual({
      success: false,
      status: 500,
      error: 'Internal Server Error',
    });
  });

  it('returns 502 when broker does not return event_id', async () => {
    vi.stubGlobal('fetch', mockFetch(200, JSON.stringify({ ok: true })));

    const strategy = new BrokerSendStrategy('http://broker:4000');
    const result = await strategy.send(baseRequest);

    expect(result).toEqual({
      success: false,
      status: 502,
      error: 'Broker send succeeded but did not return event_id',
    });
  });

  it('returns 502 on fetch network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const strategy = new BrokerSendStrategy('http://broker:4000');
    const result = await strategy.send(baseRequest);

    expect(result).toEqual({
      success: false,
      status: 502,
      error: 'ECONNREFUSED',
    });
  });

  it('returns fallback error message when broker returns empty body on failure', async () => {
    vi.stubGlobal('fetch', mockFetch(503, ''));

    const strategy = new BrokerSendStrategy('http://broker:4000');
    const result = await strategy.send(baseRequest);

    expect(result).toEqual({
      success: false,
      status: 503,
      error: 'Broker send failed with status 503',
    });
  });
});

// ---------------------------------------------------------------------------
// DirectSendStrategy
// ---------------------------------------------------------------------------

describe('DirectSendStrategy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSendMessage.mockReset();
  });

  it('sends via relaycast-provider sendMessage', async () => {
    mockSendMessage.mockResolvedValue({ messageId: 'rc_msg_456' });

    const strategy = new DirectSendStrategy(dummyConfig, '/data');
    const result = await strategy.send(baseRequest);

    expect(result).toEqual({ success: true, messageId: 'rc_msg_456' });
    expect(mockSendMessage).toHaveBeenCalledWith(dummyConfig, {
      to: baseRequest.to,
      message: baseRequest.message,
      from: baseRequest.from,
      dataDir: '/data',
    });
  });

  it('returns 502 on sendMessage error', async () => {
    mockSendMessage.mockRejectedValue(new Error('agent "bob" not found'));

    const strategy = new DirectSendStrategy(dummyConfig, '/data');
    const result = await strategy.send(baseRequest);

    expect(result).toEqual({
      success: false,
      status: 502,
      error: 'agent "bob" not found',
    });
  });

  it('returns fallback error message when error has no message', async () => {
    mockSendMessage.mockRejectedValue(new Error(''));

    const strategy = new DirectSendStrategy(dummyConfig, '/data');
    const result = await strategy.send(baseRequest);

    expect(result).toEqual({
      success: false,
      status: 502,
      error: 'Failed to send message',
    });
  });
});

// ---------------------------------------------------------------------------
// createSendStrategy factory
// ---------------------------------------------------------------------------

describe('createSendStrategy', () => {
  it('returns BrokerSendStrategy when broker proxy is enabled', () => {
    const strategy = createSendStrategy({
      brokerProxyEnabled: true,
      brokerUrl: 'http://broker:4000',
      relaycastConfig: dummyConfig,
      dataDir: '/data',
    });

    expect(strategy).toBeInstanceOf(BrokerSendStrategy);
  });

  it('returns DirectSendStrategy when broker is disabled but config exists', () => {
    const strategy = createSendStrategy({
      brokerProxyEnabled: false,
      relaycastConfig: dummyConfig,
      dataDir: '/data',
    });

    expect(strategy).toBeInstanceOf(DirectSendStrategy);
  });

  it('returns null when broker is disabled and no config', () => {
    const strategy = createSendStrategy({
      brokerProxyEnabled: false,
      relaycastConfig: null,
      dataDir: '/data',
    });

    expect(strategy).toBeNull();
  });

  it('returns null when broker is enabled but no broker URL', () => {
    const strategy = createSendStrategy({
      brokerProxyEnabled: true,
      brokerUrl: undefined,
      relaycastConfig: null,
      dataDir: '/data',
    });

    expect(strategy).toBeNull();
  });

  it('prefers broker strategy over direct when both are available', () => {
    const strategy = createSendStrategy({
      brokerProxyEnabled: true,
      brokerUrl: 'http://broker:4000',
      relaycastConfig: dummyConfig,
      dataDir: '/data',
    });

    expect(strategy).toBeInstanceOf(BrokerSendStrategy);
  });
});
