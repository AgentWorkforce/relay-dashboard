import { sessionTitle, tools, type SessionRow as DashboardRow } from "../data";
export { tools };
export type SessionMember = { id: string; name: string | null; avatarUrl?: string | null };
export type SessionFlowRun = { runId: string; flowAgentId: string | null; flowName: string | null };
export type SessionRow = {
  sessionId: string; source: string; summary: string | null; projectId: string | null;
  lastTs: string | null; eventCount: number | null; userIds: string[];
  parentSessionIds?: string[]; autoReview?: boolean; liveOnly?: boolean;
  model?: string | null; createdAt?: string | null;
  project?: { name: string; key?: string | null } | null;
  workState?: { status: "active" | "idle" | "finished"; updatedAt: string } | null;
  pullRequest: { url: string; number: string } | null; flowRun?: SessionFlowRun | null;
};
type SessionWorkState = NonNullable<SessionRow["workState"]>;
export function graphRow(row: DashboardRow): SessionRow {
  return { ...row, summary: sessionTitle(row), createdAt: row.firstTs, model: row.models.join(", "), pullRequest: row.pullRequest ?? null, autoReview: row.source === "codex" && row.models.includes("codex-auto-review") };
}

export function sessionActivity(
  item: SessionRow,
  now: number,
): SessionWorkState["status"] {
  const state = item.workState;
  if (state?.status === "finished") return "finished";
  if (state?.status === "idle") return "idle";
  const time = state ? Date.parse(state.updatedAt) : NaN;
  return Number.isFinite(time) && time <= now + 60_000 && now - time < 300_000
    ? "active"
    : "idle";
}

export function relativeTime(value: string | null, now: number) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  const days = Math.floor(minutes / 1440);
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function exactTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export { recordedPullRequest } from "../model/recorded-pull-request";
