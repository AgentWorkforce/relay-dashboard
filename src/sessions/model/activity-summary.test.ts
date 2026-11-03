// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { describe, expect, it } from "vitest";
import { formatElapsed, pairToolSteps } from "./activity-summary";
import type { ReplayEvent } from "./replay-model";

function replayEvent(
  eventId: string,
  type: string,
  extra: Partial<ReplayEvent> = {},
): ReplayEvent {
  return {
    eventId,
    ts: "2026-09-21T12:00:00.000Z",
    kind: "session_event",
    type,
    actorName: null,
    actorRole: type === "tool_result" ? "tool_result" : "assistant",
    source: "codex",
    model: null,
    machineId: "machine",
    content: null,
    contentTruncated: false,
    taskTitle: null,
    projectPath: null,
    nativeResumeId: null,
    toolUseId: null,
    toolName: null,
    toolStatus: null,
    toolCalls: null,
    filesTouched: null,
    durationMs: null,
    ...extra,
  };
}

describe("pairToolSteps", () => {
  it("pairs interleaved calls and results by their correlation identifiers", () => {
    const callA = replayEvent("call-a", "tool_use", {
      toolName: "read_file",
      toolCalls: [{ id: "tool-a" }],
    });
    const callB = replayEvent("call-b", "tool_use", {
      toolUseId: "tool-b",
      toolName: "exec",
    });
    const resultA = replayEvent("result-a", "tool_result", {
      content: 'function_call_output {"call_id":"tool-a","output":"A"}',
    });
    const resultB = replayEvent("result-b", "tool_result", {
      toolUseId: "tool-b",
      content: "B",
    });

    const steps = pairToolSteps([callA, callB, resultA, resultB]);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ call: callA, result: resultA });
    expect(steps[1]).toMatchObject({ call: callB, result: resultB });
  });

  it("does not guess when multiple uncorrelated calls could own a result", () => {
    const callA = replayEvent("call-a", "tool_use");
    const callB = replayEvent("call-b", "tool_use");
    const resultA = replayEvent("result-a", "tool_result");
    const resultB = replayEvent("result-b", "tool_result");

    const steps = pairToolSteps([callA, callB, resultA, resultB]);

    expect(steps).toEqual([
      { call: callA, result: null },
      { call: callB, result: null },
    ]);
  });

  it("uses the compatibility fallback when only one call is pending", () => {
    const call = replayEvent("call", "tool_use");
    const result = replayEvent("result", "tool_result");

    expect(pairToolSteps([call, result])).toMatchObject([
      { call, result },
    ]);
  });

});

describe("formatElapsed", () => {
  it.each([
    [400, "<1s"],
    [45_900, "45s"],
    [125_000, "2m 5s"],
    [3_725_000, "1h 2m 5s"],
  ])("formats %ims like Codex", (duration, expected) => {
    expect(formatElapsed(duration)).toBe(expected);
  });
});
