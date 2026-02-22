/**
 * @agent-relay/dashboard-server
 *
 * Dashboard server for Agent Relay (proxy-server based).
 *
 * @example
 * import { startProxyServer } from '@agent-relay/dashboard-server';
 * const server = await startProxyServer({
 *   port: 3888,
 *   relayUrl: 'http://localhost:3889',
 * });
 */

// Primary proxy/standalone/mock server
export { startServer, createServer } from './proxy-server.js';
export { startServer as startProxyServer, createServer as createProxyServer } from './proxy-server.js';

// Types
export type {
  ProxyServerOptions,
  DashboardServer,
  AgentState,
  ChannelRecord,
  ThreadMetadata,
} from './types/index.js';

// Re-export from proxy server for backwards compatibility
export type { DashboardServerOptions } from './proxy-server.js';

// Re-export mock fixtures for testing
export * from './mocks/fixtures.js';
export * from './mocks/types.js';
