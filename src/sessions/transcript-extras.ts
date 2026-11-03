// Self-host additions on top of the hosted transcript model.
import type { ReplayEvent } from "./model/replay-model";
import type { TranscriptCell } from "./model/transcript-cells";

const TOOL_KINDS = new Set(["exec", "explored", "edited", "called", "web"]);

/** Prompts and tool calls shown in the transcript. */
export function transcriptCounts(cells: TranscriptCell[]) {
  let prompts = 0;
  let tools = 0;
  for (const cell of cells) {
    if (cell.kind === "user") prompts += 1;
    else if (
      TOOL_KINDS.has(cell.kind) &&
      !(cell.kind === "exec" && cell.title === "You ran")
    )
      tools += 1;
  }
  return { prompts, tools };
}

function touched(event: ReplayEvent): string[] {
  const files = Array.isArray(event.filesTouched)
    ? event.filesTouched.filter(
        (file): file is string => typeof file === "string" && !!file,
      )
    : [];
  return files.length
    ? files
    : event.content?.trim()
      ? [event.content.trim()]
      : [];
}

function relative(path: string, root: string | null) {
  const base = root?.replace(/\/+$/, "");
  return base && path.startsWith(`${base}/`)
    ? path.slice(base.length + 1)
    : path;
}

/**
 * RelayHistory also records `file_edit` events (the files an agent changed)
 * that the hosted renderer drops. Show each as an "Edited" step unless a tool
 * call in the transcript already shows an edit to that file.
 */
export function withRecordedFileEdits(
  cells: TranscriptCell[],
  events: ReplayEvent[],
): TranscriptCell[] {
  const shown = new Set(
    cells.flatMap((cell) =>
      cell.kind === "edited" ? cell.files.map((file) => file.path) : [],
    ),
  );
  const extra: TranscriptCell[] = events.flatMap((event): TranscriptCell[] => {
    if (
      (event.kind || event.type) !== "file_edit" &&
      event.type !== "file_edit"
    )
      return [];
    const files = touched(event)
      .map((path) => relative(path, event.projectPath))
      .filter(
        (path) =>
          !shown.has(path) &&
          ![...shown].some((seen) => path.endsWith(`/${seen}`)),
      );
    if (!files.length) return [];
    return [
      {
        kind: "edited",
        id: event.eventId,
        ts: event.ts,
        files: files.map((path) => ({
          verb: "Edited" as const,
          path,
          added: 0,
          removed: 0,
          lines: [],
        })),
        output: null,
        failed: false,
      },
    ];
  });
  if (!extra.length) return cells;
  const merged = [...cells];
  for (const cell of extra) {
    const at = Date.parse(cell.ts);
    let index = merged.length;
    // Before the closing "worked" line of the turn it belongs to.
    while (index > 0 && Date.parse(merged[index - 1]!.ts) > at) index -= 1;
    while (index > 0 && merged[index - 1]!.kind === "worked") index -= 1;
    merged.splice(index, 0, cell);
  }
  return merged;
}

/**
 * A raw `history` record and RelayHistory's projected event can describe the
 * same message. The hosted reconciliation pairs them only when their
 * attribution matches; a history copy without a user id would otherwise show
 * twice. Drop a history record when a projected record with the same speaker
 * and text lies within two seconds of it.
 */
export function collapseHistoryCopies(events: ReplayEvent[]): ReplayEvent[] {
  const speaker = (event: ReplayEvent) =>
    event.actorRole ||
    (event.kind === "prompt" || event.kind === "user" ? "user" : event.kind);
  const projected = new Map<string, number[]>();
  for (const event of events) {
    if (event.kind === "history" || !event.content?.trim()) continue;
    const key = JSON.stringify([speaker(event), event.content.trim()]);
    projected.set(key, [...(projected.get(key) ?? []), Date.parse(event.ts)]);
  }
  return events.filter((event) => {
    if (event.kind !== "history" || !event.content?.trim()) return true;
    const times = projected.get(
      JSON.stringify([speaker(event), event.content.trim()]),
    );
    const at = Date.parse(event.ts);
    return !times?.some((time) => Math.abs(time - at) <= 2_000);
  });
}
