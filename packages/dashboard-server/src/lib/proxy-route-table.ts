export type DashboardProxyUpstream = 'broker' | 'cloud';

export interface DashboardProxyRoute {
  key: 'brokerHealth' | 'cloudMetrics' | 'cloudNeedsAttention' | 'brokerSpawned';
  method: 'GET';
  routePath: string;
  upstream: DashboardProxyUpstream;
  upstreamPath: string;
}

export const DASHBOARD_PROXY_ROUTE_TABLE: readonly DashboardProxyRoute[] = Object.freeze([
  {
    key: 'brokerHealth',
    method: 'GET',
    routePath: '/health',
    upstream: 'broker',
    upstreamPath: '/health',
  },
  {
    key: 'cloudMetrics',
    method: 'GET',
    routePath: '/api/metrics',
    upstream: 'cloud',
    upstreamPath: '/api/metrics',
  },
  {
    key: 'cloudNeedsAttention',
    method: 'GET',
    routePath: '/api/agents/needs-attention',
    upstream: 'cloud',
    upstreamPath: '/api/agents/needs-attention',
  },
  {
    key: 'brokerSpawned',
    method: 'GET',
    routePath: '/api/spawned',
    upstream: 'broker',
    upstreamPath: '/api/spawned',
  },
]);

const ROUTE_BY_KEY = new Map(DASHBOARD_PROXY_ROUTE_TABLE.map((route) => [route.key, route]));

function normalizeBaseUrl(raw: string): string {
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export function getDashboardProxyRoute(key: DashboardProxyRoute['key']): DashboardProxyRoute {
  const route = ROUTE_BY_KEY.get(key);
  if (!route) {
    throw new Error(`Unknown dashboard proxy route key: ${key}`);
  }
  return route;
}

export function resolveUpstreamBaseUrl(
  upstream: DashboardProxyUpstream,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (upstream === 'cloud') {
    const baseUrl = env.DASHBOARD_CLOUD_URL ?? env.CLOUD_API_URL;
    if (!baseUrl) {
      throw new Error('Cloud upstream URL is not configured (set DASHBOARD_CLOUD_URL or CLOUD_API_URL)');
    }
    return baseUrl;
  }

  const brokerBaseUrl =
    env.DASHBOARD_BROKER_URL ??
    env.BROKER_API_URL ??
    env.RELAY_URL ??
    env.RELAY_API_URL ??
    'http://127.0.0.1:3889';
  return brokerBaseUrl;
}

export function buildDashboardProxyUrl(
  route: DashboardProxyRoute,
  opts: {
    env?: NodeJS.ProcessEnv;
    query?: URLSearchParams | Record<string, string | number | boolean | undefined>;
  } = {}
): string {
  const env = opts.env ?? process.env;
  const baseUrl = resolveUpstreamBaseUrl(route.upstream, env);
  const target = new URL(route.upstreamPath.replace(/^\//, ''), normalizeBaseUrl(baseUrl));

  if (opts.query) {
    const query = opts.query instanceof URLSearchParams
      ? opts.query
      : new URLSearchParams(
        Object.entries(opts.query)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)] as [string, string])
      );
    for (const [key, value] of query.entries()) {
      target.searchParams.set(key, value);
    }
  }

  return target.toString();
}
