import path from 'path';
import {
  createRelaycastClient,
  type AgentClient,
} from '@agent-relay/sdk';
import { isBrokerIdentity } from '@agent-relay/contracts';
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

const readerClientCache = new Map<string, Promise<AgentClient>>();
const writerClientCache = new Map<string, Promise<AgentClient>>();

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

export function normalizeIdentity(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();

  if (
    lowered === DASHBOARD_DISPLAY_NAME.toLowerCase()
    || lowered === DASHBOARD_READER_NAME
    || isBrokerIdentity(trimmed)
    // Match Dashboard-<hex> names (Relaycast conflict suffix)
    || /^dashboard-[0-9a-f]{6,}$/i.test(trimmed)
  ) {
    return DASHBOARD_DISPLAY_NAME;
  }

  return trimmed;
}

function resolveDmRecipient(participants: string[], sender: string): string {
  const senderKey = sender.toLowerCase();

  for (const participant of participants) {
    const normalized = normalizeIdentity(participant);
    if (!normalized) continue;
    if (normalized.toLowerCase() !== senderKey) {
      return normalized;
    }
  }

  const fallback = normalizeIdentity(participants[0] ?? '');
  return fallback || DASHBOARD_DISPLAY_NAME;
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
  return `${config.baseUrl}|${config.apiKey}|${agentName}|${registrationType}|${cachePath}`;
}

function senderRegistrationType(agentName: string): RelaycastRegistrationType {
  const normalized = agentName.trim().toLowerCase();
  if (
    normalized === DASHBOARD_DISPLAY_NAME.toLowerCase()
    || normalized === DASHBOARD_READER_NAME
  ) {
    return 'human';
  }
  return 'agent';
}

async function getCachedClient(
  cache: Map<string, Promise<AgentClient>>,
  config: RelaycastConfig,
  agentName: string,
  registrationType: RelaycastRegistrationType,
  dataDir?: string,
): Promise<AgentClient> {
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
  }).catch((err) => {
    cache.delete(key);
    throw err;
  });

  cache.set(key, clientPromise);
  return clientPromise;
}

export function getReaderClient(config: RelaycastConfig): Promise<AgentClient> {
  return getCachedClient(readerClientCache, config, DASHBOARD_READER_NAME, 'human');
}

export function getWriterClient(config: RelaycastConfig, senderName: string, dataDir?: string): Promise<AgentClient> {
  return getCachedClient(
    writerClientCache,
    config,
    senderName,
    senderRegistrationType(senderName),
    dataDir,
  );
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

export function mapChannelMessage(channelName: string, msg: RelaycastMessage): Message {
  return {
    from: normalizeIdentity(msg.agent_name) || 'unknown',
    to: `#${channelName}`,
    content: msg.text,
    timestamp: msg.created_at,
    id: msg.id,
    thread: msg.thread_id ?? undefined,
    reactions: msg.reactions ?? [],
    replyCount: msg.reply_count ?? 0,
  };
}

export function mapDmMessage(
  conversationId: string,
  participants: string[],
  msg: RelaycastMessage,
): Message {
  const from = normalizeIdentity(msg.agent_name) || 'unknown';
  const to = resolveDmRecipient(participants, from);
  const id = msg.id?.trim() || `dm_${conversationId}_${msg.created_at}`;

  return {
    from,
    to,
    content: msg.text,
    timestamp: msg.created_at,
    id,
    thread: msg.thread_id ?? undefined,
    reactions: msg.reactions ?? [],
    replyCount: msg.reply_count ?? 0,
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
