// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
/** Presentation only. Work/wait measurements and action timestamps come from
 * the authoritative History timing endpoint, never a partial replay page.
 */
function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatSessionDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms === 0) return "0s";
  if (ms < 1_000) return `${Math.max(1, Math.round(ms))}ms`;
  const seconds = Math.round(ms / 1_000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor(seconds / 60);
  if (days) return `${days}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
  if (hours) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  if (minutes) return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
  return `${seconds}s`;
}

export function formatRelativeTime(value: string, now: number): string {
  const at = timestamp(value);
  if (at === null || !Number.isFinite(now)) return "—";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60)
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
