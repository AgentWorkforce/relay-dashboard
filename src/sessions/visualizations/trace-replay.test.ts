import { expect, it } from "vitest";
import { toReplayEvent } from "../model/replay-model";
import { buildTraceWaterfall } from "./trace-waterfall-model";
import { buildTraceReplayLegs } from "./trace-replay";

const at = (seconds: number) => new Date(Date.parse("2026-10-22T12:00:00Z") + seconds * 1000).toISOString();
const event = (id: string, seconds: number, kind: string, extra = {}) => toReplayEvent({ eventId: id, ts: at(seconds), kind, ...extra })!;

it("ends each leg at the last response instead of animating the human's idle time", () => {
  const events = [event("p", 0, "prompt", { content: "First task" }), event("r", 10, "assistant", { content: "Done" }),
    event("p2", 600, "prompt", { content: "Second task" }), event("r2", 610, "assistant", { content: "Done again" })];
  expect(buildTraceReplayLegs(buildTraceWaterfall(events), events).map(({ start, end }) => [start, end]))
    .toEqual([[Date.parse(at(0)), Date.parse(at(10))], [Date.parse(at(600)), Date.parse(at(610))]]);
});

it("keeps duplicate prompt deliveries together and does not infer idle during a long tool", () => {
  const events = [event("p", 0, "prompt", { content: "Run tests" }), event("copy", 1, "prompt", { content: "Run tests" }),
    event("call", 2, "tool_call", { toolUseId: "test", content: 'exec_command {"cmd":"npm test"}' }),
    event("result", 602, "tool_result", { toolUseId: "test", content: "Passed" })];
  expect(buildTraceReplayLegs(buildTraceWaterfall(events), events)).toEqual([
    { start: Date.parse(at(0)), end: Date.parse(at(602)), lastExchange: 1, label: "Run tests" },
  ]);
});

it.each(["waiting_for_input", "idle"])("stops on recorded %s even without another prompt", (taskStatus) => {
  const events = [event("p", 0, "prompt", { content: "Deploy" }),
    event("question", 3, "assistant", { content: "Ready to proceed?" }),
    event("wait", 4, "task", { taskStatus }),
    event("resume", 60, "assistant", { content: "Continuing" })];
  expect(buildTraceReplayLegs(buildTraceWaterfall(events), events).map(({ start, end }) => [start, end]))
    .toEqual([[Date.parse(at(0)), Date.parse(at(4))], [Date.parse(at(60)), Date.parse(at(60))]]);
});
