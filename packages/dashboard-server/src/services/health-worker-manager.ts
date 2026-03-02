import { buildDashboardProxyUrl, getDashboardProxyRoute } from '../lib/proxy-route-table.js';

export interface BrokerHealthProxyRequest {
  workspaceId?: string;
  authorization?: string;
}

function buildHeaders(request?: BrokerHealthProxyRequest): Record<string, string> | undefined {
  if (!request) return undefined;
  const headers: Record<string, string> = {};
  if (request.authorization) headers.authorization = request.authorization;
  if (request.workspaceId) headers['x-workspace-id'] = request.workspaceId;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export async function fetchBrokerHealth(opts: {
  env?: NodeJS.ProcessEnv;
  request?: BrokerHealthProxyRequest;
  query?: URLSearchParams;
  fetchImpl?: typeof fetch;
} = {}): Promise<Response> {
  const route = getDashboardProxyRoute('brokerHealth');
  const url = buildDashboardProxyUrl(route, { env: opts.env, query: opts.query });
  const fetchImpl = opts.fetchImpl ?? fetch;

  return fetchImpl(url, {
    method: route.method,
    headers: buildHeaders(opts.request),
  });
}
