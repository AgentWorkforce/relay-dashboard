#!/usr/bin/env node
/**
 * Relay Dashboard Server Entry Point
 *
 * Start the dashboard server from the command line.
 */

import { startServer } from './server.js';

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
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Relay Dashboard Server

Usage: relay-dashboard [options]

Options:
  -p, --port <port>        Port to listen on (default: 3888, env: PORT)
  -r, --relay-url <url>    Relay daemon URL (default: http://localhost:3889, env: RELAY_URL)
  -s, --static-dir <path>  Static files directory (default: ./out, env: STATIC_DIR)
  -v, --verbose            Enable verbose logging (env: VERBOSE=true)
  -h, --help               Show this help message
`);
    process.exit(0);
  }
}

// Start the server
startServer({
  port: options.port ? parseInt(options.port as string, 10) : undefined,
  relayUrl: options.relayUrl as string | undefined,
  staticDir: options.staticDir as string | undefined,
  verbose: options.verbose as boolean | undefined,
}).catch((err) => {
  console.error('Failed to start dashboard server:', err);
  process.exit(1);
});
