import { useEffect, useState } from "react";
import { flowsApi, type Flow, type RunPage } from "../api";
import {
  ArrowRight,
  Clock3,
  FileCode2,
  Plus,
  Workflow,
} from "lucide-react";
import { StatusBadge, Time } from "../components";
import { plural, runTone, seg, statusLabel, usePolling } from "../format";
import { Button, ButtonLink } from "../../shell/ui";
import { WorkspaceViewSlot } from "../../shell/view-slots";
import s from "../flows-dashboard.module.css";
import chrome from "../../shell/workspace-chrome.module.css";
import { FlowsIcon } from "../../shell/icons";

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

  const flowCount = flows?.length ?? 0;
  return (
    <div className={`${s.overview} ${s.embeddedOverview}`} id="flows-content">
      <WorkspaceViewSlot name="heading">
        <div className={s.shellHeading}>
          <h1>{tab === "runs" ? "Run history" : "Flows"}</h1>
          <p>Build, manage, and run your flows.</p>
        </div>
      </WorkspaceViewSlot>
      <WorkspaceViewSlot name="toolbar">
        <ButtonLink size="sm" href="#/flows/new">
          <Plus aria-hidden="true" />
          New flow
        </ButtonLink>
      </WorkspaceViewSlot>
      <FlowsSidebar
        current={tab}
        flows={flows}
        runCount={page ? page.totalRuns : null}
      />
      <div className={s.content} aria-busy={!flows}>
        {tab === "flows" && (
          <section className={s.tabContent} aria-labelledby="your-flows-title">
            <div className={s.sectionHeading}>
              <h2 id="your-flows-title">
                Your flows {flows && <span>{flowCount}</span>}
              </h2>
            </div>
            {!flows && (
              <div className={s.loading} role="status">
                <span>Loading your flows…</span>
                <div className={s.skeleton} aria-hidden="true" />
                <div className={s.skeleton} aria-hidden="true" />
              </div>
            )}
            {flows && flows.length === 0 && (
              <div className={s.emptyFlows}>
                <Workflow size={28} strokeWidth={1.5} aria-hidden="true" />
                <h3>Make room for your first flow.</h3>
                <p>
                  Define a flow, register a worker, and its runs will appear
                  here.
                </p>
                <a href="#/flows/new" className={s.textLink}>
                  Build a flow <ArrowRight size={16} aria-hidden="true" />
                </a>
              </div>
            )}
            {flows && flows.length > 0 && (
              <>
                <div className={s.columnHeadings} aria-hidden="true">
                  <span>Flow</span>
                  <span>Last run</span>
                  <span>Last edited</span>
                  <span />
                </div>
                <ul className={s.flowList}>
                  {flows.map((flow) => (
                    <li key={flow.id}>
                      <article className={s.flowRow}>
                        <div className={s.flowInfo}>
                          <div className={s.flowTitle}>
                            <h3>
                              <a href={`#/flows/f/${seg(flow.id)}`}>
                                {flow.name}
                              </a>
                            </h3>
                          </div>
                          <p className={s.repository}>
                            <FileCode2 size={14} aria-hidden="true" />
                            {[
                              flow.stepCount
                                ? plural(flow.stepCount, "step")
                                : "? steps",
                              flow.fileType.toUpperCase(),
                              plural(flow.runCount, "run"),
                            ].join(" · ")}
                          </p>
                          {flow.description && (
                            <ul className={s.sources}>
                              <li>{flow.description}</li>
                            </ul>
                          )}
                        </div>
                        {flow.lastRun ? (
                          <a
                            href={`#/flows/runs/${seg(flow.lastRun.runId)}`}
                            className={
                              runTone(flow.lastRun.status) === "success"
                                ? s.listeningStatus
                                : s.draftStatus
                            }
                          >
                            {statusLabel(flow.lastRun.status)}
                          </a>
                        ) : (
                          <span className={s.draftStatus}>Never run</span>
                        )}
                        <span className={s.lastEdited}>
                          <Time value={flow.updatedAt} />
                        </span>
                        <div className={s.flowActions}>
                          <a
                            href={`#/flows/f/${seg(flow.id)}`}
                            className={s.secondaryButton}
                            aria-label={`Open flow: ${flow.name}`}
                          >
                            Open flow
                            <ArrowRight size={16} aria-hidden="true" />
                          </a>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
        {tab === "runs" && (
          <section className={s.tabContent} aria-labelledby="recent-runs-title">
            <div className={s.sectionHeading}>
              <h2 id="recent-runs-title">Recent runs</h2>
              <div className={s.runSummary}>
                {page && page.activeRuns > 0 && (
                  <span>{page.activeRuns} running</span>
                )}
                {page && page.failedRuns > 0 && (
                  <span className={s.failure}>{page.failedRuns} failed</span>
                )}
                <label className="inline-flex items-center gap-2">
                  Status
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
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
            </div>
            <RunList page={page} />
            {page && (cursors.length > 1 || page.nextCursor) && (
              <div className={s.pagination}>
                <span>
                  {page.runs.length} of {page.totalRuns} runs
                </span>
                <Button
                  variant="ghost"
                  disabled={cursors.length <= 1 || pageKey !== key}
                  onClick={() => setCursors(cursors.slice(0, -1))}
                >
                  Newer runs
                </Button>
                <Button
                  variant="ghost"
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
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Hosted flows-overview.tsx sidebar (Flows label and section tabs). Workers
 * is a self-host section: hosted runs flows on its own sandboxes.
 */
export function FlowsSidebar({
  current,
  flows: given,
  runCount = null,
}: {
  current: "flows" | "runs" | "workers" | null;
  /** The overview passes its list; other pages load it here. */
  flows?: Flow[] | null;
  runCount?: number | null;
}) {
  const [loaded, setLoaded] = useState<Flow[] | null>(null);
  const own = given === undefined;
  useEffect(() => {
    if (!own) return;
    const controller = new AbortController();
    flowsApi.listFlows(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setLoaded(value);
      },
      () => {
        /* The page reports its own errors; the sidebar list is optional. */
      },
    );
    return () => controller.abort();
  }, [own]);
  const flows = own ? loaded : given;
  const tabs = [
    { id: "flows", href: "#/flows", label: "Flows", count: flows ? flows.length : null },
    { id: "runs", href: "#/flows/runs", label: "Run history", count: runCount },
    { id: "workers", href: "#/flows/workers", label: "Workers", count: null },
  ] as const;
  return (
    <WorkspaceViewSlot name="sidebar">
      <nav className={s.flowSidebar} aria-label="Flows">
        <p className={s.sidebarLabel}>Flows</p>
        <div className={s.tabs}>
          {tabs.map((tab) => (
            <a
              key={tab.id}
              href={tab.href}
              className={`${s.tab} flex items-center`}
              data-state={current === tab.id ? "active" : "inactive"}
              aria-current={current === tab.id ? "page" : undefined}
            >
              {tab.label}
              {tab.count !== null && <span>{tab.count}</span>}
            </a>
          ))}
        </div>
      </nav>
      {/* Hosted workspace-chrome "Your flows" resource rows. */}
      <section className={chrome.navGroup} aria-label="Your flows">
        <h2>Your flows</h2>
        {flows && flows.length > 0 ? (
          flows.map((flow) => (
            <a
              key={flow.id}
              href={`#/flows/f/${seg(flow.id)}`}
              className={`${chrome.sidebarRow} ${chrome.resourceRow}`}
            >
              <FlowsIcon aria-hidden="true" />
              <span>
                <strong>{flow.name}</strong>
                <small>
                  {flow.stepCount ? plural(flow.stepCount, "step") : "? steps"}{" "}
                  · {flow.fileType.toUpperCase()}
                </small>
              </span>
            </a>
          ))
        ) : (
          <p className={chrome.emptyResources}>
            {flows ? "No flows added yet." : "Loading flows…"}
          </p>
        )}
      </section>
    </WorkspaceViewSlot>
  );
}

export function RunList({ page }: { page: Pick<RunPage, "runs"> | null }) {
  if (!page)
    return (
      <div className={s.loading} role="status">
        <span>Loading runs…</span>
        <div className={s.skeleton} aria-hidden="true" />
      </div>
    );
  if (!page.runs.length) {
    return (
      <div className={s.emptyRuns}>
        <Clock3 size={20} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <h3>No runs yet</h3>
          <p>Run a flow and its runs will appear here.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className={s.runList}>
      {page.runs.map((run) => (
        <li key={run.runId} className={s.runRow}>
          <div className={s.runName}>
            <a href={`#/flows/runs/${seg(run.runId)}`}>{run.workflowName}</a>
            <span>
              {[
                run.runId.slice(0, 8),
                run.workerName
                  ? `on ${run.workerName}`
                  : run.dispatchType === "local"
                    ? "local runtime"
                    : "waiting for a worker",
                run.trigger,
              ].join(" · ")}
              {" · "}
              <Time value={run.updatedAt} />
            </span>
          </div>
          <StatusBadge status={run.status} />
          <a
            href={`#/flows/runs/${seg(run.runId)}`}
            className={s.textLink}
            aria-label={`View run: ${run.workflowName}`}
          >
            View run <ArrowRight size={15} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
