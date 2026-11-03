// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { expect, it } from "vitest";
import { mergeReplayPage } from "./replay-pages";
import {
  mergeReplayStreams,
  toReplayEvent,
  toReplayTurn,
  type ReplayState,
} from "./replay-model";

function page(
  ids: number[],
  extra: Partial<ReplayState> = {},
  turnIds = ids,
): ReplayState {
  const streams = {
    events: ids.map(
      (id) =>
        toReplayEvent({
          eventId: `e${id}`,
          ts: `2026-09-08T10:00:0${id}Z`,
          kind: "edit",
          content: `edit ${id}`,
        })!,
    ),
    turns: turnIds.map(
      (id) =>
        toReplayTurn({
          id: `t${id}`,
          ts: `2026-09-08T10:00:0${id}Z`,
          role: "assistant",
          content: `reply ${id}`,
        })!,
    ),
  };
  return {
    streams,
    events: mergeReplayStreams(streams.events, streams.turns),
    nextCursor: null,
    turnsNextCursor: null,
    error: null,
    ...extra,
  };
}

it("prepends older events, appends forward turns, and is idempotent", () => {
  const loaded = page([2, 3], {}, [0, 1]);
  const older = page([0, 1, 2], {}, [1, 2, 3]);
  const merged = mergeReplayPage(loaded, older);
  expect(merged.streams?.events.map((row) => row.eventId)).toEqual([
    "e0",
    "e1",
    "e2",
    "e3",
  ]);
  expect(merged.streams?.turns.map((row) => row.eventId)).toEqual([
    "t0",
    "t1",
    "t2",
    "t3",
  ]);
  expect(merged.events).toEqual(page([0, 1, 2, 3]).events);
  expect(mergeReplayPage(merged, older)).toEqual(merged);
  expect(loaded).toEqual(page([2, 3], {}, [0, 1]));
});

it("keeps incoming duplicate values and incoming cursor, source, and error state", () => {
  const loaded = page([1, 2], {
    nextCursor: "old-e",
    turnsNextCursor: "old-t",
  });
  const older = page([0, 1], {
    nextCursor: "retry-e",
    turnsNextCursor: "retry-t",
    source: "claude",
    error: "retry",
  });
  older.streams!.events[1].content = "updated edit";
  older.streams!.turns[1].content = "updated reply";
  const merged = mergeReplayPage(loaded, older);
  expect(merged.streams?.events[1].content).toBe("updated edit");
  expect(merged.streams?.turns[0].content).toBe("updated reply");
  expect(merged).toMatchObject({
    nextCursor: "retry-e",
    turnsNextCursor: "retry-t",
    source: "claude",
    error: "retry",
  });
});

it("preserves equal-timestamp row order across the older page boundary", () => {
  const loaded = page([2, 3], {}, [0, 1]);
  const older = page([0, 1], {}, [2, 3]);
  for (const state of [loaded, older]) {
    for (const row of [...state.streams!.events, ...state.streams!.turns]) {
      row.ts = "2026-09-08T10:00:00Z";
    }
  }
  const merged = mergeReplayPage(loaded, older);
  expect(merged.streams?.events.map((row) => row.eventId)).toEqual([
    "e0",
    "e1",
    "e2",
    "e3",
  ]);
  expect(merged.streams?.turns.map((row) => row.eventId)).toEqual([
    "t0",
    "t1",
    "t2",
    "t3",
  ]);
});
