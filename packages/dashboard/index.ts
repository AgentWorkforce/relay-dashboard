/**
 * @agent-relay/dashboard
 *
 * Web dashboard for Agent Relay with visual agent coordination.
 *
 * This package provides:
 * - Static Next.js UI files (in `out/` directory)
 * - Server functionality via re-exports from @agent-relay/dashboard-server
 *
 * @example
 * // Start the dashboard server (used by CLI)
 * import { startDashboard } from '@agent-relay/dashboard';
 * const port = await startDashboard({
 *   port: 3888,
 *   dataDir: '/path/to/data',
 *   teamDir: '/path/to/team',
 * });
 *
 * @example
 * // Start a standalone proxy server
 * import { startServer } from '@agent-relay/dashboard';
 * const server = await startServer({ port: 3888 });
 */

// Re-export all server functionality from dashboard-server
export {
  // Main entry points
  startDashboard,
  startServer,
  createServer,
  // Types
  type DashboardOptions,
  type ProxyServerOptions,
  type DashboardServer,
  type DashboardServerOptions,
  type ServerContext,
  type AgentState,
  type ChannelRecord,
  type ThreadMetadata,
} from '@agent-relay/dashboard-server';
