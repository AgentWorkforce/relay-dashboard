#!/usr/bin/env node
/**
 * Relay Dashboard Server Entry Point
 *
 * Start the dashboard server from the command line.
 * Supports three modes:
 * - Proxy mode (default): Forwards requests to a relay daemon
 * - Mock mode: Returns fixture data for testing without dependencies
 * - Integrated mode: Full integration with @agent-relay packages (for npx usage)
 */

import { startServer } from './proxy-server.js';
import path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const options: Record<string, string | boolean> = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--port' || arg === '-p') {
    options.port = args[++i];
  } else if (arg === '--relay-url' || arg === '-r') {
    options.relayUrl = args[++i];
  } else if (arg === '--static-dir' || arg === '-s') {
    options.staticDir = args[++i];
  } else if (arg === '--verbose' || arg === '-v') {
    options.verbose = true;
  } else if (arg === '--mock' || arg === '-m') {
    options.mock = true;
  } else if (arg === '--integrated' || arg === '-i') {
    options.integrated = true;
  } else if (arg === '--data-dir' || arg === '-d') {
    options.dataDir = args[++i];
  } else if (arg === '--team-dir' || arg === '-t') {
    options.teamDir = args[++i];
  } else if (arg === '--project-root') {
    options.projectRoot = args[++i];
  } else if (arg === '--no-spawner') {
    options.noSpawner = true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Relay Dashboard Server

A standalone dashboard for Agent Relay that can run in three modes:
- Proxy mode (default): Forwards requests to a relay daemon
- Mock mode: Returns fixture data for testing without dependencies
- Integrated mode: Full integration with @agent-relay packages

Usage: relay-dashboard-server [options]

Options:
  -p, --port <port>        Port to listen on (default: 3888, env: PORT)
  -r, --relay-url <url>    Relay daemon URL for proxy mode (default: http://localhost:3889, env: RELAY_URL)
  -s, --static-dir <path>  Static files directory (default: ./out, env: STATIC_DIR)
  -m, --mock               Run in mock mode - no relay daemon required (env: MOCK=true)
  -i, --integrated         Run in integrated mode with full @agent-relay features
  -d, --data-dir <path>    Data directory for integrated mode (env: DATA_DIR)
  -t, --team-dir <path>    Team directory for integrated mode (env: TEAM_DIR)
  --project-root <path>    Project root for integrated mode (env: PROJECT_ROOT)
  --no-spawner             Disable agent spawning in integrated mode
  -v, --verbose            Enable verbose logging (env: VERBOSE=true)
  -h, --help               Show this help message

Examples:
  relay-dashboard-server                           # Start in proxy mode (requires relay daemon)
  relay-dashboard-server --mock                    # Start in mock mode (standalone)
  relay-dashboard-server --integrated              # Start in integrated mode (auto-detect paths)
  relay-dashboard-server -i -d .agent-relay        # Integrated mode with custom data dir
  npx @agent-relay/dashboard-server --integrated   # Quick start via npx
`);
    process.exit(0);
  }
}

// Determine mode and start appropriate server
async function main(): Promise<void> {
  if (options.integrated) {
    // Integrated mode: use full startDashboard with @agent-relay integrations
    const { startDashboard } = await import('./server.js');

    // Resolve paths from args, env vars, or defaults
    const projectRoot = (options.projectRoot as string) || process.env.PROJECT_ROOT || process.cwd();
    const dataDir = (options.dataDir as string) || process.env.DATA_DIR || path.join(projectRoot, '.agent-relay');
    const teamDir = (options.teamDir as string) || process.env.TEAM_DIR || path.join(dataDir, 'team');
    const port = options.port ? parseInt(options.port as string, 10) : parseInt(process.env.PORT || '3888', 10);

    console.log('[dashboard] Starting in integrated mode');
    console.log(`[dashboard] Project root: ${projectRoot}`);
    console.log(`[dashboard] Data dir: ${dataDir}`);
    console.log(`[dashboard] Team dir: ${teamDir}`);

    const actualPort = await startDashboard({
      port,
      dataDir,
      teamDir,
      projectRoot,
      enableSpawner: !options.noSpawner,
    });

    console.log(`Dashboard: http://localhost:${actualPort}`);
  } else {
    // Proxy or mock mode
    await startServer({
      port: options.port ? parseInt(options.port as string, 10) : undefined,
      relayUrl: options.relayUrl as string | undefined,
      staticDir: options.staticDir as string | undefined,
      verbose: options.verbose as boolean | undefined,
      mock: options.mock as boolean | undefined,
    });
  }
}

main().catch((err) => {
  console.error('Failed to start dashboard server:', err);
  process.exit(1);
});
