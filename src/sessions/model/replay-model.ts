// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { isToolActivity } from "./activity-summary";

export type ReplayEvent = {
  eventId: string;
  messageId?: string | null;
  stream?: "events" | "turns";
  userId?: string | null;
  ts: string;
  kind: string;
  type: string;
  actorName: string | null;
  actorRole: string | null;
  source: string;
  model: string | null;
  machineId: string;
  content: string | null;
  contentTruncated: boolean;
  taskTitle: string | null;
  projectPath: string | null;
  nativeResumeId: string | null;
  toolUseId: string | null;
  toolName: string | null;
  toolStatus: string | null;
  toolCalls: unknown;
  filesTouched: unknown;
  durationMs: number | null;
};

export type ReplayState = {
  source?: string;
  events: ReplayEvent[];
  streams?: { events: ReplayEvent[]; turns: ReplayEvent[] };
  nextCursor: string | null;
  turnsNextCursor: string | null;
  error: string | null;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function toReplayEvent(value: unknown): ReplayEvent | null {
  if (!isRecord(value)) return null;
  const eventId = str(value.eventId);
  const ts = str(value.ts);
  if (!eventId || !ts || !Number.isFinite(Date.parse(ts))) return null;

  return {
    eventId,
    messageId: str(value.messageId),
    stream: "events",
    userId: str(value.userId),
    ts,
    kind: str(value.kind) ?? "event",
    type: str(value.type) ?? "",
    actorName: str(value.actorName),
    actorRole: str(value.actorRole),
    source: str(value.source) ?? "",
    model: str(value.model),
    machineId: str(value.machineId) ?? "",
    content: str(value.content),
    contentTruncated: value.contentTruncated === true,
    taskTitle: str(value.taskTitle),
    projectPath:
      filesystemPath(value.projectPath) ?? filesystemPath(value.projectId),
    nativeResumeId: null,
    toolUseId:
      str(value.toolUseId) ??
      str(value.tool_use_id) ??
      str(value.callId) ??
      str(value.call_id) ??
      str(value.toolCallId) ??
      str(value.tool_call_id),
    toolName: str(value.toolName),
    toolStatus: str(value.toolStatus),
    toolCalls: value.toolCalls ?? null,
    filesTouched: value.filesTouched ?? null,
    durationMs: nonNegativeNumber(value.durationMs),
  };
}

function filesystemPath(value: unknown): string | null {
  const path = str(value);
  // Canonical owner/repo aliases are not local checkout directories.
  return path && /^(\/|\.\.?\/)/.test(path) ? path : null;
}

const REASONING_TYPES = new Set(["thinking", "reasoning", "agent_reasoning"]);

/**
 * The speaker of a conversational record, or null for tool activity and
 * reasoning. Injected wrappers inside user-role text are display concerns
 * (`displayUserMessage`), so a prompt that begins with one keeps its role.
 */
export function messageRole(event: ReplayEvent): "user" | "assistant" | null {
  if (isToolActivity(event)) return null;
  if (REASONING_TYPES.has(event.type?.toLowerCase())) return null;
  if (event.kind === "prompt" || event.kind === "user") return "user";
  if (event.kind === "assistant") return "assistant";
  // Native deliveries carry the speaker separately from the record kind.
  if (event.kind === "history" || event.kind === "session_event") {
    // A display name is not a role; consult it only after the role fields.
    const role =
      event.actorRole ||
      (event.type === "user" || event.type === "assistant"
        ? event.type
        : event.actorName);
    if (role === "user" || role === "assistant") return role;
  }
  return null;
}

export function toReplayTurn(value: unknown): ReplayEvent | null {
  if (!isRecord(value)) return null;
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const role = str(value.role);
  if (!role || !["user", "assistant", "system"].includes(role)) return null;
  const event = toReplayEvent({
    ...value,
    eventId: str(value.id),
    userId: value.actorRole === "steerer" ? null : str(value.sessionOwner),
    kind: role === "user" ? "prompt" : role,
    type: str(metadata.kind) ?? "",
    source: str(metadata.nativeCli) ?? str(metadata.source),
    model: metadata.model,
    machineId: metadata.originNode,
    projectPath: metadata.projectPath ?? metadata.project,
    toolUseId:
      metadata.toolUseId ??
      metadata.tool_use_id ??
      metadata.callId ??
      metadata.call_id ??
      metadata.toolCallId ??
      metadata.tool_call_id,
    toolName: metadata.toolName,
    toolStatus: metadata.toolStatus,
    toolCalls: metadata.toolCalls,
    filesTouched: metadata.filesTouched,
    durationMs: metadata.durationMs,
  });
  return event
    ? {
        ...event,
        stream: "turns",
        nativeResumeId: str(metadata.nativeResumeId),
      }
    : null;
}

export function mergeReplay(
  events: unknown[],
  turns: unknown[],
): ReplayEvent[] {
  return mergeReplayStreams(
    events.map(toReplayEvent).filter((row): row is ReplayEvent => row !== null),
    turns.map(toReplayTurn).filter((row): row is ReplayEvent => row !== null),
  );
}

export function mergeReplayStreams(
  events: ReplayEvent[],
  turns: ReplayEvent[],
): ReplayEvent[] {
  // IDs identify rows within a stream. Timestamp buckets only pair rows across
  // streams, one-to-one, so simultaneous tool calls or messages are not lost.
  const uniqueEvents = new Map<string, ReplayEvent>();
  for (const event of events) {
    if (event) uniqueEvents.set(event.eventId, event);
  }
  const merged = [...uniqueEvents.values()];
  const candidates = new Map<
    string,
    { indexes: number[]; next: number; common?: ReplayEvent }
  >();
  merged.forEach((event, index) => {
    const key = `${event.kind}:${Date.parse(event.ts)}`;
    const bucket = candidates.get(key);
    if (bucket) bucket.indexes.push(index);
    else candidates.set(key, { indexes: [index], next: 0 });
  });
  for (const bucket of candidates.values()) {
    if (bucket.indexes.length < 2) continue;
    const first = merged[bucket.indexes[0]!]!;
    const same = (field: keyof ReplayEvent) =>
      bucket.indexes.every((index) => merged[index]![field] === first[field]);
    // A timestamp alone cannot identify which event supplied a turn's metadata.
    // Inherit only values shared by every candidate in the tied bucket.
    bucket.common = {
      ...first,
      userId: same("userId") ? first.userId : null,
      messageId: same("messageId") ? first.messageId : null,
      source: same("source") ? first.source : "",
      projectPath: same("projectPath") ? first.projectPath : null,
      model: same("model") ? first.model : null,
      machineId: same("machineId") ? first.machineId : "",
      taskTitle: same("taskTitle") ? first.taskTitle : null,
    };
  }
  const uniqueTurns = new Map<string, ReplayEvent>();
  for (const turn of turns) {
    if (turn) uniqueTurns.set(turn.eventId, turn);
  }
  for (const turn of uniqueTurns.values()) {
    const key = `${turn.kind}:${Date.parse(turn.ts)}`;
    // A cursor preserves FIFO pairing without copying or shifting large buckets.
    const bucket = candidates.get(key);
    const index = bucket && bucket.indexes[bucket.next++];
    if (index === undefined) {
      merged.push(turn);
    } else {
      const existing = merged[index];
      const metadata = bucket?.common ?? existing;
      merged[index] = {
        ...turn,
        userId: turn.userId ?? metadata.userId,
        messageId: turn.messageId ?? metadata.messageId,
        source: turn.source || metadata.source,
        projectPath: turn.projectPath ?? metadata.projectPath,
        model: turn.model ?? metadata.model,
        machineId: turn.machineId || metadata.machineId,
        taskTitle: turn.taskTitle ?? metadata.taskTitle,
      };
    }
  }
  return merged.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** Resume identity belongs to the session, including rows the transcript hides. */
export function replayResumeCommand(
  replay: ReplayState,
  sessionId: string,
): string | null {
  const rows = replay.streams
    ? mergeReplayStreams(replay.streams.events, replay.streams.turns)
    : replay.events;
  return resumeCommand(rows, sessionId);
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

export function resumeCommand(
  events: ReplayEvent[],
  sessionId: string,
): string | null {
  const native = [...events]
    .reverse()
    .find((event) => event.nativeResumeId && event.source);
  const source = native?.source || events.find((event) => event.source)?.source;
  const id = shellQuote(native?.nativeResumeId ?? sessionId);
  let command: string;
  // Mirrors ai-hist-core::resume_command; Codex also gets the requested cwd prefix.
  switch (source) {
    case "claude":
      command = `claude --resume ${id}`;
      break;
    case "codex":
      command = `codex resume ${id}`;
      break;
    case "cursor":
      command = `cursor-agent --resume=${id}`;
      break;
    case "grok":
      command = `grok resume ${id}`;
      break;
    // TODO: Add openai/opencode when ai-hist exposes a native resume command.
    default:
      return null;
  }
  const projectPath = events.find((event) => event.projectPath)?.projectPath;
  return projectPath ? `cd ${shellQuote(projectPath)} && ${command}` : command;
}
