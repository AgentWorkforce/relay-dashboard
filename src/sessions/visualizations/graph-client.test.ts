import { beforeEach, expect, it, vi } from "vitest";
import { SignedOut } from "../../api/client";
import { loadGraphDetail, loadGraphRelationships, readGraphCatalog, readGraphReplay } from "./graph-client";

const mocks = vi.hoisted(() => ({ read: vi.fn(), events: vi.fn(), turns: vi.fn(), list: vi.fn() }));
vi.mock("../../api/client", () => ({ read: mocks.read, SignedOut: class SignedOut extends Error {} }));
vi.mock("../api", () => ({ listSessions: mocks.list, sessionEvents: mocks.events, sessionTurns: mocks.turns }));
const identity = { source: "codex", sessionId: "s/1" };
const signal = () => new AbortController().signal;
const event = (id: string) => ({ eventId: id, kind: "assistant", ts: "2026-11-02T12:00:00Z", content: id });
const catalog = () => ({ ...identity, workspaceId: "w", found: true, catalog: { title: "Work" }, parents: [], children: [], truncated: false });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(catalog());
  mocks.events.mockResolvedValue({ events: [], members: [], nextCursor: null });
  mocks.turns.mockResolvedValue({ turns: [], nextCursor: null });
});

it("reads the authorized route and preserves unresolved relationship evidence", async () => {
  const unlinked = { relationshipUid: "pending", parentSessionId: "s/1", childSessionId: null, identityStatus: "unlinked", task: "Review" };
  mocks.read.mockResolvedValue({ ...catalog(), children: [unlinked] });
  expect(await readGraphCatalog("w", identity, signal())).toMatchObject({ children: [unlinked] });
  expect(mocks.read).toHaveBeenCalledWith("/v1/workspaces/w/sessions/s%2F1/catalog?source=codex", expect.any(AbortSignal));
});
it.each([{ sessionId: "wrong" }, { source: "claude" }, { workspaceId: "other" }, { found: undefined }])("rejects incomplete or mismatched catalog identity %j", async (change) => {
  mocks.read.mockResolvedValue({ ...catalog(), ...change });
  await expect(readGraphCatalog("w", identity, signal())).rejects.toThrow("unavailable");
});
it("distinguishes an absent catalog from a valid empty catalog", async () => {
  mocks.read.mockResolvedValue({ ...catalog(), found: false, catalog: null });
  expect(await readGraphCatalog("w", identity, signal())).toBeNull();
});
it("uses independent event/turn cursors and never mixes another source", async () => {
  mocks.events.mockImplementation(async (_w, _s, cursor) => cursor ? { events: [event("e2"), { ...event("foreign"), source: "claude" }], members: [], nextCursor: null } : { events: [event("e1")], members: [], nextCursor: "events-2" });
  mocks.turns.mockImplementation(async (_w, _s, _signal, cursor) => ({ turns: [{ id: cursor ? "t2" : "t1", ts: "2026-11-02T12:00:00Z", role: "user", content: cursor ? "Next request" : "First request" }], nextCursor: cursor ? null : "turns-2" }));
  const replay = await readGraphReplay("w", identity, signal(), 10);
  expect(replay.streams?.events.map((row) => row.eventId)).toEqual(["e1", "e2"]);
  expect(replay.events.every((row) => row.source === "codex")).toBe(true);
  expect(replay.streams?.turns.map((row) => row.eventId)).toEqual(["t1", "t2"]);
  expect(mocks.events.mock.calls.map((call) => call[2])).toEqual([null, "events-2"]);
  expect(mocks.turns.mock.calls.map((call) => call[3])).toEqual([null, "turns-2"]);
  expect(replay.nextCursor).toBeNull();
  expect(replay.turnsNextCursor).toBeNull();
});
it("stops a completed stream while the other stream continues", async () => {
  let pages = 0;
  mocks.events.mockImplementation(async () => ({ events: [event(String(++pages))], members: [], nextCursor: pages < 3 ? String(pages) : null }));
  await readGraphReplay("w", identity, signal(), 10);
  expect(mocks.events).toHaveBeenCalledTimes(3);
  expect(mocks.turns).toHaveBeenCalledOnce();
});
it("retains an unfinished cursor when its page budget is reached", async () => {
  mocks.events.mockResolvedValue({ events: [event("e1")], members: [], nextCursor: "older" });
  const replay = await readGraphReplay("w", identity, signal(), 1);
  expect(mocks.events).toHaveBeenCalledOnce();
  expect(replay.nextCursor).toBe("older");
});
it("terminates repeated cursor pairs and retains the evidence already read", async () => {
  mocks.events.mockResolvedValue({ events: [event("e1")], members: [], nextCursor: "loop" });
  const replay = await readGraphReplay("w", identity, signal(), 10);
  expect(mocks.events).toHaveBeenCalledTimes(2);
  expect(replay.streams?.events).toHaveLength(1);
  expect(replay.nextCursor).toBe("loop");
});
it("preserves a successful stream when another stream fails", async () => {
  mocks.events.mockResolvedValue({ events: [event("e1")], members: [], nextCursor: null });
  mocks.turns.mockRejectedValue(new Error("Unavailable"));
  const replay = await readGraphReplay("w", identity, signal(), 10);
  expect(replay.streams?.events).toHaveLength(1);
  expect(replay.error).toBeTruthy();
});
it.each(["catalog", "events", "turns"])("propagates sign-out from the %s reader instead of returning stale partial evidence", async (reader) => {
  (reader === "catalog" ? mocks.read : reader === "events" ? mocks.events : mocks.turns).mockRejectedValue(new SignedOut());
  await expect(loadGraphDetail("w", identity.source, identity.sessionId)).rejects.toBeInstanceOf(SignedOut);
});
it("limits parallel related-session reads to four sessions", async () => {
  let active = 0, maximum = 0;
  mocks.read.mockImplementation(async (path: string) => {
    active++; maximum = Math.max(active, maximum);
    await new Promise((done) => setTimeout(done, 1));
    active--;
    const sessionId = decodeURIComponent(/sessions\/([^/]+)\/catalog/.exec(path)![1]!);
    return { ...catalog(), sessionId };
  });
  const ids = Array.from({ length: 9 }, (_, i) => ({ source: "codex", sessionId: String(i) }));
  const result = await loadGraphRelationships("w", ids);
  expect(result.evidence).toHaveLength(9);
  expect(maximum).toBe(4);
});

it("rejects turn metadata from another source instead of relabeling it", async () => {
  mocks.turns.mockResolvedValue({ turns: [{ id: "foreign", role: "user", ts: "2026-11-02T12:00:00Z", content: "Other source", metadata: { nativeCli: "claude" } }], nextCursor: null });
  const replay = await readGraphReplay("w", identity, signal(), 1);
  expect(replay.events).toEqual([]);
  expect(replay.streams?.turns).toEqual([]);
});
