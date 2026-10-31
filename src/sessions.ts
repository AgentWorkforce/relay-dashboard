import type { Session } from "./api/contracts";
const names: Record<string, string> = {
  claude: "Claude Code",
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  gemini: "Gemini",
};
export const harnessName = (source: string) => names[source] || source;
export const sessionKey = (row: Session) =>
  JSON.stringify([row.source, row.sessionId]);
export function conversationUrl(workspace: string, row: Session) {
  const query = new URLSearchParams({ workspace, source: row.source });
  return `/cloud/dashboard/sessions/${encodeURIComponent(row.sessionId)}?${query}`;
}
export function sessionDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
