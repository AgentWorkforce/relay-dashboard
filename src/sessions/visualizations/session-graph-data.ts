import {
  isToolResultEvent,
  isToolUseEvent,
  pairToolSteps,
  toolCorrelationId,
} from "../model/activity-summary";
import { messageRole, type ReplayEvent, type ReplayState } from "../model/replay-model";
import { parseToolCall, toolCells } from "../model/transcript-cells";
import {
  recordedPullRequest,
  sessionActivity,
  type SessionFlowRun,
  type SessionRow,
} from "./session-data";

/** A natural History identity is scoped by both provider and session id. */
export function sessionGraphKey(source: string, sessionId: string): string {
  return JSON.stringify([source, sessionId]);
}

export type SessionGraphRelationship =
  | "delegated"
  | "materialized_local"
  | "continuation"
  | "fork"
  | "resume"
  | "unknown";

export type SessionGraphEdge = {
  id: string;
  from: string;
  to: string;
  relationship: SessionGraphRelationship;
  provenance: "catalog_detail" | "catalog_summary" | "replay_spawn_result";
  /** Null when History did not record a spawn time. */
  spawnedAt: string | null;
  childAgentName: string | null;
  childAgentType: string | null;
  evidenceKind?: string | null;
  evidenceRef?: string | null;
  evidenceEventId?: string | null;
  task?: string | null;
};

export type SessionGraphMessage = {
  id: string;
  role: "user" | "assistant";
  ts: string;
  text: string;
  truncated: boolean;
};

export type SessionGraphTool = {
  id: string;
  ts: string;
  name: string;
  status: "succeeded" | "failed" | "unknown";
  /** A recorded result exists; its text can be opened in the session detail. */
  hasResult: boolean;
  toolUseId?: string | null;
};

export type SessionGraphNode = {
  id: string;
  source: string;
  sessionId: string;
  /** False means a relationship names this session outside the loaded page. */
  present: boolean;
  title: string | null;
  autoReview?: boolean;
  agentName?: string | null;
  assignment?: string | null;
  outcome?: string | null;
  /** History's first recorded prompt, available from an exact catalog read. */
  initialRequest: string | null;
  createdAt: string | null;
  lastTs: string | null;
  status: "active" | "idle" | "finished" | "unknown";
  flowRun: SessionFlowRun | null;
  pullRequests: Array<{ url: string; number: string; role?: "creator" | "contributor" | null; evidence?: string | null; toolUseId?: string | null; detectedAt?: string | null }>;
  messages: SessionGraphMessage[];
  tools: SessionGraphTool[];
  catalogStatus: "not_loaded" | "loaded" | "partial" | "unavailable";
  /** The replay may be absent, incomplete, or failed independently of catalog. */
  replayStatus: "not_loaded" | "partial" | "loaded" | "unavailable";
};

export type SessionGraphUnresolved = {
  id: string;
  parent: string;
  relationship: SessionGraphRelationship;
  childAgentName: string | null;
  childAgentType: string | null;
  spawnedAt: string | null;
  task?: string | null;
  /** The provider recorded a relationship without a stable child id. */
  reason: "child_identity_unlinked";
};

/** One exact-session History catalog response, and optionally its replay. */
export type SessionGraphEvidence = {
  source: string;
  sessionId: string;
  /** Undefined means not requested; null means unavailable or not found. */
  catalog?: unknown | null;
  replay?: ReplayState | null;
  /** Exact-session Cloud links after server-side tenant filtering. */
  pullRequests?: Array<{ url: string; role?: "creator" | "contributor" | null; evidence?: string | null; toolUseId?: string | null; detectedAt?: string | null }>;
};

export type SessionGraphHandoff = {
  id: string;
  from: string;
  to: string;
  text: string | null;
  ts: string | null;
  evidenceEventId: string;
  status?: "sent" | "delivered" | "unknown";
};

export type SessionWorkGraph = {
  nodes: SessionGraphNode[];
  edges: SessionGraphEdge[];
  unresolved: SessionGraphUnresolved[];
  handoffs: SessionGraphHandoff[];
  coverage: {
    /** A cursor means more sessions may lie outside this graph window. */
    listHasMore: boolean;
    catalog: "not_loaded" | "partial" | "loaded";
    replay: "not_loaded" | "partial" | "loaded";
  };
};

type CatalogRelationship = {
  relationshipUid: string;
  parentSessionId: string;
  childSessionId: string | null;
  relationship: SessionGraphRelationship;
  childAgentName: string | null;
  childAgentType: string | null;
  spawnedAt: string | null;
  evidenceKind: string | null;
  evidenceRef: string | null;
  task: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): string | null {
  const valueText = text(value);
  return valueText && Number.isFinite(Date.parse(valueText)) ? valueText : null;
}

function relationship(value: unknown): SessionGraphRelationship {
  switch (value) {
    case "delegated":
    case "materialized_local":
    case "continuation":
    case "fork":
    case "resume":
      return value;
    default:
      return "unknown";
  }
}

function catalogEdges(
  value: unknown,
  source: string,
  sessionId: string,
  workspaceId?: string,
): CatalogRelationship[] {
  const detail = record(value);
  // An attested History response must still match the requested natural key.
  if (!validCatalog(detail, source, sessionId, workspaceId)) return [];
  const parents = Array.isArray(detail.parents) ? detail.parents : [];
  const children = Array.isArray(detail.children) ? detail.children : [];
  return [...parents, ...children].flatMap((candidate) => {
    const edge = record(candidate);
    const uid = text(edge?.relationshipUid);
    const parent = text(edge?.parentSessionId);
    const child = text(edge?.childSessionId);
    if (!uid || !parent || (child === null && edge?.childSessionId !== null))
      return [];
    if (parent === child || (parent !== sessionId && child !== sessionId))
      return [];
    return [
      {
        relationshipUid: uid,
        parentSessionId: parent,
        childSessionId: child,
        relationship: relationship(edge?.relationship),
        childAgentName: text(edge?.childAgentName),
        childAgentType: text(edge?.childAgentType),
        spawnedAt: timestamp(edge?.spawnedAt),
        evidenceKind: text(edge?.evidenceKind),
        evidenceRef: text(edge?.evidenceRef),
        task: text(edge?.task),
      },
    ];
  });
}

function validCatalog(
  detail: Record<string, unknown> | null,
  source: string,
  sessionId: string,
  workspaceId?: string,
): detail is Record<string, unknown> {
  return Boolean(
    detail &&
    detail.source === source &&
    detail.sessionId === sessionId &&
    text(detail.workspaceId) &&
    (workspaceId === undefined || detail.workspaceId === workspaceId) &&
    Array.isArray(detail.parents) &&
    Array.isArray(detail.children),
  );
}

function toolStatus(
  value: string | null | undefined,
): SessionGraphTool["status"] {
  switch (value?.toLowerCase()) {
    case "success":
    case "succeeded":
    case "completed":
      return "succeeded";
    case "error":
    case "failed":
    case "failure":
      return "failed";
    default:
      return "unknown";
  }
}

const EVENT_KIND_NAMES = new Set([
  "assistant",
  "session_event",
  "tool_call",
  "tool-call",
  "tool_use",
  "custom_tool_call",
  "mcp_tool_call",
  "function_call",
  "event",
  "history",
]);

function usableToolName(value: unknown): string | null {
  const name = text(value);
  return name &&
    !EVENT_KIND_NAMES.has(name.toLowerCase()) &&
    /^[\w.:-]+(?:\/[\w.:-]+)*$/u.test(name)
    ? name
    : null;
}

function metadataToolName(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const item = record(first);
  return (
    usableToolName(item?.name) ??
    usableToolName(item?.toolName) ??
    usableToolName(record(item?.function)?.name) ??
    usableToolName(record(item?.tool)?.name)
  );
}

function parsedJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  for (const start of [value.indexOf("{"), value.indexOf("[")].filter((at) => at >= 0).sort((a,b) => a-b)) {
    try {
      const parsed: unknown = JSON.parse(value.slice(start));
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      return record(first);
    } catch { /* Other recorded text can surround a JSON value. */ }
  }
  return null;
}

/** Reconcile native calls and assistant projections before assigning results. */
function recordedToolEvents(events: ReplayEvent[]): ReplayEvent[] {
  const messages = new Map<string, ReplayEvent[]>();
  for (const event of events) {
    if (!isToolUseEvent(event)) continue;
    const key = event.messageId ? JSON.stringify(["message", event.messageId])
      : toolCorrelationId(event) ? JSON.stringify(["tool", toolCorrelationId(event)]) : null;
    if (!key) continue;
    const calls = messages.get(key) ?? [];
    calls.push(event);
    messages.set(key, calls);
  }
  const replacements = new Map<ReplayEvent, ReplayEvent>();
  const copies = new Set<ReplayEvent>();
  for (const calls of messages.values()) {
    const correlated = new Map<string, ReplayEvent[]>();
    for (const call of calls) {
      const id = toolCorrelationId(call);
      if (!id) continue;
      const group = correlated.get(id) ?? [];
      group.push(call);
      correlated.set(id, group);
    }
    const uncorrelatedCopies = calls.filter((call) => !toolCorrelationId(call) && call.actorRole === "assistant");
    for (const group of correlated.values()) {
      // Prefer the native record while retaining arguments recorded only in its
      // display projection. A message can contain several distinct native calls.
      const native = [...group].sort((a, b) => Number(Boolean(b.toolUseId)) - Number(Boolean(a.toolUseId))
        || Number(a.actorRole === "assistant") - Number(b.actorRole === "assistant"))[0]!;
      const projections = [...group.filter((call) => call !== native), ...uncorrelatedCopies];
      for (const copy of projections) copies.add(copy);
      // An uncorrelated copy cannot identify which of multiple native calls owns
      // its arguments. Omit that projection rather than inventing a causal edge.
      const donor = group.find((call) => call !== native && callArguments(call))
        ?? (correlated.size === 1 ? uncorrelatedCopies.find((call) => callArguments(call)) : undefined);
      if (!callArguments(native) && donor) replacements.set(native, {
        ...native,
        content: JSON.stringify(callArguments(donor)),
        toolName: native.toolName ?? donor.toolName ?? parseToolCall(donor).name,
      });
    }
  }
  return events.filter((event) => !copies.has(event)).map((event) => replacements.get(event) ?? event);
}

/** Preserve correlation when storage orders a same-timestamp result before its call. */
function pairRecordedToolSteps(events: ReplayEvent[]) {
  return pairToolSteps(recordedToolEvents(events).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)
    || Number(isToolUseEvent(b)) - Number(isToolUseEvent(a))));
}

function callArguments(call: ReplayEvent): Record<string, unknown> | null {
  const metadata = record(Array.isArray(call.toolCalls) ? call.toolCalls[0] : call.toolCalls);
  const raw = metadata?.args ?? metadata?.arguments ?? metadata?.input ?? metadata?.parameters;
  return record(raw) ??
    (typeof raw === "string" ? parsedJson(raw) : null) ??
    parseToolCall(call).args ??
    parsedJson(call.content);
}

function collaborationToolName(call: ReplayEvent): string | null {
  const metadata = record(Array.isArray(call.toolCalls) ? call.toolCalls[0] : call.toolCalls);
  const value = text(call.toolName) ?? text(metadata?.name) ?? text(metadata?.tool) ?? text(parseToolCall(call).name);
  if (!value) return null;
  const leaf = value.split(/[.:/]/u).at(-1)?.toLowerCase();
  if (leaf === "spawn_agent" || leaf === "spawnagent") return "spawn";
  if (leaf === "sendinput" || leaf === "send_input") return "send_input";
  if (leaf === "send_message" || leaf === "send_message_to_thread") return "send_message";
  return null;
}

function exactRecipientIds(args: Record<string, unknown> | null, tool: string): string[] {
  if (!args) return [];
  const array = Array.isArray(args.receiverThreadIds) ? args.receiverThreadIds : [];
  return [...new Set([...array.map(text).filter((id): id is string => id !== null),
    text(args.recipient_id), text(args.threadId), ...(tool === "send_input" ? [text(args.id)] : [])].filter((id): id is string => id !== null))];
}

function exactSpawnSessionId(result: ReplayEvent | null): {id: string; agentIdOnly: boolean} | null {
  const body = parsedJson(result?.content ?? null);
  // A launch response can name its child with either provider spelling.
  const sessionId = text(body?.childSessionId) ?? text(body?.child_session_id) ??
    text(body?.threadId) ?? text(body?.thread_id);
  if (sessionId) return {id: sessionId, agentIdOnly: false};
  const agentId = text(body?.agent_id);
  return agentId ? {id: agentId, agentIdOnly: true} : null;
}

function failedToolResult(result: ReplayEvent | null): boolean {
  if (!result) return false;
  const status = result.toolStatus?.toLowerCase();
  const body = parsedJson(result.content);
  return status === "failed" || status === "failure" || status === "error" || status === "errored" ||
    body?.isError === true || body?.error === true || body?.success === false;
}

/** A tool label must come from its invocation, never its generic event kind. */
function recordedToolLabel(
  call: Parameters<typeof parseToolCall>[0],
  result: Parameters<typeof toolCells>[0]["result"],
): string {
  const fromContent = parseToolCall({ ...call, toolName: null });
  let name =
    usableToolName(call.toolName) ??
    usableToolName(fromContent.name) ??
    metadataToolName(call.toolCalls);
  if (!name && call.content?.trimStart().startsWith("{")) {
    try {
      name = metadataToolName(JSON.parse(call.content));
    } catch {
      /* Recorded text need not be JSON. */
    }
  }
  if (!name) return "Unnamed tool";
  if (EVENT_KIND_NAMES.has(fromContent.name.toLowerCase())) return name;

  const cells = toolCells({ call: { ...call, toolName: name }, result });
  const cell = cells[0];
  const detail = (() => {
    if (!cell) return null;
    if (cell.kind === "exec") return cell.command;
    if (cell.kind === "explored") {
      const first = cell.rows[0];
      return first?.verb === "Read"
        ? first.names.join(", ")
        : first?.verb === "Search"
          ? first.query
          : first?.verb === "List"
            ? first.detail
            : null;
    }
    if (cell.kind === "edited")
      return cell.files.map((file) => file.path).join(", ");
    return null;
  })();
  const command = [
    "exec",
    "exec_command",
    "bash",
    "shell",
    "shell_command",
  ].includes(name.toLowerCase())
    ? (text(fromContent.args?.cmd) ??
      text(fromContent.args?.command) ??
      text(fromContent.args?.input))
    : null;
  const display = detail ?? command;
  return display
    ? `${name} · ${display.replace(/\s+/gu, " ").slice(0, 120)}`
    : name;
}

function replayDetails(
  replay: ReplayState | null | undefined,
  source: string,
): Pick<SessionGraphNode, "messages" | "tools" | "replayStatus"> {
  if (replay === undefined)
    return { messages: [], tools: [], replayStatus: "not_loaded" };
  if (replay === null)
    return { messages: [], tools: [], replayStatus: "unavailable" };
  if (replay.source && replay.source !== source)
    return { messages: [], tools: [], replayStatus: "unavailable" };
  const events = replay.events.filter(
    (event) => !event.source || event.source === source,
  );
  const messages = events.flatMap((event) => {
    const role = messageRole(event);
    const content = text(event.content);
    return role && content
      ? [
          {
            id: event.eventId,
            role,
            ts: event.ts,
            text: content,
            truncated: event.contentTruncated,
          },
        ]
      : [];
  });
  // The merged display timeline can contain turn copies of activity events.
  // Tool causality and toolUseId belong to the raw activity stream.
  const rawToolEvents = (replay.streams?.events ?? replay.events).filter(
    (event) => !event.source || event.source === source,
  );
  const tools = pairRecordedToolSteps(rawToolEvents).map(({ call, result }) => ({
    id: call.eventId,
    ts: call.ts,
    name: recordedToolLabel(call, result),
    status: toolStatus(result?.toolStatus ?? call.toolStatus),
    hasResult: Boolean(result && isToolResultEvent(result)),
    ...(call.toolUseId ? {toolUseId: call.toolUseId} : {}),
  }));
  return {
    messages,
    tools,
    replayStatus: replay.error
      ? events.length
        ? "partial"
        : "unavailable"
      : replay.nextCursor || replay.turnsNextCursor
        ? "partial"
        : "loaded",
  };
}

function placeholder(source: string, sessionId: string): SessionGraphNode {
  return {
    id: sessionGraphKey(source, sessionId),
    source,
    sessionId,
    present: false,
    title: null,
    initialRequest: null,
    createdAt: null,
    lastTs: null,
    status: "unknown",
    flowRun: null,
    pullRequests: [],
    messages: [],
    tools: [],
    catalogStatus: "not_loaded",
    replayStatus: "not_loaded",
  };
}

function pullRequests(
  row: SessionRow | undefined,
  evidence: SessionGraphEvidence | undefined,
): SessionGraphNode["pullRequests"] {
  const seen = new Set<string>();
  const result: SessionGraphNode["pullRequests"] = [];
  for (const candidate of [
    ...(evidence?.pullRequests ?? []),
    ...(row?.pullRequest ? [row.pullRequest] : []),
  ]) {
    // The same strict URL parser protects list and detail links.
    const parsed = recordedPullRequest([candidate]);
    if (!parsed) continue;
    const key = parsed.url.replace(/\/$/u, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...parsed,
      ...(candidate && "role" in candidate ? {role: candidate.role} : {}),
      ...(candidate && "evidence" in candidate ? {evidence: candidate.evidence} : {}),
      ...(candidate && "toolUseId" in candidate ? {toolUseId: candidate.toolUseId} : {}),
      ...(candidate && "detectedAt" in candidate ? {detectedAt: candidate.detectedAt} : {}),
    });
  }
  return result;
}


/**
 * Builds a bounded work graph only from observed History relationships. Shared
 * project, PR, timestamps, and message IDs never imply a session edge.
 */
export function buildSessionWorkGraph(
  rows: SessionRow[],
  evidence: SessionGraphEvidence[] = [],
  options: { listHasMore?: boolean; now?: number; workspaceId?: string } = {},
): SessionWorkGraph {
  const evidenceByKey = new Map(
    evidence.map((item) => [
      sessionGraphKey(item.source, item.sessionId),
      item,
    ]),
  );
  const nodes = new Map<string, SessionGraphNode>();
  const edges = new Map<string, SessionGraphEdge>();
  const unresolved = new Map<string, SessionGraphUnresolved>();
  const handoffs = new Map<string, SessionGraphHandoff>();

  for (const row of rows) {
    if (row.liveOnly) continue;
    const id = sessionGraphKey(row.source, row.sessionId);
    const selectedEvidence = evidenceByKey.get(id);
    const details = replayDetails(selectedEvidence?.replay, row.source);
    const catalog = record(selectedEvidence?.catalog);
    const valid = validCatalog(
      catalog,
      row.source,
      row.sessionId,
      options.workspaceId,
    );
    const catalogStatus =
      selectedEvidence?.catalog === undefined
        ? "not_loaded"
        : valid
          ? catalog.truncated === true
            ? "partial"
            : "loaded"
          : "unavailable";
    nodes.set(id, {
      id,
      source: row.source,
      sessionId: row.sessionId,
      present: true,
      title: row.summary,
      autoReview: row.autoReview === true,
      agentName: valid ? text(record(catalog.catalog)?.agentName) : null,
      assignment: valid ? text(record(catalog.catalog)?.assignment) : null,
      outcome: valid ? text(record(catalog.catalog)?.outcome) : null,
      initialRequest: valid ? text(record(catalog.catalog)?.firstPrompt) : null,
      createdAt: row.createdAt ?? null,
      lastTs: row.lastTs,
      status: row.workState
        ? sessionActivity(row, options.now ?? Date.now())
        : "unknown",
      flowRun: row.flowRun ?? null,
      pullRequests: pullRequests(row, selectedEvidence),
      catalogStatus,
      ...details,
    });
  }

  // A contextual focus can be outside the current list page. Exact evidence
  // from the authenticated action enriches a placeholder without inventing a
  // list row or marking the session as part of the loaded page.
  for (const item of evidence) {
    const id = sessionGraphKey(item.source, item.sessionId);
    if (nodes.has(id)) continue;
    const catalog = record(item.catalog);
    const valid = validCatalog(catalog, item.source, item.sessionId, options.workspaceId);
    const replayValid = item.replay &&
      (!item.replay.source || item.replay.source === item.source) &&
      item.replay.events.some((event) => !event.source || event.source === item.source);
    if (!valid && !replayValid) continue;
    nodes.set(id, {
      ...placeholder(item.source, item.sessionId),
      initialRequest: valid ? text(record(catalog.catalog)?.firstPrompt) : null,
      title: valid ? text(record(catalog.catalog)?.title) : null,
      agentName: valid ? text(record(catalog.catalog)?.agentName) : null,
      assignment: valid ? text(record(catalog.catalog)?.assignment) : null,
      outcome: valid ? text(record(catalog.catalog)?.outcome) : null,
      pullRequests: pullRequests(undefined, item),
      catalogStatus: valid ? catalog.truncated === true ? "partial" : "loaded" : item.catalog === undefined ? "not_loaded" : "unavailable",
      ...replayDetails(item.replay, item.source),
    });
  }

  const addNode = (source: string, sessionId: string) => {
    const id = sessionGraphKey(source, sessionId);
    if (!nodes.has(id)) nodes.set(id, placeholder(source, sessionId));
    return id;
  };
  for (const item of evidence) {
    const ownerId = sessionGraphKey(item.source, item.sessionId);
    if (
      !nodes.has(ownerId) ||
      item.catalog === undefined ||
      item.catalog === null
    )
      continue;
    const detail = record(item.catalog);
    if (!validCatalog(detail, item.source, item.sessionId, options.workspaceId))
      continue;
    for (const edge of catalogEdges(
      item.catalog,
      item.source,
      item.sessionId,
      options.workspaceId,
    )) {
      const from = addNode(item.source, edge.parentSessionId);
      if (edge.childSessionId === null) {
        const id = JSON.stringify([
          "unlinked",
          item.source,
          edge.parentSessionId,
          edge.relationshipUid,
        ]);
        unresolved.set(id, {
          id,
          parent: from,
          relationship: edge.relationship,
          childAgentName: edge.childAgentName,
          childAgentType: edge.childAgentType,
          spawnedAt: edge.spawnedAt,
          task: edge.task,
          reason: "child_identity_unlinked",
        });
        continue;
      }
      const to = addNode(item.source, edge.childSessionId);
      const childNode = nodes.get(to)!;
      if (!childNode.agentName && edge.childAgentName) childNode.agentName = edge.childAgentName;
      if (!childNode.assignment && edge.task) childNode.assignment = edge.task;
      const id = JSON.stringify([
        "detail",
        item.source,
        edge.parentSessionId,
        edge.relationshipUid,
      ]);
      edges.set(id, {
        id,
        from,
        to,
        relationship: edge.relationship,
        provenance: "catalog_detail",
        spawnedAt: edge.spawnedAt,
        childAgentName: edge.childAgentName,
        childAgentType: edge.childAgentType,
        evidenceKind: edge.evidenceKind,
        evidenceRef: edge.evidenceRef,
        task: edge.task,
      });
    }
  }

  // Collect the exact raw event stream for every authenticated owner first.
  // Discover all spawn identities before resolving messages, so input order
  // cannot decide whether a recorded recipient is known.
  const replaySteps = evidence.flatMap((item) => {
    const from = sessionGraphKey(item.source, item.sessionId);
    if (!nodes.has(from) || !item.replay ||
      (item.replay.source && item.replay.source !== item.source)) return [];
    const events = (item.replay.streams?.events ?? item.replay.events).filter((event) => !event.source || event.source === item.source);
    const owner = nodes.get(from)!;
    if (!owner.agentName) owner.agentName = events
      .filter((event) => event.actorRole === "assistant" || event.actorRole === "agent")
      .map((event) => text(event.actorName)).find((name) => name !== null) ?? null;
    return pairRecordedToolSteps(events).map(({call, result}) => ({item, from, call, result, name: collaborationToolName(call), args: callArguments(call)}));
  });
  for (const {item, from, call, result, name, args} of replaySteps) {
      if (name === "spawn" && result && isToolResultEvent(result) && !failedToolResult(result) && toolCorrelationId(call) && toolCorrelationId(result) === toolCorrelationId(call)) {
        const child = exactSpawnSessionId(result);
        if (child && child.id !== item.sessionId && (!child.agentIdOnly || item.source === "codex")) {
          const to = addNode(item.source, child.id);
          const childNode = nodes.get(to)!;
          if (!childNode.agentName) childNode.agentName = text(args?.name);
          if (!childNode.assignment) childNode.assignment = text(args?.message);
          const id = JSON.stringify(["spawn", item.source, item.sessionId, call.eventId, child.id]);
          if (![...edges.values()].some((edge) => edge.from === from && edge.to === to))
            edges.set(id, {id, from, to, relationship: "delegated", provenance: "replay_spawn_result",
              spawnedAt: timestamp(call.ts), childAgentName: text(args?.name), childAgentType: text(args?.agent_type),
              evidenceEventId: result.eventId, task: text(args?.message)});
        }
      }
  }
  // A handoff refers only to an existing exact node identity. Its recipient
  // can be off the current list page, but an unknown alias creates no node.
  for (const {item, from, call, result, name, args} of replaySteps) {
      if ((name === "send_message" || name === "send_input") && !failedToolResult(result)) {
        for (const recipient of exactRecipientIds(args, name)) {
          if (recipient === item.sessionId) continue;
          const to = sessionGraphKey(item.source, recipient);
          if (!nodes.has(to)) continue;
          const id = JSON.stringify(["handoff", item.source, item.sessionId, call.eventId, recipient]);
          handoffs.set(id, {id, from, to, text: text(args?.message) ?? text(args?.prompt), ts: timestamp(call.ts),
            evidenceEventId: call.eventId, status: result && isToolResultEvent(result) && parsedJson(result.content)?.delivered === true ? "delivered" : result && isToolResultEvent(result) ? "sent" : "unknown"});
        }
      }
  }

  // The list catalog carries observed parent identities but no relationship
  // kind. Suppress these summary edges when a detail edge identifies the pair.
  for (const row of rows) {
    if (row.liveOnly || !text(row.source) || row.source === "—") continue;
    const to = sessionGraphKey(row.source, row.sessionId);
    for (const parent of row.parentSessionIds ?? []) {
      if (!text(parent) || parent === row.sessionId) continue;
      const from = sessionGraphKey(row.source, parent);
      if (
        [...edges.values()].some((edge) => edge.from === from && edge.to === to)
      )
        continue;
      // A complete child catalog is authoritative; a truncated one cannot
      // disprove parent IDs omitted from its bounded relationship list.
      if (nodes.get(to)?.catalogStatus === "loaded") continue;
      addNode(row.source, parent);
      const id = JSON.stringify(["summary", row.source, parent, row.sessionId]);
      edges.set(id, {
        id,
        from,
        to,
        relationship: "unknown",
        provenance: "catalog_summary",
        spawnedAt: null,
        childAgentName: null,
        childAgentType: null,
      });
    }
  }

  const present = [...nodes.values()].filter((node) => node.present);
  const loadedCatalogs = present.filter(
    (node) => node.catalogStatus === "loaded",
  ).length;
  const partialCatalogs = present.filter(
    (node) => node.catalogStatus === "partial",
  ).length;
  const loadedReplays = present.filter(
    (node) => node.replayStatus === "loaded",
  ).length;
  const partialReplays = present.filter(
    (node) => node.replayStatus === "partial",
  ).length;
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    unresolved: [...unresolved.values()],
    handoffs: [...handoffs.values()],
    coverage: {
      listHasMore: options.listHasMore === true,
      catalog:
        loadedCatalogs + partialCatalogs === 0
          ? "not_loaded"
          : loadedCatalogs === present.length
            ? "loaded"
            : "partial",
      replay:
        loadedReplays + partialReplays === 0
          ? "not_loaded"
          : loadedReplays === present.length
            ? "loaded"
            : "partial",
    },
  };
}
