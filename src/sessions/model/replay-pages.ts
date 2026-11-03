// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import {
  mergeReplayStreams,
  type ReplayEvent,
  type ReplayState,
} from "./replay-model";

export function mergeReplayPage(
  current: ReplayState,
  page: ReplayState,
): ReplayState {
  const streamsFor = (state: ReplayState) =>
    state.streams ?? {
      events: state.events.filter((event) => event.stream !== "turns"),
      turns: state.events.filter((event) => event.stream === "turns"),
    };
  const before = streamsFor(current);
  const next = streamsFor(page);
  const combine = (ordered: ReplayEvent[], incoming: ReplayEvent[]) => {
    const byId = new Map<string, ReplayEvent>();
    for (const row of ordered) byId.set(row.eventId, row);
    // An overlapping page can contain a fuller or corrected row.
    for (const row of incoming) byId.set(row.eventId, row);
    return [...byId.values()];
  };
  const streams = {
    events: combine([...next.events, ...before.events], next.events),
    turns: combine([...before.turns, ...next.turns], next.turns),
  };
  return {
    ...page,
    streams,
    events: mergeReplayStreams(streams.events, streams.turns),
  };
}
