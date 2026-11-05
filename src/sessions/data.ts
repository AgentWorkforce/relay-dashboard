// Session row presentation, following the hosted dashboard's
// session-table-data.ts (labels, work status, attribution).
import {
  displayUserMessage,
  promptTitleText,
} from "./model/transcript-display";

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
  shortSummary: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectKey: string | null;
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

// Colors are brand.css tokens, so they follow the light and dark themes.
export const tools: Record<string, { label: string; color: string }> = {
  claude: { label: "Claude Code", color: "var(--harness-claude)" },
  codex: { label: "Codex", color: "var(--harness-codex)" },
  devin: { label: "Devin", color: "var(--harness-devin)" },
  gemini: { label: "Gemini CLI", color: "var(--harness-gemini)" },
  cursor: { label: "Cursor", color: "var(--harness-cursor)" },
  opencode: { label: "OpenCode", color: "var(--harness-opencode)" },
  grok: { label: "Grok", color: "var(--harness-grok)" },
  muse: { label: "Muse", color: "var(--harness-muse)" },
  capy: { label: "Capy", color: "var(--harness-capy)" },
};
const aliases: Record<string, string> = {
  "claude-code": "claude",
  "claude-terminal": "claude",
  "claude-cloud": "claude",
};
export const toolKey = (source: string) => aliases[source] ?? source;
/** Every raw source that shares this harness key (itself included). */
export const harnessSources = (key: string) => [
  key,
  ...Object.keys(aliases).filter((alias) => aliases[alias] === key),
];
export const harnessName = (source: string) =>
  tools[toolKey(source)]?.label ?? source;
export const toolColor = (source: string) =>
  tools[toolKey(source)]?.color ?? "var(--harness-other)";

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
    summary: text(value.summary),
    shortSummary: text(value.shortSummary),
    taskTitle: text(value.taskTitle),
    projectId: text(value.projectId),
    projectKey:
      catalog.projectKeyMethod === "path" ? null : text(catalog.projectKey),
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

/**
 * A one-line label from recorded prompt text, skipping injected wrappers
 * (system reminders, slash-command blocks, "Caveat:" preambles, AGENTS.md and
 * environment context, pasted-content tags). Mirrors the hosted
 * session-presentation `shortLabel`; null when nothing a person typed remains.
 */
export function promptLabel(value: unknown, max = 90): string | null {
  const raw = text(value);
  if (!raw) return null;
  const display = displayUserMessage(
    raw.replace(/^## My request(?: for Codex)?:\s*\n/, ""),
  );
  if (display.kind !== "prompt") return null;
  const cleaned = promptTitleText(display.text)
    .replace(
      /<(environment_context|INSTRUCTIONS|system-reminder|user_instructions|command-name|command-message|command-args|local-command-stdout|local-command-stderr)>[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(/<\/?pasted[_-]content[^>]*>/gi, "");
  const line = cleaned
    .split(/\r?\n/)
    .map((part) =>
      part
        .replace(/^\s*#+\s*/, "")
        // Agent Relay deliveries: "Relay message from <sender> [<id>]: <text>".
        .replace(/^Relay message from [^:\n]+?(?:\s*\[[^\]\n]+\])?:\s*/i, "")
        // A relayed task often opens with "Repo: owner/name." before the ask.
        .replace(/^Repo:\s*\S+?\.?\s+(?=\S)/i, "")
        .trim(),
    )
    .find(
      (part) =>
        part &&
        !/^(?:<|\[Image:|AGENTS\.md instructions|Files mentioned by the user|My request:|INSTRUCTIONS|Image attachment:|Repo:|cwd[:>]|Caveat:)/i.test(
          part,
        ),
    );
  if (!line) return null;
  let compact = line.replace(/\s+/g, " ");
  // A long ask reads better as its first sentence than as a cut-off line.
  const sentence = /^(.{12,}?[.!?])\s/.exec(compact)?.[1];
  if (compact.length > max && sentence && sentence.length <= max)
    compact = sentence;
  return compact.length <= max
    ? compact
    : `${compact.slice(0, max - 3).trimEnd()}…`;
}

/** Hosted order: generated title, task title, then the recorded summary. */
export function sessionTitle(row: SessionRow): string {
  return (
    promptLabel(row.title, 160) ??
    promptLabel(row.taskTitle, 160) ??
    promptLabel(row.summary, 160) ??
    `${projectLabel(row)?.name ?? "Session"} · ${row.sessionId.slice(0, 8)}`
  );
}

const normalizePath = (value: string) =>
  value.replace(/\\/g, "/").replace(/\/+$/, "");
const isLocalPath = (value: string) =>
  /^(?:\/|~\/|[A-Za-z]:\/)/.test(normalizePath(value));

/** Short project name: owner/repo for remotes, the checkout's last two folders for paths. */
export function shortProject(value: string): string {
  const path = normalizePath(value);
  const remote =
    /^(?:https?:\/\/|git@)[^/:]+[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(path) ??
    /^(?:github|gitlab|bitbucket)\.(?:com|org)\/([^/]+\/[^/]+?)(?:\.git)?$/i.exec(
      path,
    );
  if (remote) return remote[1]!;
  if (!isLocalPath(path)) return path;
  // A worktree or tool folder (".claude/worktrees", ".relayflow/…") lives inside its checkout.
  const segments = path.split("/").filter(Boolean);
  const hidden = segments.findIndex((segment) => segment.startsWith("."));
  const checkout = hidden > 0 ? segments.slice(0, hidden) : segments;
  return checkout.slice(-2).join("/") || path;
}

/** Display name and full detail (for a tooltip) of a session's project. */
export function projectLabel(
  row: SessionRow,
): { name: string; detail: string } | null {
  const detail =
    row.repoUrl ?? row.projectKey ?? row.project?.name ?? row.projectId;
  return detail ? { name: shortProject(detail), detail } : null;
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
