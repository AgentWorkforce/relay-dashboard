import { afterEach, expect, it, vi } from "vitest";
import { SignedOut } from "../api/client";
import { ApiError, flowsApi } from "./api";
import { duration, relativeTime, runTone, statusLabel } from "./format";

afterEach(() => vi.unstubAllGlobals());

const run = {
  runId: "r1",
  flowId: "f1",
  workflow: "hello",
  workflowName: "hello",
  fileType: "yaml",
  dispatchType: "worker",
  status: "running",
  trigger: "manual",
  workerId: "w1",
  workerName: "box",
  resumedBy: [],
  createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:01.000Z",
};

it("reads runs with the browser cookie under /cloud/api and encodes filters", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          runs: [run],
          nextCursor: "n+1",
          totalRuns: 1,
          activeRuns: 1,
          failedRuns: 0,
        }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const page = await flowsApi.listRuns({ cursor: "c/1", status: "failed" });
  expect(page.runs[0]!.workerName).toBe("box");
  expect(fetch.mock.calls[0][0]).toBe(
    "/cloud/api/v1/workflows/runs?cursor=c%2F1&status=failed",
  );
  expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
});

it("sends a worker runtime only when one is chosen, and surfaces API errors", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ runId: "r2", status: "pending" }), {
        status: 201,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ runId: "r3", status: "pending" }), {
        status: 201,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Worker not found", code: "worker_not_found" }),
        { status: 404 },
      ),
    )
    .mockResolvedValueOnce(new Response("{}", { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  await flowsApi.invokeFlow("f/1", { inputs: { task: "x" } });
  expect(fetch.mock.calls[0][0]).toBe("/cloud/api/v1/flows/f%2F1/invoke");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    inputs: { task: "x" },
  });
  await flowsApi.invokeFlow("f1", { workerId: "w1" });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    runtime: { id: "worker", config: { workerId: "w1" } },
  });
  const failure = flowsApi.invokeFlow("f1", {});
  await expect(failure).rejects.toBeInstanceOf(ApiError);
  await expect(failure).rejects.toThrow("Worker not found");
  await expect(flowsApi.listWorkers()).rejects.toBeInstanceOf(SignedOut);
});

it("builds artifact download URLs per path segment", () => {
  expect(flowsApi.artifactUrl("r 1", "step a/agent.log")).toBe(
    "/cloud/api/v1/workflows/runs/r%201/artifacts/step%20a/agent.log",
  );
});

it("formats statuses and durations like the hosted dashboard", () => {
  expect(statusLabel("needs_review")).toBe("Needs review");
  expect(runTone("completed")).toBe("success");
  expect(runTone("failed")).toBe("danger");
  expect(runTone("pending")).toBe("info");
  expect(runTone("cancelled")).toBe("default");
  expect(duration(724)).toBe("724ms");
  expect(duration(65_000)).toBe("1m 5s");
  expect(
    relativeTime(
      "2026-11-03T00:00:00.000Z",
      Date.parse("2026-11-03T00:10:00.000Z"),
    ),
  ).toBe("10m ago");
});
