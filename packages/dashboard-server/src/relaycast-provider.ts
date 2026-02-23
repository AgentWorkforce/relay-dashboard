/**
 * Relaycast data provider for dashboard-server.
 *
 * This module centralizes all Relaycast API interactions so proxy-server.ts
 * can stay focused on HTTP/WS routing and response shaping.
 */

import fs from 'fs';
import path from 'path';
import {
  createRelaycastClient,
  type AgentClient,
} from '@agent-relay/sdk';

const DEFAULT_RELAYCAST_BASE_URL = 'https://api.relaycast.dev';
const DEFAULT_MESSAGE_LIMIT = 100;
const MAX_MESSAGE_LIMIT = 500;
const DASHBOARD_READER_NAME = 'dashboard-reader';

interface RelaycastAgentRecord {
  name: string;
  type?: string;
  status?: string;
  last_seen?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface RelaycastChannel {
  id: string;
  name: string;
  topic: string | null;
  member_count: number;
  created_at: string;
  is_archived: boolean;
}

interface RelaycastMessage {
  id: string;
  agent_name: string;
  text: string;
  created_at: string;
  thread_id?: string | null;
  reply_count?: number;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelaycastConfig {
  apiKey: string;
  baseUrl: string;
}

/** Dashboard AgentStatus (matches legacy server.ts shape) */
export interface AgentStatus {
  name: string;
  role: string;
  cli: string;
  messageCount: number;
  status?: string;
  lastActive?: string;
  lastSeen?: string;
  needsAttention?: boolean;
  isProcessing?: boolean;
  processingStartedAt?: number;
  isSpawned?: boolean;
  team?: string;
  avatarUrl?: string;
  model?: string;
  cwd?: string;
}

/** Dashboard Message (matches legacy server.ts shape) */
export interface Message {
  from: string;
  to: string;
  content: string;
  timestamp: string;
  id: string;
  thread?: string;
  isBroadcast?: boolean;
  status?: string;
}

export interface FetchChannelMessagesOptions {
  limit?: number;
  before?: number;
}

export interface SendMessageInput {
  to: string;
  message: string;
  from?: string;
  dataDir?: string;
}

export interface SendMessageResult {
  messageId: string;
}

export interface CreateChannelInput {
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
  creator?: string;
  dataDir?: string;
}

export interface ChannelMemberInput {
  id: string;
  type?: 'user' | 'agent';
}

export interface InviteToChannelInput {
  channel: string;
  members: ChannelMemberInput[];
  invitedBy?: string;
  dataDir?: string;
}

export interface InviteToChannelResult {
  invited: Array<{ id: string; type: 'user' | 'agent'; success: boolean; reason?: string }>;
}

export interface JoinChannelInput {
  channel: string;
  username: string;
  dataDir?: string;
}

export interface LeaveChannelInput {
  channel: string;
  username: string;
}

export interface SetChannelArchivedInput {
  channel: string;
  archived: boolean;
  updatedBy?: string;
}

export interface DashboardSnapshot {
  agents: AgentStatus[];
  messages: Message[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizeChannelName(channel: string): string {
  const trimmed = channel.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

function normalizeTarget(to: string): string {
  const trimmed = to.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('#') || trimmed.startsWith('dm:')) return trimmed;
  return trimmed;
}

function getMessageLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_MESSAGE_LIMIT);
}

const readerClientCache = new Map<string, Promise<AgentClient>>();
const writerClientCache = new Map<string, Promise<AgentClient>>();

function getCachePath(dataDir?: string): string | undefined {
  if (!dataDir) return undefined;
  return path.join(dataDir, 'relaycast.json');
}

function getClientCacheKey(config: RelaycastConfig, agentName: string, dataDir?: string): string {
  const cachePath = getCachePath(dataDir) ?? '';
  return `${config.baseUrl}|${config.apiKey}|${agentName}|${cachePath}`;
}

async function getCachedClient(
  cache: Map<string, Promise<AgentClient>>,
  config: RelaycastConfig,
  agentName: string,
  dataDir?: string,
): Promise<AgentClient> {
  const key = getClientCacheKey(config, agentName, dataDir);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }

  const clientPromise = createRelaycastClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    cachePath: getCachePath(dataDir),
    agentName,
  }).catch((err) => {
    cache.delete(key);
    throw err;
  });

  cache.set(key, clientPromise);
  return clientPromise;
}

function getReaderClient(config: RelaycastConfig, dataDir?: string): Promise<AgentClient> {
  return getCachedClient(readerClientCache, config, DASHBOARD_READER_NAME, dataDir);
}

function getWriterClient(config: RelaycastConfig, senderName: string, dataDir?: string): Promise<AgentClient> {
  return getCachedClient(writerClientCache, config, senderName, dataDir);
}

function parseCliAndModel(
  cliValue: unknown,
  modelValue: unknown,
): { cli: string; model?: string } {
  const explicitModel =
    typeof modelValue === 'string' && modelValue.trim().length > 0
      ? modelValue.trim()
      : undefined;
  const cliSource = typeof cliValue === 'string' ? cliValue.trim() : '';

  if (!cliSource) {
    return {
      cli: 'unknown',
      model: explicitModel,
    };
  }

  const parts = cliSource.split(/\s+/);
  const cli = parts[0] ?? 'unknown';
  const args = parts.slice(1);
  let model = explicitModel;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--model') {
      const next = args[index + 1];
      if (!model && typeof next === 'string' && next.trim()) {
        model = next.trim();
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--model=')) {
      if (!model) {
        const value = arg.slice('--model='.length).trim();
        if (value) model = value;
      }
    }
  }

  return { cli, model };
}

function mapAgentStatus(agent: RelaycastAgentRecord): AgentStatus {
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

function mapDashboardMessage(channelName: string, msg: RelaycastMessage): Message {
  return {
    from: msg.agent_name,
    to: `#${channelName}`,
    content: msg.text,
    timestamp: msg.created_at,
    id: msg.id,
    thread: msg.thread_id ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

/**
 * Try to load Relaycast credentials from `<dataDir>/relaycast.json`.
 * Returns null if the file doesn't exist or is invalid.
 */
export function loadRelaycastConfig(dataDir: string): RelaycastConfig | null {
  const credPath = path.join(dataDir, 'relaycast.json');
  if (!fs.existsSync(credPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    const apiKey = raw.api_key as string | undefined;
    if (!apiKey) return null;
    const baseUrl = process.env.RELAYCAST_API_URL || DEFAULT_RELAYCAST_BASE_URL;
    return { apiKey, baseUrl };
  } catch {
    return null;
  }
}

async function createReader(config: RelaycastConfig): Promise<AgentClient> {
  return getReaderClient(config);
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

/**
 * Fetch all agents from the Relaycast workspace and map to dashboard AgentStatus[].
 */
export async function fetchAgents(config: RelaycastConfig): Promise<AgentStatus[]> {
  try {
    const reader = await createReader(config);
    const agents = await reader.client.get<RelaycastAgentRecord[]>('/v1/agents');
    return agents
      .filter((agent) => agent.type !== 'human')
      .filter((agent) => agent.name.toLowerCase() !== DASHBOARD_READER_NAME.toLowerCase())
      .map(mapAgentStatus);
  } catch (err) {
    console.warn('[relaycast-provider] Failed to fetch agents:', (err as Error).message);
    return [];
  }
}

/**
 * Fetch channels from Relaycast.
 */
export async function fetchChannels(config: RelaycastConfig): Promise<RelaycastChannel[]> {
  try {
    const reader = await createReader(config);
    const channelsRaw = await reader.channels.list({ include_archived: true }) as Array<Omit<RelaycastChannel, 'member_count'> & {
      member_count?: number;
    }>;
    const channels: RelaycastChannel[] = channelsRaw.map((channel) => ({
      ...channel,
      member_count: typeof channel.member_count === 'number' ? channel.member_count : 0,
    }));
    return channels.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn('[relaycast-provider] Failed to fetch channels:', (err as Error).message);
    return [];
  }
}

/**
 * Fetch channel message history from Relaycast.
 */
export async function fetchChannelMessages(
  config: RelaycastConfig,
  channel: string,
  options: FetchChannelMessagesOptions = {},
): Promise<RelaycastMessage[]> {
  const channelName = normalizeChannelName(channel);
  if (!channelName) return [];

  try {
    const reader = await createReader(config);
    const limit = getMessageLimit(options.limit);
    let messages = await reader.messages(channelName, { limit }) as RelaycastMessage[];

    if (typeof options.before === 'number' && Number.isFinite(options.before)) {
      const beforeTs = options.before;
      messages = messages.filter((msg: RelaycastMessage) => {
        const ts = parseTimestamp(msg.created_at);
        return ts !== null && ts < beforeTs;
      });
    }

    messages.sort((a: RelaycastMessage, b: RelaycastMessage) => {
      const aTs = parseTimestamp(a.created_at) ?? 0;
      const bTs = parseTimestamp(b.created_at) ?? 0;
      return aTs - bTs;
    });

    return messages;
  } catch (err) {
    console.warn(`[relaycast-provider] Failed to fetch channel messages for #${channelName}:`, (err as Error).message);
    return [];
  }
}

/**
 * Fetch channel members.
 * Relaycast read API does not expose per-channel membership, so this returns
 * workspace agents as the effective member list.
 */
export async function fetchChannelMembers(config: RelaycastConfig, _channel: string): Promise<AgentStatus[]> {
  return fetchAgents(config);
}

/**
 * Fetch messages from all channels, merged and sorted oldest-first.
 */
export async function fetchAllMessages(config: RelaycastConfig): Promise<Message[]> {
  try {
    const channels = await fetchChannels(config);
    if (channels.length === 0) return [];

    const results = await Promise.all(
      channels.map((channel) => fetchChannelMessages(config, channel.name, { limit: DEFAULT_MESSAGE_LIMIT })),
    );

    const mapped = results.flatMap((messages, index) => {
      const channelName = channels[index]?.name ?? 'general';
      return messages.map((msg) => mapDashboardMessage(channelName, msg));
    });

    mapped.sort((a, b) => (parseTimestamp(a.timestamp) ?? 0) - (parseTimestamp(b.timestamp) ?? 0));
    return mapped;
  } catch (err) {
    console.warn('[relaycast-provider] Failed to fetch all messages:', (err as Error).message);
    return [];
  }
}

export async function fetchDashboardSnapshot(config: RelaycastConfig): Promise<DashboardSnapshot> {
  const [agents, messages] = await Promise.all([
    fetchAgents(config),
    fetchAllMessages(config),
  ]);
  return { agents, messages };
}

// ---------------------------------------------------------------------------
// Write API
// ---------------------------------------------------------------------------

export async function sendMessage(config: RelaycastConfig, input: SendMessageInput): Promise<SendMessageResult> {
  const target = normalizeTarget(input.to);
  const message = input.message.trim();
  if (!target || !message) {
    throw new Error('Missing required fields: to, message');
  }

  const senderName = input.from?.trim() ? input.from.trim() : 'Dashboard';
  const relaycast = await getWriterClient(config, senderName, input.dataDir);
  if (target.startsWith('#')) {
    await relaycast.send(target.slice(1), message);
  } else {
    await relaycast.dm(target, message);
  }
  return { messageId: `relaycast-${Date.now()}` };
}

export async function createChannel(config: RelaycastConfig, input: CreateChannelInput): Promise<void> {
  const channelName = normalizeChannelName(input.name);
  if (!channelName || channelName.startsWith('dm:')) {
    throw new Error('name is required');
  }

  // Relaycast channel creation currently ignores visibility.
  void input.visibility;
  const relaycast = await getWriterClient(config, input.creator?.trim() || 'Dashboard', input.dataDir);
  await relaycast.channels.create({
    name: channelName,
    ...(input.description?.trim() ? { topic: input.description.trim() } : {}),
  });
}

export async function inviteToChannel(
  config: RelaycastConfig,
  input: InviteToChannelInput,
): Promise<InviteToChannelResult> {
  const channelName = normalizeChannelName(input.channel);
  if (!channelName || channelName.startsWith('dm:')) {
    throw new Error('channel is required');
  }

  const relaycast = await getWriterClient(config, input.invitedBy?.trim() || 'Dashboard', input.dataDir);
  const invited: Array<{ id: string; type: 'user' | 'agent'; success: boolean; reason?: string }> = [];

  for (const member of input.members) {
    const memberId = typeof member.id === 'string' ? member.id.trim() : '';
    if (!memberId) continue;

    try {
      await relaycast.channels.invite(channelName, memberId);
      invited.push({ id: memberId, type: member.type === 'user' ? 'user' : 'agent', success: true });
    } catch (err) {
      invited.push({
        id: memberId,
        type: member.type === 'user' ? 'user' : 'agent',
        success: false,
        reason: (err as Error).message,
      });
    }
  }

  return { invited };
}

export async function joinChannel(config: RelaycastConfig, input: JoinChannelInput): Promise<void> {
  const channelName = normalizeChannelName(input.channel);
  if (!channelName || channelName.startsWith('dm:')) return;

  const relaycast = await getWriterClient(config, input.username.trim() || 'Dashboard', input.dataDir);
  await relaycast.channels.join(channelName);
}

export async function leaveChannel(config: RelaycastConfig, input: LeaveChannelInput): Promise<void> {
  const channelName = normalizeChannelName(input.channel);
  if (!channelName || channelName.startsWith('dm:')) return;

  const relaycast = await getWriterClient(config, input.username.trim() || 'Dashboard');
  await relaycast.channels.leave(channelName);
}

export async function setChannelArchived(
  _config: RelaycastConfig,
  input: SetChannelArchivedInput,
): Promise<void> {
  // RelaycastApi does not currently expose archive/unarchive. Keep API-compatible no-op.
  if (process.env.VERBOSE === 'true') {
    const action = input.archived ? 'archive' : 'unarchive';
    const updatedBy = input.updatedBy || 'unknown';
    console.warn(`[relaycast-provider] ${action} no-op for ${input.channel} (updatedBy: ${updatedBy})`);
  }
}
