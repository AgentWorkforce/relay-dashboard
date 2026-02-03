/**
 * @agent-relay/dashboard
 *
 * Web dashboard UI for Agent Relay with visual agent coordination.
 *
 * This package provides static Next.js UI files (in `out/` directory).
 *
 * @example
 * // Get the path to dashboard static files
 * import { dashboardDir } from '@agent-relay/dashboard';
 * console.log(dashboardDir); // /path/to/node_modules/@agent-relay/dashboard/out
 */

import { fileURLToPath } from 'url';
import path from 'path';

// Dashboard static files directory (Next.js export output)
// This allows other packages to find the dashboard UI files
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dashboardDir = path.join(__dirname, 'out');
