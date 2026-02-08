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
