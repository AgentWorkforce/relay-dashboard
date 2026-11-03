// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { describe, expect, it } from "vitest";
import { toReplayEvent, type ReplayEvent } from "./replay-model";
import { buildTranscript } from "./transcript-cells";
import { transcriptEvents } from "./transcript-events";
import { pairToolSteps } from "./activity-summary";

const event = (id: string, extra: Partial<ReplayEvent> = {}) => toReplayEvent({
  eventId: id, ts: "2026-10-29T06:00:00.000Z", source: "claude", userId: "owner",
  kind: "session_event", type: "user", actorRole: "user", content: "Inspect the repository", ...extra,
})!;

describe("capture reconciliation", () => {
  it("preserves an undated historical prompt that repeats a later turn", () => {
    const earlier = event("earlier", {kind: "history", ts: "1970-01-01T00:00:00Z", content: "Continue"});
    const response = event("response", {type: "assistant", actorRole: "assistant", content: "First attempt finished"});
    const later = event("later", {content: "Continue", ts: "2026-10-29T07:00:00Z"});
    expect(transcriptEvents([earlier, response, later])).toEqual([earlier, response, later]);
    expect(buildTranscript([earlier, response, later]).filter(cell => cell.kind === "user")).toHaveLength(2);
  });

  it("keeps a reconciled tool result with its call when the native copy crosses a prompt", () => {
    const call = event("call", {type: "tool_use", actorRole: null, content: "Bash npm test", toolUseId: "call-1"});
    const history = event("history-result", {kind: "history", type: "tool_result", actorRole: "tool_result", content: "tests passed", toolUseId: "call-1", ts: "2026-10-29T06:00:00.050Z"});
    const prompt = event("next-turn", {content: "What next?", ts: "2026-10-29T06:00:00.060Z"});
    const native = {...history, eventId: "native-result", kind: "session_event", ts: "2026-10-29T06:00:00.069Z"};
    expect(transcriptEvents([call, history, prompt, native])).toEqual([call, native, prompt]);
    expect(buildTranscript([call, history, prompt, native])).toContainEqual(expect.objectContaining({kind: "exec", output: "tests passed"}));
  });

  it("keeps an identified epoch output with its only pending call before a second invocation", () => {
    const first = event("first-call", {type: "tool_use", actorRole: null, content: "Bash npm test", ts: "1970-01-01T00:00:00Z"});
    const epoch = event("epoch-result", {kind: "history", type: "tool_result", actorRole: "tool_result", content: "tests passed", messageId: "result-1", ts: "1970-01-01T00:00:00Z"});
    const second = event("second-call", {type: "tool_use", actorRole: null, content: "Bash npm run build"});
    const native = {...epoch, eventId: "native-result", kind: "session_event", ts: "2026-10-29T06:00:00.050Z"};
    const rows = [first, epoch, second, native];
    expect(transcriptEvents(rows)).toEqual([first, native, second]);
    expect(pairToolSteps(transcriptEvents(rows))).toEqual([{call: first, result: native}, {call: second, result: null}]);
    expect(buildTranscript(rows)).toContainEqual(expect.objectContaining({kind: "exec", output: "tests passed"}));
  });

  it.each(["message", "tool"])("does not move an identified %s epoch result before its call", identity => {
    const prompt = event("prompt", {content: "Run the tests", ts: "1970-01-01T00:00:00Z"});
    const call = event("call", {type: "tool_use", actorRole: null, content: "Bash npm test", toolUseId: "call-1"});
    const native = event("native-result", {type: "tool_result", actorRole: "tool_result", content: "tests passed", toolUseId: "call-1", messageId: "result-1"});
    const epoch = {...native, kind: "history", eventId: "epoch-result", ts: "1970-01-01T00:00:00Z", ...(identity === "message" ? {toolUseId: null} : {messageId: null})};
    const rows = [prompt, epoch, call, native];
    expect(transcriptEvents(rows)).toEqual([prompt, call, native]);
    expect(buildTranscript(rows)).toContainEqual(expect.objectContaining({kind: "exec", output: "tests passed"}));
  });

  it.each([
    ["tool_use", "message"], ["tool_use", "tool"],
    ["tool_result", "message"], ["tool_result", "tool"],
  ])("reconciles a preferred %s capture that omitted its %s identity", (type, identity) => {
    const native = event("native", {type, actorRole: type === "tool_result" ? "tool_result" : null, content: type === "tool_result" ? "OK" : "Bash npm test"});
    const ids = identity === "message" ? {messageId: "message-1"} : {toolUseId: "call-1"};
    const history = {...native, eventId: "history", kind: "history", ...ids};
    const reconciled = transcriptEvents([history, native]);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].eventId).toBe("native");
    if (identity === "tool") expect(reconciled[0].toolUseId).toBe("call-1");
  });

  it("does bounded identity work for repeated results with distinct call IDs", () => {
    let identityReads = 0;
    const rows = Array.from({length: 1200}, (_, index) => {
      const row = event(`result-${index}`, {type: "tool_result", actorRole: "tool_result", content: "OK"});
      Object.defineProperty(row, "toolUseId", {get() { identityReads++; return `call-${index}`; }});
      return row;
    });
    expect(transcriptEvents(rows)).toEqual(rows);
    expect(identityReads).toBeLessThan(rows.length * 40);
  });

  it("indexes assistant-form echoes among repeated commands with distinct identities", () => {
    let identityReads = 0;
    const calls = Array.from({length: 500}, (_, index) => {
      const row = event(`call-${index}`, {type: "tool_use", actorRole: null, content: "Bash npm test"});
      Object.defineProperty(row, "toolUseId", {get() { identityReads++; return `tool-${index}`; }});
      return row;
    });
    const echoes = calls.map((call, index) => event(`echo-${index}`, {kind: "history", type: "assistant", actorRole: "assistant", content: call.content, toolUseId: `tool-${index}`}));
    identityReads = 0;
    expect(transcriptEvents([...calls, ...echoes])).toEqual(calls);
    expect(identityReads).toBeLessThan(calls.length * 50);
  });

  it("preserves undated messages when neither time nor identity proves a copy", () => {
    const native = event("native");
    const first = event("first", { ts: "1970-01-01T00:00:00Z" });
    const repeated = event("repeated", { ts: "1970-01-01T00:00:00Z" });
    expect(transcriptEvents([first, repeated, native])).toEqual([first, repeated, native]);
  });

  it("preserves rapid repeated prompts without a shared message identity", () => {
    const first = event("history-first", { kind: "history" });
    const repeated = event("native-repeat", { ts: "2026-10-29T06:00:00.069Z" });
    expect(transcriptEvents([first, repeated])).toEqual([first, repeated]);
  });

  it("does not reinterpret an assistant reply using an unrelated recorded command", () => {
    const call = event("call", { type: "tool_call", actorRole: null, toolName: "Bash", content: "Bash npm test", messageId: "call-message" });
    const later = event("later", { type: "assistant", actorRole: "assistant", content: call.content, ts: "2026-10-29T07:00:00Z" });
    const distinct = event("distinct", { type: "assistant", actorRole: "assistant", content: call.content, messageId: "reply-message" });
    const undated = event("undated", { type: "assistant", actorRole: "assistant", content: call.content, ts: "1970-01-01T00:00:00Z" });
    for (const reply of [later, distinct, undated]) {
      expect(transcriptEvents([call, reply])).toEqual([call, reply]);
    }
  });

  it("keeps an authoritative call when both capture streams infer Claude JSON calls", () => {
    const content = 'Bash {"command":"ls"}';
    const history = event("history", { kind: "history", type: "assistant", actorRole: "assistant", content });
    const native = event("native", { type: "assistant", actorRole: "assistant", content });
    const result = event("result", { type: "tool_result", actorRole: "tool_result", content: "files" });
    const reconciled = transcriptEvents([history, native, result]);
    expect(reconciled).toHaveLength(2);
    expect(pairToolSteps(reconciled)).toMatchObject([{ call: { eventId: "native" }, result }]);
  });

  it.each([
    ["epoch", "1970-01-01T00:00:00Z"],
    ["jitter", "2026-10-29T06:00:00.069Z"],
    ["exact", "2026-10-29T06:00:00.000Z"],
  ])("preserves separate nested tool identities across %s captures and their outputs", (_, ts) => {
    const first = event("first", { kind: "history", type: "tool_use", actorRole: null, toolName: "Bash", content: "Bash npm test", ts, toolCalls: [{ id: "one" }] });
    const second = event("second", { type: "tool_use", actorRole: null, toolName: "Bash", content: first.content, toolCalls: [{ tool_call_id: "two" }] });
    const firstOutput = event("first-output", { type: "tool_result", actorRole: "tool_result", toolCalls: { result: { call_id: "one" } }, content: "first output" });
    const secondOutput = event("second-output", { type: "tool_result", actorRole: "tool_result", toolCalls: { output: { tool_use_id: "two" } }, content: "second output" });
    const rows = [first, second, firstOutput, secondOutput];
    expect(transcriptEvents(rows)).toEqual(rows);
    expect(pairToolSteps(transcriptEvents(rows))).toEqual([
      { call: first, result: firstOutput }, { call: second, result: secondOutput },
    ]);
  });

  it.each(["tool_use", "assistant"])("preserves result correlation when a native %s copy omits tool metadata", (type) => {
    const call = event("history", { kind: "history", type: "tool_use", actorRole: null, toolName: "Bash", toolCalls: [{ id: "test-call" }], content: "Bash npm test" });
    const native = event("native", { type, actorRole: type === "assistant" ? "assistant" : null, content: call.content });
    const result = event("output", { type: "tool_result", actorRole: "tool_result", toolUseId: "test-call", content: "tests passed" });
    const steps = pairToolSteps(transcriptEvents([call, native, result]));
    expect(steps).toHaveLength(1);
    expect(steps[0].result).toEqual(result);
  });

  it.each([
    ["tool_use", "2026-10-29T06:00:00.000Z"],
    ["assistant", "2026-10-29T06:00:00.000Z"],
    ["tool_use", "1970-01-01T00:00:00Z"],
    ["assistant", "1970-01-01T00:00:00Z"],
  ])("keeps a reconciled %s call from %s before its jitter-straddled result", (type, ts) => {
    const history = event("history", {kind: "history", type: "tool_use", actorRole: null, content: "Bash npm test", toolName: "Bash", toolUseId: "test-call", messageId: "call-message", ts});
    const result = event("output", {type: "tool_result", actorRole: "tool_result", content: "tests passed", toolUseId: "test-call", ts: "2026-10-29T06:00:00.050Z"});
    const native = event("native", {type, actorRole: type === "assistant" ? "assistant" : null, content: history.content, messageId: "call-message", ts: "2026-10-29T06:00:00.069Z"});
    const reconciled = transcriptEvents([history, result, native]);
    expect(reconciled.map(row => row.eventId)).toEqual(["native", "output"]);
    expect(pairToolSteps(reconciled)).toMatchObject([{call: {eventId: "native", toolUseId: "test-call"}, result}]);
    expect(buildTranscript([history, result, native])).toMatchObject([{kind: "exec", output: "tests passed"}]);
  });

  it("does not use an unidentified epoch import to move a call before its user turn", () => {
    const history = event("history", {kind: "history", type: "tool_use", actorRole: null, content: "Bash npm test", ts: "1970-01-01T00:00:00Z"});
    const prompt = event("prompt", {content: "Run the checks"});
    const native = event("native", {type: "tool_use", actorRole: null, content: history.content});
    const result = event("output", {type: "tool_result", actorRole: "tool_result", content: "tests passed"});
    expect(transcriptEvents([history, prompt, native, result])).toEqual([prompt, native, result]);
    expect(pairToolSteps(transcriptEvents([history, prompt, native, result]))).toEqual([{call: native, result}]);
  });

  it.each(["message", "tool"])("keeps an identified %s epoch copy within the surviving call's user turn", identity => {
    const ids = identity === "message" ? {messageId: "same-call"} : {toolUseId: "same-call"};
    const history = event("history", {kind: "history", type: "tool_use", actorRole: null, content: "Bash npm test", ts: "1970-01-01T00:00:00Z", ...ids});
    const prompt = event("prompt", {content: "Run the checks"});
    const native = event("native", {type: "tool_use", actorRole: null, content: history.content, ...ids});
    const result = event("output", {type: "tool_result", actorRole: "tool_result", content: "tests passed", ...(identity === "tool" ? {toolUseId: "same-call"} : {})});
    expect(transcriptEvents([history, prompt, native, result])).toEqual([prompt, native, result]);
    expect(buildTranscript([history, prompt, native, result]).filter(cell => cell.kind !== "worked")).toMatchObject([{kind: "user"}, {kind: "exec", output: "tests passed"}]);
  });

  it("reconciles history assistant-form invocations using the native message identity", () => {
    const history = event("history", {kind: "history", type: "assistant", actorRole: "assistant", content: "Bash npm test", messageId: "call-message"});
    const native = event("native", {type: "tool_use", actorRole: null, content: history.content, toolName: "Bash", messageId: "call-message"});
    expect(transcriptEvents([history, native])).toEqual([native]);
    expect(buildTranscript([history, native]).map(cell => cell.kind)).toEqual(["exec"]);
    const distinct = {...history, messageId: "different-message"};
    expect(transcriptEvents([distinct, native])).toEqual([distinct, native]);
  });

  it("renders a native prompt once across history copies, capture-time jitter, and epoch imports", () => {
    const native = event("native", { messageId: "native-message" });
    const rows = [
      event("epoch-native", { messageId: "native-message", ts: "1970-01-01T00:00:00.000Z" }),
      event("epoch-history", { messageId: "native-message", kind: "history", ts: "1970-01-01T00:00:00.000Z" }),
      event("history", { kind: "history" }), native,
      event("history-jitter", { kind: "history", messageId: "native-message", ts: "2026-10-29T06:00:00.069Z" }),
    ];
    expect(transcriptEvents(rows)).toEqual([native]);
    expect(buildTranscript(rows)).toMatchObject([{ kind: "user", id: "native" }]);
    expect(buildTranscript(rows)).toHaveLength(1);
  });

  it("preserves repeated native prompts, separate owners and sources, and history-only sessions", () => {
    const rows = [event("first"), event("repeat", { messageId: "another-message" }),
      event("later", { ts: "2026-10-29T07:00:00Z" }),
      event("other-owner", { kind: "history", userId: "teammate" }),
      event("other-source", { kind: "history", source: "codex" }),
      event("later-history", { kind: "history", ts: "2026-10-29T08:00:00Z" })];
    expect(transcriptEvents(rows)).toEqual(rows);
    expect(transcriptEvents([event("history-only", { kind: "history" })])).toHaveLength(1);
  });

  it("collapses recorded Bash calls and removes their assistant-text echoes", () => {
    const call = event("call", { kind: "tool_call", type: "tool_call", toolName: "Bash", actorRole: null, content: "Bash ls", toolUseId: "ls-call" });
    const rows = [event("epoch", { type: "assistant", actorRole: "assistant", ts: "1970-01-01T00:00:00Z", content: "Bash cd ~/work/repo && ls", toolUseId: "ls-call" }),
      event("echo", { type: "assistant", actorRole: "assistant", content: "Bash ls" }), call];
    expect(transcriptEvents(rows)).toEqual([call]);
    expect(buildTranscript(rows).map(cell => cell.kind)).toEqual(["explored"]);
    const nativeCall = { ...call, kind: "session_event", type: "tool_use" };
    expect(transcriptEvents([rows[1], nativeCall])).toEqual([nativeCall]);
  });

  it("keeps ordinary assistant prose and unique undated evidence", () => {
    const rows = [event("prose", { type: "assistant", actorRole: "assistant", content: "Bash is useful for this." }),
      event("command-example", { type: "assistant", actorRole: "assistant", content: "Bash npm test" }),
      event("undated", { ts: "1970-01-01T00:00:00Z", content: "Only captured here" })];
    expect(transcriptEvents(rows)).toEqual(rows);
  });

  it("preserves separate correlated tool calls and messages with the same content", () => {
    const rows = [event("first-tool", { kind: "tool_call", type: "tool_call", toolName: "Bash", content: "Bash npm test", toolUseId: "one" }),
      event("second-tool", { type: "tool_use", toolName: "Bash", content: "Bash npm test", toolUseId: "two" }),
      event("first-message", { messageId: "one" }),
      event("different-message", { kind: "history", messageId: "two" })];
    expect(transcriptEvents(rows)).toEqual(rows);
  });
});
