import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Dashboard } from "./dashboard";

type Handler = (url: URL) => unknown;
let routes: Array<[RegExp, Handler]> = [];
const calls: URL[] = [];

function respond(pattern: RegExp, handler: Handler) {
  routes.unshift([pattern, handler]);
}

const W = "w/1";
const base = `/cloud/api/v1/workspaces/${encodeURIComponent(W)}/sessions`;
const now = "2026-11-02T20:00:00.000Z";

const members = [
  { id: "u1", name: "Alex" },
  { id: "u2", name: "Sam" },
];

const sessions = [
  {
    sessionId: "s/1",
    source: "codex",
    summary: "Fix session loading",
    projectId: "relay",
    project: { name: "relay" },
    firstTs: "2026-11-02T18:00:00.000Z",
    lastTs: "2026-11-02T19:58:00.000Z",
    eventCount: 12,
    userIds: ["u1"],
    workState: { status: "active", updatedAt: "2026-11-02T19:58:00.000Z" },
    catalog: { childSessionCount: 1 },
  },
  {
    sessionId: "s2",
    source: "claude",
    summary: "Write docs",
    projectId: "docs",
    project: { name: "docs" },
    lastTs: "2026-11-01T10:00:00.000Z",
    eventCount: 4,
    userIds: ["u2"],
    workState: { status: "finished", updatedAt: "2026-11-01T10:00:00.000Z" },
  },
];

const transcript = [
  {
    eventId: "e1",
    ts: "2026-11-02T18:00:00.000Z",
    kind: "prompt",
    source: "codex",
    userId: "u1",
    content: "Please fix the loader",
  },
  {
    eventId: "e2",
    ts: "2026-11-02T18:00:01.000Z",
    kind: "session_event",
    type: "function_call",
    source: "codex",
    toolName: "exec_command",
    toolUseId: "call-1",
    content: 'exec_command {"cmd":"npm test"}',
  },
  {
    eventId: "e3",
    ts: "2026-11-02T18:00:02.000Z",
    kind: "session_event",
    type: "function_call_output",
    source: "codex",
    toolUseId: "call-1",
    content: "Process exited with code 0\nOutput:\nall green",
  },
  {
    eventId: "e4",
    ts: "2026-11-02T18:00:03.000Z",
    kind: "session_event",
    type: "custom_tool_call",
    source: "codex",
    toolName: "apply_patch",
    toolUseId: "call-2",
    content:
      "apply_patch *** Begin Patch\n*** Update File: src/loader.ts\n@@\n-const broken = true;\n+const broken = false;\n*** End Patch",
  },
  {
    eventId: "e5",
    ts: "2026-11-02T18:00:04.000Z",
    kind: "assistant",
    source: "codex",
    content: "Fixed the **loader**.",
  },
  {
    eventId: "e6",
    ts: "2026-11-02T18:00:05.000Z",
    kind: "file_edit",
    type: "file_edit",
    source: "codex",
    projectId: "/work/relay",
    content: "/work/relay/src/extra.ts",
    filesTouched: ["/work/relay/src/extra.ts"],
  },
  // The raw history copy of the prompt collapses into the projected event.
  {
    eventId: "e1-history",
    ts: "2026-11-02T18:00:00.000Z",
    kind: "history",
    type: "history",
    actorRole: "user",
    source: "codex",
    content: "Please fix the loader",
  },
];

beforeEach(() => {
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
  routes = [];
  calls.length = 0;
  window.history.replaceState(null, "", "/dashboard/");
  respond(/\/cloud\/api\/auth\/session/, () => ({
    authenticated: true,
    user: { id: "u1", name: "Alex" },
    currentWorkspace: { id: W, name: "Workspace" },
  }));
  respond(/\/sessions$/, () => ({
    items: sessions,
    members,
    nextCursor: null,
    error: false,
    now,
  }));
  respond(/\/sessions\/s%2F1\/events$/, () => ({
    events: transcript,
    members,
    nextCursor: null,
    error: false,
  }));
  respond(/\/sessions\/s%2F1\/turns$/, () => ({ turns: [], nextCursor: null }));
  respond(/\/sessions\/s%2F1\/timing$/, () => ({
    timing: {
      sessionId: "s/1",
      source: "codex",
      startedAt: "2026-11-02T18:00:00.000Z",
      lastActionAt: "2026-11-02T18:12:00.000Z",
      workMs: 420_000,
      waitingMs: 300_000,
    },
  }));
  respond(/\/sessions\/s%2F1\/catalog$/, () => ({
    catalog: {
      title: "Fix session loading",
      gitBranch: "main",
      repoUrl: "https://github.com/acme/relay",
    },
    parents: [],
    children: [
      {
        parentSessionId: "s/1",
        childSessionId: "child-1",
        childAgentName: "reviewer",
        childAgentType: "subagent",
      },
    ],
    commitLinks: [],
    truncated: false,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "https://relay.test");
      calls.push(url);
      const route = routes.find(([pattern]) => pattern.test(url.pathname));
      if (!route) return new Response("{}", { status: 404 });
      const body = await route[1](url);
      return body instanceof Response
        ? body
        : new Response(JSON.stringify(body));
    }),
  );
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText: vi.fn(async () => {}) },
  });
});

afterEach(() => vi.unstubAllGlobals());

it("lists sessions with agent, project, people, and status, linking in-app", async () => {
  render(<Dashboard />);
  const link = await screen.findByRole("link", { name: "Fix session loading" });
  expect(link).toHaveAttribute("href", "/?session=s%2F1&source=codex");
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  const row = link.closest("tr")!;
  expect(within(row).getByText("Codex")).toBeInTheDocument();
  expect(within(row).getByText("relay")).toBeInTheDocument();
  expect(within(row).getByText("Alex")).toBeInTheDocument();
  expect(within(row).getByText("Active")).toBeInTheDocument();
  expect(within(row).getByText("1 subagent")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Write docs" })).toBeInTheDocument();
  expect(
    calls.find((url) => url.pathname === base)?.searchParams.get("metadata"),
  ).toBe("deferred");
});

function facetRow(group: string, label: string) {
  const facet = screen.getByRole("group", { name: `Filter by ${group}` });
  const row = within(facet).getByRole("button", { name: label });
  return { row, count: row.querySelector("span:last-child")?.textContent };
}

it("keeps every facet option after one is picked, counting against the other filters", async () => {
  window.history.replaceState(null, "", "/?q=project%3Arelay");
  render(<Dashboard />);
  expect(
    await screen.findByRole("link", { name: "Fix session loading" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Write docs" }),
  ).not.toBeInTheDocument();
  // Once the id is known the table asks the server for that project exactly,
  // while the facets read the same query without project or harness.
  await act(async () => {});
  const lists = calls.filter((url) => url.pathname === base);
  expect(lists.some((url) => url.searchParams.get("project") === "relay")).toBe(true);
  // The initial load and the separate facet query both omit the project.
  expect(
    lists.filter(
      (url) => !url.searchParams.has("project") && !url.searchParams.has("source"),
    ).length,
  ).toBeGreaterThanOrEqual(2);
  // The project facet ignores its own selection: every project, true total.
  expect(facetRow("project", "All projects").count).toBe("2");
  expect(facetRow("project", "relay").count).toBe("1");
  expect(facetRow("project", "docs").count).toBe("1");
  expect(facetRow("project", "relay").row).toHaveAttribute("aria-pressed", "true");
  // Other facets respect the project selection.
  expect(facetRow("status", "All sessions").count).toBe("1");
  expect(facetRow("status", "Finished").count).toBe("0");
  expect(facetRow("harness", "Codex").count).toBe("1");
  expect(facetRow("harness", "Claude Code").count).toBe("0");
  // Switching projects needs no detour through "All".
  fireEvent.click(facetRow("project", "docs").row);
  expect(
    await screen.findByRole("link", { name: "Write docs" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Search sessions")).toHaveValue("project:docs");
  expect(facetRow("project", "relay").count).toBe("1");
});

it("pages the sidebar facets on their own and keeps earlier options", async () => {
  const infra = {
    ...sessions[1]!,
    sessionId: "s3",
    summary: "Tune infra",
    projectId: "infra",
    project: { name: "infra" },
  };
  respond(/\/sessions$/, (url) =>
    url.searchParams.get("cursor") === "c2"
      ? { items: [infra], members, nextCursor: null, error: false, now }
      : url.searchParams.has("project")
        ? { items: [sessions[0]], members, nextCursor: null, error: false, now }
        : { items: sessions, members, nextCursor: "c2", error: false, now },
  );
  window.history.replaceState(null, "", "/?q=project%3Arelay");
  render(<Dashboard />);
  const more = await screen.findByRole("button", { name: "Load more options" });
  expect(facetRow("project", "docs").count).toBe("1");
  expect(
    within(screen.getByRole("group", { name: "Filter by project" })).queryByRole(
      "button",
      { name: "infra" },
    ),
  ).toBeNull();
  fireEvent.click(more);
  expect(await screen.findByRole("button", { name: "infra" })).toBeInTheDocument();
  expect(facetRow("project", "docs").count).toBe("1");
  expect(facetRow("project", "All projects").count).toBe("3");
  expect(screen.queryByRole("button", { name: "Load more options" })).toBeNull();
});

it("keeps the sidebar and rows on screen while a filter change loads", async () => {
  render(<Dashboard />);
  await screen.findByRole("link", { name: "Fix session loading" });
  await act(async () => {});
  const sidebar = screen.getByRole("group", { name: "Filter by project" });
  const status = screen.getByRole("group", { name: "Filter by status" });
  // Hold the narrowed list request open to observe the pending state.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  respond(/\/sessions$/, async (url) => {
    if (url.searchParams.has("project")) await held;
    return { items: sessions, members, nextCursor: null, error: false, now };
  });
  fireEvent.click(within(sidebar).getByRole("button", { name: "docs" }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  // Same nodes (not remounted), no skeleton, rows filtered in place, pending.
  expect(screen.getByRole("group", { name: "Filter by project" })).toBe(sidebar);
  expect(screen.getByRole("group", { name: "Filter by status" })).toBe(status);
  expect(sidebar.isConnected).toBe(true);
  expect(screen.queryByRole("status", { name: "Loading sessions…" })).toBeNull();
  expect(screen.getByRole("link", { name: "Write docs" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Fix session loading" })).toBeNull();
  expect(
    within(sidebar).getByRole("button", { name: "docs" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("link", { name: "Write docs" }).closest("[aria-busy]"))
    .toHaveAttribute("aria-busy", "true");
  await act(async () => {
    release();
    await held;
  });
  await waitFor(() =>
    expect(
      screen.getByRole("link", { name: "Write docs" }).closest("[aria-busy]"),
    ).toHaveAttribute("aria-busy", "false"),
  );
  expect(screen.getByRole("group", { name: "Filter by project" })).toBe(sidebar);
});

it("keeps older loaded pages and shows no skeleton while a pick loads", async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  respond(/\/sessions$/, async (url) => {
    if (url.searchParams.has("project")) await held;
    if (url.searchParams.get("cursor") === "c2")
      return { items: [sessions[1]], members, nextCursor: null, error: false, now };
    if (url.searchParams.has("project"))
      return { items: [sessions[1]], members, nextCursor: null, error: false, now };
    return { items: [sessions[0]], members, nextCursor: "c2", error: false, now };
  });
  render(<Dashboard />);
  await screen.findByRole("link", { name: "Fix session loading" });
  fireEvent.click(screen.getByRole("button", { name: "Older sessions" }));
  expect(await screen.findByRole("link", { name: "Write docs" })).toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole("group", { name: "Filter by project" })).getByRole(
      "button",
      { name: "docs" },
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  // The older page's row stays (filtered in place); no skeleton, no empty state.
  expect(screen.getByRole("link", { name: "Write docs" })).toBeInTheDocument();
  expect(screen.queryByRole("status", { name: "Loading sessions…" })).toBeNull();
  expect(screen.queryByText("No sessions match these filters.")).toBeNull();
  await act(async () => {
    release();
    await held;
  });
  // The narrowed response applied and loading ended.
  await waitFor(() =>
    expect(
      screen.getByRole("link", { name: "Write docs" }).closest("[aria-busy]"),
    ).toHaveAttribute("aria-busy", "false"),
  );
});

it("counts each facet against the others, not itself", async () => {
  window.history.replaceState(null, "", "/?q=project%3Arelay%20is%3Afinished");
  render(<Dashboard />);
  expect(await screen.findByText("No sessions match these filters.")).toBeInTheDocument();
  expect(facetRow("project", "All projects").count).toBe("1");
  expect(facetRow("project", "relay").count).toBe("0");
  expect(facetRow("project", "docs").count).toBe("1");
  expect(facetRow("status", "All sessions").count).toBe("1");
  expect(facetRow("status", "Active").count).toBe("1");
});

it("applies person and status filters in the browser and free text on the server", async () => {
  window.history.replaceState(null, "", "/?q=loader%20is%3Afinished");
  render(<Dashboard />);
  expect(
    await screen.findByRole("link", { name: "Write docs" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Fix session loading" }),
  ).not.toBeInTheDocument();
  const list = [...calls].reverse().find((url) => url.pathname === base)!;
  expect(list.searchParams.get("q")).toBe("loader");
  fireEvent.click(screen.getByRole("button", { name: "Alex" }));
  expect(screen.getByLabelText("Search sessions")).toHaveValue(
    "loader is:finished person:u1",
  );
  expect(
    await screen.findByText("No sessions match these filters."),
  ).toBeInTheDocument();
});

it("shows an API failure rather than a misleading empty list", async () => {
  respond(/\/sessions$/, () => new Response("unavailable", { status: 502 }));
  render(<Dashboard />);
  const alerts = await screen.findAllByText(/Couldn’t load your sessions/);
  for (const alert of alerts) expect(alert).toHaveAttribute("role", "alert");
  expect(screen.queryByText(/No sessions yet/)).not.toBeInTheDocument();
});

it("renders the transcript with tool calls, results, diffs, timing, and subagents", async () => {
  render(<Dashboard />);
  fireEvent.click(
    await screen.findByRole("link", { name: "Fix session loading" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Fix session loading" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Session identity")).toHaveTextContent("Codex");
  expect(screen.getByText("acme/relay")).toBeInTheDocument();
  expect(screen.getByText("main")).toBeInTheDocument();
  expect(screen.getByText("7m")).toBeInTheDocument();
  expect(screen.getByText("5m")).toBeInTheDocument();
  expect(screen.getAllByText("Please fix the loader")).toHaveLength(1);
  expect(screen.queryByText(/session_event|history/)).not.toBeInTheDocument();
  expect(screen.getByText("loader")).toBeInTheDocument();
  expect(
    screen.getByText("Prompts · tool steps").nextElementSibling,
  ).toHaveTextContent("1 · 3");
  expect(
    screen.getByRole("button", { name: "Next tool call" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("Alex").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByRole("link", { name: "reviewer" })).toHaveAttribute(
    "href",
    "/?session=child-1&source=codex&workspace=w%2F1",
  );
  const resume = screen.getByRole("button", {
    name: "Resume session: copy terminal command",
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await act(async () => fireEvent.click(resume));
  expect(writeText).toHaveBeenCalledWith("cd /work/relay && codex resume s/1");

  const activity = screen.getByText(/Activity · 2 steps/);
  fireEvent.click(activity);
  expect(await screen.findByText("npm test")).toBeInTheDocument();
  expect(screen.getByText("all green")).toBeInTheDocument();
  const diff = screen.getByLabelText("Diff of src/loader.ts");
  expect(within(diff).getByText("const broken = false;")).toBeInTheDocument();
  expect(within(diff).getByText("const broken = true;")).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Activity · 1 step/));
  expect(await screen.findByText(/src\/extra\.ts/)).toBeInTheDocument();

  const events = calls.find((url) => url.pathname.endsWith("/events"))!;
  expect(events.searchParams.get("source")).toBe("codex");
  for (const resource of ["turns", "timing", "catalog"]) {
    expect(calls.some((url) => url.pathname.endsWith(`/${resource}`))).toBe(
      true,
    );
  }
});

it("opens hosted-style citation links and keeps the transcript when enrichments fail", async () => {
  respond(
    /\/sessions\/s%2F1\/timing$/,
    () => new Response("{}", { status: 502 }),
  );
  respond(
    /\/sessions\/s%2F1\/catalog$/,
    () => new Response("{}", { status: 502 }),
  );
  window.history.replaceState(
    null,
    "",
    "/dashboard/sessions/s%2F1?source=codex#message-e1",
  );
  render(<Dashboard />);
  expect(
    await screen.findByRole("heading", { name: "Please fix the loader" }),
  ).toBeInTheDocument();
  expect(document.getElementById("message-e1")).not.toBeNull();
  fireEvent.click(
    screen.getAllByRole("link", { name: "Link to this message" })[0]!,
  );
  await act(async () => {});
  expect(navigator.clipboard.writeText).toHaveBeenCalled();
});

it("searches messages across sessions and links each match to its session", async () => {
  respond(/\/sessions\/search$/, (url) => ({
    matches: [
      {
        eventId: "e5",
        sessionId: "s/1",
        source: "codex",
        ts: "2026-11-02T18:00:04.000Z",
        kind: "assistant",
        content: `Fixed the loader for ${url.searchParams.get("q")}`,
        citationPath: "/dashboard/sessions/s%2F1?source=codex",
      },
    ],
    members,
    nextCursor: null,
  }));
  window.history.replaceState(null, "", "/?tab=search&q=loader");
  render(<Dashboard />);
  const match = await screen.findByText("Fixed the loader for loader");
  expect(match.closest("a")).toHaveAttribute(
    "href",
    "/?session=s%2F1&source=codex&event=e5&from=tab%3Dsearch%26q%3Dloader",
  );
});

it("charts team activity by agent", async () => {
  respond(/\/sessions\/activity$/, (url) => ({
    days: [
      {
        date: url.searchParams.get("first"),
        conversations: 3,
        bySource: { codex: 2, "claude-terminal": 1 },
      },
      {
        date: url.searchParams.get("last"),
        conversations: 1,
        bySource: { codex: 1 },
      },
    ],
  }));
  respond(/\/sessions\/output$/, () => ({ output: null, unsupported: true }));
  window.history.replaceState(null, "", "/?tab=activity");
  render(<Dashboard />);
  expect(
    await screen.findByText("active conversation-days"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("active conversation-days").parentElement,
  ).toHaveTextContent("4 active conversation-days");
  const legend = screen.getByRole("list");
  expect(within(legend).getByText("Codex")).toBeInTheDocument();
  expect(within(legend).getByText("Claude Code")).toBeInTheDocument();
  const activity = calls.find((url) => url.pathname.endsWith("/activity"))!;
  expect(activity.searchParams.get("first")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it("offers retry only after a load error, and keeps list filters on the way back", async () => {
  let fail = true;
  respond(/\/sessions\/s%2F1\/events$/, () =>
    fail
      ? new Response("{}", { status: 502 })
      : { events: transcript, members, nextCursor: null, error: false },
  );
  window.history.replaceState(
    null,
    "",
    "/?session=s%2F1&source=codex&from=q%3Dis%253Aactive",
  );
  render(<Dashboard />);
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load");
  expect(screen.getByRole("link", { name: "Sessions" })).toHaveAttribute(
    "href",
    "/?q=is%3Aactive",
  );
  fail = false;
  fireEvent.click(retry);
  expect(
    await screen.findByRole("heading", { name: "Fix session loading" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
});

it("reads every page of turns, not only the first", async () => {
  respond(/\/sessions\/s%2F1\/turns$/, (url) =>
    url.searchParams.get("cursor") === "t2"
      ? {
          turns: [
            {
              id: "turn-2",
              role: "user",
              content: "And the second page prompt",
              createdAt: "2026-11-02T18:30:00.000Z",
              ts: "2026-11-02T18:30:00.000Z",
            },
          ],
          nextCursor: null,
        }
      : { turns: [], nextCursor: "t2" },
  );
  window.history.replaceState(null, "", "/?session=s%2F1&source=codex");
  render(<Dashboard />);
  expect(
    await screen.findByText("And the second page prompt"),
  ).toBeInTheDocument();
  expect(
    calls.some(
      (url) =>
        url.pathname.endsWith("/turns") &&
        url.searchParams.get("cursor") === "t2",
    ),
  ).toBe(true);
});

it("scrolls an assistant-reply citation to its cell", async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  window.history.replaceState(
    null,
    "",
    "/?session=s%2F1&source=codex&event=e5",
  );
  render(<Dashboard />);
  await screen.findByText("loader");
  await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
  expect(scroll.mock.contexts[0]).toBe(document.getElementById("cell-e5"));
  expect(window.location.hash).toBe("");
});

it("loads later event pages until a cited event is found", async () => {
  respond(/\/sessions\/s%2F1\/events$/, (url) =>
    url.searchParams.get("cursor") === "p2"
      ? {
          events: transcript.slice(4),
          members,
          nextCursor: null,
          error: false,
        }
      : {
          events: transcript.slice(0, 4),
          members,
          nextCursor: "p2",
          error: false,
        },
  );
  window.history.replaceState(
    null,
    "",
    "/?session=s%2F1&source=codex&event=e5",
  );
  render(<Dashboard />);
  expect(await screen.findByText("loader")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Load later events" }),
  ).not.toBeInTheDocument();
});

it("sends an expired session on a transcript to sign in", async () => {
  respond(
    /\/sessions\/s%2F1\/events$/,
    () => new Response("{}", { status: 401 }),
  );
  window.history.replaceState(null, "", "/?session=s%2F1&source=codex");
  render(<Dashboard />);
  expect(
    (await screen.findAllByText("Taking you to sign in…")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
});

it("links a search match without a citation path to its session", async () => {
  respond(/\/sessions\/search$/, () => ({
    matches: [
      {
        eventId: "e1",
        sessionId: "s/1",
        source: "codex",
        ts: "2026-11-02T18:00:00.000Z",
        userId: "u1",
        kind: "prompt",
        content: "Please fix the loader",
      },
      {
        eventId: "x1",
        sessionId: "s2",
        source: "claude",
        userId: "u2",
        ts: "2026-11-02T18:00:00.000Z",
        kind: "prompt",
        content: "Please fix the loader too",
      },
    ],
    members,
    nextCursor: null,
  }));
  window.history.replaceState(
    null,
    "",
    "/?tab=search&q=loader%20person%3Au1%20is%3Aactive",
  );
  render(<Dashboard />);
  const match = await screen.findByText("Please fix the loader");
  expect(match.closest("a")).toHaveAttribute(
    "href",
    expect.stringMatching(/^\/\?session=s%2F1&source=codex&event=e1/),
  );
  // person:u1 filters the other person's match; is: is named as unused.
  expect(
    screen.queryByText("Please fix the loader too"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Not applied in message search: is:active/),
  ).toBeInTheDocument();
});

it("retries a failed account load", async () => {
  let fail = true;
  respond(/\/cloud\/api\/auth\/session/, () =>
    fail
      ? new Response("{}", { status: 500 })
      : {
          authenticated: true,
          user: { id: "u1", name: "Alex" },
          currentWorkspace: { id: W, name: "Workspace" },
        },
  );
  render(<Dashboard />);
  const retry = await screen.findByRole("button", { name: "Retry" });
  fail = false;
  fireEvent.click(retry);
  expect(
    await screen.findByRole("link", { name: "Fix session loading" }),
  ).toBeInTheDocument();
});

it("opens a cited system-prompt cell's disclosure", async () => {
  respond(/\/sessions\/s%2F1\/events$/, () => ({
    events: [
      ...transcript,
      {
        eventId: "ctx",
        ts: "2026-11-02T17:59:59.000Z",
        kind: "session_event",
        type: "user",
        actorRole: "system",
        source: "codex",
        content: "You are a careful assistant.",
      },
    ],
    members,
    nextCursor: null,
    error: false,
  }));
  window.history.replaceState(
    null,
    "",
    "/?session=s%2F1&source=codex&event=ctx",
  );
  render(<Dashboard />);
  await screen.findByText("loader");
  const cell = document.getElementById("cell-ctx");
  expect(cell).not.toBeNull();
  expect(cell!.querySelector(":scope > details")).not.toBeNull();
  await vi.waitFor(() => expect(window.location.hash).toBe("#cell-ctx"));
  await vi.waitFor(() =>
    expect(cell!.querySelector(":scope > details")).toHaveAttribute("open"),
  );
  expect(
    await screen.findByText("You are a careful assistant."),
  ).toBeInTheDocument();
});

it("sends a citation to a collapsed history copy to the surviving prompt", async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  window.history.replaceState(
    null,
    "",
    "/?session=s%2F1&source=codex&event=e1-history",
  );
  render(<Dashboard />);
  await screen.findByText("loader");
  expect(document.getElementById("message-e1-history")).toBeNull();
  await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
  expect(scroll.mock.contexts[0]).toBe(document.getElementById("message-e1"));
  expect(window.location.hash).toBe("");
});

it.each([undefined, false, "true"])("does not mount graph reads with disabled or malformed runtime gate %s", async (flag) => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: flag };
  window.history.replaceState(null, "", "/?view=graph&workspace=w%2F1");
  render(<Dashboard />);
  expect(await screen.findByText("Session visualizations are not enabled.")).toBeInTheDocument();
  expect(calls.filter((url) => url.pathname.includes("/sessions"))).toEqual([]);
});

it.each(["graph", "session"])("does not read a foreign explicit workspace through the %s route", async (view) => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  window.history.replaceState(null, "", `/?${view === "graph" ? "view=graph&" : ""}workspace=other&session=s%2F1&source=codex`);
  render(<Dashboard />);
  expect(await screen.findByText("This link belongs to a different workspace.")).toBeInTheDocument();
  expect(calls.filter((url) => url.pathname.includes("/sessions"))).toEqual([]);
});

it("opens the gated trace and recorded decision tree without losing transcript navigation", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  window.history.replaceState(null, "", "/?session=s%2F1&source=codex&workspace=w%2F1");
  render(<Dashboard />);
  expect(await screen.findByRole("group", { name: "Session view" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Timeline", pressed: true })).toBeInTheDocument();
  expect(screen.getAllByRole("region", { name: /Timeline|Trace/ }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Decision tree", pressed: false }));
  expect(screen.getByRole("button", { name: "Decision tree", pressed: true })).toBeInTheDocument();
  expect(screen.getAllByRole("region", { name: "Decision tree" }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Conversation", pressed: false }));
  expect(await screen.findByRole("region", { name: "Conversation" })).toBeInTheDocument();
  const graph = screen.getByRole("link", { name: "Work graph" });
  expect(new URL(graph.getAttribute("href")!, "https://relay.test").searchParams.get("workspace")).toBe(W);
});

it("follows recorded graph relationships and keeps the workspace in Open session", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  window.history.replaceState(null, "", "/?view=graph&workspace=w%2F1");
  respond(/\/sessions\/s%2F1\/catalog$/, () => ({ sessionId: "s/1", source: "codex", workspaceId: W, found: true,
    catalog: { title: "Fix session loading" }, parents: [], children: [{ relationshipUid: "child-edge", parentSessionId: "s/1", childSessionId: "child-1", relationship: "delegated", identityStatus: "observed" }], commitLinks: [], truncated: false,
  }));
  render(<Dashboard />);
  expect(await screen.findByRole("heading", { name: "Work graph" })).toBeInTheDocument();
  const open = await screen.findByRole("link", { name: "Open session" });
  const url = new URL(open.getAttribute("href")!, "https://relay.test");
  expect(url.searchParams.get("workspace")).toBe(W);
  expect(url.searchParams.get("source")).toBe("codex");
  await waitFor(() => expect(calls.some((url) => url.pathname.includes("/child-1/catalog"))).toBe(true));
  fireEvent.click(open);
  expect(await screen.findByRole("group", { name: "Session view" })).toBeInTheDocument();
  expect(window.location.search).toContain("workspace=w%2F1");
});

it("progressively loads both trace streams and stops completed cursors", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  window.history.replaceState(null, "", "/?session=s%2F1&source=codex");
  respond(/\/sessions\/s%2F1\/events$/, (url) => ({ events: url.searchParams.get("cursor") ? [{ ...transcript[4], eventId: "later-event" }] : transcript, members, nextCursor: url.searchParams.get("cursor") ? null : "event-next" }));
  respond(/\/sessions\/s%2F1\/turns$/, (url) => ({ turns: [{ id: url.searchParams.get("cursor") ? "turn-next" : "turn-first", ts: now, role: "user", content: "Another request" }], nextCursor: url.searchParams.get("cursor") ? null : "turn-next" }));
  render(<Dashboard />);
  await screen.findByRole("group", { name: "Session view" });
  await waitFor(() => expect(calls.filter((url) => url.pathname.endsWith("/events"))).toHaveLength(2));
  await waitFor(() => expect(calls.filter((url) => url.pathname.endsWith("/turns"))).toHaveLength(2));
  expect(calls.filter((url) => url.pathname.endsWith("/events")).map((url) => url.searchParams.get("cursor"))).toEqual([null, "event-next"]);
  expect(calls.filter((url) => url.pathname.endsWith("/turns")).map((url) => url.searchParams.get("cursor"))).toEqual([null, "turn-next"]);
});

it("pauses trace loading on failure and resumes from the failed cursor after retry", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  window.history.replaceState(null, "", "/?session=s%2F1&source=codex");
  let failed = true;
  respond(/\/sessions\/s%2F1\/events$/, (url) => {
    const cursor = url.searchParams.get("cursor");
    if (cursor === "second" && failed) return new Response("{}", { status: 503 });
    return { events: transcript, members, nextCursor: cursor === null ? "second" : cursor === "second" ? "third" : null };
  });
  render(<Dashboard />);
  const retry = await screen.findByRole("button", { name: "Retry loading history" });
  expect(calls.filter((url) => url.pathname.endsWith("/events"))).toHaveLength(2);
  failed = false;
  fireEvent.click(retry);
  await waitFor(() => expect(calls.filter((url) => url.pathname.endsWith("/events"))).toHaveLength(4));
  expect(calls.filter((url) => url.pathname.endsWith("/events")).map((url) => url.searchParams.get("cursor"))).toEqual([null, "second", "second", "third"]);
  expect(screen.queryByRole("button", { name: "Retry loading history" })).not.toBeInTheDocument();
});

it("stops trace auto-loading when the server repeats a cursor", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  window.history.replaceState(null, "", "/?session=s%2F1&source=codex");
  respond(/\/sessions\/s%2F1\/events$/, () => ({ events: transcript, members, nextCursor: "same" }));
  render(<Dashboard />);
  await screen.findByRole("button", { name: "Retry loading history" });
  expect(calls.filter((url) => url.pathname.endsWith("/events"))).toHaveLength(2);
  expect(screen.getByRole("alert")).toHaveTextContent("History pagination did not advance");
});

it("automatically discovers a recorded relative's own child without rescanning identities", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  window.history.replaceState(null, "", "/?view=graph&workspace=w%2F1");
  respond(/\/sessions$/, () => ({ items: [sessions[0]], members, nextCursor: null, error: false, now }));
  respond(/\/sessions\/[^/]+\/catalog$/, (url) => {
    const id = decodeURIComponent(/sessions\/([^/]+)\/catalog/.exec(url.pathname)![1]!);
    const child = id === "s/1" ? "child" : id === "child" ? "grandchild" : null;
    return { sessionId: id, source: "codex", workspaceId: W, found: true, catalog: {}, parents: [], children: child ? [{ relationshipUid: `edge-${id}`, parentSessionId: id, childSessionId: child, relationship: "delegated", identityStatus: "observed" }] : [], truncated: false };
  });
  respond(/\/sessions\/[^/]+\/events$/, () => ({ events: [], members, nextCursor: null }));
  respond(/\/sessions\/[^/]+\/turns$/, () => ({ turns: [], nextCursor: null }));
  render(<Dashboard />);
  await waitFor(() => expect(calls.some((url) => url.pathname.endsWith("/grandchild/catalog"))).toBe(true));
  expect(calls.filter((url) => url.pathname.endsWith("/child/catalog"))).toHaveLength(1);
  expect(calls.filter((url) => url.pathname.endsWith("/grandchild/catalog"))).toHaveLength(1);
});

it("bounds automatic graph discovery to 80 off-page identities and reports the remaining family", async () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  window.history.replaceState(null, "", "/?view=graph&workspace=w%2F1");
  respond(/\/sessions$/, () => ({ items: [sessions[0]], members, nextCursor: null, error: false, now }));
  respond(/\/sessions\/[^/]+\/catalog$/, (url) => {
    const id = decodeURIComponent(/sessions\/([^/]+)\/catalog/.exec(url.pathname)![1]!);
    return { sessionId: id, source: "codex", workspaceId: W, found: true, catalog: {}, parents: [], children: id === "s/1" ? Array.from({ length: 85 }, (_, i) => ({ relationshipUid: `edge-${i}`, parentSessionId: id, childSessionId: `child-${i}`, relationship: "delegated", identityStatus: "observed" })) : [], truncated: false };
  });
  respond(/\/sessions\/[^/]+\/events$/, () => ({ events: [], members, nextCursor: null }));
  respond(/\/sessions\/[^/]+\/turns$/, () => ({ turns: [], nextCursor: null }));
  render(<Dashboard />);
  await screen.findByText(/Automatic discovery is limited to 80 related sessions/);
  const relatives = () => calls.filter((url) => /\/child-\d+\/catalog$/.test(url.pathname));
  await waitFor(() => expect(relatives()).toHaveLength(80), { timeout: 5000 });
  expect(new Set(relatives().map((url) => url.pathname)).size).toBe(80);
  expect(calls.some((url) => url.pathname.endsWith("/child-80/catalog"))).toBe(false);
});

it("opens a trace tool in its original collapsed conversation group", async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") }));
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  window.history.replaceState(null, "", "/?session=s%2F1&source=codex");
  render(<Dashboard />);
  const step = await screen.findByRole("treeitem", { name: /Run tests/ });
  fireEvent.click(step);
  expect(await screen.findByRole("dialog", { name: "Trace event details" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /View in conversation/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Conversation", pressed: true })).toBeInTheDocument());
  await waitFor(() => expect(window.location.hash).toContain("cell-e2"));
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "start" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "Conversation" }).querySelector(".activity-group .disclosure[open]")).toBeTruthy());
});
