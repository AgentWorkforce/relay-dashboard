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

  const json = await res.json();

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
