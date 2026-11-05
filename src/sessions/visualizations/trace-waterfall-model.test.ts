import { describe, expect, it } from "vitest";
import { buildTraceWaterfall } from "./trace-waterfall-model";
import { toReplayEvent } from "../model/replay-model";
import { buildTranscript, transcriptCellAnchor } from "../model/transcript-cells";

const at = (seconds: number) => new Date(Date.parse("2026-10-22T12:00:00Z") + seconds * 1000).toISOString();
const event = (eventId: string, seconds: number, kind: string, extra: Record<string, unknown> = {}) => toReplayEvent({ eventId, ts: at(seconds), kind, ...extra })!;

describe("recorded trace waterfall", () => {
  it("uses the actual typed request as its branch label even when it is longer than a short summary", () => {
    const request = "Can you check which macOS versions our users are on, then explain whether we can drop support for macOS 13?";
    const data = buildTraceWaterfall([event("request", 0, "prompt", { content: request })]);
    expect(data.exchanges[0]?.label).toBe(request);
    expect(data.exchanges[0]?.steps[0]?.detail).toBe(request);
  });
  it("keeps complete raw input and output behind the short action label", () => {
    const input = 'exec_command ' + JSON.stringify({ cmd: "gh run view 123 --json status,conclusion", note: "raw detail\n".repeat(60) });
    const output = "full recorded output\n".repeat(60);
    const data = buildTraceWaterfall([
      event("call", 1, "tool_call", { toolUseId: "ci", content: input }),
      event("result", 2, "tool_result", { toolUseId: "ci", content: output }),
    ]);
    expect(data.exchanges[0]!.steps[0]).toMatchObject({ label: "Check build and test status", detail: input, output });
  });
  it("groups a request and pairs only correlated tool results", () => {
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Fix the cache" }),
      event("call-a", 1, "tool_call", { toolUseId: "a", content: "exec npm test" }),
      event("call-b", 2, "tool_call", { toolUseId: "b", content: "Read src/cache.ts" }),
      event("result-b", 4, "tool_result", { toolUseId: "b" }),
      event("result-a", 8, "tool_result", { toolUseId: "a" }),
      event("reply", 9, "assistant", { content: "Cache fixed" }),
    ]);
    expect(data.exchanges).toHaveLength(1);
    expect(data.exchanges[0]?.label).toBe("Fix the cache");
    expect(data.exchanges[0]?.steps.map((step) => [step.id, step.end])).toEqual([
      ["request", null], ["call-a", Date.parse(at(8))], ["call-b", Date.parse(at(4))], ["reply", null],
    ]);
  });

  it("keeps an unpaired call as a point even when the session has later activity", () => {
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Investigate" }),
      event("call", 1, "tool_call", { content: "exec npm test" }),
      event("reply", 20, "assistant", { content: "Done" }),
    ]);
    expect(data.exchanges[0]?.steps[1]?.end).toBeNull();
  });

  it("surfaces a recorded failed tool result", () => {
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Run checks" }),
      event("call", 1, "tool_call", { toolUseId: "check", content: "exec_command {\"cmd\":\"npm test\"}" }),
      event("result", 3, "tool_result", { toolUseId: "check", toolStatus: "failed", content: "Failed: tests" }),
    ]);
    expect(data.exchanges[0]?.steps[1]).toMatchObject({ failed: true, end: Date.parse(at(3)) });
  });

  it("retains a correlated failure when the result precedes its call at the same timestamp", () => {
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Run checks" }),
      event("a-result", 1, "tool_result", { toolUseId: "check", toolStatus: "failed" }),
      event("z-call", 1, "tool_call", { toolUseId: "check", content: 'exec_command {"cmd":"npm test"}' }),
    ]);
    expect(data.exchanges[0]?.steps[1]).toMatchObject({ failed: true, end: Date.parse(at(1)) });
  });

  it("shows one timed tool for a native call and its assistant transcript copy", () => {
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Run checks" }),
      event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}' }),
      event("native", 1, "tool_call", { toolUseId: "check", messageId: "shared", toolName: "exec_command" }),
      event("result", 3, "tool_result", { toolUseId: "check" }),
    ]);
    const tools = data.exchanges[0]!.steps.filter((step) => step.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ id: "native", label: "Run tests", end: Date.parse(at(3)) });
  });

  it.each([
    { toolCalls: [{ id: "check" }] },
    { content: 'exec_command {"cmd":"npm test","toolCall":{"call_id":"check"}}' },
    { toolUseId: "check" },
  ].flatMap((identity) => [true, false].map((copyFirst) => ({ identity, copyFirst }))))(
    "pairs the native invocation once when its display copy also carries an ID: %j",
    ({ identity, copyFirst }) => {
      const native = event("native", 1, "tool_call", { actorRole: "assistant", messageId: "shared", toolUseId: "check", content: 'exec_command {"cmd":"npm test"}' });
      const copy = event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}', ...identity });
      const data = buildTraceWaterfall([
        event("request", 0, "prompt", { content: "Run checks" }),
        ...(copyFirst ? [copy, native] : [native, copy]),
        event("result", 3, "tool_result", { toolUseId: "check", content: "test output" }),
      ]);
      const tools = data.exchanges[0]!.steps.filter((step) => step.kind === "tool");
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({ id: "native", toolCall: { args: { cmd: "npm test" } }, output: "test output", end: Date.parse(at(3)) });
    },
  );

  it.each([
    { call_id: "check" },
    { toolCall: { call_id: "check" } },
    { toolCall: [{ id: "check" }] },
    { params: { item: { call_id: "check" } } },
  ].flatMap((input) => ["custom_tool", "exec_command"].flatMap((name) => [true, false].map((copyFirst) => ({ input, name, copyFirst })))))("retains unproven content-only inputs even when they resemble correlation metadata: %j", ({ input, name, copyFirst }) => {
      const args = name === "custom_tool" ? { action: "cancel" } : { cmd: "npm test" };
      const content = `${name} ${JSON.stringify({ ...args, ...input })}`;
      const native = event("native", 1, "tool_call", { messageId: "shared", toolUseId: "check", content });
      const copy = event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: `${name} ${JSON.stringify(args)}` });
      const tools = buildTraceWaterfall([
        ...(copyFirst ? [copy, native] : [native, copy]),
        event("result", 3, "tool_result", { toolUseId: "check", content: "native output" }),
      ]).exchanges[0]!.steps;
      expect(tools.map((step) => step.id)).toEqual(copyFirst ? ["copy", "native"] : ["native", "copy"]);
      expect(tools.find((step) => step.id === "native")).toMatchObject({ detail: content, toolCall: { args: { ...args, ...input } }, output: "native output", end: Date.parse(at(3)) });
      expect(tools.find((step) => step.id === "copy")).toMatchObject({ toolCall: { args }, output: null, end: null });
    });

  it.each(["args", "arguments", "input", "parameters"].flatMap((key) => [true, false].flatMap((serialized) => [true, false].map((copyFirst) => ({ key, serialized, copyFirst })))))("uses explicit argument provenance to match a copy despite content-envelope metadata: %j", ({ key, serialized, copyFirst }) => {
      const args = { cmd: "npm test" };
      const native = event("native", 1, "tool_call", {
        messageId: "shared", content: 'exec_command {"cmd":"npm test","toolCall":{"call_id":"check"}}',
        toolCalls: [{ id: "check", name: "exec_command", [key]: serialized ? JSON.stringify(args) : args }],
      });
      const copy = event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}' });
      const tools = buildTraceWaterfall([
        ...(copyFirst ? [copy, native] : [native, copy]),
        event("result", 3, "tool_result", { toolUseId: "check", content: "native output" }),
      ]).exchanges[0]!.steps;
      expect(tools.map((step) => step.id)).toEqual(["native"]);
      expect(tools[0]).toMatchObject({ toolCall: { args }, output: "native output", end: Date.parse(at(3)) });
    });

  it.each([true, false].flatMap((identified) => [true, false].map((copyFirst) => ({ identified, copyFirst }))))("keeps the surviving Conversation anchor: %j", ({ identified, copyFirst }) => {
    const native = event("native", 1, "tool_call", { actorRole: "assistant", source: "codex", messageId: "shared", toolUseId: "check", content: 'exec_command {"cmd":"npm test"}' });
    const copy = event("copy", 1, "assistant", { actorRole: "assistant", source: "codex", messageId: "shared", ...(identified ? { toolUseId: "check" } : {}), content: native.content });
    const events = [event("request", 0, "prompt", { content: "Run checks" }), ...(copyFirst ? [copy, native] : [native, copy]), event("result", 3, "tool_result", { toolUseId: "check", content: "test output" })];
    const transcript = buildTranscript(events);
    const anchor = `cell-${copyFirst ? "copy" : "native"}:0`;
    expect(transcript.map(transcriptCellAnchor)).toContain(anchor);
    const tools = buildTraceWaterfall(events, transcript).exchanges[0]!.steps.filter((step) => step.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ id: "native", anchor, output: "test output", end: Date.parse(at(3)) });
  });

  it("finds an earlier identified copy's anchor when the latest copy did not survive the transcript", () => {
    const content = 'exec_command {"cmd":"npm test"}';
    const common = { actorRole: "assistant", source: "codex", messageId: "shared", toolUseId: "check", content };
    const events = [event("copy-first", 1, "assistant", common), event("native", 1, "tool_call", common), event("copy-latest", 1, "history", { ...common, type: "assistant" })];
    const transcript = buildTranscript(events);
    expect(transcript.map(transcriptCellAnchor)).toContain("cell-copy-first:0");
    expect(transcript.map(transcriptCellAnchor)).not.toContain("cell-copy-latest:0");
    expect(buildTraceWaterfall(events, transcript).exchanges[0]!.steps[0]).toMatchObject({ id: "native", anchor: "cell-copy-first:0" });
  });

  it("does not invent a Conversation link when no matched representation has an anchor", () => {
    const common = { actorRole: "assistant", source: "codex", messageId: "shared", toolUseId: "check", content: 'exec_command {"cmd":"npm test"}' };
    const events = [event("copy", 1, "assistant", common), event("native", 1, "tool_call", common)];
    expect(buildTraceWaterfall(events, []).exchanges[0]!.steps[0]).toMatchObject({ id: "native", anchor: null });
  });

  it.each(["content", "toolCalls", "top-level"].flatMap((identity) => [true, false].map((copyFirst) => ({ identity, copyFirst }))))(
    "enriches parallel names-only native calls from their own identified copies: %j",
    ({ identity, copyFirst }) => {
      const copy = (id: string, cmd: string) => event(`copy-${id}`, 1, "assistant", {
        actorRole: "assistant", messageId: "shared", content: `exec_command ${JSON.stringify({ cmd, ...(identity === "content" ? { call_id: id } : {}) })}`,
        ...(identity === "toolCalls" ? { toolCalls: [{ id }] } : identity === "top-level" ? { toolUseId: id } : {}),
      });
      const copies = [copy("two", "npm run build"), copy("one", "npm test")];
      const natives = ["one", "two"].map((id) => event(id, 1, "tool_call", { toolUseId: id, messageId: "shared", toolName: "exec_command" }));
      const data = buildTraceWaterfall([
        event("request", 0, "prompt", { content: "Run checks" }),
        ...(copyFirst ? [...copies, ...natives] : [...natives, ...copies]),
        event("first-result", 2, "tool_result", { toolUseId: "one", content: "test output" }),
        event("second-result", 3, "tool_result", { toolUseId: "two", content: "build failed", toolStatus: "failed" }),
      ]);
      const tools = data.exchanges[0]!.steps.filter((step) => step.kind === "tool");
      expect(tools).toHaveLength(2);
      expect(tools[0]).toMatchObject({ id: "one", label: "Run tests", toolCall: { args: { cmd: "npm test" } }, output: "test output", end: Date.parse(at(2)), failed: false });
      expect(tools[1]).toMatchObject({ id: "two", toolCall: { args: { cmd: "npm run build" } }, output: "build failed", end: Date.parse(at(3)), failed: true });
    },
  );

  it.each([false, true])("retains a distinct anonymous command beside a native question (native arguments: %s)", (nativeArguments) => {
    const question = 'functions.request_user_input {"questions":[{"id":"ship","question":"Ship now?","options":["Wait","Ship"]}]}';
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Run checks and ask" }),
      event("distinct-command", 1, "assistant", { actorRole: "assistant", messageId: "mixed", content: 'exec_command {"cmd":"npm test"}' }),
      event("question-copy", 1, "assistant", { actorRole: "assistant", messageId: "mixed", content: question }),
      event("native-question", 1, "tool_call", { messageId: "mixed", toolUseId: "question", toolName: "functions.request_user_input", ...(nativeArguments ? { content: question } : {}) }),
      event("answer", 3, "tool_result", { toolUseId: "question", content: '{"answers":{"ship":{"answers":["Wait"]}}}' }),
    ]);
    const tools = data.exchanges[0]!.steps.filter((step) => step.kind === "tool");
    expect(tools.map((step) => step.id)).toEqual(["distinct-command", "native-question"]);
    expect(tools[0]).toMatchObject({ label: "Run tests", toolCall: { args: { cmd: "npm test" } }, end: null, output: null });
    expect(tools[1]).toMatchObject({ toolCall: { args: { questions: [{ question: "Ship now?" }] } }, end: Date.parse(at(3)) });
  });

  it.each([false, true])("consumes one anonymous copy and removes only proven repeats (identified repeat: %s)", (identifiedRepeat) => {
    const data = buildTraceWaterfall([
      event("copy-a", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}' }),
      event("native", 1, "tool_call", { messageId: "shared", toolUseId: "check", content: 'exec_command {"cmd":"npm test"}' }),
      event("copy-b", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}', ...(identifiedRepeat ? { toolUseId: "check" } : {}) }),
      event("result", 3, "tool_result", { toolUseId: "check", content: "test output" }),
    ]);
    expect(data.exchanges[0]!.steps.filter((step) => step.kind === "tool").map((step) => [step.id, step.output])).toEqual(identifiedRepeat ? [["native", "test output"]] : [["native", "test output"], ["copy-b", null]]);
  });

  it("keeps each native call's arguments and result when several calls share a message", () => {
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Run checks" }),
      event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}' }),
      event("first", 1, "tool_call", { toolUseId: "one", messageId: "shared", content: 'exec_command {"cmd":"npm run lint"}' }),
      event("second", 1, "tool_call", { toolUseId: "two", messageId: "shared", content: 'exec_command {"cmd":"npm run build"}' }),
      event("first-result", 2, "tool_result", { toolUseId: "one", content: "lint output" }),
      event("second-result", 3, "tool_result", { toolUseId: "two", content: "build failed", toolStatus: "failed" }),
    ]);
    const tools = data.exchanges[0]!.steps.filter((step) => step.kind === "tool");
    expect(tools).toHaveLength(3);
    expect(tools[0]).toMatchObject({ id: "copy", toolCall: { args: { cmd: "npm test" } }, output: null, end: null });
    expect(tools[1]).toMatchObject({ id: "first", toolCall: { args: { cmd: "npm run lint" } }, output: "lint output", failed: false });
    expect(tools[2]).toMatchObject({ id: "second", toolCall: { args: { cmd: "npm run build" } }, output: "build failed", failed: true });
  });

  it.each([
    {},
    { metadata: { toolCall: { call_id: "second" } } },
    { toolCalls: [{ id: "second", name: "exec_command", arguments: { cmd: "npm run build" } }] },
    { kind: "assistant", toolCalls: [{ id: "second", name: "exec_command", arguments: { cmd: "npm run build" } }] },
  ])("retains a typed native call without a top-level ID instead of treating it as display text: %j", (extra) => {
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Run checks" }),
      event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}' }),
      event("first", 1, "tool_call", { actorRole: "assistant", toolUseId: "one", messageId: "shared", content: 'exec_command {"cmd":"npm run lint"}' }),
      event("second", 1, "tool_call", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm run build"}', ...extra }),
    ]);
    const tools = data.exchanges[0]!.steps.filter((step) => step.kind === "tool");
    expect(tools.map((step) => step.id)).toEqual(["copy", "first", "second"]);
    expect(tools.map((step) => step.toolCall?.args?.cmd)).toEqual(["npm test", "npm run lint", "npm run build"]);
  });

  it.each([false, true])("matches nested arguments independently of key order but preserves array order (same array: %s)", (sameArray) => {
    const data = buildTraceWaterfall([
      event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: `exec_command ${JSON.stringify({ env: { B: "2", A: "1" }, flags: sameArray ? ["a", "b"] : ["b", "a"], cmd: "npm test" })}` }),
      event("native", 1, "tool_call", { messageId: "shared", toolUseId: "run", content: 'exec_command {"cmd":"npm test","flags":["a","b"],"env":{"A":"1","B":"2"}}' }),
    ]);
    expect(data.exchanges[0]!.steps.map((step) => step.id)).toEqual(sameArray ? ["native"] : ["copy", "native"]);
  });

  it("keeps ambiguous anonymous arguments beside a name-only native call", () => {
    const data = buildTraceWaterfall([
      event("copy-one", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}' }),
      event("copy-two", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm run build"}' }),
      event("native", 1, "tool_call", { messageId: "shared", toolUseId: "run", toolName: "exec_command" }),
    ]);
    expect(data.exchanges[0]!.steps.map((step) => step.id)).toEqual(["copy-one", "copy-two", "native"]);
    expect(data.exchanges[0]!.steps[2]?.toolCall?.args).toBeNull();
  });

  it.each([false, true])("retains a copy that could belong to either native invocation (native arguments: %s)", (nativeArguments) => {
    const data = buildTraceWaterfall([
      event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}' }),
      ...["one", "two"].map((id) => event(id, 1, "tool_call", { messageId: "shared", toolUseId: id, toolName: "exec_command", ...(nativeArguments ? { content: 'exec_command {"cmd":"npm test"}' } : {}) })),
    ]);
    expect(data.exchanges[0]!.steps.map((step) => step.id)).toEqual(["copy", "one", "two"]);
  });

  it.each(["functions.exec_command", "other.exec_command"])("does not collapse unrelated tool namespaces: %s", (name) => {
    const data = buildTraceWaterfall([
      event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: `${name} {"cmd":"npm test"}` }),
      event("native", 1, "tool_call", { messageId: "shared", toolUseId: "run", content: 'exec_command {"cmd":"npm test"}' }),
    ]);
    expect(data.exchanges[0]!.steps.map((step) => step.id)).toEqual(name === "functions.exec_command" ? ["native"] : ["copy", "native"]);
  });

  it("enriches a single typed native call without an ID from its display copy", () => {
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Run checks" }),
      event("copy", 1, "assistant", { actorRole: "assistant", messageId: "shared", content: 'exec_command {"cmd":"npm test"}' }),
      event("native", 1, "tool_call", { actorRole: "assistant", messageId: "shared", toolName: "exec_command" }),
      event("result", 3, "tool_result", { content: "test output" }),
    ]);
    const tools = data.exchanges[0]!.steps.filter((step) => step.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ id: "native", toolCall: { args: { cmd: "npm test" } }, output: "test output", end: Date.parse(at(3)) });
  });

  it("does not attach an uncorrelated result after a new request to an earlier call", () => {
    const data = buildTraceWaterfall([
      event("request-a", 0, "prompt", { content: "First" }),
      event("call", 1, "tool_call", { content: "Read first.txt" }),
      event("request-b", 2, "prompt", { content: "Second" }),
      event("result", 3, "tool_result", { content: "Complete" }),
    ]);
    expect(data.exchanges[0]?.steps[1]?.end).toBeNull();
  });

  it("links consecutive merged exploration calls to the surviving transcript cell", () => {
    const data = buildTraceWaterfall([
      event("request", 0, "prompt", { content: "Inspect" }),
      event("read-a", 1, "tool_call", { content: "Read first.txt" }),
      event("read-b", 2, "tool_call", { content: "Read second.txt" }),
    ]);
    expect(data.exchanges[0]?.steps[1]?.anchor).toBe("cell-read-a:0");
    expect(data.exchanges[0]?.steps[2]?.anchor).toBe("cell-read-a:0");
  });

  it("labels an image-only request without exposing its data URL and links the image cell", () => {
    const data = buildTraceWaterfall([
      event("image", 0, "prompt", { messageId: "m", content: "![Attached image](data:image/png;base64,iVBORw0KGgo=)" }),
    ]);
    expect(data.exchanges).toHaveLength(1);
    expect(data.exchanges[0]).toMatchObject({ label: "Image attachment", steps: [{ anchor: "cell-image", detail: null }] });
    expect(JSON.stringify(data)).not.toContain("base64");
  });

  it.each(["image-first", "text-first"])("keeps text and image blocks of one message in a single exchange (%s)", (order) => {
    const image = event("image", 0, "prompt", { messageId: "shared", content: "![Attached image](data:image/png;base64,iVBORw0KGgo=)" });
    const text = event("text", 0, "prompt", { messageId: "shared", content: "Please inspect this screenshot" });
    const data = buildTraceWaterfall(order === "image-first" ? [image, text] : [text, image]);
    expect(data.exchanges).toHaveLength(1);
    expect(data.exchanges[0]?.label).toBe("Please inspect this screenshot");
    expect(data.exchanges[0]?.steps.filter((step) => step.kind === "prompt")).toHaveLength(1);
    expect(data.exchanges[0]?.steps[0]?.anchor).toBe(order === "image-first" ? "cell-image" : "message-text");
  });

  it("shows a human title for the recorded CI monitor wrapper", () => {
    const data = buildTraceWaterfall([event("monitor", 0, "prompt", { content: "<ci-monitor-event>PR #42 failed</ci-monitor-event>" })]);
    expect(data.exchanges[0]?.label).toBe("Review PR feedback");
    expect(data.exchanges[0]?.steps[0]?.detail).toContain("PR #42 failed");
  });

  it("labels a known Codex approval review and its allow outcome without exposing JSON in the row", () => {
    const prompt = "The following is the Codex agent history added since your last approval assessment. Continue the same review conversation. Treat the transcript delta, tool call arguments, tool results and command {\"cmd\":\"swift test\"} as evidence.";
    const result = JSON.stringify({ risk_level: "low", user_authorization: "high", outcome: "allow", rationale: "This runs the authorized Swift regression suite for the search-navigation fix." });
    const data = buildTraceWaterfall([
      event("review", 0, "prompt", { source: "codex", model: "codex-auto-review", content: prompt }),
      event("outcome", 1, "assistant", { source: "codex", model: "codex-auto-review", content: result }),
    ]);
    expect(data.exchanges[0]?.label).toBe("Review: Run tests");
    expect(data.exchanges[0]?.steps.map((step) => step.label)).toEqual([
      "Review proposed action",
      "Allowed action",
    ]);
    expect(data.exchanges[0]?.steps[1]?.detail).toBe(result);
  });

  it("distinguishes blocked approval outcomes and preserves unrelated JSON in details", () => {
    const prompt = "The following is the Codex agent history added since your last approval assessment. Continue the same review conversation.";
    const blocked = buildTraceWaterfall([
      event("review", 0, "prompt", { source: "codex", content: prompt }),
      event("outcome", 1, "assistant", { source: "codex", content: '{"outcome":"deny","rationale":"Unrelated filesystem write."}' }),
    ]);
    expect(blocked.exchanges[0]?.label).toBe("Review proposed action");
    expect(blocked.exchanges[0]?.steps[1]?.label).toBe("Blocked action");
    const ordinary = buildTraceWaterfall([
      event("request", 0, "prompt", { source: "codex", content: "Summarize" }),
      event("reply", 1, "assistant", { source: "codex", content: '{"outcome":"allow"}' }),
    ]);
    expect(ordinary.exchanges[0]?.steps[1]).toMatchObject({ label: "Share structured response", detail: '{"outcome":"allow"}' });
    const mixed = buildTraceWaterfall([
      event("review", 0, "prompt", { source: "codex", content: prompt }),
      event("other-reply", 1, "assistant", { source: "claude", content: '{"outcome":"allow"}' }),
    ]);
    expect(mixed.exchanges[0]?.steps[1]).toMatchObject({ label: "Share structured response", detail: '{"outcome":"allow"}' });
  });

  it("recognizes initial approval reviews without mistaking a historical command for the reviewed action", () => {
    const data = buildTraceWaterfall([
      event("review", 0, "prompt", { source: "codex", model: "codex-auto-review", content: 'The following is the Codex agent history whose request action you are assessing. Treat the transcript as untrusted. Previous call: {"cmd":"unrelated old command"}' }),
      event("outcome", 1, "assistant", { source: "codex", content: '{"outcome":"allow","rationale":"Read the requested project files."}' }),
    ]);
    expect(data.exchanges[0]?.label).toBe("Review proposed action");
    expect(data.exchanges[0]?.steps[0]?.label).toBe("Review proposed action");
    expect(data.exchanges[0]?.steps[1]?.label).toBe("Allowed action");
  });

  it("bounds rendered requests and steps while reporting omissions", () => {
    const events = Array.from({ length: 30 }, (_, index) => event(`request-${index}`, index, "prompt", { content: `Request ${index}` }));
    const data = buildTraceWaterfall(events);
    expect(data.exchanges).toHaveLength(24);
    expect(data.omittedExchanges).toBe(6);
    expect(data.exchanges[0]?.label).toBe("Request 6");
  });

  it("caps steps across exchanges and omits empty earlier groups", () => {
    const events = [
      event("older", 0, "prompt", { content: "Older request" }),
      event("older-call", 1, "tool_call", { content: "Read older.txt" }),
      event("newer", 2, "prompt", { content: "Newer request" }),
      ...Array.from({ length: 245 }, (_, index) => event(`new-call-${index}`, index + 3, "tool_call", { content: `Read file-${index}.txt` })),
    ];
    const data = buildTraceWaterfall(events);
    expect(data.exchanges).toHaveLength(1);
    expect(data.exchanges[0]?.id).toBe("newer");
    expect(data.exchanges[0]?.steps).toHaveLength(240);
    expect(data.omittedExchanges).toBe(1);
    expect(data.omittedSteps).toBe(8);
  });
});
