// Team activity: active conversations per UTC day, stacked by agent harness
// (the hosted dashboard's TeamActivity chart), plus output totals when the
// RelayHistory build serves them.
import { useEffect, useState } from "react";
import { SignedOut } from "../api/client";
import { useLoad } from "./use-load";
import { sessionActivity, sessionOutput, type ActivityDay } from "./api";
import { harnessName, toolColor, toolKey } from "./data";

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

  const chart = days ? byHarness(days) : null;
  const max = chart ? Math.max(1, ...chart.rows.map((row) => row.total)) : 1;
  const total = chart ? chart.rows.reduce((sum, row) => sum + row.total, 0) : 0;
  return (
    <section className="activity" aria-label="Team activity">
      <div className="activity-head">
        <h2>Team activity</h2>
        <div role="group" aria-label="Range" className="segmented">
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {value}d
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert">
          {error instanceof SignedOut ? "Taking you to sign in…" : error.message}
        </p>
      )}
      {!days && !error && <p role="status">Loading activity…</p>}
      {chart && (
        <>
          <div className="stats">
            <div>
              <strong>{total}</strong>
              <span>active conversation-days</span>
            </div>
            {output && (
              <>
                <div>
                  <strong>{output.agentMessages}</strong>
                  <span>agent messages</span>
                </div>
                <div>
                  <strong>{output.commits}</strong>
                  <span>commits</span>
                </div>
                <div>
                  <strong>
                    <span className="added">+{output.linesAdded}</span>{" "}
                    <span className="removed">-{output.linesRemoved}</span>
                  </strong>
                  <span>lines changed</span>
                </div>
              </>
            )}
          </div>
          <div
            className="chart"
            role="img"
            aria-label={`Conversations per day over ${range} days`}
          >
            {chart.rows.map((row) => (
              <div
                key={row.date}
                className="bar"
                title={`${row.date}: ${row.total} ${row.total === 1 ? "conversation" : "conversations"}`}
              >
                {chart.order.map((tool) =>
                  row.tools[tool] ? (
                    <span
                      key={tool}
                      style={{
                        height: `${(row.tools[tool]! / max) * 100}%`,
                        background: toolColor(tool),
                      }}
                    />
                  ) : null,
                )}
              </div>
            ))}
          </div>
          <div className="chart-axis dim small">
            <span>{chart.rows[0]?.date}</span>
            <span>{chart.rows.at(-1)?.date}</span>
          </div>
          <ul className="legend">
            {chart.order.map((tool) => (
              <li key={tool}>
                <i style={{ background: toolColor(tool) }} aria-hidden="true" />
                {harnessName(tool)}{" "}
                <span className="dim">{chart.totals.get(tool)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
