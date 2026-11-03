// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import type { TranscriptCell } from "./transcript-cells";

const toolKinds = new Set(["exec", "explored", "edited", "called", "web"]);
export const isAgentActivity = (cell: TranscriptCell) => toolKinds.has(cell.kind) && !(cell.kind === "exec" && cell.title === "You ran");

/** Keep the transcript and its navigation on the same activity boundaries. */
export function groupTranscriptCells(cells: TranscriptCell[]): TranscriptCell[][] {
  const groups: TranscriptCell[][] = [];
  for (const cell of cells) {
    if (cell.kind === "worked") continue;
    const previous = groups.at(-1);
    if (isAgentActivity(cell) && previous && isAgentActivity(previous[0])) previous.push(cell);
    else groups.push([cell]);
  }
  return groups;
}
