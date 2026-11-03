import { expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLoad } from "./use-load";
import { mergeReplay, replayTurnAliases, resumeCommand, toReplayEvent, toReplayTurn, type ReplayEvent } from "./model/replay-model";
import { displayUserMessage } from "./model/transcript-display";
import { buildTranscript } from "./model/transcript-cells";

const event = (value: Record<string, unknown>) => toReplayEvent(value) as ReplayEvent;

it("does not report a revisited key's old result as settled", async () => {
  const pending: Record<string, (value: string) => void> = {};
  const { result, rerender } = renderHook(
    ({ id }) =>
      useLoad(id, () => new Promise<string>((resolve) => (pending[id] = resolve))),
    { initialProps: { id: "a" } },
  );
  await act(async () => pending.a!("first a"));
  expect(result.current).toMatchObject({ data: "first a", loading: false });
  rerender({ id: "b" });
  rerender({ id: "a" });
  expect(result.current.loading).toBe(true);
  await act(async () => pending.a!("second a"));
  expect(result.current).toMatchObject({ data: "second a", loading: false });
});

it("offers resume for Claude source aliases and keeps ~ expandable", () => {
  const events = [
    event({
      eventId: "e",
      ts: "2026-11-02T10:00:00Z",
      kind: "prompt",
      source: "claude-terminal",
      projectPath: "~/work/relay",
      content: "hi",
    }),
  ];
  expect(resumeCommand(events, "s1")).toBe("cd ~/work/relay && claude --resume s1");
});

it("shows local-command stderr when stdout is empty", () => {
  expect(
    displayUserMessage(
      "<local-command-stdout></local-command-stdout><local-command-stderr>boom</local-command-stderr>",
    ),
  ).toMatchObject({ kind: "notice", text: "boom" });
});

it("keeps system turns as context", () => {
  const turn = toReplayTurn({ id: "t", role: "system", content: "Be brief.", ts: "2026-11-02T10:00:00Z" });
  expect(turn?.actorRole).toBe("system");
});

it("keeps background-terminal output", () => {
  const cells = buildTranscript([
    event({
      eventId: "c",
      ts: "2026-11-02T10:00:00Z",
      kind: "session_event",
      type: "function_call",
      source: "codex",
      toolName: "write_stdin",
      toolUseId: "w1",
      content: 'write_stdin {"session_id":1,"chars":""}',
    }),
    event({
      eventId: "r",
      ts: "2026-11-02T10:00:01Z",
      kind: "session_event",
      type: "function_call_output",
      source: "codex",
      toolUseId: "w1",
      content: "server listening on 3000",
    }),
  ]);
  expect(cells.find((cell) => cell.kind === "notice")).toMatchObject({
    output: "server listening on 3000",
  });
});

it("aliases cited events to turns with the merge's FIFO pairing", () => {
  const ts = "2026-11-02T10:00:00.000Z";
  const events = [
    { eventId: "e1", ts, kind: "prompt", source: "codex", content: "one" },
    { eventId: "e2", ts, kind: "prompt", source: "codex", content: "two" },
    { eventId: "a1", ts, kind: "assistant", source: "codex", content: "ok" },
  ];
  const turns = [
    { id: "t-assistant", role: "assistant", ts, content: "ok" },
    { id: "t1", role: "user", ts, content: "one" },
    { id: "t2", role: "user", ts, content: "two" },
  ];
  const aliases = replayTurnAliases(events, turns);
  expect(aliases.get("e1")).toBe("t1");
  expect(aliases.get("e2")).toBe("t2");
  expect(aliases.get("a1")).toBe("t-assistant");
  // The transcript renders exactly those turn ids.
  expect(
    mergeReplay(events, turns)
      .map((row) => row.eventId)
      .sort(),
  ).toEqual(["t-assistant", "t1", "t2"]);
});
