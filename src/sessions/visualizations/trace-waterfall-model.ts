// Ported from Cloud session visualizations, including copy/anchor and embedded-ID repairs through de79917c3.
import { isNativeToolUseEvent, isToolActivity, isToolUseEvent, pairToolSteps, toolArgumentsForComparison, toolCorrelationId } from "../model/activity-summary";
import { isRecord, messageRole, type ReplayEvent } from "../model/replay-model";
import { isCodexAutoReview } from "./session-auto-review";
import { commandLabel, messageLabel, namedFiles, toolActionLabel } from "./trace-labels";
import { buildTranscript, parseToolCall, toolCells, transcriptCellAnchor, type TranscriptCell } from "../model/transcript-cells";

export type TraceStep = {
  id: string;
  kind: "prompt" | "reply" | "tool";
  source?: string;
  label: string;
  detail: string | null;
  output?: string | null;
  /** Parsed from the same native/display-copy event used to render the trace. */
  toolCall?: ReturnType<typeof parseToolCall>;
  at: number;
  end: number | null;
  anchor: string | null;
  failed: boolean;
};

export type TraceExchange = {
  id: string;
  label: string;
  start: number;
  end: number;
  /** Request identity survives the display-row budget. */
  prompt?: TraceStep;
  steps: TraceStep[];
};

export type TraceWaterfallData = {
  exchanges: TraceExchange[];
  start: number;
  end: number;
  omittedExchanges: number;
  omittedSteps: number;
};

const MAX_EXCHANGES = 24;
const MAX_STEPS = 240;

function excerpt(value: string | null, fallback: string): string {
  const clean = value?.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 180) : fallback;
}

function requestLabel(text: string): string {
  return /^<ci-monitor-event(?:\s|>)/i.test(text.trim()) ? "Review PR feedback" : text.replace(/\s+/g, " ").trim() || "Request";
}

const APPROVAL_REVIEW_PREFIX = "The following is the Codex agent history added since your last approval assessment.";

function approvalReviewPrompt(event: ReplayEvent, text: string): boolean {
  return event.source === "codex" && (isCodexAutoReview(event) || text.startsWith(APPROVAL_REVIEW_PREFIX)
    || text.startsWith("The following is the Codex agent history whose request action you are assessing."));
}

/** Only inspect command keys inside Codex's known approval-review wrapper. */
function approvalCommand(text: string): string | null {
  // The initial wrapper contains the entire history, including unrelated commands.
  if (!text.startsWith(APPROVAL_REVIEW_PREFIX)) return null;
  const literal = /"(?:cmd|command)"\s*:\s*("(?:\\.|[^"\\])*")/.exec(text)?.[1];
  if (!literal) return null;
  try {
    const command: unknown = JSON.parse(literal);
    return typeof command === "string" && command.trim() ? command : null;
  } catch {
    return null;
  }
}

function approvalOutcome(text: string): { label: string; rationale: string | null } | null {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value)) return null;
  const outcome = value.outcome;
  const label = outcome === "allow" ? "Allowed action" :
    outcome === "deny" || outcome === "block" || outcome === "reject" ? "Blocked action" : null;
  if (!label) return null;
  const rationale = typeof value.rationale === "string" && value.rationale.trim() ? value.rationale.trim() : null;
  return { label, rationale };
}

function startsExchange(cell: TranscriptCell): boolean {
  return cell.startsExchange === true || (cell.kind === "user" && cell.startsExchange !== false);
}

function toolLabel(call: ReplayEvent, cells: ReturnType<typeof toolCells>): string {
  const tool = parseToolCall(call);
  const cell = cells[0];
  if (!cell) return toolActionLabel(tool.name, tool.args);
  switch (cell.kind) {
    case "exec": return commandLabel(cell.command);
    case "explored": {
      const row = cell.rows[0];
      if (!row) return "Inspect files";
      if (row.verb === "Read") return namedFiles("Read", row.names);
      if (row.verb === "Search") return "Search project files";
      return "Inspect project folders";
    }
    case "edited": return namedFiles("Edit", cell.files.map((file) => file.path));
    case "notice": return cell.text.includes("Waited") ? "Wait for command to finish" : "Send terminal input";
    case "web": return /search/i.test(cell.action) ? "Search the web" : "Read web page";
    case "plan": return "Update work plan";
    default: return toolActionLabel(tool.name, tool.args);
  }
}

/** Compare recorded JSON without depending on object-key order. */
function sameRecordedValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => sameRecordedValue(value, b[index]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(b, key) && sameRecordedValue(a[key], b[key]));
}

/** The waterfall only uses recorded instants. A result closes a tool interval;
 * a lone call remains a point even when later events exist. */
export function buildTraceWaterfall(events: ReplayEvent[], transcript?: TranscriptCell[]): TraceWaterfallData {
  const nativeToolIds = new Map<string, Set<string>>();
  const nativesByMessage = new Map<string, ReplayEvent[]>();
  for (const event of events) {
    if (!event.messageId || !isNativeToolUseEvent(event)) continue;
    const natives = nativesByMessage.get(event.messageId) ?? [];
    natives.push(event);
    nativesByMessage.set(event.messageId, natives);
    const id = toolCorrelationId(event);
    if (!id) continue;
    const ids = nativeToolIds.get(event.messageId) ?? new Set<string>();
    ids.add(id);
    nativeToolIds.set(event.messageId, ids);
  }
  const isIdentifiedCopy = (event: ReplayEvent): boolean => {
    if (!event.messageId || isNativeToolUseEvent(event) || event.actorRole !== "assistant") return false;
    const id = toolCorrelationId(event);
    return id !== null && nativeToolIds.get(event.messageId)?.has(id) === true;
  };
  // A matching ID establishes copy identity, including repeated copies.
  const displayCopies = events.filter((event) => isIdentifiedCopy(event) && isToolUseEvent(event));
  const identifiedCopies = new Map<string, Map<string, ReplayEvent[]>>();
  for (const copy of displayCopies) {
    const copies = identifiedCopies.get(copy.messageId!) ?? new Map<string, ReplayEvent[]>();
    const id = toolCorrelationId(copy)!;
    const records = copies.get(id) ?? [];
    records.push(copy);
    copies.set(id, records);
    identifiedCopies.set(copy.messageId!, copies);
  }
  const identifiedCopiesFor = (event: ReplayEvent): ReplayEvent[] => {
    const id = toolCorrelationId(event);
    return event.messageId && id ? identifiedCopies.get(event.messageId)?.get(id) ?? [] : [];
  };
  const identifiedCopyFor = (event: ReplayEvent): ReplayEvent | undefined => identifiedCopiesFor(event).at(-1);
  const anonymousByMessage = new Map<string, ReplayEvent[]>();
  for (const event of events) {
    if (!event.messageId || isNativeToolUseEvent(event) || toolCorrelationId(event) || event.actorRole !== "assistant" || !isToolUseEvent(event)) continue;
    const calls = anonymousByMessage.get(event.messageId) ?? [];
    calls.push(event);
    anonymousByMessage.set(event.messageId, calls);
  }
  const anonymousCopies = new Map<ReplayEvent, ReplayEvent>();
  const copyEvents = new Set(displayCopies);
  for (const [messageId, natives] of nativesByMessage) {
    const anonymous = anonymousByMessage.get(messageId) ?? [];
    const profiles = new Map(natives.map((native) => {
      const call = parseToolCall(native);
      const identified = identifiedCopyFor(native);
      const recordedEvent = !call.args && !call.target && identified ? identified : native;
      const recorded = recordedEvent === native ? call : parseToolCall(recordedEvent);
      return [native, { ...recorded, args: recorded.args ? toolArgumentsForComparison(recordedEvent, recorded.args) : null }];
    }));
    const matches = new Map(anonymous.map((copy) => {
      const call = parseToolCall(copy);
      const name = call.name.replace(/^functions\./, "");
      return [copy, natives.filter((native) => {
        const recorded = profiles.get(native)!;
        if (!name || name !== recorded.name.replace(/^functions\./, "")) return false;
        if (recorded.args) return sameRecordedValue(recorded.args, call.args);
        return !recorded.target || recorded.target === call.target;
      })];
    }));
    for (const native of natives) {
      const candidates = anonymous.filter((copy) => matches.get(copy)?.length === 1 && matches.get(copy)?.[0] === native);
      const recorded = profiles.get(native)!;
      // A name-only native call needs one unambiguous copy. With recorded
      // arguments, consume at most one exact copy and retain unproven repeats.
      if (!candidates.length || (!recorded.args && !recorded.target && candidates.length !== 1)) continue;
      anonymousCopies.set(native, candidates[0]!);
      copyEvents.add(candidates[0]!);
    }
  }
  const sorted = events.filter((event) => Number.isFinite(Date.parse(event.ts)) && !copyEvents.has(event))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const transcriptCells = transcript ?? buildTranscript(sorted);
  const transcriptAnchors = new Set(transcriptCells.map(transcriptCellAnchor));
  const prompts = new Map(transcriptCells.filter((cell) => cell.kind === "user" || cell.kind === "image").map((cell) => [cell.id, cell]));
  const paired = new Map<ReplayEvent, ReplayEvent | null>();
  let turnTools: ReplayEvent[] = [];
  const pairTurn = () => {
    // Storage can return a result before its call within one millisecond.
    // Keep turn boundaries intact while presenting invocations to the pairer first.
    turnTools.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)
      || Number(isToolUseEvent(b)) - Number(isToolUseEvent(a)));
    for (const { call, result } of pairToolSteps(turnTools)) paired.set(call, result);
    turnTools = [];
  };
  for (const event of sorted) {
    const prompt = prompts.get(event.eventId);
    if (prompt && startsExchange(prompt)) pairTurn();
    if (isToolActivity(event)) turnTools.push(event);
  }
  pairTurn();
  const all: TraceExchange[] = [];
  let current: TraceExchange | null = null;
  let reviewingApproval = false;
  let lastExploredAnchor: string | null = null;
  for (const event of sorted) {
    const at = Date.parse(event.ts);
    const role = messageRole(event);
    const prompt = prompts.get(event.eventId);
    if (prompt && startsExchange(prompt)) {
      lastExploredAnchor = null;
      const promptText = prompt.kind === "user" ? prompt.text : null;
      reviewingApproval = promptText !== null && approvalReviewPrompt(event, promptText);
      const reviewCommand = reviewingApproval && promptText !== null ? approvalCommand(promptText) : null;
      const label = prompt.kind === "image" ? "Image attachment" : reviewingApproval ? reviewCommand ? `Review: ${commandLabel(reviewCommand)}` : "Review proposed action" : requestLabel(prompt.text);
      current = { id: event.eventId, label, start: at, end: at, steps: [] };
      all.push(current);
      current.steps.push({ id: event.eventId, kind: "prompt", label: prompt.kind === "image" ? "Image attachment" : reviewingApproval ? "Review proposed action" : "Request", detail: prompt.kind === "image" ? null : prompt.text || null, at, end: null, anchor: transcriptCellAnchor(prompt), failed: false });
      current.prompt = current.steps[0];
      continue;
    }
    if (prompt) {
      if (current && prompt.kind === "user" && prompt.text.trim()) {
        current.label = requestLabel(prompt.text);
        const first = current.steps.find((step) => step.kind === "prompt");
        if (first) first.detail = prompt.text;
      }
      continue;
    }
    let step: TraceStep | null = null;
    if (isToolUseEvent(event)) {
      const result = paired.get(event);
      const end = result ? Date.parse(result.ts) : NaN;
      // Copy selection is per invocation; unmatched anonymous calls stay
      // recorded activity instead of being discarded by message identity.
      const anonymousCopy = anonymousCopies.get(event);
      const displayEvent = identifiedCopyFor(event) ?? anonymousCopy ?? event;
      const cells = toolCells({ call: displayEvent, result: result ?? null });
      const failed = [event.toolStatus, result?.toolStatus].some((status) => Boolean(status && /fail|error/i.test(status))) || cells.some((cell) => "failed" in cell && cell.failed);
      const ownAnchor = `cell-${event.eventId}:0`;
      const firstIsExplored = cells[0]?.kind === "explored";
      // The supplied Conversation transcript may have kept a different
      // representation of this invocation. Link only to an anchor it retained.
      const copies = [...identifiedCopiesFor(event), ...(anonymousCopy ? [anonymousCopy] : [])];
      const copyAnchor = copies.map((copy) => `cell-${copy.eventId}:0`).find((candidate) => transcriptAnchors.has(candidate));
      const anchor: string | null = transcriptAnchors.has(ownAnchor) ? ownAnchor : copyAnchor ?? (firstIsExplored ? lastExploredAnchor : null);
      lastExploredAnchor = cells.at(-1)?.kind === "explored" ? anchor : null;
      step = {
        id: event.eventId, kind: "tool", source: event.source, label: excerpt(toolLabel(displayEvent, cells), "Tool call"),
        detail: displayEvent.content || event.content || null,
        output: result?.content ?? null,
        toolCall: parseToolCall(displayEvent), at,
        end: Number.isFinite(end) && end >= at ? end : null,
        anchor,
        failed,
      };
    } else if (role === "assistant" && event.content?.trim()) {
      lastExploredAnchor = null;
      const outcome = reviewingApproval && event.source === "codex" ? approvalOutcome(event.content) : null;
      step = { id: event.eventId, kind: "reply", source: event.source, label: outcome ? outcome.label : messageLabel(event.content), detail: event.content, at, end: null, anchor: transcriptAnchors.has(`cell-${event.eventId}`) ? `cell-${event.eventId}` : null, failed: false };
    }
    if (step) {
      if (!current) {
        current = { id: `before-${event.eventId}`, label: excerpt(event.taskTitle, "Recorded activity"), start: at, end: at, steps: [] };
        all.push(current);
      }
      current.steps.push(step);
      current.end = Math.max(current.end, step.end ?? at);
    }
  }
  const selected = all.slice(-MAX_EXCHANGES);
  let budget = MAX_STEPS;
  let omittedSteps = 0;
  for (let index = selected.length - 1; index >= 0; index--) {
    const exchange = selected[index]!;
    const keep = Math.min(exchange.steps.length, budget);
    omittedSteps += exchange.steps.length - keep;
    exchange.steps = keep ? exchange.steps.slice(-keep) : [];
    budget -= keep;
  }
  const bounded = selected.filter((exchange) => exchange.steps.length > 0);
  const positions = bounded.flatMap((exchange) => [exchange.start, exchange.end]);
  return {
    exchanges: bounded,
    start: positions.length ? Math.min(...positions) : 0,
    end: positions.length ? Math.max(...positions) : 0,
    omittedExchanges: all.length - bounded.length,
    omittedSteps,
  };
}
