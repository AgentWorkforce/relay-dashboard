import { buildDashboardProxyUrl, getDashboardProxyRoute } from '../lib/proxy-route-table.js';

export interface MetricsProxyRequest {
  workspaceId?: string;
  authorization?: string;
}

function buildHeaders(request?: MetricsProxyRequest): Record<string, string> | undefined {
  if (!request) return undefined;
  const headers: Record<string, string> = {};
  if (request.authorization) headers.authorization = request.authorization;
  if (request.workspaceId) headers['x-workspace-id'] = request.workspaceId;
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export async function fetchCloudMetrics(opts: {
  env?: NodeJS.ProcessEnv;
  request?: MetricsProxyRequest;
  query?: URLSearchParams;
  upstreamPath?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<Response> {
  const route = getDashboardProxyRoute('cloudMetrics');
  const effectiveRoute = opts.upstreamPath
    ? { ...route, upstreamPath: opts.upstreamPath }
    : route;
  const url = buildDashboardProxyUrl(effectiveRoute, { env: opts.env, query: opts.query });
  const fetchImpl = opts.fetchImpl ?? fetch;

  return fetchImpl(url, {
    method: route.method,
    headers: buildHeaders(opts.request),
  });
}
