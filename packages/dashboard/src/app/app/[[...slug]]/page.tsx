/**
 * Catch-all route for /app/* URLs (Server Component wrapper)
 *
 * Handles all /app routes including:
 * - /app (base route)
 * - /app/agent/Leader
 * - /app/channel/general
 * - /app/settings/workspace
 *
 * The actual routing is handled client-side by useUrlRouting hook.
 */

import DashboardPageClient from './DashboardPageClient';

// Required for static export with optional catch-all routes
// Return one entry for the base /app route - subsequent routing is client-side
export function generateStaticParams() {
  return [{ slug: undefined }];
}

export default function DashboardPage() {
  return <DashboardPageClient />;
}
