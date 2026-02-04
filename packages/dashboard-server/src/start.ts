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

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './proxy-server.js';

// Read version - prefer build-time define for compiled binaries, fall back to package.json
function getVersion(): string {
  // Check for build-time defined version (set via bun build --define)
  // This is used when running as a compiled standalone binary
  if (process.env.DASHBOARD_SERVER_VERSION) {
    return process.env.DASHBOARD_SERVER_VERSION;
  }

  // Fall back to reading from package.json (for development/npm installs)
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Walk up to find package.json
    let dir = __dirname;
    for (let i = 0; i < 5; i++) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          if (pkg.name === '@agent-relay/dashboard-server') {
            return pkg.version || 'unknown';
          }
        } catch {
          // Continue searching
        }
      }
      dir = dirname(dir);
    }
  } catch {
    // Filesystem access failed (e.g., in compiled binary with virtual fs)
  }
  return 'unknown';
}

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
  } else if (arg === '--version' || arg === '-V') {
    console.log(getVersion());
    process.exit(0);
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Relay Dashboard Server v${getVersion()}

A standalone dashboard for Agent Relay that can run in three modes:
- Integrated mode: Full @agent-relay integration (used by CLI)
- Proxy mode (default): Forwards requests to a relay daemon HTTP endpoint
- Mock mode: Returns fixture data for testing without dependencies

Usage: relay-dashboard-server [options]

Options:
  -p, --port <port>        Port to listen on (default: 3888, env: PORT)
  -r, --relay-url <url>    Relay daemon URL for proxy mode (default: http://localhost:3889, env: RELAY_URL)
  -s, --static-dir <path>  Static files directory (default: ./out, env: STATIC_DIR)
  -m, --mock               Run in mock mode - no relay daemon required (env: MOCK=true)
  -v, --verbose            Enable verbose logging (env: VERBOSE=true)
  --integrated             Run in integrated mode (requires --data-dir, --team-dir, --project-root)
  --data-dir <path>        Data directory for integrated mode
  --team-dir <path>        Team directory for integrated mode
  -V, --version            Output the version number
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
      verbose: options.verbose as boolean | undefined,
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
