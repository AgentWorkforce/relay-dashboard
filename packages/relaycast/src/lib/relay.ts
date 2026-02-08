const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'https://api.relaycast.dev';

/* ------------------------------------------------------------------ */
/*  Thin HTTP helper — avoids pulling in the full SDK for now          */
/* ------------------------------------------------------------------ */

async function apiFetch<T>(
  path: string,
  token: string,
  opts: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers as Record<string, string>),
    },
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok || json.ok === false) {
    const msg =
      json.error?.message ?? json.message ?? `API error ${res.status}`;
    throw new Error(msg);
  }

  return json.data as T;
}

/* ------------------------------------------------------------------ */
/*  Public helpers used by login + sidebar                             */
/* ------------------------------------------------------------------ */

export interface WorkspaceInfo {
  name: string;
  plan?: string;
}

export async function validateApiKey(apiKey: string): Promise<WorkspaceInfo> {
  return apiFetch<WorkspaceInfo>('/v1/workspace', apiKey);
}

export interface RegisterAgentResponse {
  name: string;
  token: string;
}

export async function registerHumanAgent(
  apiKey: string,
): Promise<RegisterAgentResponse> {
  return apiFetch<RegisterAgentResponse>('/v1/agents', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Human',
      type: 'human',
      persona: 'Workspace owner using the dashboard',
    }),
  });
}

export async function rotateToken(
  apiKey: string,
  agentName: string,
): Promise<RegisterAgentResponse> {
  return apiFetch<RegisterAgentResponse>(
    `/v1/agents/${encodeURIComponent(agentName)}/rotate-token`,
    apiKey,
    { method: 'POST' },
  );
}

export interface ChannelSummary {
  name: string;
  topic?: string;
  member_count?: number;
}

export async function fetchChannels(
  apiKey: string,
): Promise<ChannelSummary[]> {
  return apiFetch<ChannelSummary[]>('/v1/channels', apiKey);
}

export interface DmConversation {
  id: string;
  type: string;
  participants: string[];
  last_message?: { text: string; agent_name: string; created_at: string };
}

export async function fetchDmConversations(
  agentToken: string,
): Promise<DmConversation[]> {
  return apiFetch<DmConversation[]>('/v1/dm/conversations', agentToken);
}

/* ------------------------------------------------------------------ */
/*  Channel detail + messages                                          */
/* ------------------------------------------------------------------ */

export interface ChannelDetail {
  name: string;
  topic?: string;
  member_count?: number;
  is_member?: boolean;
}

export async function fetchChannelInfo(
  apiKey: string,
  channelName: string,
): Promise<ChannelDetail> {
  return apiFetch<ChannelDetail>(
    `/v1/channels/${encodeURIComponent(channelName)}`,
    apiKey,
  );
}

export interface MessageResponse {
  id: string;
  channel_name?: string;
  agent_name: string;
  text: string;
  created_at: string;
  reply_count?: number;
  reactions?: { emoji: string; count: number; agents: string[] }[];
}

export async function fetchMessages(
  apiKey: string,
  channelName: string,
  opts?: { limit?: number; before?: string },
): Promise<MessageResponse[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  const qs = params.toString();
  return apiFetch<MessageResponse[]>(
    `/v1/channels/${encodeURIComponent(channelName)}/messages${qs ? `?${qs}` : ''}`,
    apiKey,
  );
}

export async function sendMessage(
  agentToken: string,
  channelName: string,
  text: string,
): Promise<MessageResponse> {
  return apiFetch<MessageResponse>(
    `/v1/channels/${encodeURIComponent(channelName)}/messages`,
    agentToken,
    { method: 'POST', body: JSON.stringify({ text }) },
  );
}

/* ------------------------------------------------------------------ */
/*  Threads                                                            */
/* ------------------------------------------------------------------ */

export async function fetchReplies(
  apiKey: string,
  messageId: string,
): Promise<MessageResponse[]> {
  return apiFetch<MessageResponse[]>(
    `/v1/messages/${encodeURIComponent(messageId)}/replies`,
    apiKey,
  );
}

export async function sendReply(
  agentToken: string,
  messageId: string,
  text: string,
): Promise<MessageResponse> {
  return apiFetch<MessageResponse>(
    `/v1/messages/${encodeURIComponent(messageId)}/replies`,
    agentToken,
    { method: 'POST', body: JSON.stringify({ text }) },
  );
}

/* ------------------------------------------------------------------ */
/*  Agents                                                             */
/* ------------------------------------------------------------------ */

export interface AgentSummary {
  name: string;
  type?: string;
  status?: string;
}

export async function fetchAgents(
  apiKey: string,
): Promise<AgentSummary[]> {
  return apiFetch<AgentSummary[]>('/v1/agents', apiKey);
}

/* ------------------------------------------------------------------ */
/*  DM Messages                                                        */
/* ------------------------------------------------------------------ */

export async function fetchDmMessages(
  agentToken: string,
  conversationId: string,
  opts?: { limit?: number; before?: string },
): Promise<MessageResponse[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  const qs = params.toString();
  return apiFetch<MessageResponse[]>(
    `/v1/dm/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ''}`,
    agentToken,
  );
}

export async function sendDmMessage(
  agentToken: string,
  conversationId: string,
  text: string,
): Promise<MessageResponse> {
  return apiFetch<MessageResponse>(
    `/v1/dm/${encodeURIComponent(conversationId)}/messages`,
    agentToken,
    { method: 'POST', body: JSON.stringify({ text }) },
  );
}

export async function createDm(
  agentToken: string,
  to: string,
  text: string,
): Promise<{ conversation_id: string; message: MessageResponse }> {
  return apiFetch<{ conversation_id: string; message: MessageResponse }>(
    '/v1/dm',
    agentToken,
    { method: 'POST', body: JSON.stringify({ to, text }) },
  );
}

export async function createGroupDm(
  agentToken: string,
  participants: string[],
  text: string,
  name?: string,
): Promise<{ conversation_id: string; message: MessageResponse }> {
  return apiFetch<{ conversation_id: string; message: MessageResponse }>(
    '/v1/dm/group',
    agentToken,
    { method: 'POST', body: JSON.stringify({ participants, text, name }) },
  );
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

export async function searchMessages(
  apiKey: string,
  query: string,
  opts?: { channel?: string; from?: string; limit?: number },
): Promise<MessageResponse[]> {
  const params = new URLSearchParams({ query });
  if (opts?.channel) params.set('channel', opts.channel);
  if (opts?.from) params.set('from', opts.from);
  if (opts?.limit) params.set('limit', String(opts.limit));
  return apiFetch<MessageResponse[]>(`/v1/search?${params.toString()}`, apiKey);
}

/* ------------------------------------------------------------------ */
/*  Reactions                                                          */
/* ------------------------------------------------------------------ */

export async function addReaction(
  agentToken: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await apiFetch<void>(
    `/v1/messages/${encodeURIComponent(messageId)}/reactions`,
    agentToken,
    { method: 'POST', body: JSON.stringify({ emoji }) },
  );
}

export async function removeReaction(
  agentToken: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await apiFetch<void>(
    `/v1/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
    agentToken,
    { method: 'DELETE' },
  );
}

/* ------------------------------------------------------------------ */
/*  Workspace management                                               */
/* ------------------------------------------------------------------ */

export async function updateWorkspace(
  apiKey: string,
  data: { name?: string },
): Promise<WorkspaceInfo> {
  return apiFetch<WorkspaceInfo>('/v1/workspace', apiKey, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function fetchSystemPrompt(
  apiKey: string,
): Promise<{ prompt: string }> {
  return apiFetch<{ prompt: string }>('/v1/workspace/system-prompt', apiKey);
}

export async function updateSystemPrompt(
  apiKey: string,
  prompt: string,
): Promise<void> {
  await apiFetch<void>('/v1/workspace/system-prompt', apiKey, {
    method: 'PUT',
    body: JSON.stringify({ prompt }),
  });
}

/* ------------------------------------------------------------------ */
/*  Workspace stats & activity                                         */
/* ------------------------------------------------------------------ */

export interface WorkspaceStats {
  total_agents: number;
  online_agents: number;
  total_channels: number;
  messages_today: number;
  active_conversations: number;
}

export async function fetchWorkspaceStats(
  apiKey: string,
): Promise<WorkspaceStats> {
  return apiFetch<WorkspaceStats>('/v1/workspace/stats', apiKey);
}

export interface ActivityItem {
  type: 'message' | 'dm' | 'thread_reply' | 'reaction';
  id: string;
  channel_name?: string;
  agent_name: string;
  text?: string;
  emoji?: string;
  created_at: string;
}

export async function fetchActivity(
  apiKey: string,
  opts?: { limit?: number },
): Promise<ActivityItem[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiFetch<ActivityItem[]>(`/v1/activity${qs ? `?${qs}` : ''}`, apiKey);
}

/* ------------------------------------------------------------------ */
/*  Billing                                                            */
/* ------------------------------------------------------------------ */

export interface BillingUsage {
  messages: { used: number; limit: number };
  agents: { used: number; limit: number };
  storage: { used_mb: number; limit_mb: number };
}

export async function fetchBillingUsage(
  apiKey: string,
): Promise<BillingUsage> {
  return apiFetch<BillingUsage>('/v1/billing/usage', apiKey);
}

export interface BillingSubscription {
  plan: string;
  status: string;
  current_period_end?: string;
}

export async function fetchBillingSubscription(
  apiKey: string,
): Promise<BillingSubscription> {
  return apiFetch<BillingSubscription>('/v1/billing/subscription', apiKey);
}

export async function createBillingPortal(
  apiKey: string,
): Promise<{ url: string }> {
  return apiFetch<{ url: string }>('/v1/billing/portal', apiKey, {
    method: 'POST',
  });
}
