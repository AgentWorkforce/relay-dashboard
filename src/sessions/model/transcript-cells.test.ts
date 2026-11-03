// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { describe, expect, it } from "vitest";
import type { ReplayEvent } from "./replay-model";
import {
  buildTranscript,
  commandResult,
  parsePatch,
  scriptOperations,
  toolCells,
} from "./transcript-cells";

let seq = 0;
function row(extra: Partial<ReplayEvent>): ReplayEvent {
  seq += 1;
  return {
    eventId: `e${seq}`,
    ts: `2026-09-21T12:00:${String(seq).padStart(2, "0")}.000Z`,
    kind: "session_event",
    type: "",
    actorName: null,
    actorRole: "assistant",
    source: "claude",
    model: null,
    machineId: "m",
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
const call = (content: string, id: string, extra: Partial<ReplayEvent> = {}) =>
  row({ type: "tool_use", content, toolUseId: id, ...extra });
const result = (content: string | null, id: string, extra: Partial<ReplayEvent> = {}) =>
  row({ type: "tool_result", actorRole: "tool_result", content, toolUseId: id, ...extra });
const cellsFor = (callEvent: ReplayEvent, resultEvent: ReplayEvent | null) =>
  toolCells({ call: callEvent, result: resultEvent });

describe("toolCells", () => {
  it("renders recorded `Name target` shell calls as Ran with output and exit code", () => {
    expect(cellsFor(call("Bash npm test", "a"), result("Exit code 1\nFAIL parser", "a"))).toEqual([
      { kind: "exec", title: "Ran", command: "npm test", output: "FAIL parser", recorded: true, failed: true, exitCode: 1 },
    ]);
    expect(
      cellsFor(
        call('exec_command {"cmd":"cargo build","workdir":"/w"}', "b", { source: "codex" }),
        result("Chunk ID: 1\nWall time: 0.1 seconds\nProcess exited with code 0\nOriginal token count: 3\nOutput:\nFinished", "b"),
      ),
    ).toMatchObject([{ kind: "exec", command: "cargo build", output: "Finished", failed: false, exitCode: 0 }]);
  });

  it("groups read, search, and list commands as Explored", () => {
    expect(cellsFor(call("Bash rg -n replay src", "a"), result("src/a.ts:1", "a"))).toEqual([
      { kind: "explored", rows: [{ verb: "Search", query: "replay", path: "src" }], failed: false },
    ]);
    expect(cellsFor(call("Read /w/lib/replay-model.ts", "b"), null)).toMatchObject([
      { kind: "explored", rows: [{ verb: "Read", names: ["replay-model.ts"] }] },
    ]);
    expect(cellsFor(call("Grep fetchReplay", "c"), null)).toMatchObject([
      { kind: "explored", rows: [{ verb: "Search", query: "fetchReplay" }] },
    ]);
  });

  it("expands Codex code-mode scripts into one cell per tool call", () => {
    const script =
      'const [a, b] = await Promise.allSettled([tools.exec_command({cmd:"git status --short"}), tools.exec_command({cmd:"cat README.md"})]); text(a); text(b);';
    expect(scriptOperations(script)).toEqual([
      { type: "exec", command: "git status --short" },
      { type: "exec", command: "cat README.md" },
    ]);
    const cells = cellsFor(
      call(`exec ${JSON.stringify({ input: script })}`, "x", { source: "codex" }),
      result(
        'Script completed\nOutput:\n{"i":0,"status":"fulfilled","value":{"exit_code":0,"output":" M a.ts"}}\n{"i":1,"status":"fulfilled","value":{"exit_code":0,"output":"# Readme"}}',
        "x",
      ),
    );
    expect(cells).toEqual([
      { kind: "exec", title: "Ran", command: "git status --short", output: "M a.ts", recorded: true, failed: false, exitCode: 0 },
      { kind: "explored", rows: [{ verb: "Read", names: ["README.md"] }], failed: false },
    ]);
  });

  it("renders patches as Edited with per-file counts and diff lines", () => {
    const patch =
      "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n keep\n*** Add File: src/b.ts\n+hello\n*** End Patch";
    expect(parsePatch(patch)).toEqual([
      {
        verb: "Edited",
        path: "src/a.ts",
        added: 1,
        removed: 1,
        lines: [
          { sign: "-", text: "old" },
          { sign: "+", text: "new" },
          { sign: " ", text: "keep" },
        ],
      },
      { verb: "Added", path: "src/b.ts", added: 1, removed: 0, lines: [{ sign: "+", text: "hello" }] },
    ]);
    expect(cellsFor(call("apply_patch src/a.ts", "p", { source: "codex" }), result("Success", "p"))).toMatchObject([
      { kind: "edited", files: [{ verb: "Edited", path: "src/a.ts" }], failed: false },
    ]);
    expect(
      cellsFor(
        call('Edit {"file_path":"/w/a.ts","old_string":"a","new_string":"b"}', "q"),
        result("<tool_use_error>String not found</tool_use_error>", "q"),
      ),
    ).toMatchObject([{ kind: "edited", failed: true, output: "String not found" }]);
  });

  it("renders plans, web actions, and MCP calls", () => {
    expect(
      cellsFor(call('TodoWrite {"todos":[{"content":"Parse","status":"completed"},{"content":"Render","status":"in_progress"}]}', "t"), null),
    ).toEqual([
      {
        kind: "plan",
        title: "Updated Plan",
        steps: [
          { text: "Parse", status: "completed" },
          { text: "Render", status: "in_progress" },
        ],
        text: null,
      },
    ]);
    expect(cellsFor(call('WebSearch {"query":"codex tui"}', "w"), null)).toEqual([
      { kind: "web", action: "Searched the web for", detail: "codex tui" },
    ]);
    expect(cellsFor(call('mcp__linear__get_issue {"id":"AR-1"}', "m"), result("[{\"type\":\"text\",\"text\":\"Issue AR-1\"}]", "m"))).toEqual([
      { kind: "called", invocation: 'linear.get_issue({"id":"AR-1"})', output: "Issue AR-1", failed: false },
    ]);
  });
});

describe("commandResult", () => {
  it("unwraps Claude's oversized-output wrapper upstream and plain text here", () => {
    expect(commandResult("hello\n")).toEqual({ output: "hello", exitCode: null });
    expect(commandResult('{"output":"ok","metadata":{"exit_code":2}}')).toEqual({ output: "ok", exitCode: 2 });
  });
});

describe("buildTranscript", () => {
  it("builds a Codex-shaped turn and closes it with Worked for", () => {
    const events = [
      row({ kind: "prompt", actorRole: "user", content: "<system-reminder>ctx</system-reminder>\nFix it", ts: "2026-09-21T12:00:00.000Z" }),
      row({ type: "thinking", content: "Let me look", ts: "2026-09-21T12:00:01.000Z" }),
      call("Read /w/a.ts", "r1", { ts: "2026-09-21T12:00:02.000Z" }),
      result("1 code", "r1", { ts: "2026-09-21T12:00:03.000Z" }),
      call("Read /w/b.ts", "r2", { ts: "2026-09-21T12:00:04.000Z" }),
      result("2 code", "r2", { ts: "2026-09-21T12:00:05.000Z" }),
      row({ content: "Fixed.", ts: "2026-09-21T12:02:05.000Z" }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    expect(buildTranscript(events).map(({ id: _id, ts: _ts, ...cell }) => cell)).toEqual([
      { kind: "user", text: "Fix it", attachments: [] },
      { kind: "explored", rows: [{ verb: "Read", names: ["a.ts", "b.ts"] }], failed: false },
      { kind: "assistant", text: "Fixed." },
      { kind: "worked", durationMs: 125_000 },
    ]);
  });

  it("hides a skill's expanded instructions and shows interruptions", () => {
    const events = [
      row({ kind: "prompt", actorRole: "user", content: "<command-name>/review</command-name>", ts: "2026-09-21T12:00:00.000Z" }),
      row({ kind: "prompt", actorRole: "user", content: "Base directory for this skill: /skills/review\n\n# Review", ts: "2026-09-21T12:00:00.500Z" }),
      row({ kind: "prompt", actorRole: "user", content: "[Request interrupted by user]", ts: "2026-09-21T12:00:09.000Z" }),
    ];
    expect(buildTranscript(events).map((cell) => cell.kind === "user" ? cell.text : cell.kind)).toEqual([
      "/review",
      "interrupted",
    ]);
  });
});

describe("relative paths", () => {
  it("shows edited and searched paths relative to the project, including ~ forms", () => {
    const projectPath = "/Users/dev/work/app";
    expect(
      toolCells({ call: call("Edit ~/work/app/src/a.ts", "e", { projectPath }), result: null }),
    ).toMatchObject([{ kind: "edited", files: [{ path: "src/a.ts" }] }]);
    expect(
      toolCells({ call: call("Bash rg foo /Users/dev/work/app/lib", "s", { projectPath }), result: null }),
    ).toMatchObject([{ kind: "explored", rows: [{ verb: "Search", path: "lib" }] }]);
  });
});

describe("review regressions", () => {
  it("keeps a tool result under its call when a reply arrives in between", () => {
    const events = [
      row({ kind: "prompt", actorRole: "user", content: "Test it" }),
      call("Bash npm test", "t1"),
      row({ content: "Running the tests now." }),
      result("12 passed", "t1"),
    ];
    expect(buildTranscript(events).find((cell) => cell.kind === "exec")).toMatchObject({
      command: "npm test",
      output: "12 passed",
    });
  });

  it("keeps a tool result under its call when a hidden injected record arrives in between", () => {
    const events = [
      row({ kind: "prompt", actorRole: "user", content: "Test it" }),
      call("Bash npm test", "h1"),
      row({ kind: "prompt", actorRole: "user", content: "<system-reminder>todo list changed</system-reminder>" }),
      result("12 passed", "h1"),
    ];
    expect(buildTranscript(events).find((cell) => cell.kind === "exec")).toMatchObject({
      output: "12 passed",
    });
  });

  it("bounds code-mode commands to their own call", () => {
    expect(
      scriptOperations('const cmd = "npm test"; await tools.exec_command({cmd}); await tools.exec_command({cmd:"git status"});'),
    ).toEqual([
      { type: "exec", command: "cmd" },
      { type: "exec", command: "git status" },
    ]);
  });

  it("keeps a quick follow-up after a slash command", () => {
    const events = [
      row({ kind: "prompt", actorRole: "user", content: "<command-name>/review</command-name>", ts: "2026-09-21T12:00:00.000Z" }),
      row({ kind: "prompt", actorRole: "user", content: "Focus on tests", ts: "2026-09-21T12:00:01.000Z" }),
      row({ kind: "prompt", actorRole: "user", content: "Base directory for this skill: /skills/ship\n\n# Ship", ts: "2026-09-21T12:00:01.500Z" }),
    ];
    expect(buildTranscript(events).flatMap((cell) => (cell.kind === "user" ? [cell.text] : []))).toEqual([
      "/review",
      "Focus on tests",
    ]);
  });

  it("flags truncated messages and tool results", () => {
    const events = [
      row({ kind: "prompt", actorRole: "user", content: "Go" }),
      row({ content: "Partial answ", contentTruncated: true }),
      call("Bash cat big.log > copy.log", "c"),
      result("line", "c", { contentTruncated: true }),
    ];
    expect(buildTranscript(events).filter((cell) => cell.truncated).map((cell) => cell.kind)).toEqual([
      "assistant",
      "exec",
    ]);
  });

  it("marks generic tools failed from their payload, but not shell output", () => {
    expect(cellsFor(call('mcp__x__y {"a":1}', "m"), result('{"isError":true,"content":"Timeout"}', "m"))).toMatchObject([
      { kind: "called", failed: true },
    ]);
    expect(cellsFor(call("Bash make", "b"), result("Error: deprecated flag\nbuilt", "b"))).toMatchObject([
      { kind: "exec", failed: false },
    ]);
    expect(cellsFor(call("Read /w/errors.md", "r"), result("Error: handling guide", "r"))).toMatchObject([
      { kind: "explored", failed: false },
    ]);
    expect(cellsFor(call("Edit /w/a.ts", "e"), result('{"isError": true} is now handled', "e"))).toMatchObject([
      { kind: "edited", failed: false },
    ]);
  });
});


describe("captured image copies", () => {
  it("renders bytes rather than an image label or raw base64 message", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    expect(buildTranscript([row({ actorRole: "user", type: "text", content: `![Attached image](${url})` })])).toMatchObject([{ kind: "image", url }]);
  });
  it("does not fetch local paths, remote images or active content from transcripts", () => {
    for (const url of ["file:///tmp/image.png", "https://example.com/track.png", "data:image/svg+xml;base64,PHN2Zz4="]) {
      expect(buildTranscript([row({ actorRole: "user", type: "text", content: `![Attached image](${url})` })]).some(cell => cell.kind === "image")).toBe(false);
    }
  });
});

it("keeps image-only user prompts chronological and attached images with text", () => {
  const image = "![Attached image](data:image/png;base64,iVBORw0KGgo=)";
  const events = [
    row({ eventId: "a", actorRole: "user", content: "Question A", ts: "2026-10-12T00:00:00Z", messageId: "a" }),
    row({ eventId: "answer-a", actorRole: "assistant", content: "Answer A", ts: "2026-10-12T00:00:01Z" }),
    row({ eventId: "image", actorRole: "user", content: image, ts: "2026-10-12T00:00:02Z", messageId: "b" }),
    row({ eventId: "answer-b", actorRole: "assistant", content: "Answer B", ts: "2026-10-12T00:00:03Z" }),
  ];
  const transcript = buildTranscript(events);
  expect(transcript.map(c => c.kind)).toEqual(["user", "assistant", "worked", "image", "assistant", "worked"]);
  expect(transcript.filter(c => c.kind === "worked").map(c => c.durationMs)).toEqual([1000, 1000]);
  expect(transcript.filter(c => c.kind !== "worked").map(c => c.id)).toEqual(["a", "answer-a", "image", "answer-b"]);
  const text = row({ eventId: "text", actorRole: "user", content: "Describe this", ts: "2026-10-12T00:00:02Z", messageId: "b" });
  for (const blocks of [[text, events[2]], [events[2], text]]) {
    const cells = buildTranscript([...events.slice(0, 2), ...blocks, events[3]]);
    expect(cells.filter(c => c.kind !== "worked").map(c => c.id)).toEqual(["a", "answer-a", ...blocks.map(e => e.eventId), "answer-b"]);
  }
});

it("groups legacy text and image blocks by their shared timestamp", () => {
  const content = "![Attached image](data:image/png;base64,iVBORw0KGgo=)";
  const cells = buildTranscript([
    row({ eventId: "text", actorRole: "user", content: "Describe this", ts: "2026-10-12T00:00:02Z" }),
    row({ eventId: "image", actorRole: "user", content, ts: "2026-10-12T00:00:02Z" }),
  ]);
  expect(cells.map(c => c.startsExchange)).toEqual([undefined, false]);
});

it("keeps system records inspectable while preserving ordinary environment questions as user messages", () => {
  const cells = buildTranscript([
    row({ eventId: "system", kind: "session_event", actorRole: "system", content: "System-only setup" }),
    row({ eventId: "context", kind: "session_event", actorRole: "user", type: "context", content: "Recorded setup" }),
    row({ eventId: "question", kind: "prompt", content: "# Environment\nExplain our deployment settings" }),
  ]);
  expect(cells.map(cell => cell.kind)).toEqual(["context", "context", "user"]);
  expect(cells[2]).toMatchObject({ text: "# Environment\nExplain our deployment settings" });
});

it("preserves setup snippets quoted by an assistant or returned by a tool", () => {
  const text = "# Environment\nYou have been invoked in the following environment:\n- Example setup";
  const cells = buildTranscript([
    row({ type: "assistant", actorRole: "assistant", content: text }),
    call("Bash print-environment", "setup-output"),
    result(text, "setup-output", { actorRole: "user" }),
  ]);
  expect(cells.filter(cell => cell.kind === "context")).toEqual([]);
  expect(cells.find(cell => cell.kind === "assistant")).toMatchObject({ text });
  expect(cells.find(cell => cell.kind === "exec")).toMatchObject({ output: text });
});
