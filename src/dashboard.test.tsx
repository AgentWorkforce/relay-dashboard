import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
      const body = route[1](url);
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
  fireEvent.change(screen.getByLabelText("Person"), {
    target: { value: "u1" },
  });
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
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn’t load your sessions",
  );
  expect(screen.queryByText("No sessions yet.")).not.toBeInTheDocument();
});

it("renders the transcript with tool calls, results, diffs, timing, and subagents", async () => {
  render(<Dashboard />);
  fireEvent.click(
    await screen.findByRole("link", { name: "Fix session loading" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Fix session loading" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Codex · acme/relay · main"),
  ).toBeInTheDocument();
  expect(screen.getByText("7m")).toBeInTheDocument();
  expect(screen.getByText("5m")).toBeInTheDocument();
  expect(screen.getAllByText("Please fix the loader")).toHaveLength(1);
  expect(screen.queryByText(/session_event|history/)).not.toBeInTheDocument();
  expect(screen.getByText("loader")).toBeInTheDocument();
  expect(
    screen.getByText("Prompts · tool calls").nextElementSibling,
  ).toHaveTextContent("1 · 3");
  expect(
    screen.getByRole("button", { name: "Next tool call ↓" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("Alex").length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: "reviewer" })).toHaveAttribute(
    "href",
    "/?session=child-1&source=codex",
  );
  expect(screen.getByText("cd /work/relay && codex resume s/1")).toBeInTheDocument();

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
  expect(screen.getByText("4")).toBeInTheDocument();
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
  expect(screen.getByRole("link", { name: "← Sessions" })).toHaveAttribute(
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
