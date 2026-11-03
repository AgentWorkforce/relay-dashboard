// Session row presentation, following the hosted dashboard's
// session-table-data.ts (labels, work status, attribution).
import { displayUserMessage } from "./model/transcript-display";

export type WorkState = {
  status: "active" | "idle" | "finished";
  updatedAt: string;
};

export type Member = { id: string; name: string | null };

export type SessionRow = {
  sessionId: string;
  source: string;
  title: string | null;
  summary: string | null;
  projectId: string | null;
  project: { name: string } | null;
  firstTs: string | null;
  lastTs: string | null;
  eventCount: number | null;
  userIds: string[];
  models: string[];
  machineIds: string[];
  workState: WorkState | null;
  parentSessionIds: string[];
  childSessionCount: number;
  gitBranch: string | null;
  repoUrl: string | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  search: { snippet: string | null; matchedBy: string[] } | null;
};

export const tools: Record<string, { label: string; color: string }> = {
  claude: { label: "Claude Code", color: "#d97745" },
  codex: { label: "Codex", color: "#4a90e2" },
  devin: { label: "Devin", color: "#5bb98c" },
  gemini: { label: "Gemini CLI", color: "#8b78da" },
  cursor: { label: "Cursor", color: "#43a99a" },
  opencode: { label: "OpenCode", color: "#ba9055" },
  grok: { label: "Grok", color: "#737373" },
  muse: { label: "Muse", color: "#c76fa8" },
  capy: { label: "Capy", color: "#7f9c4a" },
};
const aliases: Record<string, string> = {
  "claude-code": "claude",
  "claude-terminal": "claude",
  "claude-cloud": "claude",
};
export const toolKey = (source: string) => aliases[source] ?? source;
export const harnessName = (source: string) =>
  tools[toolKey(source)]?.label ?? source;
export const toolColor = (source: string) =>
  tools[toolKey(source)]?.color ?? "#9ca3af";

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item)
    : [];
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function recordedWorkState(value: unknown): WorkState | null {
  if (!isRecord(value)) return null;
  return (value.status === "active" ||
    value.status === "idle" ||
    value.status === "finished") &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt))
    ? { status: value.status, updatedAt: value.updatedAt }
    : null;
}

/** Map a RelayHistory session summary onto a dashboard row. */
export function sessionRow(value: Record<string, unknown>): SessionRow {
  const catalog = isRecord(value.catalog) ? value.catalog : {};
  const project = isRecord(value.project) ? text(value.project.name) : null;
  const search = isRecord(value.search) ? value.search : null;
  return {
    sessionId: String(value.sessionId),
    source: String(value.source),
    title: text(catalog.title) ?? text(value.title),
    summary: text(value.summary) ?? text(value.taskTitle),
    projectId: text(value.projectId),
    project: project ? { name: project } : null,
    firstTs: text(value.firstTs) ?? text(catalog.firstActivityAt),
    lastTs: text(value.lastTs) ?? text(catalog.lastActivityAt),
    eventCount: count(value.eventCount),
    userIds: strings(value.userIds),
    models: strings(value.models).length
      ? strings(value.models)
      : strings(catalog.models),
    machineIds: strings(value.machineIds),
    workState: recordedWorkState(value.workState),
    parentSessionIds: strings(catalog.parentSessionIds),
    childSessionCount: count(catalog.childSessionCount) ?? 0,
    gitBranch: text(catalog.gitBranch),
    repoUrl: text(catalog.repoUrl),
    totalInputTokens: count(value.totalInputTokens),
    totalOutputTokens: count(value.totalOutputTokens),
    search: search
      ? { snippet: text(search.snippet), matchedBy: strings(search.matchedBy) }
      : null,
  };
}

/** Generated title first, then the recorded summary, as hosted does. */
export function sessionTitle(row: SessionRow): string {
  const summary = row.summary ? displayUserMessage(row.summary) : null;
  const fromSummary =
    summary?.kind === "prompt" ? summary.text.trim() : row.summary?.trim();
  const title = row.title || fromSummary || "";
  const line =
    title
      .split("\n")
      .find((part) => part.trim())
      ?.trim() ?? "";
  return line.length > 140
    ? `${line.slice(0, 139)}…`
    : line || "Untitled session";
}

export const projectName = (row: SessionRow) =>
  row.project?.name ?? row.projectId ?? null;

/** Work status: recorded finished/idle, else active within five minutes. */
export function sessionActivity(row: SessionRow, now: number) {
  const state = row.workState;
  if (state?.status === "finished") return "finished" as const;
  if (state?.status === "idle") return "idle" as const;
  const time = state ? Date.parse(state.updatedAt) : NaN;
  return Number.isFinite(time) && time <= now + 60_000 && now - time < 300_000
    ? ("active" as const)
    : ("idle" as const);
}

export const workStates = {
  active: {
    label: "Active",
    description: "Work activity recorded in the last 5 minutes",
  },
  idle: {
    label: "Idle",
    description:
      "No recent work activity, or the session is paused or waiting; completion has not been recorded",
  },
  finished: {
    label: "Finished",
    description: "The latest recorded work state indicates completion",
  },
} as const;

export const sessionKey = (row: { source: string; sessionId: string }) =>
  JSON.stringify([row.source, row.sessionId]);

export function memberNames(ids: string[], members: Member[]): string[] {
  const byId = new Map(members.map((member) => [member.id, member.name]));
  return ids.map((id) => byId.get(id) || "Unknown teammate");
}

export function shortDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function dateTime(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
