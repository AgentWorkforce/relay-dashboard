// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import type { ReplayEvent } from "./replay-model";

/** One tool call with the result recorded for it, when there is one. */
export type ToolStep = {
  call: ReplayEvent;
  result: ReplayEvent | null;
};

const TOOL_USE_KINDS = new Set([
  "custom_tool_call",
  "function_call",
  "mcp_tool_call",
  "tool_use",
  "tool-call",
  "tool_call",
]);
const TOOL_RESULT_KINDS = new Set([
  "custom_tool_call_output",
  "mcp_tool_call_output",
  "tool_result",
  "tool-result",
  "tool_call_output",
  "function_call_output",
]);

function normalizedKind(event: ReplayEvent): string {
  return (event.type || event.kind).toLowerCase();
}

export function isNativeToolUseEvent(event: ReplayEvent): boolean {
  return TOOL_USE_KINDS.has(normalizedKind(event));
}

export function isToolUseEvent(event: ReplayEvent): boolean {
  return (
    isNativeToolUseEvent(event) ||
    (event.actorRole === "assistant" &&
      /^[\w.:-]+\s+\{[\s\S]*\}$/.test(event.content?.trim() ?? ""))
  );
}

export function isToolResultEvent(event: ReplayEvent): boolean {
  return (
    event.actorRole === "tool_result" ||
    TOOL_RESULT_KINDS.has(normalizedKind(event))
  );
}

export function isToolActivity(event: ReplayEvent): boolean {
  return isToolUseEvent(event) || isToolResultEvent(event);
}


function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const CORRELATION_KEYS = [
  "toolUseId",
  "tool_use_id",
  "callId",
  "call_id",
  "toolCallId",
  "tool_call_id",
] as const;

const CORRELATION_CONTAINERS = [
  "toolCall", "tool_call", "functionCall", "function_call",
  "output", "result", "item", "params",
] as const;

function correlationIdFromValue(
  value: unknown,
  allowPlainId = false,
  depth = 0,
): string | null {
  if (depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = correlationIdFromValue(item, true, depth + 1);
      if (id) return id;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of CORRELATION_KEYS) {
    const id = stringValue(value[key]);
    if (id) return id;
  }
  if (allowPlainId) {
    const id = stringValue(value.id);
    if (id) return id;
  }
  for (const key of CORRELATION_CONTAINERS) {
    const id = correlationIdFromValue(value[key], false, depth + 1);
    if (id) return id;
  }
  return null;
}

function parsedContent(event: ReplayEvent): unknown {
  const content = event.content?.trim() ?? "";
  const starts = [content.indexOf("{"), content.indexOf("[")].filter(
    (index) => index >= 0,
  );
  if (starts.length === 0) return null;
  try {
    return JSON.parse(content.slice(Math.min(...starts)));
  } catch {
    return null;
  }
}

export function toolCorrelationId(event: ReplayEvent): string | null {
  return (
    event.toolUseId ??
    correlationIdFromValue(event.toolCalls, true) ??
    correlationIdFromValue(parsedContent(event))
  );
}

/** Comparison only: omit the selected call ID along the same metadata paths
 * used by toolCorrelationId. Preserve other IDs and every command input. */
export function toolArgumentsForComparison(event: ReplayEvent, args: Record<string, unknown>): Record<string, unknown> {
  // Structured argument payloads describe actual inputs, even when an input
  // happens to have a correlation-like name. Only normalize content envelopes.
  const metadata = Array.isArray(event.toolCalls) ? event.toolCalls.find(isRecord) : event.toolCalls;
  if (isRecord(metadata)) {
    const raw = metadata.args ?? metadata.arguments ?? metadata.input ?? metadata.parameters;
    if (isRecord(raw)) return args;
    if (typeof raw === "string") {
      try { if (isRecord(JSON.parse(raw))) return args; } catch { /* Display-text fallback. */ }
    }
  }
  const id = toolCorrelationId(event);
  if (!id) return args;
  type ComparedValue = { value: unknown; metadataOnly: boolean };
  const omitId = (value: unknown, allowPlainId = false, depth = 0): ComparedValue => {
    if (depth > 4) return { value, metadataOnly: false };
    if (Array.isArray(value)) {
      const items = value.map((item) => omitId(item, true, depth + 1));
      return { value: items.map((item) => item.value), metadataOnly: items.length > 0 && items.every((item) => item.metadataOnly) };
    }
    if (!isRecord(value)) return { value, metadataOnly: false };
    const result = { ...value };
    let removed = false;
    for (const key of CORRELATION_KEYS) if (result[key] === id) { delete result[key]; removed = true; }
    if (allowPlainId && result.id === id) { delete result.id; removed = true; }
    for (const key of CORRELATION_CONTAINERS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const child = omitId(value[key], false, depth + 1);
      // Drop only containers consisting entirely of selected-ID metadata.
      // Explicit empties, mixed arrays and other input values remain distinct.
      if (child.metadataOnly) { delete result[key]; removed = true; }
      else result[key] = child.value;
    }
    return { value: result, metadataOnly: removed && Object.keys(result).length === 0 };
  };
  return omitId(args).value as Record<string, unknown>;
}



/**
 * Pair tool calls with their results by correlation id, or by position when a
 * single call is pending. Results that no call claims are dropped: an output
 * without its invocation has nothing to render under.
 */
export function pairToolSteps(events: ReplayEvent[]): ToolStep[] {
  const pending: { step: ToolStep; correlationId: string | null }[] = [];
  const steps: ToolStep[] = [];
  for (const event of events) {
    if (isToolUseEvent(event)) {
      const step: ToolStep = { call: event, result: null };
      steps.push(step);
      pending.push({ step, correlationId: toolCorrelationId(event) });
      continue;
    }
    if (!isToolResultEvent(event)) continue;
    const correlationId = toolCorrelationId(event);
    const index = correlationId
      ? pending.findIndex((candidate) => candidate.correlationId === correlationId)
      : pending.length === 1
        ? 0
        : -1;
    if (index < 0) continue;
    const [match] = pending.splice(index, 1);
    if (match) match.step.result = event;
  }
  return steps;
}

/** Codex's elapsed format: `<1s`, `45s`, `2m 5s`, `1h 2m 5s`. */
export function formatElapsed(durationMs: number): string {
  const total = Math.floor(durationMs / 1_000);
  if (total < 1) return "<1s";
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
