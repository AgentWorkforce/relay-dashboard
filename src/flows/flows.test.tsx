import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../app";
import { getAccount } from "../api/client";
import { flowsApi } from "./api";
import { parseFlowsRoute } from "./flows-app";

vi.mock("../api/client", () => ({
  getAccount: vi.fn(),
  getSessions: vi
    .fn()
    .mockResolvedValue({ items: [], nextCursor: null, error: false }),
  SignedOut: class extends Error {},
}));
vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    flowsApi: Object.fromEntries(
      Object.keys(original.flowsApi).map((key) => [
        key,
        key === "artifactUrl" ? original.flowsApi.artifactUrl : vi.fn(),
      ]),
    ) as unknown as typeof original.flowsApi,
  };
});

const api = vi.mocked(flowsApi);
const run = (overrides: Record<string, unknown> = {}) => ({
  runId: "11111111-2222-3333-4444-555555555555",
  flowId: "f1",
  workflow: "hello-selfhost",
  workflowName: "hello-selfhost",
  fileType: "yaml",
  workflowFileName: "hello-selfhost.yaml",
  dispatchType: "worker",
  status: "completed" as const,
  trigger: "manual",
  workerId: "w1",
  workerName: "e2e-worker",
  assignmentStatus: "completed",
  resumedBy: [],
  exitCode: 0,
  durationMs: 724,
  summary: "Workflow completed.",
  createdAt: "2026-11-03T08:07:23.526Z",
  updatedAt: "2026-11-03T08:07:24.291Z",
  ...overrides,
});

beforeEach(() => {
  window.location.hash = "";
  vi.mocked(getAccount).mockResolvedValue({
    authenticated: true,
    user: { id: "u", name: "Alex" },
    currentWorkspace: { id: "w", name: "Workspace" },
  });
  api.listFlows.mockResolvedValue([
    {
      id: "f1",
      name: "hello-selfhost",
      description: "Deterministic smoke flow",
      fileType: "yaml",
      createdAt: "2026-11-03T08:00:00.000Z",
      updatedAt: "2026-11-03T08:00:00.000Z",
      stepCount: 2,
      runCount: 1,
      lastRun: {
        runId: run().runId,
        status: "completed",
        createdAt: run().createdAt,
      },
    },
  ]);
  api.listRuns.mockResolvedValue({
    runs: [run()],
    nextCursor: null,
    totalRuns: 1,
    activeRuns: 0,
    failedRuns: 0,
  });
  api.listWorkers.mockResolvedValue([]);
  api.listEnrollments.mockResolvedValue([]);
});

it("parses flows hash routes, including malformed escapes", () => {
  expect(parseFlowsRoute("/flows")).toEqual({ kind: "flows" });
  expect(parseFlowsRoute("/flows/runs")).toEqual({ kind: "runs" });
  expect(parseFlowsRoute("/flows/runs/abc")).toEqual({
    kind: "run",
    id: "abc",
  });
  expect(parseFlowsRoute("/flows/f/x%2Fy")).toEqual({
    kind: "flow",
    id: "x/y",
  });
  expect(parseFlowsRoute("/flows/workers/new")).toEqual({ kind: "add-worker" });
  expect(parseFlowsRoute("/flows/workers/w1")).toEqual({
    kind: "worker",
    id: "w1",
  });
  // A malformed escape must not throw during render.
  expect(parseFlowsRoute("/flows/f/%E0%A4%A")).toEqual({ kind: "flows" });
});

it("encodes opaque ids in flow and run links", async () => {
  window.location.hash = "#/flows";
  api.listFlows.mockResolvedValue([
    {
      id: "team/flow",
      name: "slashed",
      description: null,
      fileType: "yaml",
      createdAt: "2026-11-03T08:00:00.000Z",
      updatedAt: "2026-11-03T08:00:00.000Z",
      stepCount: 1,
      runCount: 1,
      lastRun: {
        runId: "team/run",
        status: "completed",
        createdAt: "2026-11-03T08:00:00.000Z",
      },
    },
  ]);
  render(<App />);
  const flowLink = await screen.findByRole("link", { name: "slashed" });
  expect(flowLink).toHaveAttribute("href", "#/flows/f/team%2Fflow");
  expect(
    within(flowLink.closest("tr")!).getByRole("link", { name: "Completed" }),
  ).toHaveAttribute("href", "#/flows/runs/team%2Frun");
});

it("keeps the flows list when run history fails to load", async () => {
  window.location.hash = "#/flows";
  api.listRuns.mockRejectedValue(new Error("runs unavailable"));
  render(<App />);
  expect(
    await screen.findByRole("link", { name: "hello-selfhost" }),
  ).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "runs unavailable",
  );
  // The alert belongs to the page that failed, not the next one.
  await act(async () => {
    window.location.hash = "#/flows/workers";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(await screen.findByText("No workers registered yet.")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  // Coming back is a new visit: while it loads, the old alert stays gone.
  api.listFlows.mockReturnValue(new Promise(() => undefined));
  await act(async () => {
    window.location.hash = "#/flows";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(await screen.findByText("Loading your flows…")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("makes Flows discoverable from the sessions page", async () => {
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "Primary" });
  expect(within(nav).getByRole("link", { name: "Flows" })).toHaveAttribute(
    "href",
    "#/flows",
  );
});

it("lists flows and run history from the API", async () => {
  window.location.hash = "#/flows";
  render(<App />);
  expect(
    await screen.findByRole("link", { name: "hello-selfhost" }),
  ).toHaveAttribute("href", "#/flows/f/f1");
  expect(
    screen.getByText(/Deterministic smoke flow · 2 steps · YAML · 1 run$/),
  ).toBeInTheDocument();
  await act(async () => {
    window.location.hash = "#/flows/runs";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  const runLink = await screen.findByRole("link", {
    name: /hello-selfhost.*on e2e-worker/,
  });
  expect(runLink).toHaveAttribute("href", `#/flows/runs/${run().runId}`);
});

it("shows run detail with declared steps, timeline, missing logs, and retry", async () => {
  window.location.hash = `#/flows/runs/${run().runId}`;
  api.getRun.mockResolvedValue(run());
  api.getSteps.mockResolvedValue({
    source: "declared",
    live: false,
    steps: [
      {
        stepName: "generate",
        status: "completed",
        source: "declared",
        stepType: "deterministic",
        dependsOn: [],
      },
      {
        stepName: "transform",
        status: "completed",
        source: "declared",
        stepType: "deterministic",
        dependsOn: ["generate"],
      },
    ],
  });
  api.getEvents.mockResolvedValue([
    {
      id: "e1",
      sequence: 1,
      eventType: "run.queued",
      payload: {},
      createdAt: run().createdAt,
    },
    {
      id: "e2",
      sequence: 2,
      eventType: "run.completed",
      payload: { exitCode: 0 },
      createdAt: run().updatedAt,
    },
  ]);
  api.getArtifacts.mockResolvedValue([]);
  api.getLog.mockResolvedValue({
    content: "",
    offset: 0,
    totalSize: 0,
    done: true,
    available: false,
  });
  api.resumeRun.mockResolvedValue({ runId: "next-run" });
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "hello-selfhost" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "e2e-worker" })).toHaveAttribute(
    "href",
    "#/flows/workers/w1",
  );
  expect(
    screen.getByText(/status is inferred from the run/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Step dependency graph" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Queued for a worker")).toBeInTheDocument();
  expect(
    await screen.findByText(/No log output was captured/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Cancel run" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await vi.waitFor(() =>
    expect(window.location.hash).toBe("#/flows/runs/next-run"),
  );
  expect(api.resumeRun).toHaveBeenCalledWith(run().runId, "retry", undefined);
});

it("cancels an active run and shows a failure panel for failed runs", async () => {
  window.location.hash = "#/flows/runs/r-active";
  api.getRun.mockResolvedValue(
    run({ runId: "r-active", status: "running", exitCode: null }),
  );
  api.getSteps.mockResolvedValue({ source: "none", live: false, steps: [] });
  api.getEvents.mockResolvedValue([]);
  api.getArtifacts.mockResolvedValue([
    {
      key: "runner.log",
      contentType: "text/plain",
      size: 12,
      updatedAt: run().updatedAt,
      kind: "log",
    },
  ]);
  api.getLog.mockResolvedValue({
    content: "[step] generate started\n",
    offset: 24,
    totalSize: 24,
    done: false,
    available: true,
  });
  api.cancelRun.mockResolvedValue({ runId: "r-active", status: "cancelled" });
  const { unmount } = render(<App />);
  expect(
    await screen.findByText(/\[step\] generate started/),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "runner.log" })).toHaveAttribute(
    "href",
    "/cloud/api/v1/workflows/runs/r-active/artifacts/runner.log",
  );
  const loadsBefore = api.getSteps.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
  await vi.waitFor(() =>
    expect(api.cancelRun).toHaveBeenCalledWith("r-active"),
  );
  // Turning terminal stops polling but still refreshes the details once.
  await vi.waitFor(() =>
    expect(api.getSteps.mock.calls.length).toBeGreaterThan(loadsBefore),
  );
  unmount();

  window.location.hash = "#/flows/runs/r-failed";
  api.getRun.mockResolvedValue(
    run({
      runId: "r-failed",
      status: "failed",
      exitCode: 1,
      error: "Workflow runner exited with code 1",
    }),
  );
  render(<App />);
  const failure = await screen.findByRole("region", {
    name: "Execution failure",
  });
  expect(failure).toHaveTextContent("Workflow runner exited with code 1");
});

it("creates an enrollment token, shows it once with commands, and waits for registration", async () => {
  window.location.hash = "#/flows/workers/new";
  api.createEnrollment.mockResolvedValue({
    id: "t1",
    token: "sh_wrk_enr_secret",
    expiresAt: "2026-11-03T09:00:00.000Z",
    createdAt: new Date().toISOString(),
    cloudUrl: "https://api.example.company",
    registerCommand:
      "agent-relay cloud worker register --token sh_wrk_enr_secret --name box --base-url https://api.example.company",
    startCommand:
      "agent-relay cloud worker start --name box --base-url https://api.example.company",
  });
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Worker name"), {
    target: { value: "box" },
  });
  fireEvent.change(screen.getByLabelText(/Tags/), {
    target: { value: "linux, gpu" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create enrollment token" }),
  );
  expect(await screen.findByText(/shown only once/)).toBeInTheDocument();
  expect(api.createEnrollment).toHaveBeenCalledWith({
    name: "box",
    tags: ["linux", "gpu"],
    expiresInMinutes: 60,
  });
  expect(
    screen.getByText(/worker register --token sh_wrk_enr_secret/),
  ).toBeInTheDocument();
  expect(screen.getByText(/mode: cloudWorker/)).toBeInTheDocument();
  expect(
    screen.getByText(/cloudUrl: "https:\/\/api.example.company"/),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(/Waiting for registration/),
  ).toBeInTheDocument();
});

it("lists workers with status and lets admins revoke", async () => {
  window.location.hash = "#/flows/workers";
  api.listWorkers.mockResolvedValue([
    {
      id: "w1",
      name: "e2e-worker",
      displayName: "e2e-worker",
      hostInfo: { platform: "darwin", arch: "arm64", node: "v22" },
      tags: [],
      status: "online",
      lastSeen: new Date().toISOString(),
      registeredAt: "2026-11-03T08:00:00.000Z",
      currentRunId: null,
    },
  ]);
  api.revokeWorker.mockResolvedValue({});
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  expect(
    await screen.findByRole("link", { name: "e2e-worker" }),
  ).toBeInTheDocument();
  expect(screen.getByText("darwin / arm64 / v22")).toBeInTheDocument();
  expect(screen.getByText("Online")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await vi.waitFor(() => expect(api.revokeWorker).toHaveBeenCalledWith("w1"));
});

it("confirms enrollment-token revocation and reports a failure", async () => {
  window.location.hash = "#/flows/workers";
  api.listEnrollments.mockResolvedValue([
    {
      id: "t1",
      tokenHint: "sh_en_…abcd",
      name: "box",
      status: "active",
      expiresAt: "2026-11-04T08:00:00.000Z",
      createdAt: "2026-11-03T08:00:00.000Z",
    },
  ] as never);
  api.revokeEnrollment.mockRejectedValue(new Error("revoke failed"));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  expect(confirm).toHaveBeenCalled();
  expect(await screen.findByText("revoke failed")).toBeInTheDocument();
});

it("shows the flow even when the worker list fails", async () => {
  window.location.hash = "#/flows/f/f1";
  api.getFlow.mockResolvedValue({
    flow: {
      id: "f1",
      name: "hello-selfhost",
      description: null,
      fileType: "yaml",
      createdAt: "2026-11-03T08:00:00.000Z",
      updatedAt: "2026-11-03T08:00:00.000Z",
      stepCount: 1,
      runCount: 0,
      lastRun: null,
      source: "version: '1.0'",
      steps: [],
    },
    recentRuns: [],
  } as never);
  api.listWorkers.mockRejectedValue(new Error("workers unavailable"));
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "hello-selfhost" }),
  ).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "workers unavailable",
  );
});

it("hides worker revocation from non-admins on the worker page", async () => {
  window.location.hash = "#/flows/workers/w1";
  api.getWorker.mockResolvedValue({
    id: "w1",
    name: "e2e-worker",
    displayName: "e2e-worker",
    hostInfo: {},
    tags: [],
    status: "online",
    lastSeen: null,
    registeredAt: "2026-11-03T08:00:00.000Z",
    currentRunId: null,
  } as never);
  api.listEnrollments.mockRejectedValue(
    Object.assign(new Error("forbidden"), { status: 403 }),
  );
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "e2e-worker" }),
  ).toBeInTheDocument();
  await vi.waitFor(() => expect(api.listEnrollments).toHaveBeenCalled());
  expect(
    screen.queryByRole("button", { name: "Revoke worker" }),
  ).not.toBeInTheDocument();
});
