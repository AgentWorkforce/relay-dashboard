import { buildDashboardProxyUrl, getDashboardProxyRoute } from '../lib/proxy-route-table.js';

export interface NeedsAttentionProxyRequest {
  workspaceId?: string;
  authorization?: string;
}

export type NeedsAttentionPayload =
  | string[]
  | { agents?: Array<string | { name?: string }> }
  | { data?: { agents?: Array<string | { name?: string }> } };

function buildHeaders(request?: NeedsAttentionProxyRequest): Record<string, string> | undefined {
  if (!request) return undefined;
  const headers: Record<string, string> = {};
  if (request.authorization) headers.authorization = request.authorization;
  if (request.workspaceId) headers['x-workspace-id'] = request.workspaceId;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function normalizeEntry(entry: unknown): string | null {
  if (typeof entry === 'string') {
    return entry;
  }
  if (entry && typeof entry === 'object') {
    const name = (entry as { name?: unknown }).name;
    if (typeof name === 'string') {
      return name;
    }
  }
  return null;
}

export function parseNeedsAttentionAgents(payload: NeedsAttentionPayload): Set<string> {
  let direct: Array<string | { name?: string }> = [];
  if (Array.isArray(payload)) {
    direct = payload;
  } else if ('agents' in payload && Array.isArray(payload.agents)) {
    direct = payload.agents;
  } else if ('data' in payload && payload.data?.agents && Array.isArray(payload.data.agents)) {
    direct = payload.data.agents;
  }

  const agents = new Set<string>();
  for (const entry of direct) {
    const normalized = normalizeEntry(entry);
    if (normalized) {
      agents.add(normalized);
    }
  }
  return agents;
}

export async function fetchCloudNeedsAttention(opts: {
  env?: NodeJS.ProcessEnv;
  request?: NeedsAttentionProxyRequest;
  query?: URLSearchParams;
  fetchImpl?: typeof fetch;
} = {}): Promise<Response> {
  const route = getDashboardProxyRoute('cloudNeedsAttention');
  const url = buildDashboardProxyUrl(route, { env: opts.env, query: opts.query });
  const fetchImpl = opts.fetchImpl ?? fetch;

  return fetchImpl(url, {
    method: route.method,
    headers: buildHeaders(opts.request),
  });
}
