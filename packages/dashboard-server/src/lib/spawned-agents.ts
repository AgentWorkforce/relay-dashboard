import { buildDashboardProxyUrl, getDashboardProxyRoute } from './proxy-route-table.js';

export interface ProxyRequestHeaders {
  authorization?: string;
  workspaceId?: string;
}

function buildHeaders(headers?: ProxyRequestHeaders): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  if (headers.authorization) out.authorization = headers.authorization;
  if (headers.workspaceId) out['x-workspace-id'] = headers.workspaceId;
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function fetchBrokerSpawnedAgents(opts: {
  env?: NodeJS.ProcessEnv;
  query?: URLSearchParams;
  headers?: ProxyRequestHeaders;
  fetchImpl?: typeof fetch;
} = {}): Promise<Response> {
  const route = getDashboardProxyRoute('brokerSpawned');
  const url = buildDashboardProxyUrl(route, { env: opts.env, query: opts.query });
  const fetchImpl = opts.fetchImpl ?? fetch;
  return fetchImpl(url, {
    method: route.method,
    headers: buildHeaders(opts.headers),
  });
}
