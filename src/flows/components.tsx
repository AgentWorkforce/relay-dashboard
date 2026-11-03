import { useRef, useState, type ReactNode } from "react";
import { flowsApi, type RunEvent, type Step, type Steps } from "./api";
import {
  duration,
  eventLabel,
  fullTime,
  relativeTime,
  runTone,
  statusLabel,
  usePolling,
  type Tone,
} from "./format";
import { Badge as HostedBadge } from "../shell/ui";

export function Badge({
  tone = "default",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  // Hosted ui/badge.tsx; tones are its variants.
  return (
    <HostedBadge variant={tone} data-tone={tone}>
      {children}
    </HostedBadge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={runTone(status)}>{statusLabel(status)}</Badge>;
}

export function Tabs<T extends string>({
  tabs,
  current,
  onChange,
  label,
}: {
  tabs: Array<{ id: T; label: ReactNode }>;
  current: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === current}
          className={tab.id === current ? "tab active" : "tab"}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Time({ value }: { value?: string | null }) {
  return (
    <time dateTime={value ?? undefined} title={fullTime(value)}>
      {relativeTime(value)}
    </time>
  );
}

export function CopyableCommand({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="copyable">
      <div className="copyable-head">
        <span>{label}</span>
        <button type="button" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{command}</code>
      </pre>
    </div>
  );
}

export function Tile({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="tile">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Incremental log reader: appends pages every 2 s until the run is done.
 * Callers key it by run and step so switching sources starts fresh.
 */
export function LogViewer({
  runId,
  step,
  terminal,
}: {
  runId: string;
  step: string | null;
  terminal: boolean;
}) {
  const [content, setContent] = useState("");
  const [state, setState] = useState<"loading" | "live" | "done" | "missing">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  // Runtimes may upload the log just after reporting a terminal status, so
  // after "Not captured" keep checking a few more times before stopping.
  const [misses, setMisses] = useState(0);
  usePolling(
    async (signal) => {
      try {
        const page = await flowsApi.getLog(
          runId,
          { offset: offset.current, step },
          signal,
        );
        if (signal.aborted) return;
        setError(null);
        if (!page.available) {
          if (terminal) setMisses((value) => value + 1);
          setState(terminal ? "missing" : "loading");
          return;
        }
        setContent((previous) =>
          page.reset ? page.content : previous + page.content,
        );
        offset.current = page.offset;
        setState(page.done ? "done" : "live");
      } catch (caught) {
        if (!signal.aborted) setError((caught as Error).message);
      }
    },
    2_000,
    state !== "done" && !(state === "missing" && misses >= 3),
    [runId, step, terminal],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // Clipboard unavailable (insecure context or denied permission).
    }
  }
  return (
    <div className="log">
      <div className="log-head">
        <span>{step ? `${step} output` : "Runner output"}</span>
        <span className="log-actions">
          <Badge
            tone={
              state === "live"
                ? "success"
                : state === "done"
                  ? "default"
                  : "info"
            }
          >
            {state === "live"
              ? "Live"
              : state === "done"
                ? "Complete"
                : state === "missing"
                  ? "Not captured"
                  : "Connecting"}
          </Badge>
          {content && (
            <button type="button" onClick={() => void copy()}>
              Copy log
            </button>
          )}
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      <pre
        className="log-body"
        aria-label={step ? `${step} log` : "Runner log"}
      >
        {content ||
          (state === "missing"
            ? "No log output was captured for this run. Workers running the v1 relayflows runtime report status only; logs appear when the runtime uploads them."
            : "Waiting for the first log line…")}
      </pre>
    </div>
  );
}

function stepDuration(step: Step): string {
  if (step.durationMs !== null && step.durationMs !== undefined)
    return duration(step.durationMs);
  return "—";
}

export function StepsTable({ steps }: { steps: Steps }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!steps.steps.length) {
    return (
      <p className="muted">
        This run has not reported any steps. Step rows arrive when the runtime
        reports them; TypeScript flows declare their steps at run time.
      </p>
    );
  }
  const counts = steps.steps.reduce<Record<string, number>>((all, step) => {
    all[step.status] = (all[step.status] ?? 0) + 1;
    return all;
  }, {});
  return (
    <div>
      <div className="step-summary">
        <span>{steps.steps.length} steps</span>
        {Object.entries(counts).map(([status, count]) => (
          <Badge key={status} tone={runTone(status)}>
            {count} {statusLabel(status)}
          </Badge>
        ))}
        {steps.live && <Badge tone="success">Live</Badge>}
      </div>
      {steps.source === "declared" && (
        <p className="note">
          Declared in the flow definition. This worker’s runtime reports run
          status only, so step status is inferred from the run.
        </p>
      )}
      <table className="table steps">
        <thead>
          <tr>
            <th>Step</th>
            <th>Type</th>
            <th>Depends on</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {steps.steps.map((step) => (
            <StepRow
              key={step.stepName}
              step={step}
              open={open === step.stepName}
              onToggle={() =>
                setOpen(open === step.stepName ? null : step.stepName)
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StepRow({
  step,
  open,
  onToggle,
}: {
  step: Step;
  open: boolean;
  onToggle: () => void;
}) {
  const expandable = Boolean(step.outputSummary || step.error);
  return (
    <>
      <tr>
        <td>
          {expandable ? (
            <button
              type="button"
              className="link"
              aria-expanded={open}
              onClick={onToggle}
            >
              {open ? "▾" : "▸"} {step.label || step.stepName}
            </button>
          ) : (
            <strong>{step.label || step.stepName}</strong>
          )}
          {step.label && step.label !== step.stepName && (
            <code className="sub">{step.stepName}</code>
          )}
          {step.error && !open && (
            <span className="error-text">{step.error}</span>
          )}
        </td>
        <td>{step.stepType ?? step.agent ?? "—"}</td>
        <td className="mono">
          {step.dependsOn.length ? step.dependsOn.join(", ") : "—"}
        </td>
        <td>
          <StatusBadge status={step.status} />
        </td>
        <td>{stepDuration(step)}</td>
        <td className="mono">
          {step.completionReason ??
            (step.exitCode !== null && step.exitCode !== undefined
              ? `Exit ${step.exitCode}`
              : "—")}
          {step.retryCount ? ` · ${step.retryCount} retries` : ""}
        </td>
      </tr>
      {open && (
        <tr className="step-detail">
          <td colSpan={6}>
            {step.error && (
              <>
                <h4>Failure</h4>
                <pre className="danger-box">{step.error}</pre>
              </>
            )}
            {step.outputSummary && (
              <>
                <h4>Output summary</h4>
                <pre>{step.outputSummary}</pre>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Dependency graph laid out by depth (columns) like the hosted run graph. */
export function StepGraph({ steps }: { steps: Step[] }) {
  if (steps.length < 2 || steps.length > 60) return null;
  const byName = new Map(steps.map((step) => [step.stepName, step]));
  const depth = new Map<string, number>();
  const visit = (name: string, seen: Set<string>): number => {
    if (depth.has(name)) return depth.get(name)!;
    if (seen.has(name)) return 0;
    seen.add(name);
    const step = byName.get(name);
    const value = step?.dependsOn.length
      ? 1 +
        Math.max(
          ...step.dependsOn
            .filter((dep) => byName.has(dep))
            .map((dep) => visit(dep, seen)),
          -1,
        )
      : 0;
    depth.set(name, value);
    return value;
  };
  steps.forEach((step) => visit(step.stepName, new Set()));
  const columns: string[][] = [];
  for (const step of steps) {
    const column = depth.get(step.stepName) ?? 0;
    (columns[column] ??= []).push(step.stepName);
  }
  const W = 168;
  const H = 52;
  const GX = 56;
  const GY = 16;
  const position = new Map<string, { x: number; y: number }>();
  columns.forEach((names, column) =>
    names.forEach((name, row) =>
      position.set(name, { x: column * (W + GX), y: row * (H + GY) }),
    ),
  );
  const width = columns.length * (W + GX) - GX;
  const height =
    Math.max(...columns.map((names) => names.length)) * (H + GY) - GY;
  return (
    <div className="graph" role="img" aria-label="Step dependency graph">
      <svg
        viewBox={`-4 -4 ${width + 8} ${height + 8}`}
        width={width + 8}
        height={height + 8}
      >
        {steps.flatMap((step) =>
          step.dependsOn
            .filter((dep) => position.has(dep))
            .map((dep) => {
              const from = position.get(dep)!;
              const to = position.get(step.stepName)!;
              return (
                <path
                  key={`${dep}->${step.stepName}`}
                  className="edge"
                  d={`M${from.x + W},${from.y + H / 2} C${from.x + W + GX / 2},${from.y + H / 2} ${to.x - GX / 2},${to.y + H / 2} ${to.x},${to.y + H / 2}`}
                />
              );
            }),
        )}
        {steps.map((step) => {
          const at = position.get(step.stepName)!;
          return (
            <g
              key={step.stepName}
              className={`node node-${runTone(step.status)}`}
              transform={`translate(${at.x},${at.y})`}
            >
              <rect width={W} height={H} rx={8} />
              <text x={12} y={21} className="node-title">
                {(step.label || step.stepName).slice(0, 22)}
              </text>
              <text x={12} y={39} className="node-sub">
                {statusLabel(step.status)}
                {step.durationMs !== null && step.durationMs !== undefined
                  ? ` · ${duration(step.durationMs)}`
                  : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function EventTimeline({ events }: { events: RunEvent[] }) {
  if (!events.length) return <p className="muted">No events yet.</p>;
  return (
    <ol className="timeline">
      {events.map((event) => {
        const detail = [
          event.stepName,
          typeof event.payload.exitCode === "number"
            ? `exit ${event.payload.exitCode}`
            : null,
          typeof event.payload.durationMs === "number"
            ? duration(event.payload.durationMs)
            : null,
          typeof event.payload.error === "string" ? event.payload.error : null,
        ].filter(Boolean);
        return (
          <li
            key={event.id}
            className={`event event-${runTone(event.eventType.split(".").pop() ?? "")}`}
          >
            <span className="dot" aria-hidden />
            <div>
              <strong>{eventLabel(event.eventType)}</strong>
              {detail.length > 0 && (
                <span className="muted"> · {detail.join(" · ")}</span>
              )}
            </div>
            <time dateTime={event.createdAt} title={fullTime(event.createdAt)}>
              {fullTime(event.createdAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
