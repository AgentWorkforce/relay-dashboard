import { expect, it } from "vitest";
import { toReplayEvent, type ReplayEvent } from "./model/replay-model";
import { buildTranscript } from "./model/transcript-cells";
import {
  collapseHistoryCopies,
  transcriptCounts,
  withRecordedFileEdits,
} from "./transcript-extras";

const event = (value: Record<string, unknown>) =>
  toReplayEvent(value) as ReplayEvent;

it("adds recorded file edits the tool calls do not already show", () => {
  const events = [
    event({
      eventId: "p",
      ts: "2026-11-02T18:00:00.000Z",
      kind: "prompt",
      content: "Fix it",
    }),
    event({
      eventId: "c",
      ts: "2026-11-02T18:00:01.000Z",
      kind: "tool_call",
      toolName: "Edit",
      content:
        'Edit {"file_path":"src/a.ts","old_string":"a","new_string":"b"}',
    }),
    event({
      eventId: "f1",
      ts: "2026-11-02T18:00:02.000Z",
      kind: "file_edit",
      type: "file_edit",
      projectId: "/w",
      content: "/w/src/a.ts",
      filesTouched: ["/w/src/a.ts"],
    }),
    event({
      eventId: "f2",
      ts: "2026-11-02T18:00:03.000Z",
      kind: "file_edit",
      type: "file_edit",
      projectId: "/w",
      content: "/w/src/b.ts",
      filesTouched: ["/w/src/b.ts"],
    }),
    event({
      eventId: "r",
      ts: "2026-11-02T18:00:04.000Z",
      kind: "assistant",
      content: "Done",
    }),
  ];
  const cells = withRecordedFileEdits(buildTranscript(events), events);
  const edited = cells.filter((cell) => cell.kind === "edited");
  expect(
    edited.map(
      (cell) => cell.kind === "edited" && cell.files.map((file) => file.path),
    ),
  ).toEqual([["src/a.ts"], ["src/b.ts"]]);
  expect(cells.findIndex((cell) => cell.id === "f2")).toBeLessThan(
    cells.findIndex((cell) => cell.kind === "assistant"),
  );
  expect(transcriptCounts(cells)).toEqual({ prompts: 1, tools: 2 });
});

it("collapses a raw history copy into its projected message", () => {
  const events = [
    event({
      eventId: "s",
      ts: "2026-09-01T10:00:00.000Z",
      kind: "session_event",
      type: "user",
      actorRole: "user",
      userId: "u1",
      content: "offlinefixture local-only",
    }),
    event({
      eventId: "h",
      ts: "2026-09-01T10:00:00.000Z",
      kind: "history",
      type: "history",
      actorRole: "user",
      content: "offlinefixture local-only",
    }),
    event({
      eventId: "later",
      ts: "2026-09-01T10:05:00.000Z",
      kind: "history",
      type: "history",
      actorRole: "user",
      content: "offlinefixture local-only",
    }),
  ];
  expect(collapseHistoryCopies(events).map((row) => row.eventId)).toEqual([
    "s",
    "later",
  ]);
  const cells = buildTranscript(collapseHistoryCopies(events.slice(0, 2)));
  expect(cells.filter((cell) => cell.kind === "user")).toHaveLength(1);
});
