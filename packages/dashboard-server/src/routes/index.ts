/**
 * Route Registration
 *
 * Centralizes route registration for the dashboard server.
 */

import type { Express } from 'express';
import type { ServerContext } from '../types/index.js';
import { createHealthRouter, type HealthRouterOptions } from './health.js';

export interface RegisterRoutesOptions {
  app: Express;
  context: ServerContext;
  mode: 'full' | 'proxy' | 'mock';
  getAgentCount?: () => number;
  getMessageCount?: () => number;
}

/**
 * Register all routes on the Express app
 */
export function registerRoutes(options: RegisterRoutesOptions): void {
  const { app, context, mode, getAgentCount, getMessageCount } = options;

  // Health routes (always available)
  const healthRouter = createHealthRouter({
    context,
    mode,
    getAgentCount,
    getMessageCount,
  });
  app.use(healthRouter);

  // Additional routes will be added here as they are migrated:
  // - Channels routes
  // - Messages routes
  // - Auth routes
  // - Metrics routes
  // - History routes
  // - Logs routes
  // - Spawn routes
  // - Files routes
  // - Trajectory routes
}

export { createHealthRouter } from './health.js';
