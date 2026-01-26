/**
 * Relay Dashboard Server
 *
 * A flexible server that can operate in two modes:
 * 1. Proxy mode (default): Forwards requests to a relay daemon
 * 2. Mock mode: Returns fixture data for standalone testing/demos
 *
 * This enables the dashboard to run completely independently for testing,
 * demos, and development without requiring a relay daemon.
 */

export { startServer, createServer } from './server.js';
export type { DashboardServerOptions, DashboardServer } from './server.js';

// Re-export mock fixtures for testing
export * from './mocks/fixtures.js';
export * from './mocks/types.js';
