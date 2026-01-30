#!/usr/bin/env node
/**
 * Relay Dashboard CLI Entry Point
 *
 * Provides version information and starts the dashboard via dashboard-server.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Read version from package.json
function getVersion(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Walk up to find package.json
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === '@agent-relay/dashboard') {
          return pkg.version || 'unknown';
        }
      } catch {
        // Continue searching
      }
    }
    dir = dirname(dir);
  }
  return 'unknown';
}

// Parse command line arguments
const args = process.argv.slice(2);

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--version' || arg === '-V') {
    console.log(getVersion());
    process.exit(0);
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Relay Dashboard v${getVersion()}

Web dashboard UI for Agent Relay - visual agent coordination and management.

Usage: relay-dashboard [options]

Options:
  -V, --version            Output the version number
  -h, --help               Show this help message

Note: This package provides the dashboard UI. For the server, use:
  - relay-dashboard-server (standalone server)
  - agent-relay up --dashboard (integrated mode)

Examples:
  relay-dashboard --version    # Show version
  next dev -p 3888             # Run in development mode
  next start -p 3888           # Run in production mode
`);
    process.exit(0);
  }
}

// If no arguments, show help
console.log(`
Relay Dashboard v${getVersion()}

Use --help to see available options.
For the server, use: relay-dashboard-server or agent-relay up --dashboard
`);
