/**
 * @vitest-environment jsdom
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'http';
import React, { useEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannels, useReply, useSendMessage, useWebSocket } from '@relaycast/react';
import { createServer, type DashboardServer } from '../../../dashboard-server/src/proxy-server.js';
import { RelayConfigProvider, useRelayConfigStatus } from './RelayConfigProvider';

interface HarnessApi {
  channelNames: string[];
  channelsLoading: boolean;
  connectionStatus: string;
  send: (channel: string, text: string) => Promise<{ id: string }>;
  reply: (messageId: string, text: string) => Promise<{ id: string }>;
}

interface FakeMessage {
  id: string;
  channel_id: string;
  agent_id: string;
  agent_name: string;
  text: string;
  blocks: null;
  has_attachments: boolean;
  thread_id: string | null;
  attachments: [];
  created_at: string;
  reply_count: number;
  reactions: [];
  read_by_count: number;
}

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readonly sentFrames: string[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);

    queueMicrotask(() => {
      if (this.readyState !== MockWebSocket.CONNECTING) return;
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sentFrames.push(data);
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

class FakeRelaycastBackend {
  readonly workspaceApiKey = 'rk_workspace';
  readonly channelListAuthTokens: string[] = [];
  readonly sendAuthTokens: string[] = [];
  readonly replyAuthTokens: string[] = [];

  private server: HttpServer;
  private agent:
    | {
      id: string;
      name: string;
      type: 'human';
      status: 'online';
      createdAt: string;
      lastSeen: string;
      token: string;
    }
    | null = null;
  private invalidTokens = new Set<string>();
  private tokenCounter = 0;
  private messageCounter = 0;

  constructor() {
    this.server = createHttpServer((req, res) => {
      void this.handle(req, res);
    });
  }

  get baseUrl(): string {
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Fake Relaycast server address not available');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  get currentAgentToken(): string | null {
    return this.agent?.token ?? null;
  }

  async start(): Promise<void> {
    await listen(this.server);
  }

  async stop(): Promise<void> {
    await closeHttpServer(this.server);
  }

  invalidateCurrentAgentToken(): void {
    if (!this.agent) {
      throw new Error('Cannot invalidate agent token before registration');
    }
    this.invalidTokens.add(this.agent.token);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const method = req.method ?? 'GET';
    const authToken = readBearerToken(req.headers.authorization);

    if (method === 'POST' && url.pathname === '/v1/agents') {
      if (!this.isWorkspaceAuthorized(authToken)) {
        sendJson(res, 401, { ok: false, error: { code: 'unauthorized', message: 'workspace key required' } });
        return;
      }

      const body = await readJson(req);
      const requestedName = typeof body?.name === 'string' ? body.name : '';
      if (!requestedName) {
        sendJson(res, 400, { ok: false, error: { code: 'invalid_request', message: 'name is required' } });
        return;
      }

      if (this.agent) {
        sendJson(res, 409, { ok: false, error: { code: 'agent_already_exists', message: 'agent already exists' } });
        return;
      }

      const createdAt = new Date().toISOString();
      this.agent = {
        id: 'agent-1',
        name: requestedName,
        type: 'human',
        status: 'online',
        createdAt,
        lastSeen: createdAt,
        token: this.issueToken(),
      };

      sendJson(res, 200, {
        ok: true,
        data: {
          id: this.agent.id,
          name: this.agent.name,
          token: this.agent.token,
          status: this.agent.status,
          created_at: this.agent.createdAt,
        },
      });
      return;
    }

    if (method === 'GET' && url.pathname.startsWith('/v1/agents/')) {
      if (!this.isWorkspaceAuthorized(authToken)) {
        sendJson(res, 401, { ok: false, error: { code: 'unauthorized', message: 'workspace key required' } });
        return;
      }

      const name = decodeURIComponent(url.pathname.slice('/v1/agents/'.length));
      if (!this.agent || this.agent.name !== name) {
        sendJson(res, 404, { ok: false, error: { code: 'agent_not_found', message: 'agent not found' } });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        data: {
          id: this.agent.id,
          name: this.agent.name,
          type: this.agent.type,
          status: this.agent.status,
          persona: null,
          metadata: {},
          last_seen: this.agent.lastSeen,
          created_at: this.agent.createdAt,
          channels: [],
        },
      });
      return;
    }

    if (method === 'POST' && url.pathname.endsWith('/rotate-token')) {
      if (!this.isWorkspaceAuthorized(authToken)) {
        sendJson(res, 401, { ok: false, error: { code: 'unauthorized', message: 'workspace key required' } });
        return;
      }

      if (!this.agent) {
        sendJson(res, 404, { ok: false, error: { code: 'agent_not_found', message: 'agent not found' } });
        return;
      }

      this.invalidTokens.add(this.agent.token);
      this.agent.token = this.issueToken();
      this.agent.lastSeen = new Date().toISOString();

      sendJson(res, 200, {
        ok: true,
        data: {
          token: this.agent.token,
        },
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/v1/channels') {
      this.channelListAuthTokens.push(authToken ?? '');
      if (!this.isCurrentAgentToken(authToken)) {
        sendJson(res, 401, { ok: false, error: { code: 'unauthorized', message: 'stale token' } });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        data: [
          {
            id: 'channel-1',
            name: 'general',
            topic: null,
            created_at: this.agent?.createdAt ?? new Date().toISOString(),
            created_by: this.agent?.id ?? null,
            is_archived: false,
            member_count: 1,
            members: [],
          },
        ],
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/v1/channels/general/join') {
      if (!this.isCurrentAgentToken(authToken)) {
        sendJson(res, 401, { ok: false, error: { code: 'unauthorized', message: 'stale token' } });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        data: {
          channel: 'general',
          agent_id: this.agent?.id ?? 'agent-1',
          already_member: true,
        },
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/v1/channels/general/messages') {
      this.sendAuthTokens.push(authToken ?? '');
      if (!this.isCurrentAgentToken(authToken)) {
        sendJson(res, 401, { ok: false, error: { code: 'unauthorized', message: 'stale token' } });
        return;
      }

      const body = await readJson(req);
      sendJson(res, 200, {
        ok: true,
        data: this.createMessage(String(body?.text ?? ''), null),
      });
      return;
    }

    const replyMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)\/replies$/);
    if (method === 'POST' && replyMatch) {
      this.replyAuthTokens.push(authToken ?? '');
      if (!this.isCurrentAgentToken(authToken)) {
        sendJson(res, 401, { ok: false, error: { code: 'unauthorized', message: 'stale token' } });
        return;
      }

      const body = await readJson(req);
      const parentId = decodeURIComponent(replyMatch[1] ?? '');
      sendJson(res, 200, {
        ok: true,
        data: this.createMessage(String(body?.text ?? ''), parentId),
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: { code: 'not_found', message: `${method} ${url.pathname} not mocked` } });
  }

  private createMessage(text: string, threadId: string | null): FakeMessage {
    this.messageCounter += 1;
    const createdAt = new Date().toISOString();
    return {
      id: `msg-${this.messageCounter}`,
      channel_id: 'channel-1',
      agent_id: this.agent?.id ?? 'agent-1',
      agent_name: this.agent?.name ?? 'dashboard',
      text,
      blocks: null,
      has_attachments: false,
      thread_id: threadId,
      attachments: [],
      created_at: createdAt,
      reply_count: 0,
      reactions: [],
      read_by_count: 0,
    };
  }

  private issueToken(): string {
    this.tokenCounter += 1;
    return `agt_${this.tokenCounter}`;
  }

  private isWorkspaceAuthorized(token: string | null): boolean {
    return token === this.workspaceApiKey;
  }

  private isCurrentAgentToken(token: string | null): boolean {
    return Boolean(token && this.agent && token === this.agent.token && !this.invalidTokens.has(token));
  }
}

function readBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith('Bearer ')) return null;
  return value.slice(7);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function listen(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function extractWebSocketToken(url: string): string | null {
  return new URL(url).searchParams.get('token');
}

function RelayHarness({ apiRef }: { apiRef: { current: HarnessApi | null } }) {
  const relayConfig = useRelayConfigStatus();

  if (!relayConfig.configured || relayConfig.loading) {
    return null;
  }

  return <RelayHarnessBody apiRef={apiRef} />;
}

function RelayHarnessBody({ apiRef }: { apiRef: { current: HarnessApi | null } }) {
  const { channels, loading } = useChannels();
  const { send } = useSendMessage();
  const { reply } = useReply();
  const { status } = useWebSocket();

  useEffect(() => {
    apiRef.current = {
      channelNames: (channels ?? []).map((channel) => channel.name),
      channelsLoading: loading,
      connectionStatus: status,
      send: async (channel: string, text: string) => {
        return send(channel, text) as Promise<{ id: string }>;
      },
      reply: async (messageId: string, text: string) => {
        return reply(messageId, text) as Promise<{ id: string }>;
      },
    };
  }, [apiRef, channels, loading, reply, send, status]);

  return null;
}

describe('RelayConfigProvider integration', () => {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const originalRelaycastApiUrl = process.env.RELAYCAST_API_URL;
  let backend: FakeRelaycastBackend;
  let dashboard: DashboardServer;
  let dataDir: string;
  let staticDir: string;

  beforeEach(async () => {
    cleanup();
    MockWebSocket.instances.length = 0;
    backend = new FakeRelaycastBackend();
    await backend.start();

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-config-integration-data-'));
    staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-config-integration-static-'));
    fs.writeFileSync(path.join(staticDir, 'app.html'), '<!doctype html><h1>dashboard</h1>', 'utf-8');

    process.env.RELAYCAST_API_URL = backend.baseUrl;

    dashboard = createServer({
      port: 0,
      mock: false,
      verbose: false,
      dataDir,
      staticDir,
      relayApiKey: backend.workspaceApiKey,
    });
    await listen(dashboard.server);

    const address = dashboard.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Dashboard server address not available');
    }

    const dashboardOrigin = `http://127.0.0.1:${address.port}`;
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.startsWith('/')) {
        return originalFetch(new URL(url, dashboardOrigin), init);
      }
      return originalFetch(input, init);
    }) as typeof globalThis.fetch);
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    process.env.RELAYCAST_API_URL = originalRelaycastApiUrl;
    await dashboard?.close();
    await backend?.stop();
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    if (staticDir) {
      fs.rmSync(staticDir, { recursive: true, force: true });
    }
  });

  it('reloads channels and keeps send/reply working after the dashboard agent token is invalidated', async () => {
    const apiRef: { current: HarnessApi | null } = { current: null };

    render(
      <RelayConfigProvider>
        <RelayHarness apiRef={apiRef} />
      </RelayConfigProvider>,
    );

    await waitFor(() => {
      expect(apiRef.current).not.toBeNull();
      expect(apiRef.current?.channelsLoading).toBe(false);
      expect(apiRef.current?.channelNames).toEqual(['general']);
      expect(apiRef.current?.connectionStatus).toBe('connected');
    });

    const initialToken = backend.currentAgentToken;
    expect(initialToken).toBe('agt_1');
    expect(backend.channelListAuthTokens).toContain('agt_1');

    backend.invalidateCurrentAgentToken();

    let sentMessage: { id: string } | undefined;
    await act(async () => {
      sentMessage = await apiRef.current!.send('general', 'hello after rotation');
    });

    await waitFor(() => {
      expect(backend.currentAgentToken).toBe('agt_2');
      expect(apiRef.current?.channelNames).toEqual(['general']);
      expect(apiRef.current?.channelsLoading).toBe(false);
      expect(apiRef.current?.connectionStatus).toBe('connected');
      expect(backend.channelListAuthTokens).toContain('agt_2');
    });

    expect(sentMessage?.id).toBe('msg-1');

    let replyMessage: { id: string } | undefined;
    await act(async () => {
      replyMessage = await apiRef.current!.reply(sentMessage!.id, 'reply after refresh');
    });

    expect(replyMessage?.id).toBe('msg-2');
    expect(backend.sendAuthTokens).toEqual(['agt_1', 'agt_2']);
    expect(backend.replyAuthTokens.at(-1)).toBe('agt_2');

    const configuredWebSocketTokens = MockWebSocket.instances
      .map((socket) => extractWebSocketToken(socket.url))
      .filter((token): token is string => Boolean(token && token !== '__relay_disabled__'));
    expect(configuredWebSocketTokens.length).toBeGreaterThanOrEqual(2);
    expect(new Set(configuredWebSocketTokens)).toEqual(new Set(['rk_workspace']));

    const subscribeFrames = MockWebSocket.instances
      .flatMap((socket) => socket.sentFrames)
      .map((payload) => JSON.parse(payload) as { type?: string; channels?: string[] })
      .filter((payload) => payload.type === 'subscribe');
    expect(subscribeFrames.length).toBeGreaterThanOrEqual(2);
    expect(subscribeFrames.every((payload) => payload.channels?.join(',') === 'general')).toBe(true);
  });
});
