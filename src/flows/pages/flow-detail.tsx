import { useState } from "react";
import { flowsApi, type FlowDetail, type Worker } from "../api";
import { Badge, Tabs, Time } from "../components";
import { go, seg, usePolling } from "../format";
import { FlowForm } from "./flow-editor";
import { RunList } from "./overview";

type Tab = "runs" | "definition";

export function FlowDetailPage({
  flowId,
  onError,
}: {
  flowId: string;
  onError: (error: Error | null) => void;
}) {
  const [detail, setDetail] = useState<FlowDetail | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("runs");
  const [inputs, setInputs] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  usePolling(
    async (signal) => {
      // The flow and the worker picker load independently: a worker-list
      // failure must not hide the flow's definition and recent runs.
      const [flowResult, workersResult] = await Promise.allSettled([
        flowsApi.getFlow(flowId, signal),
        flowsApi.listWorkers(signal),
      ]);
      if (signal.aborted) return;
      if (flowResult.status === "rejected") {
        const error = flowResult.reason as Error & { status?: number };
        if (error.status === 404) setMissing(true);
        else onError(error);
        return;
      }
      setDetail(flowResult.value);
      if (workersResult.status === "fulfilled") {
        setWorkers(workersResult.value);
        onError(null);
      } else if (
        (workersResult.reason as { status?: number }).status === 403
      ) {
        // Not allowed to list workers: "Any online worker" only.
        setWorkers([]);
        onError(null);
      } else {
        // Don't keep offering (or submitting) a worker from a stale list.
        setWorkers([]);
        setWorkerId("");
        onError(workersResult.reason as Error);
      }
    },
    10_000,
    !missing,
    [flowId, revision],
  );

  if (missing) {
    return (
      <div className="empty">
        <strong>Flow not found</strong>
        <a className="button" href="#/flows">
          Back to flows
        </a>
      </div>
    );
  }
  if (!detail) return <p role="status">Loading flow…</p>;
  const { flow, recentRuns } = detail;
  const online = workers.filter((worker) => worker.status === "online");
  // A worker that was revoked or disappeared can't stay selected.
  const selectedWorker = workers.some(
    (worker) => worker.id === workerId && worker.status !== "revoked",
  )
    ? workerId
    : "";

  async function runNow() {
    setRunning(true);
    setRunError(null);
    setStarted(null);
    try {
      let parsed: unknown;
      if (inputs.trim()) {
        try {
          parsed = JSON.parse(inputs);
        } catch {
          throw new Error("Inputs must be valid JSON.");
        }
      }
      const run = await flowsApi.invokeFlow(flow.id, {
        inputs: parsed,
        workerId: selectedWorker || undefined,
      });
      setStarted(run.runId);
      setRevision((value) => value + 1);
    } catch (error) {
      setRunError((error as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="heading">
        <div>
          <a className="back" href="#/flows">
            ← Back to flows
          </a>
          <h1>{flow.name}</h1>
          <p>
            {flow.description || "No description"} ·{" "}
            {flow.fileType.toUpperCase()} · edited{" "}
            <Time value={flow.updatedAt} />
          </p>
        </div>
        <Badge tone="success">Manual</Badge>
      </div>

      <section className="panel" aria-label="Run this flow">
        <div className="run-now">
          <label>
            Inputs (optional JSON)
            <textarea
              className="code-input"
              rows={2}
              placeholder='{"task": "…"}'
              value={inputs}
              onChange={(event) => setInputs(event.target.value)}
            />
          </label>
          <label>
            Worker
            <select
              value={selectedWorker}
              onChange={(event) => setWorkerId(event.target.value)}
            >
              <option value="">Any online worker</option>
              {workers
                .filter((worker) => worker.status !== "revoked")
                .map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name} ({worker.status})
                  </option>
                ))}
            </select>
          </label>
          <button
            className="primary"
            onClick={() => void runNow()}
            disabled={running}
          >
            {running ? "Starting…" : runError ? "Retry Run now" : "Run now"}
          </button>
        </div>
        {online.length === 0 && (
          <p className="note">
            No worker is online. The run will wait in the queue until one
            connects. <a href="#/flows/workers">Add a worker →</a>
          </p>
        )}
        {runError && <p role="alert">{runError}</p>}
        {started && (
          <p role="status">
            Run started. <a href={`#/flows/runs/${seg(started)}`}>Open run</a>
          </p>
        )}
      </section>

      <Tabs
        label="Flow sections"
        current={tab}
        onChange={setTab}
        tabs={[
          {
            id: "runs",
            label: (
              <>
                Runs <span className="count">{flow.runCount}</span>
              </>
            ),
          },
          { id: "definition", label: "Definition" },
        ]}
      />
      {tab === "runs" && <RunList page={{ runs: recentRuns }} />}
      {tab === "definition" && (
        <>
          <FlowForm
            // Keyed by flow, not updatedAt: a refresh that sees a newer save
            // must not discard a draft being edited.
            key={flow.id}
            initial={{
              name: flow.name,
              description: flow.description ?? "",
              fileType: flow.fileType,
              source: flow.source,
            }}
            submitLabel="Save changes"
            onError={onError}
            onSubmit={async (value) => {
              await flowsApi.updateFlow(flow.id, {
                name: value.name,
                description: value.description || null,
                fileType: value.fileType,
                source: value.source,
              });
              setRevision((current) => current + 1);
            }}
          />
          <details className="panel">
            <summary>Flow details</summary>
            <dl className="facts">
              <dt>Flow ID</dt>
              <dd className="mono">{flow.id}</dd>
              <dt>Declared steps</dt>
              <dd>
                {flow.steps.map((step) => step.stepName).join(", ") || "—"}
              </dd>
              <dt>Created by</dt>
              <dd>{flow.createdBy ?? "—"}</dd>
            </dl>
          </details>
          <div className="danger-zone">
            {!confirmDelete ? (
              <button className="danger" onClick={() => setConfirmDelete(true)}>
                Delete flow
              </button>
            ) : (
              <div role="alertdialog" aria-label="Confirm delete">
                <p>Delete {flow.name}? Past runs are kept.</p>
                <button
                  className="danger"
                  onClick={() =>
                    void flowsApi.deleteFlow(flow.id).then(
                      () => go("/flows"),
                      (error: Error) => setDeleteError(error.message),
                    )
                  }
                >
                  Yes, delete flow
                </button>
                <button
                  onClick={() => {
                    setConfirmDelete(false);
                    setDeleteError(null);
                  }}
                >
                  Cancel
                </button>
                {deleteError && <p role="alert">{deleteError}</p>}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
