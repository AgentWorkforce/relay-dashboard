/**
 * Dashboard Configuration
 *
 * Centralized configuration for API and WebSocket URLs.
 * Works out-of-the-box with sensible defaults - no configuration required.
 *
 * Defaults (no env vars needed):
 * - Development: WebSocket connects to localhost:3889 (dashboard server)
 * - Production: WebSocket auto-detects from page URL (same host/port)
 * - API: Uses relative URLs (works for same-origin requests)
 *
 * Optional overrides (for advanced deployments):
 * - NEXT_PUBLIC_WS_URL: Override WebSocket URL entirely
 * - NEXT_PUBLIC_API_URL: Override API base URL
 * - NEXT_PUBLIC_DEV_SERVER_PORT: Change dev server port (default: 3889)
 */

// Default port for dashboard server in development
const DEFAULT_DEV_SERVER_PORT = '3889';

/**
 * Get the configured dev server port
 */
function getDevServerPort(): string {
  return process.env.NEXT_PUBLIC_DEV_SERVER_PORT || DEFAULT_DEV_SERVER_PORT;
}

/**
 * Check if we're in development mode
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Check if we're running in the browser
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Get the WebSocket URL for the main dashboard connection
 *
 * Priority:
 * 1. NEXT_PUBLIC_WS_URL environment variable
 * 2. Development mode: connect to dev server port
 * 3. Production: auto-detect from page URL
 */
export function getWebSocketUrl(path: string = '/ws'): string {
  // Check for explicit environment variable
  const envWsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envWsUrl) {
    // Append path if base URL provided
    return envWsUrl.endsWith('/') ? `${envWsUrl.slice(0, -1)}${path}` : `${envWsUrl}${path}`;
  }

  // SSR fallback - return localhost with dev port
  if (!isBrowser()) {
    const port = getDevServerPort();
    return `ws://localhost:${port}${path}`;
  }

  const host = window.location.hostname || 'localhost';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  // Development mode: Next.js on 3888, dashboard server on dev port (3889)
  // Next.js rewrites don't support WebSocket upgrade, so connect directly
  if (isDevelopment() && window.location.port === '3888') {
    const devPort = getDevServerPort();
    return `ws://${host}:${devPort}${path}`;
  }

  // Production: use same host/port as the page
  return `${protocol}//${window.location.host}${path}`;
}

/**
 * Get the API base URL
 *
 * Priority:
 * 1. NEXT_PUBLIC_API_URL environment variable
 * 2. Empty string (relative URLs) - works for same-origin
 */
export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || '';
}

/**
 * Configuration object for easy access
 */
export const config = {
  /** Get WebSocket URL for a given path */
  getWebSocketUrl,

  /** Get API base URL */
  getApiBaseUrl,

  /** Check if in development mode */
  isDevelopment,

  /** Check if in browser */
  isBrowser,

  /** Dev server port */
  devServerPort: getDevServerPort(),
};

export default config;
