#!/usr/bin/env node
/**
 * Relay Dashboard Server Entry Point
 *
 * Start the dashboard server from the command line.
 * Single entry point using proxy-server.ts:
 * - Default mode: Relaycast data + broker proxy
 * - Standalone mode: Relaycast data only (omit relay URL)
 * - Mock mode: Fixture data, no dependencies
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './proxy-server.js';

interface CliOptions {
  port?: number;
  relayUrl?: string;
  dataDir?: string;
  staticDir?: string;
  mock?: boolean;
  verbose?: boolean;
}

const DEFAULT_PORT = 3888;
const DEFAULT_RELAY_URL = 'http://localhost:3889';
const DEFAULT_DATA_DIR = '.agent-relay';
const DEFAULT_STATIC_DIR = './out';

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

function printHelp(): void {
  console.log(`
Relay Dashboard Server v${getVersion()}

Usage: relay-dashboard-server [options]

Modes:
  Default: Serves dashboard with Relaycast data + broker proxy
  --mock:  Serves dashboard with fixture data (no dependencies)
  No --relay-url: Standalone read-only mode (Relaycast data only)

Options:
  -p, --port <port>        Port to listen on (default: ${DEFAULT_PORT}, env: PORT)
  -r, --relay-url <url>    Relay daemon URL (default: ${DEFAULT_RELAY_URL}, env: RELAY_URL)
  --data-dir <path>        Relaycast credentials directory (default: ${DEFAULT_DATA_DIR}, env: DATA_DIR)
  -s, --static-dir <path>  Static files directory (default: ${DEFAULT_STATIC_DIR}, env: STATIC_DIR)
  -m, --mock               Run in mock mode (env: MOCK=true)
  -v, --verbose            Enable verbose logging (env: VERBOSE=true)
  -V, --version            Output the version number
  -h, --help               Show this help message

Examples:
  relay-dashboard-server
  relay-dashboard-server --mock
  relay-dashboard-server --port 4000 --relay-url http://localhost:3889
  relay-dashboard-server --data-dir /path/to/.agent-relay --verbose
`);
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      options.port = parsePort(readOptionValue(args, i, arg));
      i += 1;
    } else if (arg === '--relay-url' || arg === '-r') {
      options.relayUrl = readOptionValue(args, i, arg);
      i += 1;
    } else if (arg === '--data-dir') {
      options.dataDir = readOptionValue(args, i, arg);
      i += 1;
    } else if (arg === '--static-dir' || arg === '-s') {
      options.staticDir = readOptionValue(args, i, arg);
      i += 1;
    } else if (arg === '--mock' || arg === '-m') {
      options.mock = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--version' || arg === '-V') {
      console.log(getVersion());
      process.exit(0);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

let cliOptions: CliOptions;
try {
  cliOptions = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  console.error('Use --help to see available options.');
  process.exit(1);
}

// Start the server
async function main() {
  await startServer({
    port: cliOptions.port ?? parsePort(process.env.PORT || `${DEFAULT_PORT}`),
    relayUrl: cliOptions.relayUrl ?? process.env.RELAY_URL ?? DEFAULT_RELAY_URL,
    dataDir: cliOptions.dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR,
    staticDir: cliOptions.staticDir ?? process.env.STATIC_DIR ?? DEFAULT_STATIC_DIR,
    verbose: cliOptions.verbose ?? process.env.VERBOSE === 'true',
    mock: cliOptions.mock ?? process.env.MOCK === 'true',
  });
}

main().catch((err) => {
  console.error('Failed to start dashboard server:', err);
  process.exit(1);
});
