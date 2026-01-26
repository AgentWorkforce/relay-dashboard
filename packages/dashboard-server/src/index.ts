/**
 * @agent-relay/dashboard-server
 *
 * Dashboard server for Agent Relay with two operating modes:
 *
 * 1. Server mode (startDashboard): Complete integration with @agent-relay packages.
 *    Used by the CLI when running `agent-relay up --dashboard`.
 *
 * 2. Proxy/Mock mode (startProxyServer): Lightweight server that proxies to a daemon
 *    or serves mock data. Used for standalone testing and development.
 *
 * @example
 * // Server mode - for CLI integration
 * import { startDashboard } from '@agent-relay/dashboard-server';
 * const port = await startDashboard({
 *   port: 3888,
 *   dataDir: '/path/to/data',
 *   teamDir: '/path/to/team',
 *   enableSpawner: true,
 * });
 *
 * @example
 * // Proxy mode - for standalone operation
 * import { startProxyServer } from '@agent-relay/dashboard-server';
 * const server = await startProxyServer({
 *   port: 3888,
 *   relayUrl: 'http://localhost:3889',
 * });
 */

// Main server (with @agent-relay integrations)
export { startDashboard } from './server.js';

// Proxy/Mock server (standalone, for development)
export { startServer as startProxyServer, createServer as createProxyServer } from './proxy-server.js';

// Backwards compatibility aliases
export { startServer, createServer } from './proxy-server.js';

// Types
export type {
  DashboardOptions,
  ProxyServerOptions,
  DashboardServer,
  ServerContext,
  AgentState,
  ChannelRecord,
  ThreadMetadata,
} from './types/index.js';

// Re-export from proxy server for backwards compatibility
export type { DashboardServerOptions } from './proxy-server.js';

// Re-export mock fixtures for testing
export * from './mocks/fixtures.js';
export * from './mocks/types.js';
