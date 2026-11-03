// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { displayUserMessage } from "./transcript-display";
import { sessionImage } from "./session-image";
import { isToolActivity, isToolResultEvent, isToolUseEvent, toolCorrelationId } from "./activity-summary";
import { messageRole, type ReplayEvent } from "./replay-model";
import { CaptureIndex, captureCluster, type CaptureCluster } from "./capture-index";

const dated = (event: ReplayEvent) => Date.parse(event.ts) > 0;

function captureContent(event: ReplayEvent): string {
  // Old undated deliveries included the checkout prefix; native records do not.
  return event.content?.trim().replace(/^Bash cd (?:"[^"]+"|'[^']+'|\S+)\s+&&\s+/, "Bash ") ?? "";
}

function toolKey(event: ReplayEvent): string {
  return JSON.stringify([event.source, event.userId ?? "", captureContent(event)]);
}

function sharedIdentity(a: ReplayEvent, b: ReplayEvent): boolean {
  const tool = toolCorrelationId(a);
  return Boolean((a.messageId && a.messageId === b.messageId) ||
    (tool && tool === toolCorrelationId(b)));
}

/** Older Claude deliveries serialized calls as assistant text. Text alone is
 * insufficient: the recorded call must identify the same capture or instant.
 */
function normalizeTool(event: ReplayEvent, calls: CaptureIndex, input: ReplayEvent[]): ReplayEvent {
  if (event.source !== "claude" || !["session_event", "history"].includes(event.kind) ||
      event.type !== "assistant" || isToolUseEvent(event)) return event;
  const match = calls.find(event, toolKey(event));
  const call = match ? input[match.survivor] : undefined;
  return call ? { ...event, type: "tool_call", toolName: call.toolName } : event;
}

function signature(event: ReplayEvent): string {
  const role = isToolActivity(event) ? (isToolResultEvent(event) ? "result" : "tool") : messageRole(event) ?? event.type;
  return JSON.stringify([event.source, event.userId ?? "", role, captureContent(event)]);
}

/** Reconcile capture representations, without removing real repeated turns.
 * Raw replay remains available to metadata, resume, and pagination consumers.
 */
export function transcriptEvents(input: ReplayEvent[]): ReplayEvent[] {
  const calls = new CaptureIndex();
  input.forEach((event, index) => {
    if (isToolUseEvent(event)) calls.add(captureCluster(event, toolKey(event), index, index));
  });
  const events = input.map(event => normalizeTool(event, calls, input));
  const lane = (index: number) => JSON.stringify([
    events[index].kind, dated(events[index]), events[index].type,
    events[index] !== input[index],
  ]);
  // Choose survivors first. Removed records can never eliminate one another.
  // Within a capture stream every occurrence needs its own surviving copy.
  const priority = (index: number) =>
    Number(dated(events[index])) * 4 + Number(events[index].kind !== "history") * 2 +
    Number(events[index] === input[index]);
  const candidates = events.map((_, index) => index).sort((a, b) => priority(b) - priority(a));
  const indexByCapture = new CaptureIndex();
  const clusters: CaptureCluster[] = [];
  candidates.forEach((index, rank) => {
    const event = events[index];
    const group = signature(event);
    const captureLane = lane(index);
    const cluster = indexByCapture.find(event, group, captureLane, true);
    if (cluster) {
      indexByCapture.remove(cluster);
      cluster.members.push(index);
      cluster.lanes.add(captureLane);
      cluster.message ||= event.messageId ?? "";
      cluster.tool ||= toolCorrelationId(event) ?? "";
      indexByCapture.add(cluster);
    } else {
      const created = captureCluster(event, group, index, rank, captureLane);
      clusters.push(created);
      indexByCapture.add(created);
    }
  });
  // Undated imports have identity but no chronological authority. Determine
  // turns from the prompts that survived reconciliation, not their raw copies.
  const prompts = new Set(clusters.filter(({ survivor }) => {
    const event = events[survivor];
    return !isToolActivity(event) && messageRole(event) === "user" &&
      (sessionImage(event.content) || displayUserMessage(event.content).kind === "prompt");
  }).map(({ survivor }) => survivor));
  let turn = 0;
  const turns = events.map((_, index) => turn += Number(prompts.has(index)));
  const captures: LocatedCapture[] = clusters.map(({ survivor, members }) => {
    let event = events[survivor];
    // The preferred copy can omit the ID that owns its recorded result.
    if (isToolActivity(event) && !toolCorrelationId(event)) {
      const toolUseId = members.map(member => toolCorrelationId(events[member])).find(Boolean);
      if (toolUseId) event = { ...event, toolUseId };
    }
    const position = isToolActivity(event)
      ? members.reduce((first, member) => dated(events[member]) || (isToolUseEvent(event) && turns[member] === turns[survivor] && sharedIdentity(event, events[member]))
        ? Math.min(first, member) : first, survivor)
      : survivor;
    return { event, members, survivor, position };
  });
  anchorResults(captures, events, prompts, turns);
  const positioned = new Map(captures.map(({ position, event }) => [position, event]));
  return events.flatMap((_, index) => {
    const event = positioned.get(index);
    return event ? [event] : [];
  });
}

type LocatedCapture = { event: ReplayEvent; members: number[]; survivor: number; position: number };

/** An epoch result can preserve recorded order only when an invocation is
 * actually pending there. Reconcile calls first, then claim each result once:
 * later copies must not consume a second call's positional result slot.
 */
function anchorResults(captures: LocatedCapture[], events: ReplayEvent[], prompts: Set<number>, turns: number[]) {
  const calls = new Map<number, LocatedCapture>();
  const results = new Map<number, LocatedCapture>();
  for (const capture of captures) {
    if (isToolUseEvent(capture.event)) calls.set(capture.position, capture);
    else if (isToolResultEvent(capture.event)) {
      for (const member of capture.members) {
        if (member === capture.survivor || dated(events[member]) ||
            (turns[member] === turns[capture.survivor] && sharedIdentity(capture.event, events[member]))) {
          results.set(member, capture);
        }
      }
    }
  }
  const pending = new Set<LocatedCapture>();
  const byId = new Map<string, Set<LocatedCapture>>();
  const assigned = new Set<LocatedCapture>();
  events.forEach((_, index) => {
    if (prompts.has(index)) { pending.clear(); byId.clear(); }
    const call = calls.get(index);
    if (call) {
      pending.add(call);
      const id = toolCorrelationId(call.event);
      if (id) {
        let pool = byId.get(id);
        if (!pool) { pool = new Set(); byId.set(id, pool); }
        pool.add(call);
      }
    }
    const result = results.get(index);
    if (!result || assigned.has(result)) return;
    const id = toolCorrelationId(result.event);
    const match = id ? byId.get(id)?.values().next().value
      : pending.size === 1 ? pending.values().next().value : undefined;
    if (!match) return;
    result.position = index;
    assigned.add(result);
    pending.delete(match);
    const callId = toolCorrelationId(match.event);
    if (callId) byId.get(callId)?.delete(match);
  });
}
