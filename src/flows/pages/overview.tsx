import { useState } from "react";
import { flowsApi, type Flow, type RunPage } from "../api";
import { Badge, StatusBadge, Tabs, Time } from "../components";
import { seg, usePolling } from "../format";

type Tab = "flows" | "runs";

export function FlowsOverview({
  tab,
  onError,
}: {
  tab: Tab;
  onError: (error: Error | null) => void;
}) {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [page, setPage] = useState<RunPage | null>(null);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [status, setStatus] = useState("");
  // The cursor and filter the shown page was loaded for; paging is disabled
  // until the page for the current selection arrives, so a double click can't
  // push the same cursor twice.
  const [pageKey, setPageKey] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1] ?? null;
  const key = `${status}\n${cursor ?? ""}`;

  usePolling(
    async (signal) => {
      try {
        // Each list renders on its own tab, so one failing must not discard
        // the other's result.
        const [flowsResult, runsResult] = await Promise.allSettled([
          flowsApi.listFlows(signal),
          flowsApi.listRuns({ cursor, status: status || undefined }, signal),
        ]);
        if (signal.aborted) return;
        if (flowsResult.status === "fulfilled") setFlows(flowsResult.value);
        if (runsResult.status === "fulfilled") {
          setPage(runsResult.value);
          setPageKey(key);
        }
        if (flowsResult.status === "rejected") throw flowsResult.reason;
        if (runsResult.status === "rejected") throw runsResult.reason;
        onError(null);
      } catch (error) {
        if (!signal.aborted) onError(error as Error);
      }
    },
    10_000,
    true,
    [cursor, status],
  );

  return (
    <>
      <div className="heading">
        <div>
          <h1>Flows</h1>
          <p>Build, manage, and run your flows.</p>
        </div>
        <a className="button primary" href="#/flows/new">
          + New flow
        </a>
      </div>
      <Tabs
        label="Flows sections"
        current={tab}
        onChange={(next) =>
          (window.location.hash = next === "flows" ? "/flows" : "/flows/runs")
        }
        tabs={[
          {
            id: "flows",
            label: (
              <>
                Flows{" "}
                {flows ? <span className="count">{flows.length}</span> : null}
              </>
            ),
          },
          {
            id: "runs",
            label: (
              <>
                Run history{" "}
                {page ? <span className="count">{page.totalRuns}</span> : null}
              </>
            ),
          },
        ]}
      />
      {tab === "flows" && (
        <section aria-label="Your flows">
          {!flows && <p role="status">Loading your flows…</p>}
          {flows && flows.length === 0 && (
            <div className="empty">
              <strong>Make room for your first flow.</strong>
              <p>
                Define a flow, register a worker, and its runs will appear here.
              </p>
              <a className="button" href="#/flows/new">
                Build a flow →
              </a>
            </div>
          )}
          {flows && flows.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Flow</th>
                  <th>Last run</th>
                  <th>Last edited</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {flows.map((flow) => (
                  <tr key={flow.id}>
                    <td>
                      <a href={`#/flows/f/${seg(flow.id)}`}>
                        <strong>{flow.name}</strong>
                      </a>
                      <span className="sub">
                        {[
                          flow.description,
                          `${flow.stepCount || "?"} steps`,
                          flow.fileType.toUpperCase(),
                          `${flow.runCount} runs`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td>
                      {flow.lastRun ? (
                        <a href={`#/flows/runs/${seg(flow.lastRun.runId)}`}>
                          <StatusBadge status={flow.lastRun.status} />
                        </a>
                      ) : (
                        <Badge>Never run</Badge>
                      )}
                    </td>
                    <td>
                      <Time value={flow.updatedAt} />
                    </td>
                    <td className="actions">
                      <a href={`#/flows/f/${seg(flow.id)}`}>Open flow →</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {tab === "runs" && (
        <section aria-label="Recent runs">
          <div className="toolbar">
            {page && (
              <div className="chips">
                {page.activeRuns > 0 && (
                  <Badge tone="info">{page.activeRuns} running</Badge>
                )}
                {page.failedRuns > 0 && (
                  <Badge tone="danger">{page.failedRuns} failed</Badge>
                )}
              </div>
            )}
            <label>
              Status{" "}
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setCursors([null]);
                }}
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>
          <RunList page={page} />
          {page && (cursors.length > 1 || page.nextCursor) && (
            <div className="pager">
              <span>
                {page.runs.length} of {page.totalRuns} runs
              </span>
              <button
                disabled={cursors.length <= 1 || pageKey !== key}
                onClick={() => setCursors(cursors.slice(0, -1))}
              >
                Newer runs
              </button>
              <button
                disabled={!page.nextCursor || pageKey !== key}
                onClick={() => {
                  const next = page.nextCursor;
                  if (!next) return;
                  setCursors((current) =>
                    current.includes(next) ? current : [...current, next],
                  );
                }}
              >
                Older runs
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function RunList({ page }: { page: Pick<RunPage, "runs"> | null }) {
  if (!page) return <p role="status">Loading runs…</p>;
  if (!page.runs.length) {
    return (
      <div className="empty">
        <strong>No runs yet</strong>
        <p>Run a flow and its runs will appear here.</p>
      </div>
    );
  }
  return (
    <ul className="runs">
      {page.runs.map((run) => (
        <li key={run.runId}>
          <a href={`#/flows/runs/${seg(run.runId)}`}>
            <div>
              <strong>{run.workflowName}</strong>
              <span className="sub">
                {[
                  run.runId.slice(0, 8),
                  run.workerName
                    ? `on ${run.workerName}`
                    : run.dispatchType === "local"
                      ? "local runtime"
                      : "waiting for a worker",
                  run.trigger,
                ].join(" · ")}
              </span>
            </div>
            <Time value={run.updatedAt} />
            <StatusBadge status={run.status} />
            <span className="view">View run →</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
