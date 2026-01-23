/**
 * Relay Dashboard Server
 *
 * A minimal server that:
 * 1. Serves the static dashboard files
 * 2. Proxies API requests to the relay daemon
 * 3. Proxies WebSocket connections to the relay daemon
 *
 * The dashboard is purely a presentation layer - all business logic
 * lives in the relay daemon.
 */

export { startServer, createServer } from './server.js';
export type { DashboardServerOptions } from './server.js';
