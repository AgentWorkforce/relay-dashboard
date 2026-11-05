// Ported from Cloud session visualizations, head55bfc58fb.
import type { ReplayEvent } from "../model/replay-model";
import type { TraceWaterfallData } from "./trace-waterfall-model";

export type TraceReplayLeg = {
  start: number;
  end: number;
  lastExchange: number;
  label: string;
};

/** Request boundaries, not elapsed-time guesses, define pauses. A long-running
 * tool stays in one leg. Duplicate prompt-only deliveries stay with their reply. */
export function buildTraceReplayLegs(data: TraceWaterfallData, events: ReplayEvent[]): TraceReplayLeg[] {
  const legs: TraceReplayLeg[] = [];
  const stops = events.filter((event) =>
    !["presence", "discovery", "heartbeat", "session_meta"].includes(event.type) &&
    /^(waiting_for_input|awaiting_user|waiting_for_user|waiting|idle|paused|completed|complete|finished|done)$/i.test(event.taskStatus?.trim() ?? ""),
  ).map((event) => Date.parse(event.ts)).filter(Number.isFinite).sort((a, b) => a - b);
  data.exchanges.forEach((exchange, index) => {
    const previous = legs.at(-1);
    const priorExchange = data.exchanges[index - 1];
    const duplicatePrompt = priorExchange?.label === exchange.label && priorExchange.steps.every((step) => step.kind === "prompt");
    if (previous && (duplicatePrompt || exchange.start < previous.end)) {
      previous.end = Math.max(previous.end, exchange.end);
      previous.lastExchange = index;
    } else {
      legs.push({ start: exchange.start, end: exchange.end, lastExchange: index, label: exchange.label });
    }
    for (const stop of stops) {
      const current = legs.at(-1)!;
      if (stop < current.start || stop >= current.end) continue;
      const nextStep = exchange.steps.find((step) => step.at > stop);
      if (!nextStep) continue;
      const end = current.end;
      current.end = stop;
      legs.push({ start: nextStep.at, end, lastExchange: index, label: exchange.label });
    }
  });
  return legs;
}
