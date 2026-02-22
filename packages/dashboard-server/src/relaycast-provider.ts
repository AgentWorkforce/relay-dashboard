/**
 * Relaycast data provider for dashboard-server.
 *
 * This module centralizes all Relaycast API interactions so proxy-server.ts
 * can stay focused on HTTP/WS routing and response shaping.
 */

import fs from 'fs';
import path from 'path';
import {
  RelaycastApi,
  createWorkspaceReader,
  type RelaycastChannel,
  type RelaycastMessage,
  type WorkspaceReader,
} from '@agent-relay/sdk';

const DEFAULT_RELAYCAST_BASE_URL = 'https://api.relaycast.dev';
const DEFAULT_MESSAGE_LIMIT = 100;
const MAX_MESSAGE_LIMIT = 500;

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

function createWriter(config: RelaycastConfig, agentName: string, dataDir?: string): RelaycastApi {
  const opts: ConstructorParameters<typeof RelaycastApi>[0] = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    agentName,
  };
  if (dataDir) {
    opts.cachePath = path.join(dataDir, 'relaycast.json');
  }
  return new RelaycastApi(opts);
}

function mapAgentStatus(agent: {
  name: string;
  type: string;
  status: string;
  last_seen: string | null;
  metadata: Record<string, unknown> | null;
}): AgentStatus {
  const meta = agent.metadata || {};
  return {
    name: agent.name,
    role: (meta.role as string) || 'Agent',
    cli: (meta.cli as string) || 'unknown',
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
    thread: msg.thread_id,
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

/**
 * Create a WorkspaceReader from config.
 */
export function createReader(config: RelaycastConfig): WorkspaceReader {
  return createWorkspaceReader({ apiKey: config.apiKey, baseUrl: config.baseUrl });
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

/**
 * Fetch all agents from the Relaycast workspace and map to dashboard AgentStatus[].
 */
export async function fetchAgents(config: RelaycastConfig): Promise<AgentStatus[]> {
  try {
    const reader = createReader(config);
    const agents = await reader.listAgents();
    return agents
      .filter((agent) => agent.type !== 'human')
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
    const reader = createReader(config);
    const channels = await reader.listChannels();
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
    const reader = createReader(config);
    const limit = getMessageLimit(options.limit);
    let messages = await reader.listMessages(channelName, { limit });

    if (typeof options.before === 'number' && Number.isFinite(options.before)) {
      const beforeTs = options.before;
      messages = messages.filter((msg) => {
        const ts = parseTimestamp(msg.created_at);
        return ts !== null && ts < beforeTs;
      });
    }

    messages.sort((a, b) => {
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
  const relaycast = createWriter(config, senderName, input.dataDir);
  await relaycast.send(target, message);
  return { messageId: `relaycast-${Date.now()}` };
}

export async function createChannel(config: RelaycastConfig, input: CreateChannelInput): Promise<void> {
  const channelName = normalizeChannelName(input.name);
  if (!channelName || channelName.startsWith('dm:')) {
    throw new Error('name is required');
  }

  // Relaycast channel creation currently ignores visibility.
  void input.visibility;
  const relaycast = createWriter(config, input.creator?.trim() || 'Dashboard', input.dataDir);
  await relaycast.createChannel(channelName, input.description?.trim() || undefined);
}

export async function inviteToChannel(
  config: RelaycastConfig,
  input: InviteToChannelInput,
): Promise<InviteToChannelResult> {
  const channelName = normalizeChannelName(input.channel);
  if (!channelName || channelName.startsWith('dm:')) {
    throw new Error('channel is required');
  }

  const relaycast = createWriter(config, input.invitedBy?.trim() || 'Dashboard', input.dataDir);
  const invited: Array<{ id: string; type: 'user' | 'agent'; success: boolean; reason?: string }> = [];

  for (const member of input.members) {
    const memberId = typeof member.id === 'string' ? member.id.trim() : '';
    if (!memberId) continue;

    try {
      await relaycast.inviteToChannel(channelName, memberId);
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

  const relaycast = createWriter(config, input.username.trim() || 'Dashboard', input.dataDir);
  await relaycast.joinChannel(channelName);
}

export async function leaveChannel(_config: RelaycastConfig, input: LeaveChannelInput): Promise<void> {
  // RelaycastApi does not currently expose channel leave. Keep API-compatible no-op.
  if (process.env.VERBOSE === 'true') {
    console.warn(`[relaycast-provider] leaveChannel no-op for ${input.username} on ${input.channel}`);
  }
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
