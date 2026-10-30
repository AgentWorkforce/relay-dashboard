import { expect, it } from "vitest";
import { replayUrl, sessionStatus, uniqueSessions } from "./sessions";
import type { Session } from "./api/contracts";
const row: Session = {
  sessionId: "same/id",
  source: "codex",
  userIds: [],
  machineIds: [],
};
it("keeps sessions with the same id from distinct sources", () => {
  expect(
    uniqueSessions([{ items: [row, row, { ...row, source: "claude" }] }]),
  ).toHaveLength(2);
});
it("does not label stale observations as active", () => {
  expect(
    sessionStatus({
      ...row,
      workState: { status: "active", updatedAt: "2020-01-01" },
    }),
  ).toBe("Idle");
});
it("carries source and workspace into conversation links", () => {
  const url = new URL(replayUrl("https://agentrelay.com", "workspace", row));
  expect(url.pathname).toBe("/cloud/dashboard/sessions/same%2Fid");
  expect(url.searchParams.get("workspace")).toBe("workspace");
  expect(url.searchParams.get("source")).toBe("codex");
});
