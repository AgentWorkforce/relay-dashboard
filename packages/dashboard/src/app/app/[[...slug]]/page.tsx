/**
 * Catch-all route for /app/* URLs
 *
 * Handles deep links like:
 * - /app/agent/Leader
 * - /app/channel/general
 * - /app/settings/workspace
 *
 * The actual routing is handled client-side by useUrlRouting hook.
 */

export { default } from '../page';
