import type { MessageWithMeta } from '@relaycast/types';

export const DEFAULT_RELAYCAST_BASE_URL = 'https://api.relaycast.dev';
export const DEFAULT_MESSAGE_LIMIT = 100;
export const MAX_MESSAGE_LIMIT = 500;
export const DASHBOARD_READER_NAME = 'dashboard-reader';
export const DASHBOARD_DISPLAY_NAME = 'Dashboard';

// ---------------------------------------------------------------------------
// Wire types — re-exported from the canonical @relaycast/types package.
// Dashboard-specific aliases preserve existing import names across the codebase.
// ---------------------------------------------------------------------------

export type { Agent as RelaycastAgentRecord } from '@relaycast/types';
export type { Channel as RelaycastChannel } from '@relaycast/types';
export type { DmConversationSummary as RelaycastDmConversation } from '@relaycast/types';
export type { AgentType as RelaycastRegistrationType } from '@relaycast/types';
export type { ReactionGroup } from '@relaycast/types';

/**
 * MessageWithMeta from @relaycast/types plus `thread_id` which the Relaycast
 * API returns on channel/DM message list endpoints but is not part of the
 * canonical MessageWithMeta schema (it lives on the raw Message type instead).
 */
export type RelaycastMessage = MessageWithMeta & {
  thread_id?: string | null;
};

// ---------------------------------------------------------------------------
// Dashboard-specific domain types (no relaycast equivalent)
// ---------------------------------------------------------------------------

export interface RelaycastConfig {
  apiKey: string;
  baseUrl: string;
}

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

export interface Message {
  from: string;
  to: string;
  content: string;
  timestamp: string;
  id: string;
  thread?: string;
  isBroadcast?: boolean;
  status?: string;
  reactions?: Array<{ emoji: string; count: number; agents: string[] }>;
  replyCount?: number;
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
