#!/usr/bin/env node
/**
 * Relay Dashboard Server Entry Point
 *
 * Start the dashboard server from the command line.
 * Supports three modes:
 * - Integrated mode: Full integration with @agent-relay packages (used by `agent-relay up --dashboard`)
 * - Proxy mode (default): Forwards requests to a relay daemon HTTP endpoint
 * - Mock mode: Returns fixture data for testing without dependencies
 */

import { startServer } from './proxy-server.js';

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
  } else if (arg === '--integrated') {
    options.integrated = true;
  } else if (arg === '--data-dir') {
    options.dataDir = args[++i];
  } else if (arg === '--team-dir') {
    options.teamDir = args[++i];
  } else if (arg === '--project-root') {
    options.projectRoot = args[++i];
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Relay Dashboard Server

A standalone dashboard for Agent Relay that can run in three modes:
- Integrated mode: Full @agent-relay integration (used by CLI)
- Proxy mode (default): Forwards requests to a relay daemon HTTP endpoint
- Mock mode: Returns fixture data for testing without dependencies

Usage: relay-dashboard [options]

Options:
  -p, --port <port>        Port to listen on (default: 3888, env: PORT)
  -r, --relay-url <url>    Relay daemon URL for proxy mode (default: http://localhost:3889, env: RELAY_URL)
  -s, --static-dir <path>  Static files directory (default: ./out, env: STATIC_DIR)
  -m, --mock               Run in mock mode - no relay daemon required (env: MOCK=true)
  -v, --verbose            Enable verbose logging (env: VERBOSE=true)
  --integrated             Run in integrated mode (requires --data-dir, --team-dir, --project-root)
  --data-dir <path>        Data directory for integrated mode
  --team-dir <path>        Team directory for integrated mode
  --project-root <path>    Project root for integrated mode
  -h, --help               Show this help message

Examples:
  relay-dashboard                      # Start in proxy mode (requires relay daemon HTTP)
  relay-dashboard --mock               # Start in mock mode (standalone)
  relay-dashboard -m -v                # Mock mode with verbose logging
  relay-dashboard -p 4000 -m           # Mock mode on custom port
  relay-dashboard --integrated --data-dir ... --team-dir ... --project-root ...
`);
    process.exit(0);
  }
}

// Start the server
async function main() {
  if (options.integrated) {
    // Integrated mode: use startDashboard which connects via SDK
    const { startDashboard } = await import('./server.js');

    if (!options.dataDir || !options.teamDir || !options.projectRoot) {
      console.error('Integrated mode requires --data-dir, --team-dir, and --project-root');
      process.exit(1);
    }

    await startDashboard({
      port: options.port ? parseInt(options.port as string, 10) : 3888,
      dataDir: options.dataDir as string,
      teamDir: options.teamDir as string,
      projectRoot: options.projectRoot as string,
      enableSpawner: true,
    });
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
