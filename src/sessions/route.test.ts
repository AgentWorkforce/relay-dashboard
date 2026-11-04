import { facetFilters, serverFilters } from "./SessionsPage";
import { expect, it } from "vitest";
import {
  backHref,
  citationHref,
  listHref,
  listState,
  parseRoute,
  sessionHref,
} from "./route";
import {
  compareDate,
  matchesSearchFilters,
  projectMatches,
  matchesSessionFilters,
  parseSessionQuery,
  sessionSuggestions,
  setSessionFilter,
} from "./query";
import { sessionRow } from "./data";

it("round-trips session links through query parameters", () => {
  const href = sessionHref("a/b c", "claude", "evt-1");
  expect(href).toBe("/?session=a%2Fb+c&source=claude&event=evt-1");
  const url = new URL(href, "https://relay.test");
  expect(parseRoute(url)).toEqual({
    view: "session",
    sessionId: "a/b c",
    source: "claude",
    event: "evt-1",
    from: null,
  });
});

it("accepts hosted citation paths and transcript anchors", () => {
  expect(
    parseRoute({
      pathname: "/dashboard/sessions/s%2F1",
      search: "?source=codex",
      hash: "#cell-e9:2",
    }),
  ).toEqual({
    view: "session",
    sessionId: "s/1",
    source: "codex",
    event: "e9",
    from: null,
  });
  expect(citationHref("/dashboard/sessions/s%2F1?source=codex", "e1")).toBe(
    "/?session=s%2F1&source=codex&event=e1",
  );
  expect(citationHref(null)).toBeNull();
});

it("keeps list state in the URL", () => {
  expect(listHref()).toBe("/");
  expect(listHref("is:active", "activity")).toBe(
    "/?tab=activity&q=is%3Aactive",
  );
  expect(
    parseRoute({ pathname: "/dashboard/", search: "?tab=search&q=x" }),
  ).toEqual({
    view: "list",
    q: "x",
    tab: "search",
  });
});

it("filters rows with hosted query tokens", () => {
  const row = sessionRow({
    sessionId: "s",
    source: "claude-terminal",
    projectId: "acme/relay",
    userIds: ["u1"],
    firstTs: "2026-10-30T00:00:00.000Z",
    lastTs: "2026-11-02T00:00:00.000Z",
    workState: { status: "finished", updatedAt: "2026-11-02T00:00:00.000Z" },
  });
  const now = Date.parse("2026-11-02T12:00:00.000Z");
  expect(
    parseSessionQuery('fix "two words" harness:claude -is:active'),
  ).toMatchObject({
    text: 'fix "two words"',
    filters: [
      { field: "harness", value: "claude", exclude: false },
      { field: "is", value: "active", exclude: true },
    ],
  });
  expect(
    matchesSessionFilters(row, "harness:claude project:relay person:u1", now),
  ).toBe(true);
  expect(
    matchesSessionFilters(
      row,
      "is:finished updated:>=2026-11-01 created:<2026-11-01",
      now,
    ),
  ).toBe(true);
  expect(matchesSessionFilters(row, "person:u2", now)).toBe(false);
  expect(matchesSessionFilters(row, "-harness:claude", now)).toBe(false);
  expect(matchesSessionFilters(row, "updated:2026-1", now)).toBe(true);
  expect(setSessionFilter("fix person:u1 -person:u3", "person", "u2")).toBe(
    "fix -person:u3 person:u2",
  );
  expect(setSessionFilter("fix person:u1", "person", null)).toBe("fix");
});

it("returns from a session to the list with its filters", () => {
  const from = listState("fix is:active", "search");
  const href = sessionHref("s", "codex", null, from);
  const route = parseRoute(new URL(href, "https://relay.test"));
  expect(route.view === "session" && backHref(route.from)).toBe(
    "/?tab=search&q=fix+is%3Aactive",
  );
  expect(backHref(null)).toBe("/");
});

it("keeps malformed citation paths non-navigable", () => {
  expect(citationHref("http://[bad", "e1")).toBeNull();
});

it("never matches a complete date filter against a missing row date", () => {
  expect(compareDate(null, ">=2026-11-01")).toBe(false);
  expect(compareDate("not a date", "2026-11-01")).toBe(false);
  expect(compareDate("2026-11-02T00:00:00Z", ">=2026-11-01")).toBe(true);
  // Still being typed: don't hide anything.
  expect(compareDate(null, ">=2026-11")).toBeNull();
});

it("lists aliased harness sources once", () => {
  const rows = [
    sessionRow({ sessionId: "a", source: "claude-terminal" }),
    sessionRow({ sessionId: "b", source: "claude" }),
  ];
  const harnesses = sessionSuggestions(rows, [], Date.now()).filter(
    (s) => s.field === "harness" && s.title === "Claude Code",
  );
  expect(harnesses.map((s) => s.value)).toEqual(["claude"]);
});

it("applies search-view filters to message matches", () => {
  const match = {
    source: "claude-terminal",
    projectId: "acme/relay",
    userId: "u1",
    ts: "2026-11-02T10:00:00Z",
  };
  expect(matchesSearchFilters(match, "loader harness:claude")).toBe(true);
  expect(matchesSearchFilters(match, "project:relay person:u1")).toBe(true);
  expect(matchesSearchFilters(match, "person:u2")).toBe(false);
  expect(matchesSearchFilters(match, "-project:relay")).toBe(false);
  expect(matchesSearchFilters(match, "is:active")).toBe(true);
});

it("matches project tokens exactly, by full id or last segment", () => {
  expect(projectMatches("acme/relay", "relay")).toBe(true);
  expect(projectMatches("github.com/acme/relay", "acme/relay")).toBe(true);
  expect(projectMatches("acme/relay", "ACME/RELAY")).toBe(true);
  expect(projectMatches("docs-site", "docs")).toBe(false);
  expect(projectMatches("acme/relay-dashboard", "relay")).toBe(false);
  expect(projectMatches(null, "relay")).toBe(false);
});

it("sends a project to the server only as an exact project id", () => {
  expect(serverFilters("loader project:relay")).toMatchObject({
    q: "loader",
    project: undefined,
  });
  expect(serverFilters("project:relay", new Set(["relay"])).project).toBe("relay");
  expect(serverFilters("project:acme/relay").project).toBe("acme/relay");
  // A harness with one source narrows on the server; aliased ones don't.
  expect(serverFilters("harness:codex").source).toBe("codex");
  expect(serverFilters("harness:claude").source).toBeUndefined();
  const filters = serverFilters("x project:acme/relay harness:codex");
  expect(facetFilters(filters)).toEqual({ ...filters, project: undefined, source: undefined });
});
