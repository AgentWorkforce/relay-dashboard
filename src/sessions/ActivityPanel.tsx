// Team activity: active conversations per UTC day, stacked by agent harness
// (the hosted dashboard's TeamActivity chart), plus output totals when the
// RelayHistory build serves them.
import { useEffect, useState } from "react";
import { SignedOut } from "../api/client";
import { useLoad } from "./use-load";
import { sessionActivity, sessionOutput, type ActivityDay } from "./api";
import { Info } from "lucide-react";
import { harnessName, toolColor, toolKey } from "./data";
import { Card, Skeleton } from "../shell/ui";
import styles from "./team-activity.module.css";

const RANGES = [7, 14, 30, 90] as const;

export function activityWindow(days: number, now = new Date()) {
  const last = now.toISOString().slice(0, 10);
  const first = new Date(Date.parse(last) - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { first, last };
}

/** Combine sources that share a harness (for example claude-terminal). */
export function byHarness(days: ActivityDay[]) {
  const totals = new Map<string, number>();
  const rows = days.map((day) => {
    const tools: Record<string, number> = {};
    for (const [source, count] of Object.entries(day.bySource)) {
      const key = toolKey(source);
      tools[key] = (tools[key] ?? 0) + count;
      totals.set(key, (totals.get(key) ?? 0) + count);
    }
    return { date: day.date, total: day.conversations, tools };
  });
  const order = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  return { rows, order, totals };
}

export function ActivityPanel({
  workspaceId,
  query,
  onSignedOut,
}: {
  workspaceId: string;
  query: string;
  onSignedOut?: () => void;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const window = activityWindow(range);
  const key = JSON.stringify([workspaceId, window, query.trim()]);
  const activity = useLoad(key, (signal) =>
    sessionActivity(
      workspaceId,
      { ...window, q: query.trim() || undefined },
      signal,
    ),
  );
  // Output metrics are optional: older RelayHistory builds do not serve them.
  // They are workspace-wide (the endpoint takes no query), so they are not
  // shown beside a filtered chart.
  const filtered = !!query.trim();
  const outputs = useLoad(filtered ? null : key, (signal) =>
    sessionOutput(workspaceId, window, signal).catch(() => null),
  );
  const days = activity.data ?? null;
  const output = filtered ? null : (outputs.data ?? null);
  const error = activity.error;
  useEffect(() => {
    if (error instanceof SignedOut) onSignedOut?.();
  }, [error, onSignedOut]);

  const chart = days ? byHarness(fillDays(days, window)) : null;
  const max = chart ? Math.max(1, ...chart.rows.map((row) => row.total)) : 1;
  const scale = niceMax(max);
  const total = chart ? chart.rows.reduce((sum, row) => sum + row.total, 0) : 0;
  const labelEvery = Math.max(1, Math.round((chart?.rows.length ?? 0) / 7));
  // Hosted sessions-board.tsx: a card with the Activity screen tab and the
  // TeamActivity chart (team-activity.module.css).
  return (
    <Card
      className="gap-0 py-3"
      role="region"
      aria-label="Team activity"
    >
      <div
        role="tablist"
        aria-label="Sessions board"
        className="-mt-1 flex items-center gap-1 overflow-x-auto px-4 pb-2"
      >
        <span
          role="tab"
          aria-selected="true"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-base font-medium text-muted-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
        >
          Activity
        </span>
      </div>
      <div className={styles.header}>
        <div className={styles.title}>
          <h3>Daily active sessions</h3>
          <span title="Conversations with recorded activity per UTC day, by agent harness.">
            <Info className="size-3.5" aria-hidden="true" />
          </span>
          {chart && (
            <span className="ml-2 cursor-auto text-xs text-muted-foreground">
              <strong className="font-semibold text-foreground">{total}</strong>{" "}
              <span>active conversation-days</span>
              {output && (
                <>
                  {" · "}
                  {output.agentMessages} agent messages · {output.commits}{" "}
                  commits ·{" "}
                  <span className="added">+{output.linesAdded}</span>{" "}
                  <span className="removed">-{output.linesRemoved}</span>
                </>
              )}
            </span>
          )}
        </div>
        <div role="group" aria-label="Range" className={styles.controls}>
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              data-slot="toggle"
              aria-pressed={range === value}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              onClick={() => setRange(value)}
            >
              {value}d
            </button>
          ))}
        </div>
      </div>
      <div className="px-4">
        {error && (
          <p role="alert">
            {error instanceof SignedOut ? "Taking you to sign in…" : error.message}
          </p>
        )}
        {!days && !error && (
          <div role="status" aria-label="Loading activity…">
            <span className="sr-only">Loading activity…</span>
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {chart && (
          <div className={styles.chart}>
            <div
              className={styles.plot}
              role="img"
              aria-label={`Conversations per day over ${range} days`}
            >
              <div className={styles.scale} aria-hidden="true">
                <span>{scale}</span>
                <span>{scale / 2}</span>
                <span>0</span>
              </div>
              <div className={styles.grid} aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div className={styles.columns}>
                {chart.rows.map((row, index) => (
                  <div
                    key={row.date}
                    className={styles.day}
                    title={`${row.date}: ${row.total} ${row.total === 1 ? "conversation" : "conversations"}`}
                  >
                    <div className={styles.barArea}>
                      <div className={styles.bar}>
                        {chart.order.map((tool) =>
                          row.tools[tool] ? (
                            <span
                              key={tool}
                              className={styles.segment}
                              style={{
                                height: `${(row.tools[tool]! / scale) * 104}px`,
                                background: toolColor(tool),
                              }}
                            />
                          ) : null,
                        )}
                      </div>
                    </div>
                    <span className={styles.date}>
                      {/* Anchored on the last day, so labels never crowd it. */}
                      {(chart.rows.length - 1 - index) % labelEvery === 0
                        ? shortDay(row.date)
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {chart.order.length > 0 ? (
              <ul className={styles.legend}>
                {chart.order.map((tool) => (
                  <li key={tool} title={`${chart.totals.get(tool)}`}>
                    <span
                      style={{ background: toolColor(tool) }}
                      aria-hidden="true"
                    />
                    {harnessName(tool)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-foreground">No activity in this period.</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Every day in the window, zero where the service returned nothing (hosted draws each day). */
export function fillDays(
  days: ActivityDay[],
  range: { first: string; last: string },
): ActivityDay[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const first = Date.parse(`${range.first}T00:00:00Z`);
  const last = Date.parse(`${range.last}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first)
    return days;
  const filled: ActivityDay[] = [];
  for (let time = first; time <= last; time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    filled.push(byDate.get(date) ?? { date, conversations: 0, bySource: {} });
  }
  // Keep days the service returned outside the window rather than drop them.
  for (const day of days) if (!filled.some((row) => row.date === day.date)) filled.push(day);
  return filled.sort((a, b) => a.date.localeCompare(b.date));
}

/** A round upper bound for the scale, so the midline label is an integer. */
function niceMax(value: number) {
  const even = Math.max(2, Math.ceil(value / 2) * 2);
  return even;
}

function shortDay(date: string) {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : date;
}
