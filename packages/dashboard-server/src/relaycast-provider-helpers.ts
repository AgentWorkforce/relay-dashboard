import path from 'path';
import { RelayCast, type AgentClient } from '@relaycast/sdk';
// Import SDK's createRelaycastClient if available (for backwards compatibility and testing)
// Falls back to local implementation when not exported by SDK
import * as agentRelaySdk from '@agent-relay/sdk';
import type {
  AgentStatus,
  Message,
  RelaycastAgentRecord,
  RelaycastConfig,
  RelaycastMessage,
  RelaycastRegistrationType,
} from './relaycast-provider-types.js';
import {
  DASHBOARD_DISPLAY_NAME,
  DASHBOARD_READER_NAME,
  DEFAULT_MESSAGE_LIMIT,
  MAX_MESSAGE_LIMIT,
} from './relaycast-provider-types.js';
import {
  resolveIdentity,
  dashboardDisplayName as resolveDashboardDisplayName,
  normalizeName,
  type IdentityConfig,
} from './lib/identity.js';

export interface RelaycastClientLike {
  client: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<T>(path: string, query?: Record<string, string>): Promise<any>;
  };
  channels: {
    list(opts?: { include_archived?: boolean; includeArchived?: boolean }): Promise<unknown>;
    create(data: { name: string; topic?: string }): Promise<unknown>;
    join(name: string): Promise<unknown>;
    leave(name: string): Promise<unknown>;
    invite(channel: string, agent: string): Promise<unknown>;
  };
  send(channel: string, text: string): Promise<unknown>;
  reply(messageId: string, text: string): Promise<unknown>;
  dm(agent: string, text: string): Promise<unknown>;
  dms: {
    conversations(): Promise<unknown>;
  };
}

const readerClientCache = new Map<string, Promise<RelaycastClientLike>>();
const writerClientCache = new Map<string, Promise<RelaycastClientLike>>();
/**
 * Shared registration cache keyed by baseUrl|apiKey|agentName.
 * Used by both createRelaycastClient and getDashboardAgentToken to avoid
 * double registerOrRotate calls that could rotate/invalidate tokens.
 */
const registrationCache = new Map<string, Promise<{ token: string; name: string }>>();

function registrationCacheKey(baseUrl: string | undefined, apiKey: string, agentName: string): string {
  return `${baseUrl ?? ''}|${apiKey}|${agentName.toLowerCase()}`;
}

/**
 * Register (or retrieve cached) agent token via registerOrRotate.
 * Shared by createRelaycastClient and getDashboardAgentToken to ensure
 * a single registration per agent identity.
 */
async function registerAgentToken(options: {
  apiKey: string;
  baseUrl?: string;
  agentName: string;
  agentType: RelaycastRegistrationType;
}): Promise<{ token: string; name: string }> {
  const key = registrationCacheKey(options.baseUrl, options.apiKey, options.agentName);
  const existing = registrationCache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const relay = new RelayCast({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });
    const response = await relay.registerOrRotate({
      name: options.agentName,
      type: options.agentType,
    });
    return { token: response.token, name: response.name ?? options.agentName };
  })();

  registrationCache.set(key, promise);
  promise.catch(() => registrationCache.delete(key));
  return promise;
}

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function normalizeChannelName(channel: string): string {
  const trimmed = channel.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

export function normalizeTarget(to: string): string {
  const trimmed = to.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('#') || trimmed.startsWith('dm:')) return trimmed;
  return trimmed;
}

export function getMessageLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_MESSAGE_LIMIT);
}

function resolveDmRecipient(participants: string[], sender: string, identityConfig: IdentityConfig): string {
  const senderKey = sender.toLowerCase();

  for (const participant of participants) {
    const normalized = resolveIdentity(participant, identityConfig);
    if (!normalized) continue;
    if (normalized.toLowerCase() !== senderKey) {
      return normalized;
    }
  }

  const fallback = resolveIdentity(participants[0] ?? '', identityConfig);
  return fallback || resolveDashboardDisplayName(identityConfig);
}

function getCachePath(dataDir?: string): string | undefined {
  if (!dataDir) return undefined;
  return path.join(dataDir, 'relaycast.json');
}

function getClientCacheKey(
  config: RelaycastConfig,
  agentName: string,
  registrationType: RelaycastRegistrationType,
  dataDir?: string,
): string {
  const cachePath = getCachePath(dataDir) ?? '';
  return `${config.baseUrl}|${config.apiKey}|${config.agentToken ?? ''}|${agentName}|${registrationType}|${cachePath}`;
}

/**
 * Create a Relaycast client by registering an agent and returning an AgentClient.
 * Uses SDK's createRelaycastClient if available, otherwise falls back to local implementation.
 */
async function createRelaycastClient(options: {
  apiKey: string;
  baseUrl?: string;
  cachePath?: string;
  agentName: string;
  agentType: RelaycastRegistrationType;
}): Promise<RelaycastClientLike> {
  // Use SDK's createRelaycastClient if available (allows test mocking)
  const sdkCreateClient = (agentRelaySdk as Record<string, unknown>).createRelaycastClient;
  if (typeof sdkCreateClient === 'function') {
    return sdkCreateClient(options) as Promise<RelaycastClientLike>;
  }

  // Fallback: local implementation using shared registration cache
  const { token } = await registerAgentToken({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    agentName: options.agentName,
    agentType: options.agentType,
  });

  const relay = new RelayCast({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });
  return relay.as(token) as unknown as RelaycastClientLike;
}

function senderRegistrationType(agentName: string, identityConfig: IdentityConfig): RelaycastRegistrationType {
  const normalized = agentName.trim().toLowerCase();
  const projectIdentityKey = normalizeName(identityConfig.projectIdentity);
  if (
    normalized === DASHBOARD_DISPLAY_NAME.toLowerCase()
    || normalized === DASHBOARD_READER_NAME
    || (projectIdentityKey && normalized === projectIdentityKey)
  ) {
    return 'human';
  }
  return 'agent';
}

async function getCachedClient(
  cache: Map<string, Promise<RelaycastClientLike>>,
  config: RelaycastConfig,
  agentName: string,
  registrationType: RelaycastRegistrationType,
  dataDir?: string,
): Promise<RelaycastClientLike> {
  const key = getClientCacheKey(config, agentName, registrationType, dataDir);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }

  const clientPromise = createRelaycastClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    cachePath: getCachePath(dataDir),
    agentName,
    agentType: registrationType,
  }).then((client) => client as unknown as RelaycastClientLike)
    .catch((err: unknown) => {
      cache.delete(key);
      throw err;
    });

  cache.set(key, clientPromise);
  return clientPromise;
}

export function getReaderClient(config: RelaycastConfig): Promise<RelaycastClientLike> {
  // Use SDK's createRelaycastClient if available (for test mocking)
  const sdkCreateClient = (agentRelaySdk as Record<string, unknown>).createRelaycastClient;
  if (typeof sdkCreateClient === 'function') {
    return getCachedClient(readerClientCache, config, DASHBOARD_READER_NAME, 'human');
  }

  // For reader operations, use a simple fetch-based client without agent registration.
  // This avoids requiring POST /v1/agents for read-only data fetching.
  const key = `reader:${config.baseUrl}|${config.apiKey}`;
  const existing = readerClientCache.get(key);
  if (existing) {
    return existing;
  }

  const baseUrl = config.baseUrl || 'https://api.relaycast.dev';

  // Simple HTTP client that makes direct fetch calls
  const httpClient = {
    async get<T>(urlPath: string, query?: Record<string, string>): Promise<T> {
      const url = new URL(urlPath, baseUrl);
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          url.searchParams.set(k, v);
        }
      }
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      const json = await response.json() as { ok?: boolean; data?: T };
      // Unwrap standard Relaycast response format
      if (json && typeof json === 'object' && 'data' in json) {
        return json.data as T;
      }
      return json as T;
    },
  };

  // Create a minimal RelaycastClientLike wrapper for read operations
  const readerWrapper: RelaycastClientLike = {
    client: httpClient,
    channels: {
      list: async (opts) => {
        const query: Record<string, string> = {};
        if (opts?.include_archived || opts?.includeArchived) {
          query.include_archived = 'true';
        }
        return httpClient.get('/v1/channels', query);
      },
      create: () => Promise.reject(new Error('Reader client cannot create channels')),
      join: () => Promise.reject(new Error('Reader client cannot join channels')),
      leave: () => Promise.reject(new Error('Reader client cannot leave channels')),
      invite: () => Promise.reject(new Error('Reader client cannot invite to channels')),
    },
    send: () => Promise.reject(new Error('Reader client cannot send messages')),
    reply: () => Promise.reject(new Error('Reader client cannot send thread replies')),
    dm: () => Promise.reject(new Error('Reader client cannot send DMs')),
    dms: {
      conversations: () => httpClient.get('/v1/dm/conversations'),
    },
  };

  const clientPromise = Promise.resolve(readerWrapper);
  readerClientCache.set(key, clientPromise);
  return clientPromise;
}

export function getWriterClient(
  config: RelaycastConfig,
  senderName: string,
  dataDir?: string,
): Promise<RelaycastClientLike> {
  const normalizedSender = senderName.trim().toLowerCase();
  const normalizedProjectIdentity = config.agentName?.trim().toLowerCase();

  // Reuse the broker-issued project token when the sender matches the
  // configured project identity.
  if (config.agentToken && normalizedProjectIdentity && normalizedSender === normalizedProjectIdentity) {
    const key = `token:${config.baseUrl}|${config.apiKey}|${config.agentName}|${config.agentToken}`;
    const existing = writerClientCache.get(key);
    if (existing) {
      return existing;
    }

    const clientPromise = Promise.resolve(
      new RelayCast({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      }).as(config.agentToken) as unknown as RelaycastClientLike,
    ).catch((err: unknown) => {
      writerClientCache.delete(key);
      throw err;
    });
    writerClientCache.set(key, clientPromise);
    return clientPromise;
  }

  return getCachedClient(
    writerClientCache,
    config,
    senderName,
    senderRegistrationType(senderName, {
      projectIdentity: config.projectIdentity ?? '',
    }),
    dataDir,
  );
}

/**
 * Get (or register) an agent token for the dashboard identity.
 * Uses the same SDK override pattern and shared registration cache as
 * createRelaycastClient to ensure consistent test mocking and avoid
 * double registerOrRotate calls that could invalidate tokens.
 */
export async function getDashboardAgentToken(
  config: RelaycastConfig,
  agentName: string,
): Promise<{ token: string; name: string }> {
  // If the config already has a token for this identity, use it directly
  if (config.agentToken && config.agentName?.toLowerCase() === agentName.toLowerCase()) {
    return { token: config.agentToken, name: config.agentName };
  }

  // Use SDK's createRelaycastClient if available (allows test mocking)
  const sdkCreateClient = (agentRelaySdk as Record<string, unknown>).createRelaycastClient;
  if (typeof sdkCreateClient === 'function') {
    // Go through the SDK path to ensure mocks/wrappers are respected.
    // Create a writer client (which caches) and populate the registration cache
    // with the same identity so both frontend token and server client share it.
    const key = registrationCacheKey(config.baseUrl, config.apiKey, agentName);
    const existing = registrationCache.get(key);
    if (existing) return existing;

    const regPromise = (async () => {
      const client = await getCachedClient(
        writerClientCache,
        config,
        agentName,
        'human',
      );
      // Extract token from the SDK-created client if exposed
      const clientAny = client as unknown as Record<string, unknown>;
      const token = (typeof clientAny.token === 'string' ? clientAny.token : '') || '';
      return { token, name: agentName };
    })();
    registrationCache.set(key, regPromise);
    regPromise.catch(() => registrationCache.delete(key));
    return regPromise;
  }

  // Fallback: use shared registration cache (same cache as createRelaycastClient)
  return registerAgentToken({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    agentName,
    agentType: 'human',
  });
}

function parseCliAndModel(
  cliValue: unknown,
  modelValue: unknown,
): { cli: string; model?: string } {
  const cliSource = typeof cliValue === 'string' ? cliValue.trim() : '';
  const cli = cliSource ? (cliSource.split(/\s+/)[0] ?? 'unknown') : 'unknown';
  const model =
    typeof modelValue === 'string' && modelValue.trim().length > 0
      ? modelValue.trim()
      : undefined;

  return { cli, model };
}

export function mapAgentStatus(agent: RelaycastAgentRecord): AgentStatus {
  const meta = agent.metadata || {};
  const runtime = parseCliAndModel(meta.cli, meta.model);

  return {
    name: agent.name,
    role: (meta.role as string) || 'Agent',
    cli: runtime.cli,
    model: runtime.model,
    messageCount: 0,
    status: agent.status === 'online' ? 'online' : 'offline',
    lastSeen: agent.last_seen ?? undefined,
    lastActive: agent.last_seen ?? undefined,
    team: (meta.team as string) || undefined,
    needsAttention: false,
  };
}

export function mapChannelMessage(
  channelName: string,
  msg: RelaycastMessage,
  identityConfig: IdentityConfig,
): Message {
  // Handle both snake_case (raw API) and camelCase (SDK-processed) field names
  const msgAny = msg as Record<string, unknown>;
  const agentName = (msg.agent_name ?? msgAny.agentName ?? '') as string;
  const createdAt = (msg.created_at ?? msgAny.createdAt ?? '') as string;
  const threadId = (msg.thread_id ?? msgAny.threadId ?? undefined) as string | undefined;
  const replyCount = (msg.reply_count ?? msgAny.replyCount ?? 0) as number;

  return {
    from: resolveIdentity(agentName, identityConfig) || 'unknown',
    to: `#${channelName}`,
    content: msg.text,
    timestamp: createdAt,
    id: msg.id,
    thread: threadId,
    reactions: msg.reactions ?? [],
    replyCount,
  };
}

export function mapDmMessage(
  conversationId: string,
  participants: string[],
  msg: RelaycastMessage,
  identityConfig: IdentityConfig,
): Message {
  // Handle both snake_case (raw API) and camelCase (SDK-processed) field names
  const msgAny = msg as Record<string, unknown>;
  const agentName = (msg.agent_name ?? msgAny.agentName ?? '') as string;
  const createdAt = (msg.created_at ?? msgAny.createdAt ?? '') as string;
  const threadId = (msg.thread_id ?? msgAny.threadId ?? undefined) as string | undefined;
  const replyCount = (msg.reply_count ?? msgAny.replyCount ?? 0) as number;

  const from = resolveIdentity(agentName, identityConfig) || 'unknown';
  const to = resolveDmRecipient(participants, from, identityConfig);
  const id = msg.id?.trim() || `dm_${conversationId}_${createdAt}`;

  return {
    from,
    to,
    content: msg.text,
    timestamp: createdAt,
    id,
    thread: threadId,
    reactions: msg.reactions ?? [],
    replyCount,
  };
}

export function reactionGroupsToRecord(
  reactions: Array<{ emoji: string; agents: string[] }>,
): Record<string, string[]> {
  return Object.fromEntries(reactions.map((r) => [r.emoji, r.agents]));
}

export function dedupeMessages(messages: Message[]): Message[] {
  const byKey = new Map<string, Message>();

  for (const message of messages) {
    const fallbackKey = `${message.from}|${message.to}|${message.timestamp}|${message.content}`;
    const key = message.id || fallbackKey;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, message);
      continue;
    }

    const existingTs = parseTimestamp(existing.timestamp) ?? 0;
    const nextTs = parseTimestamp(message.timestamp) ?? 0;
    if (nextTs >= existingTs) {
      byKey.set(key, message);
    }
  }

  return Array.from(byKey.values());
}
