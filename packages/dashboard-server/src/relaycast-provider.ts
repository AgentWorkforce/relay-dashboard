/**
 * Relaycast data provider for dashboard-server.
 *
 * This module is orchestration glue only: SDK reads/writes + dashboard adapters.
 */

import fs from 'fs';
import path from 'path';
import { RelayCast } from '@relaycast/sdk';
import { extractMessageId } from './lib/message-id.js';
import type {
  AgentStatus,
  CreateChannelInput,
  DashboardSnapshot,
  FetchChannelMessagesOptions,
  InviteToChannelInput,
  InviteToChannelResult,
  JoinChannelInput,
  LeaveChannelInput,
  Message,
  RelaycastAgentRecord,
  RelaycastChannel,
  RelaycastConfig,
  RelaycastDmConversation,
  RelaycastMessage,
  SendMessageInput,
  SendMessageResult,
  SetChannelArchivedInput,
} from './relaycast-provider-types.js';
import {
  DASHBOARD_READER_NAME,
  DEFAULT_MESSAGE_LIMIT,
  DEFAULT_RELAYCAST_BASE_URL,
} from './relaycast-provider-types.js';
import {
  dedupeMessages,
  getMessageLimit,
  getReaderClient,
  getWriterClient,
  mapAgentStatus,
  mapChannelMessage,
  mapDmMessage,
  normalizeChannelName,
  normalizeTarget,
  parseTimestamp,
} from './relaycast-provider-helpers.js';
import {
  dashboardDisplayName as resolveDashboardDisplayName,
  resolveIdentity,
  type IdentityConfig,
} from './lib/identity.js';

function resolveProviderIdentityConfig(config: RelaycastConfig): IdentityConfig {
  return {
    projectIdentity: config.projectIdentity?.trim() || '',
  };
}

function dashboardDisplayName(config: RelaycastConfig): string {
  return resolveDashboardDisplayName(resolveProviderIdentityConfig(config));
}

export type {
  AgentStatus,
  ChannelMemberInput,
  CreateChannelInput,
  DashboardSnapshot,
  FetchChannelMessagesOptions,
  InviteToChannelInput,
  InviteToChannelResult,
  JoinChannelInput,
  LeaveChannelInput,
  Message,
  RelaycastConfig,
  SendMessageInput,
  SendMessageResult,
  SetChannelArchivedInput,
} from './relaycast-provider-types.js';

/**
 * Try to load Relaycast credentials.
 *
 * Resolution order:
 * 1. `<dataDir>/relaycast.json` — written by `agent-relay init` / workflow runner
 * 2. `RELAY_API_KEY` environment variable — set when launching the dashboard
 *    alongside a live workflow (e.g. `RELAY_API_KEY=rk_live_... agent-relay dashboard`)
 *
 * Returns null only if neither source provides a valid API key.
 */
export function loadRelaycastConfig(dataDir: string): RelaycastConfig | null {
  const baseUrl = process.env.RELAYCAST_API_URL || DEFAULT_RELAYCAST_BASE_URL;
  const projectDir = path.basename(path.resolve(dataDir, '..'));

  // 1. File-based credentials (written by workflow runner / agent-relay init)
  const credPath = path.join(dataDir, 'relaycast.json');
  if (fs.existsSync(credPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      const apiKey = typeof raw.api_key === 'string' ? raw.api_key.trim() : '';
      if (apiKey) {
        const agentName = raw.agent_name as string | undefined;
        const agentToken = raw.agent_token as string | undefined;
        const projectIdentity = (projectDir || agentName || '').trim();
        return { apiKey, baseUrl, agentName, agentToken, projectIdentity };
      }
    } catch {
      // fall through to env var
    }
  }

  // 2. Environment variable fallback — no file needed
  const envApiKey = process.env.RELAY_API_KEY?.trim();
  if (envApiKey) {
    const projectIdentity = projectDir.trim();
    return { apiKey: envApiKey, baseUrl, projectIdentity };
  }

  return null;
}

/**
 * Fetch all agents from the Relaycast workspace and map to dashboard AgentStatus[].
 */
export async function fetchAgents(config: RelaycastConfig): Promise<AgentStatus[]> {
  try {
    const reader = await getReaderClient(config);
    const agents = await reader.client.get<RelaycastAgentRecord[]>('/v1/agents');

    return (agents as RelaycastAgentRecord[])
      .filter((agent: RelaycastAgentRecord) => agent.type !== 'human')
      .filter((agent: RelaycastAgentRecord) => agent.name.toLowerCase() !== DASHBOARD_READER_NAME)
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
    const reader = await getReaderClient(config);
    const channels = await reader.channels.list({ include_archived: true }) as RelaycastChannel[];

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
    const reader = await getReaderClient(config);
    const limit = getMessageLimit(options.limit);
    let messages = await reader.client.get<RelaycastMessage[]>(
      `/v1/channels/${encodeURIComponent(channelName)}/messages`,
      { limit: String(limit) },
    );

    // Handle both snake_case (raw API) and camelCase (SDK-processed) field names
    const getCreatedAt = (m: RelaycastMessage) => {
      const mAny = m as Record<string, unknown>;
      return (mAny.createdAt ?? m.created_at) as string | undefined;
    };

    if (typeof options.before === 'number' && Number.isFinite(options.before)) {
      const beforeTs = options.before;
      messages = messages.filter((msg: RelaycastMessage) => {
        const ts = parseTimestamp(getCreatedAt(msg));
        return ts !== null && ts < beforeTs;
      });
    }

    messages.sort((a: RelaycastMessage, b: RelaycastMessage) => (parseTimestamp(getCreatedAt(a)) ?? 0) - (parseTimestamp(getCreatedAt(b)) ?? 0));
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
 * Create a workspace-level RelayCast client for fetching all DM conversations.
 * Uses the API key directly (not an agent token) so it can see ALL conversations
 * in the workspace, not just those the dashboard-reader participates in.
 */
function getWorkspaceClient(config: RelaycastConfig): RelayCast {
  return new RelayCast({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}

async function fetchDmConversations(config: RelaycastConfig): Promise<RelaycastDmConversation[]> {
  try {
    // Use workspace-level API to fetch ALL DM conversations, not just the
    // dashboard-reader's conversations. This ensures agent-to-agent DMs
    // (e.g., IssueReviewer → fixer-530) are visible in the dashboard.
    const relay = getWorkspaceClient(config);
    const conversations = await relay.allDmConversations();
    // WorkspaceDmConversation shape differs from RelaycastDmConversation
    // (string[] participants vs object[], camelCase vs snake_case).
    // fetchAllDirectMessages handles both formats in participant extraction.
    return Array.isArray(conversations)
      ? conversations as unknown as RelaycastDmConversation[]
      : [];
  } catch (err) {
    console.warn('[relaycast-provider] Failed to fetch DM conversations:', (err as Error).message);
    return [];
  }
}

async function fetchDmConversationMessages(
  config: RelaycastConfig,
  conversationId: string,
  limit = DEFAULT_MESSAGE_LIMIT,
): Promise<RelaycastMessage[]> {
  const trimmedId = conversationId.trim();
  if (!trimmedId) return [];

  try {
    // Use workspace-level API for DM message fetching to ensure visibility
    // of all conversations regardless of dashboard-reader participation.
    const relay = getWorkspaceClient(config);
    const rawMessages = await relay.dmMessages(trimmedId, { limit: getMessageLimit(limit) });

    if (!Array.isArray(rawMessages)) return [];
    // Map WorkspaceDmMessage (camelCase) to RelaycastMessage shape
    const messages: RelaycastMessage[] = rawMessages.map((m) => ({
      id: m.id,
      agent_name: m.agentName,
      text: m.text,
      created_at: m.createdAt,
    } as RelaycastMessage));
    messages.sort((a, b) => (parseTimestamp(a.created_at) ?? 0) - (parseTimestamp(b.created_at) ?? 0));
    return messages;
  } catch (err) {
    console.warn(
      `[relaycast-provider] Failed to fetch DM messages for conversation ${trimmedId}:`,
      (err as Error).message,
    );
    return [];
  }
}

async function fetchAllDirectMessages(config: RelaycastConfig): Promise<Message[]> {
  const conversations = await fetchDmConversations(config);
  if (conversations.length === 0) return [];
  const identityConfig = resolveProviderIdentityConfig(config);

  const grouped = await Promise.all(
    conversations.map(async (conversation) => {
      const conversationId = typeof conversation.id === 'string' ? conversation.id.trim() : '';
      if (!conversationId) return [] as Message[];

      const participants = Array.isArray(conversation.participants)
        ? conversation.participants
          .map((participant) => {
            // Handle both snake_case (raw API) and camelCase (SDK-processed) field names
            const pAny = participant as Record<string, unknown>;
            const name = typeof participant === 'string'
              ? participant
              : ((pAny.agentName ?? pAny.agent_name ?? '') as string);
            return resolveIdentity(name, identityConfig);
          })
          .filter((participant): participant is string => Boolean(participant))
        : [];

      const messages = await fetchDmConversationMessages(config, conversationId);
      return messages.map((message) => mapDmMessage(conversationId, participants, message, identityConfig));
    }),
  );

  return grouped.flat();
}

/**
 * Fetch messages from all channels + DM conversations, merged and sorted oldest-first.
 */
export async function fetchAllMessages(config: RelaycastConfig): Promise<Message[]> {
  try {
    const identityConfig = resolveProviderIdentityConfig(config);
    const [channels, directMessages] = await Promise.all([
      fetchChannels(config),
      fetchAllDirectMessages(config),
    ]);

    const channelResults = channels.length > 0
      ? await Promise.all(
        channels.map((channel) => fetchChannelMessages(config, channel.name, { limit: DEFAULT_MESSAGE_LIMIT })),
      )
      : [];

    const channelMessages = channelResults.flatMap((messages, index) => {
      const channelName = channels[index]?.name ?? 'general';
      return messages.map((msg) => mapChannelMessage(channelName, msg, identityConfig));
    });

    const mapped = dedupeMessages([...channelMessages, ...directMessages]);
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


export async function sendMessage(config: RelaycastConfig, input: SendMessageInput): Promise<SendMessageResult> {
  const target = normalizeTarget(input.to);
  const message = input.message.trim();
  const threadId = typeof input.thread === 'string' ? input.thread.trim() : '';
  if (!target || !message) {
    throw new Error('Missing required fields: to, message');
  }

  const senderName = input.from?.trim() ? input.from.trim() : dashboardDisplayName(config);
  const relaycast = await getWriterClient(config, senderName, input.dataDir);

  let sendResult: unknown;
  if (threadId) {
    sendResult = await relaycast.reply(threadId, message);
  } else if (target.startsWith('#')) {
    sendResult = await relaycast.send(target.slice(1), message);
  } else {
    sendResult = await relaycast.dm(target, message);
  }

  const sendPayload = (sendResult && typeof sendResult === 'object' && !Array.isArray(sendResult))
    ? sendResult as Record<string, unknown>
    : null;
  const messageId = sendPayload ? extractMessageId(sendPayload) : null;
  const resolvedMessageId = messageId ?? `relaycast-${Date.now()}`;
  return { messageId: resolvedMessageId };
}

export async function createChannel(config: RelaycastConfig, input: CreateChannelInput): Promise<void> {
  const channelName = normalizeChannelName(input.name);
  if (!channelName || channelName.startsWith('dm:')) {
    throw new Error('name is required');
  }

  // Relaycast channel creation currently ignores visibility.
  void input.visibility;

  const relaycast = await getWriterClient(config, input.creator?.trim() || dashboardDisplayName(config), input.dataDir);
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

  const relaycast = await getWriterClient(config, input.invitedBy?.trim() || dashboardDisplayName(config), input.dataDir);
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

  const relaycast = await getWriterClient(config, input.username.trim() || dashboardDisplayName(config), input.dataDir);
  await relaycast.channels.join(channelName);
}

export async function leaveChannel(config: RelaycastConfig, input: LeaveChannelInput): Promise<void> {
  const channelName = normalizeChannelName(input.channel);
  if (!channelName || channelName.startsWith('dm:')) return;

  const relaycast = await getWriterClient(config, input.username.trim() || dashboardDisplayName(config));
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
