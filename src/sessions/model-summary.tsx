// Hosted Cloud's recorded summary block, loaded independently of session details.
import { z } from "zod";
import { read } from "../api/client";
import { dateTime } from "./data";

const state = z
  .strictObject({
    state: z.enum(["active", "done", "abandoned", "unknown"]),
    classifiedAt: z.iso.datetime({ offset: true }),
  })
  .nullable();
const summarySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    kind: z.literal("short"),
    summary: z.string().min(1),
    model: z.string().min(1),
    builtAt: z.iso.datetime({ offset: true }),
    state,
  }),
  z.strictObject({
    status: z.literal("empty"),
    kind: z.literal("short"),
    state,
  }),
  z.strictObject({ status: z.literal("unsupported") }),
]);
export type SessionModelSummaryView = z.infer<typeof summarySchema>;

export async function sessionModelSummary(
  workspace: string,
  session: { sessionId: string; source: string },
  signal: AbortSignal,
): Promise<SessionModelSummaryView> {
  const query = new URLSearchParams({ source: session.source, kind: "short" });
  const response = await read(
    `/v1/workspaces/${encodeURIComponent(workspace)}/sessions/${encodeURIComponent(session.sessionId)}/summary?${query}`,
    signal,
  );
  return z.object({ summary: summarySchema }).parse(response).summary;
}

const labels = {
  active: "Active",
  done: "Done",
  abandoned: "Abandoned",
  unknown: null,
};

export function SessionModelSummary({
  summary,
}: {
  summary: SessionModelSummaryView | { status: "unavailable" } | undefined;
}) {
  if (!summary || summary.status === "unsupported") return null;
  const stateLabel =
    summary.status === "ready" || summary.status === "empty"
      ? summary.state && labels[summary.state.state]
      : null;
  return (
    <section aria-label="Session summary" className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">Summary</h3>
      {summary.status === "ready" ? (
        <>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {summary.summary}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {[stateLabel, summary.model].filter(Boolean).join(" · ")}
            {" · built "}
            <time dateTime={summary.builtAt}>{dateTime(summary.builtAt)}</time>
          </p>
        </>
      ) : summary.status === "empty" ? (
        <p className="text-xs text-muted-foreground">
          No summary yet{stateLabel ? ` · ${stateLabel}` : ""}
        </p>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          Summary unavailable
        </p>
      )}
    </section>
  );
}
