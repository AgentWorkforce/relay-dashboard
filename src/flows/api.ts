import { z } from "zod";
import { SignedOut } from "../api/client";

const text = z.string().nullish();
const when = z.string().nullish();

export const runStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runSchema = z.object({
  runId: z.string(),
  flowId: text,
  workflow: z.string(),
  workflowName: z.string(),
  fileType: z.string(),
  workflowFileName: text,
  dispatchType: z.string(),
  status: runStatusSchema,
  trigger: z.string(),
  workerId: text,
  workerName: text,
  assignmentStatus: text,
  resumedFromRunId: text,
  resumedBy: z
    .array(
      z.object({
        runId: z.string(),
        status: runStatusSchema,
        createdAt: z.string(),
      }),
    )
    .default([]),
  startFrom: text,
  createdBy: text,
  summary: text,
  error: text,
  exitCode: z.number().nullish(),
  durationMs: z.number().nullish(),
  hasEnvSecrets: z.boolean().optional(),
  hasCodeArchive: z.boolean().optional(),
  queueDeadline: when,
  startedAt: when,
  completedAt: when,
  createdAt: z.string(),
  updatedAt: z.string(),
  inputs: z.unknown().optional(),
});
export type Run = z.infer<typeof runSchema>;

export const runPageSchema = z.object({
  runs: z.array(runSchema),
  nextCursor: z.string().nullable(),
  totalRuns: z.number(),
  activeRuns: z.number(),
  failedRuns: z.number(),
});
export type RunPage = z.infer<typeof runPageSchema>;

export const flowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: text,
  fileType: z.enum(["yaml", "ts"]),
  createdBy: text,
  createdAt: z.string(),
  updatedAt: z.string(),
  stepCount: z.number(),
  runCount: z.number(),
  lastRun: z
    .object({
      runId: z.string(),
      status: runStatusSchema,
      createdAt: z.string(),
    })
    .nullish(),
});
export type Flow = z.infer<typeof flowSchema>;

export const declaredStepSchema = z.object({
  stepName: z.string(),
  stepType: text,
  agent: text,
  dependsOn: z.array(z.string()),
});

export const flowDetailSchema = z.object({
  flow: flowSchema.extend({
    source: z.string(),
    steps: z.array(declaredStepSchema),
  }),
  recentRuns: z.array(runSchema),
});
export type FlowDetail = z.infer<typeof flowDetailSchema>;

export const stepSchema = z.object({
  stepName: z.string(),
  label: text,
  stepType: text,
  agent: text,
  cli: text,
  status: z.string(),
  source: z.enum(["declared", "snapshot", "final"]),
  attempt: z.number().nullish(),
  startTime: text,
  endTime: text,
  durationMs: z.number().nullish(),
  exitCode: z.number().nullish(),
  outputSummary: text,
  error: text,
  completionReason: text,
  retryCount: z.number().nullish(),
  dependsOn: z.array(z.string()).default([]),
});
export type Step = z.infer<typeof stepSchema>;
export const stepsSchema = z.object({
  steps: z.array(stepSchema),
  source: z.enum(["reported", "declared", "none"]),
  live: z.boolean(),
});
export type Steps = z.infer<typeof stepsSchema>;

export const eventSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  eventType: z.string(),
  stepName: text,
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type RunEvent = z.infer<typeof eventSchema>;

export const logPageSchema = z.object({
  content: z.string(),
  offset: z.number(),
  totalSize: z.number(),
  done: z.boolean(),
  available: z.boolean(),
  reset: z.boolean().optional(),
});
export type LogPage = z.infer<typeof logPageSchema>;

export const artifactSchema = z.object({
  key: z.string(),
  contentType: z.string(),
  size: z.number(),
  updatedAt: z.string(),
  kind: z.enum(["log", "code", "artifact"]),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const workerStatusSchema = z.enum([
  "pending",
  "online",
  "offline",
  "revoked",
]);
export type WorkerStatus = z.infer<typeof workerStatusSchema>;
export const workerSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  hostInfo: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  status: workerStatusSchema.catch("offline"),
  lastSeen: when,
  registeredAt: z.string(),
  registeredBy: text,
  currentRunId: text,
});
export type Worker = z.infer<typeof workerSchema>;

export const enrollmentSchema = z.object({
  id: z.string(),
  token: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  cloudUrl: z.string(),
  registerCommand: z.string(),
  startCommand: z.string(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;

export const enrollmentTokenSchema = z.object({
  id: z.string(),
  name: text,
  tags: z.array(z.string()).default([]),
  tokenHint: z.string(),
  status: z.enum(["active", "used", "expired", "revoked"]),
  expiresAt: z.string(),
  usedAt: when,
  createdAt: z.string(),
  createdBy: text,
});
export type EnrollmentToken = z.infer<typeof enrollmentTokenSchema>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<unknown> {
  const response = await fetch(`/cloud/api/v1${path}`, {
    method: init.method ?? "GET",
    signal: init.signal,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (response.status === 401) throw new SignedOut();
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object"
        ? ((body as { message?: unknown }).message ??
          (body as { error?: unknown }).error)
        : null;
    throw new ApiError(
      typeof message === "string" && message
        ? message
        : `Request failed (${response.status}). Please try again.`,
      response.status,
    );
  }
  return body;
}

const q = (params: Record<string, string | null | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : "";
};
const id = (value: string) => encodeURIComponent(value);

/** Fired after a flow is created, changed, or deleted, so lists can refresh. */
export const FLOWS_CHANGED = "relay:flows-changed";
async function changed<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  window.dispatchEvent(new Event(FLOWS_CHANGED));
  return value;
}

export const flowsApi = {
  listFlows: async (signal?: AbortSignal) =>
    z
      .object({ flows: z.array(flowSchema) })
      .parse(await call("/flows", { signal })).flows,
  getFlow: async (flowId: string, signal?: AbortSignal) =>
    flowDetailSchema.parse(await call(`/flows/${id(flowId)}`, { signal })),
  createFlow: async (input: {
    name: string;
    description?: string;
    fileType: "yaml" | "ts";
    source: string;
  }) => {
    // Signal the change once the request succeeds, even if parsing fails.
    const body = (await changed(
      call("/flows", { method: "POST", body: input }),
    )) as { flow: unknown };
    return flowSchema.extend({ source: z.string() }).parse(body.flow);
  },
  updateFlow: async (
    flowId: string,
    input: {
      name?: string;
      description?: string | null;
      fileType?: "yaml" | "ts";
      source?: string;
    },
  ) => changed(call(`/flows/${id(flowId)}`, { method: "PATCH", body: input })),
  deleteFlow: async (flowId: string) =>
    changed(call(`/flows/${id(flowId)}`, { method: "DELETE" })),
  invokeFlow: async (
    flowId: string,
    input: { inputs?: unknown; workerId?: string; tags?: string[] },
  ) =>
    z.object({ runId: z.string(), status: runStatusSchema }).parse(
      await call(`/flows/${id(flowId)}/invoke`, {
        method: "POST",
        body: {
          ...(input.inputs !== undefined ? { inputs: input.inputs } : {}),
          ...(input.workerId || input.tags?.length
            ? {
                runtime: {
                  id: "worker",
                  config: {
                    ...(input.workerId ? { workerId: input.workerId } : {}),
                    ...(input.tags?.length ? { tags: input.tags } : {}),
                  },
                },
              }
            : {}),
        },
      }),
    ),
  listRuns: async (
    options: { cursor?: string | null; flowId?: string; status?: string },
    signal?: AbortSignal,
  ) =>
    runPageSchema.parse(
      await call(
        `/workflows/runs${q({ cursor: options.cursor, flowId: options.flowId, status: options.status })}`,
        { signal },
      ),
    ),
  getRun: async (runId: string, signal?: AbortSignal) =>
    runSchema.parse(await call(`/workflows/runs/${id(runId)}`, { signal })),
  getRunWorkflow: async (runId: string, signal?: AbortSignal) =>
    z
      .object({ workflow: z.string().nullable(), fileType: z.string() })
      .parse(await call(`/workflows/runs/${id(runId)}/workflow`, { signal })),
  cancelRun: async (runId: string) =>
    z
      .object({ runId: z.string(), status: runStatusSchema })
      .parse(
        await call(`/workflows/runs/${id(runId)}/cancel`, { method: "POST" }),
      ),
  resumeRun: async (
    runId: string,
    mode: "retry" | "resume",
    startFrom?: string,
  ) =>
    z.object({ runId: z.string() }).parse(
      await call(`/workflows/runs/${id(runId)}/${mode}`, {
        method: "POST",
        body: startFrom ? { startFrom } : {},
      }),
    ),
  getSteps: async (runId: string, signal?: AbortSignal) =>
    stepsSchema.parse(
      await call(`/workflows/runs/${id(runId)}/steps`, { signal }),
    ),
  getEvents: async (runId: string, signal?: AbortSignal) =>
    z
      .object({ events: z.array(eventSchema) })
      .parse(
        await call(`/workflows/runs/${id(runId)}/events?limit=500`, { signal }),
      ).events,
  getLog: async (
    runId: string,
    options: { offset: number; step?: string | null },
    signal?: AbortSignal,
  ) =>
    logPageSchema.parse(
      await call(
        `/workflows/runs/${id(runId)}/logs${q({ offset: String(options.offset), step: options.step })}`,
        { signal },
      ),
    ),
  getArtifacts: async (runId: string, signal?: AbortSignal) =>
    z
      .object({ artifacts: z.array(artifactSchema) })
      .parse(await call(`/workflows/runs/${id(runId)}/artifacts`, { signal }))
      .artifacts,
  artifactUrl: (runId: string, key: string) =>
    `/cloud/api/v1/workflows/runs/${id(runId)}/artifacts/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  listWorkers: async (signal?: AbortSignal) =>
    z
      .object({ workers: z.array(workerSchema) })
      .parse(await call("/workers", { signal })).workers,
  getWorker: async (workerId: string, signal?: AbortSignal) =>
    z
      .object({ worker: workerSchema })
      .parse(await call(`/workers/${id(workerId)}`, { signal })).worker,
  revokeWorker: async (workerId: string) =>
    call(`/workers/${id(workerId)}`, { method: "DELETE" }),
  createEnrollment: async (input: {
    name?: string;
    tags?: string[];
    expiresInMinutes?: number;
  }) =>
    enrollmentSchema.parse(
      await call("/workers/enrollment-tokens", { method: "POST", body: input }),
    ),
  listEnrollments: async (signal?: AbortSignal) =>
    z
      .object({ tokens: z.array(enrollmentTokenSchema) })
      .parse(await call("/workers/enrollment-tokens", { signal })).tokens,
  revokeEnrollment: async (tokenId: string) =>
    call(`/workers/enrollment-tokens/${id(tokenId)}`, { method: "DELETE" }),
};
