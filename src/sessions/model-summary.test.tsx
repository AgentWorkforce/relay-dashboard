import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionView } from "./SessionView";
import { SessionModelSummary, sessionModelSummary } from "./model-summary";

const ready = {
  status: "ready",
  kind: "short",
  summary: "Restored the session loader.",
  model: "recorded-model",
  builtAt: "2026-11-05T05:01:00Z",
  state: { state: "done", classifiedAt: "2026-11-05T05:00:00Z" },
} as const;
afterEach(() => vi.unstubAllGlobals());

it("reads the fixed summary route with the browser cookie and validates the projection", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ summary: ready }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    sessionModelSummary(
      "w/1",
      { sessionId: "s/1", source: "codex" },
      new AbortController().signal,
    ),
  ).resolves.toEqual(ready);
  expect(fetch.mock.calls[0][0]).toBe(
    "/cloud/api/v1/workspaces/w%2F1/sessions/s%2F1/summary?source=codex&kind=short",
  );
  expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
  for (const summary of [
    { ...ready, summary: "" },
    { ...ready, builtAt: "invalid" },
    { ...ready, kind: "long" },
    { status: "invented" },
  ]) {
    fetch.mockResolvedValue(Response.json({ summary }));
    await expect(
      sessionModelSummary(
        "w",
        { sessionId: "s", source: "codex" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  }
});

it("shows only recorded summaries, with honest empty and unsupported states", () => {
  const { rerender } = render(<SessionModelSummary summary={undefined} />);
  expect(screen.queryByRole("region", { name: "Session summary" })).toBeNull();
  rerender(<SessionModelSummary summary={{ status: "unsupported" }} />);
  expect(screen.queryByRole("region", { name: "Session summary" })).toBeNull();
  rerender(
    <SessionModelSummary
      summary={{ status: "empty", kind: "short", state: null }}
    />,
  );
  expect(screen.getByText("No summary yet")).toBeInTheDocument();
  rerender(<SessionModelSummary summary={ready} />);
  expect(screen.getByText(ready.summary)).toBeInTheDocument();
  expect(document.querySelector("time")).toHaveAttribute(
    "datetime",
    ready.builtAt,
  );
});

function history(summary: () => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = new URL(input, "https://dashboard.test").pathname;
      if (path.endsWith("/summary")) return summary();
      if (path.endsWith("/turns"))
        return Response.json({ turns: [], nextCursor: null });
      if (path.endsWith("/timing")) return Response.json({ timing: null });
      if (path.endsWith("/catalog"))
        return Response.json({
          catalog: null,
          parents: [],
          children: [],
          commitLinks: [],
          truncated: false,
        });
      return Response.json({
        events: [
          {
            eventId: "e1",
            source: "codex",
            ts: "2026-11-05T05:00:00Z",
            kind: "assistant",
            content: "Transcript remains usable",
          },
        ],
        members: [],
        nextCursor: null,
        error: false,
      });
    }),
  );
}

it("reveals the transcript and overview while an optional summary is pending", async () => {
  let finish!: (response: Response) => void;
  history(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <SessionView workspaceId="w" sessionId="s" source="codex" event={null} />,
  );
  await screen.findByText("Transcript remains usable");
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(
    screen.getByRole("complementary", { name: "Session overview" }),
  ).toBeVisible();
  expect(screen.queryByRole("region", { name: "Session summary" })).toBeNull();
  await act(async () => {
    finish(Response.json({ summary: ready }));
  });
  expect(await screen.findByText(ready.summary)).toBeVisible();
});

it("keeps a summary failure separate from the transcript", async () => {
  history(async () => new Response("unavailable", { status: 502 }));
  render(
    <SessionView workspaceId="w" sessionId="s" source="codex" event={null} />,
  );
  await screen.findByText("Transcript remains usable");
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(await screen.findByText("Summary unavailable")).toBeVisible();
});

it("discards an old workspace's pending summary after navigation", async () => {
  let old!: (response: Response) => void;
  let calls = 0;
  history(() =>
    ++calls === 1
      ? new Promise<Response>((resolve) => {
          old = resolve;
        })
      : Promise.resolve(
          Response.json({
            summary: { status: "empty", kind: "short", state: null },
          }),
        ),
  );
  const { rerender } = render(
    <SessionView
      workspaceId="old-workspace"
      sessionId="s"
      source="codex"
      event={null}
    />,
  );
  await screen.findByText("Transcript remains usable");
  rerender(
    <SessionView
      workspaceId="new-workspace"
      sessionId="s"
      source="codex"
      event={null}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Details" }));
  expect(await screen.findByText("No summary yet")).toBeVisible();
  await act(async () => {
    old(Response.json({ summary: ready }));
  });
  expect(screen.queryByText(ready.summary)).toBeNull();
});
