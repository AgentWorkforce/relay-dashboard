export const DEFAULT_RELAYCAST_BASE_URL = 'https://api.relaycast.dev';
export const DEFAULT_MESSAGE_LIMIT = 100;
export const MAX_MESSAGE_LIMIT = 500;
export const DASHBOARD_READER_NAME = 'dashboard-reader';
export const DASHBOARD_DISPLAY_NAME = 'Dashboard';

export type RelaycastRegistrationType = 'agent' | 'human';

export interface RelaycastAgentRecord {
  name: string;
  type?: string;
  status?: string;
  last_seen?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RelaycastChannel {
  id: string;
  name: string;
  topic: string | null;
  member_count: number;
  created_at: string;
  is_archived: boolean;
}

export interface RelaycastMessage {
  id: string;
  agent_name: string;
  text: string;
  created_at: string;
  thread_id?: string | null;
  reply_count?: number;
}

export interface RelaycastDmConversation {
  id: string;
  participants?: string[];
}

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
