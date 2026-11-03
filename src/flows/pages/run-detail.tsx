import { useState } from "react";
import {
  flowsApi,
  type Artifact,
  type Run,
  type RunEvent,
  type Steps,
} from "../api";
import {
  Badge,
  EventTimeline,
  LogViewer,
  StatusBadge,
  StepGraph,
  StepsTable,
  Tile,
  Time,
} from "../components";
import {
  bytes,
  duration,
  fullTime,
  go,
  isTerminal,
  seg,
  shortId,
  usePolling,
} from "../format";

export function RunDetailPage({
  runId,
  onError,
}: {
  runId: string;
  onError: (error: Error | null) => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Steps | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [missing, setMissing] = useState(false);
  const [logStep, setLogStep] = useState<string | null>(null);
  const [definition, setDefinition] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startFrom, setStartFrom] = useState("");
  const terminal = run ? isTerminal(run.status) : false;

  usePolling(
    async (signal) => {
      try {
        const [nextRun, nextSteps, nextEvents, nextArtifacts] =
          await Promise.all([
            flowsApi.getRun(runId, signal),
            flowsApi.getSteps(runId, signal),
            flowsApi.getEvents(runId, signal),
            flowsApi.getArtifacts(runId, signal),
          ]);
        if (signal.aborted) return;
        setRun(nextRun);
        setSteps(nextSteps);
        setEvents(nextEvents);
        setArtifacts(nextArtifacts);
        onError(null);
      } catch (error) {
        if (signal.aborted) return;
        if ((error as { status?: number }).status === 404) setMissing(true);
        else onError(error as Error);
      }
    },
    5_000,
    !missing && !terminal,
    [runId],
  );

  if (missing) {
    return (
      <div className="empty">
        <strong>Relayflow run not found</strong>
        <a className="button" href="#/flows/runs">
          Back to flows
        </a>
      </div>
    );
  }
  if (!run || !steps)
    return <p role="status">Loading relayflow run details and logs…</p>;

  async function perform(kind: "cancel" | "retry" | "resume") {
    setAction(kind);
    setActionError(null);
    try {
      if (kind === "cancel") {
        const result = await flowsApi.cancelRun(runId);
        setRun((current) =>
          current ? { ...current, status: result.status } : current,
        );
      } else {
        const next = await flowsApi.resumeRun(
          runId,
          kind,
          kind === "resume" ? startFrom || undefined : undefined,
        );
        go(`/flows/runs/${seg(next.runId)}`);
      }
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setAction(null);
    }
  }

  async function toggleDefinition() {
    if (definition !== null) {
      setDefinition(null);
      return;
    }
    try {
      const source = await flowsApi.getRunWorkflow(runId);
      setDefinition(
        source.workflow ?? "No workflow definition is available for this run.",
      );
    } catch (error) {
      onError(error as Error);
    }
  }

  const logSteps = [
    ...new Set(
      artifacts
        .filter((artifact) => artifact.key.endsWith("/agent.log"))
        .map((artifact) => artifact.key.slice(0, -"/agent.log".length)),
    ),
  ];
  const elapsed =
    run.durationMs ??
    (run.startedAt
      ? Date.parse(run.completedAt ?? run.updatedAt) - Date.parse(run.startedAt)
      : null);

  return (
    <>
      <div className="heading">
        <div>
          <a
            className="back"
            href={
              run.flowId ? `#/flows/f/${seg(run.flowId)}` : "#/flows/runs"
            }
          >
            ← Back to {run.flowId ? "flow" : "flows"}
          </a>
          <h1>{run.workflowName}</h1>
          <div className="badges">
            <StatusBadge status={run.status} />
            <Badge>
              <span className="mono" title={run.runId}>
                {shortId(run.runId)}
              </span>
            </Badge>
            {!terminal && <Badge tone="info">Refreshing every 5s</Badge>}
          </div>
        </div>
        <div className="actions">
          {!terminal && (
            <button
              className="danger"
              onClick={() => void perform("cancel")}
              disabled={action !== null}
            >
              {action === "cancel" ? "Cancelling…" : "Cancel run"}
            </button>
          )}
          {terminal && run.dispatchType === "worker" && (
            <>
              <button
                onClick={() => void perform("retry")}
                disabled={action !== null}
              >
                {action === "retry" ? "Retrying…" : "Retry"}
              </button>
              <span className="resume">
                <select
                  aria-label="Resume from step"
                  value={startFrom}
                  onChange={(event) => setStartFrom(event.target.value)}
                >
                  <option value="">Resume from start</option>
                  {steps.steps.map((step) => (
                    <option key={step.stepName} value={step.stepName}>
                      Start from {step.stepName}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void perform("resume")}
                  disabled={action !== null}
                >
                  {action === "resume" ? "Resuming…" : "Resume"}
                </button>
              </span>
            </>
          )}
        </div>
      </div>
      {actionError && <p role="alert">{actionError}</p>}
      {run.status === "cancelled" && run.assignmentStatus === "running" && (
        <p className="note">
          The run is cancelled. Its worker had already started and cannot be
          interrupted remotely; any later report from it is ignored.
        </p>
      )}

      {run.status === "failed" && (
        <section className="panel failure" aria-label="Execution failure">
          <h2>Execution failure</h2>
          <pre className="danger-box">{run.error ?? "The run failed."}</pre>
          <dl className="facts">
            <dt>Exit code</dt>
            <dd>{run.exitCode ?? "—"}</dd>
            <dt>Assignment</dt>
            <dd>{run.assignmentStatus ?? "—"}</dd>
          </dl>
        </section>
      )}

      <dl className="tiles">
        <Tile label="Run ID">
          <span className="mono">{run.runId}</span>
        </Tile>
        <Tile label="Status">{run.summary ?? run.status}</Tile>
        <Tile label="Ran on">
          {run.workerName ? (
            <a href={`#/flows/workers/${seg(run.workerId)}`}>{run.workerName}</a>
          ) : run.dispatchType === "local" ? (
            "Local runtime"
          ) : (
            "Waiting for a worker"
          )}
        </Tile>
        <Tile label="Triggered">
          {run.trigger}
          {run.createdBy ? ` by ${run.createdBy}` : ""}
        </Tile>
        <Tile label="Created">
          {fullTime(run.createdAt)} (<Time value={run.createdAt} />)
        </Tile>
        <Tile label="Duration">{duration(elapsed)}</Tile>
        <Tile label="Exit code">{run.exitCode ?? "—"}</Tile>
        {run.resumedFromRunId && (
          <Tile label="Continues">
            <a href={`#/flows/runs/${seg(run.resumedFromRunId)}`}>
              {shortId(run.resumedFromRunId)}
            </a>
            {run.startFrom ? ` from ${run.startFrom}` : ""}
          </Tile>
        )}
        {run.resumedBy.length > 0 && (
          <Tile label="Resumed by">
            {run.resumedBy.map((child) => (
              <a key={child.runId} href={`#/flows/runs/${seg(child.runId)}`}>
                {shortId(child.runId)}{" "}
              </a>
            ))}
          </Tile>
        )}
      </dl>

      <section className="panel" aria-label="Steps">
        <h2>Steps</h2>
        <StepGraph steps={steps.steps} />
        <StepsTable steps={steps} />
      </section>

      <section className="panel" aria-label="Relayflow logs">
        <h2>Relayflow logs</h2>
        <div className="tabs" role="tablist" aria-label="Log source">
          <button
            role="tab"
            aria-selected={logStep === null}
            className={logStep === null ? "tab active" : "tab"}
            onClick={() => setLogStep(null)}
          >
            Runner log
          </button>
          {logSteps.map((step) => (
            <button
              key={step}
              role="tab"
              aria-selected={logStep === step}
              className={logStep === step ? "tab active" : "tab"}
              onClick={() => setLogStep(step)}
            >
              {step}
            </button>
          ))}
        </div>
        <LogViewer
          key={`${runId}:${logStep ?? ""}`}
          runId={runId}
          step={logStep}
          terminal={terminal}
        />
      </section>

      <div className="split">
        <section className="panel" aria-label="Timeline">
          <h2>Timeline</h2>
          <EventTimeline events={events} />
        </section>
        <section className="panel" aria-label="Outputs and artifacts">
          <h2>Outputs and artifacts</h2>
          {artifacts.length === 0 ? (
            <p className="muted">No artifacts were uploaded for this run.</p>
          ) : (
            <ul className="artifacts">
              {artifacts.map((artifact) => (
                <li key={artifact.key}>
                  <a href={flowsApi.artifactUrl(runId, artifact.key)} download>
                    <code>{artifact.key}</code>
                  </a>
                  <span className="muted">
                    {artifact.kind} · {bytes(artifact.size)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {run.inputs !== null && run.inputs !== undefined && (
            <>
              <h3>Inputs</h3>
              <pre>{JSON.stringify(run.inputs, null, 2)}</pre>
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <button
          className="link"
          onClick={() => void toggleDefinition()}
          aria-expanded={definition !== null}
        >
          {definition !== null ? "▾" : "▸"} Workflow definition (
          {run.workflowFileName ?? run.fileType})
        </button>
        {definition !== null && <pre className="source">{definition}</pre>}
      </section>
    </>
  );
}
