import type { Session } from "./api/contracts";
export const harnessNames: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  gemini: "Gemini",
  pi: "Pi",
  devin: "Devin",
  "claude-code": "Claude Code",
};
export const harnessName = (source: string) => harnessNames[source] || source;
export const sessionKey = (session: Session) =>
  JSON.stringify([session.source, session.sessionId]);
export function sessionStatus(session: Session, now = Date.now()) {
  if (session.workState?.status === "finished") return "Finished";
  if (
    session.workState?.status === "active" &&
    now - Date.parse(session.workState.updatedAt) < 5 * 60_000
  )
    return "Active";
  if (
    session.workState?.status === "idle" ||
    session.workState?.status === "active"
  )
    return "Idle";
  return "Recorded";
}
export function relativeTime(
  value: string | null | undefined,
  now = Date.now(),
) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "—";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export function replayUrl(origin: string, workspace: string, session: Session) {
  const url = new URL(
    `/cloud/dashboard/sessions/${encodeURIComponent(session.sessionId)}`,
    origin,
  );
  url.searchParams.set("source", session.source);
  url.searchParams.set("workspace", workspace);
  return url.toString();
}
export function uniqueSessions(pages: { items: Session[] }[]) {
  return Array.from(
    new Map(
      pages
        .flatMap((page) => page.items)
        .map((session) => [sessionKey(session), session]),
    ).values(),
  );
}
