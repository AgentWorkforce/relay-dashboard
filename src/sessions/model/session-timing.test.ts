// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { expect, it } from "vitest";
import { formatRelativeTime, formatSessionDuration } from "./session-timing";

const base = Date.parse("2026-10-04T12:00:00Z");
const at = (seconds: number) => new Date(base + seconds * 1000).toISOString();

it.each([
  [null, "—"],
  [-1, "—"],
  [NaN, "—"],
  [Infinity, "—"],
  [0, "0s"],
  [500, "500ms"],
  [59500, "1m"],
  [125000, "2m 5s"],
  [3661000, "1h 1m"],
  [176400000, "2d 1h"],
])("formats measured duration %s as %s", (ms, expected) => {
  expect(formatSessionDuration(ms as number | null)).toBe(expected);
});
it("formats relative timestamps against the supplied clock, handling future and invalid values", () => {
  expect(formatRelativeTime(at(0), base + 59000)).toBe("Just now");
  expect(formatRelativeTime(at(0), base + 120000)).toBe("2 minutes ago");
  expect(formatRelativeTime(at(0), base + 7200000)).toBe("2 hours ago");
  expect(formatRelativeTime(at(0), base + 172800000)).toBe("2 days ago");
  expect(formatRelativeTime(at(5), base)).toBe("Just now");
  expect(formatRelativeTime("invalid", base)).toBe("—");
  expect(formatRelativeTime(at(0), NaN)).toBe("—");
});

it.each([
  [60_000, "1 minute ago"],
  [3_600_000, "1 hour ago"],
  [86_400_000, "1 day ago"],
  [518_400_000, "6 days ago"],
])(
  "uses readable singular/plural relative units at %i ms",
  (elapsed, expected) => {
    expect(formatRelativeTime(at(0), base + Number(elapsed))).toBe(expected);
  },
);
