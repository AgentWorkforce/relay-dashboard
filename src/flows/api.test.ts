import { afterEach, expect, it, vi } from "vitest";
import { SignedOut } from "../api/client";
import { ApiError, FLOWS_CHANGED, flowsApi, runSchema } from "./api";
import {
  duration,
  relativeTime,
  runTone,
  shellQuote,
  statusLabel,
} from "./format";

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

it("rolls a rounded minute over instead of showing 60s", () => {
  expect(duration(59_400)).toBe("59s");
  expect(duration(59_600)).toBe("1m 0s");
  expect(duration(119_600)).toBe("2m 0s");
  expect(duration(3_599_600)).toBe("1h 0m");
});

it("accepts runs whose workflowFileName is null", () => {
  expect(runSchema.parse({ ...run, workflowFileName: null })).toMatchObject({
    runId: "r1",
    workflowFileName: null,
  });
});

it("shell-quotes names in copied commands", () => {
  expect(shellQuote("relayflows-worker")).toBe("relayflows-worker");
  expect(shellQuote("my worker")).toBe("'my worker'");
  expect(shellQuote("a'b; rm -rf /")).toBe("'a'\\''b; rm -rf /'");
});

it("signals a created flow even when its response fails validation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ flow: { id: 1 } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  const changed = vi.fn();
  window.addEventListener(FLOWS_CHANGED, changed);
  try {
    await expect(
      flowsApi.createFlow({ name: "x", fileType: "yaml", source: "a: 1" }),
    ).rejects.toThrow();
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener(FLOWS_CHANGED, changed);
  }
});
