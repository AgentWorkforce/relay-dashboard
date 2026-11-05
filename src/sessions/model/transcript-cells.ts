// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
/**
 * Turn replay events into the cells Codex's TUI draws in its inline transcript
 * (codex-rs/tui/src/history_cell): prompts, agent messages, "Ran" commands,
 * "Explored" read/search groups, "Edited" patches, "Called" tools, plans, and a
 * "Worked for" line closing each turn. Reasoning stays out of the transcript.
 */
import { displayUserMessage, isSystemContext } from "./transcript-display";
import { sessionImage } from "./session-image";
import { transcriptEvents } from "./transcript-events";
import { isToolActivity, pairToolSteps } from "./activity-summary";
import {
  isExploring,
  parseCommand,
  shortPath,
  unwrapShell,
  type ParsedCommand,
} from "./parse-command";
import { messageRole, type ReplayEvent } from "./replay-model";

export type DiffLine = { sign: "+" | "-" | " " | "⋮"; text: string };
export type EditedFile = {
  verb: "Added" | "Edited" | "Deleted";
  path: string;
  added: number;
  removed: number;
  lines: DiffLine[];
};
export type ExploreRow =
  | { verb: "Read"; names: string[] }
  | { verb: "List"; detail: string }
  | { verb: "Search"; query: string; path: string | null };
export type PlanStep = { text: string; status: "completed" | "in_progress" | "pending" };

export type TranscriptCell = { id: string; ts: string; truncated?: boolean; startsExchange?: boolean } & (
  | { kind: "user"; text: string; attachments: string[] }
  | { kind: "assistant"; text: string }
  | { kind: "image"; url: string }
  | { kind: "context"; text: string }
  | { kind: "notice"; text: string; output: string | null }
  | { kind: "interrupted" }
  | { kind: "exec"; title: "Ran" | "You ran"; command: string; output: string | null; recorded: boolean; failed: boolean; exitCode: number | null }
  | { kind: "explored"; rows: ExploreRow[]; failed: boolean }
  | { kind: "edited"; files: EditedFile[]; output: string | null; failed: boolean }
  | { kind: "called"; invocation: string; output: string | null; failed: boolean }
  | { kind: "web"; action: string; detail: string }
  | { kind: "plan"; title: "Updated Plan" | "Proposed Plan"; steps: PlanStep[]; text: string | null }
  | { kind: "worked"; durationMs: number }
);
/** Stable message anchors retained for shared transcript deep links. */
export function transcriptCellAnchor(cell: TranscriptCell): string {
  return `${cell.kind === "user" ? "message" : "cell"}-${cell.id}`;
}

type CellBody = TranscriptCell extends infer C
  ? C extends TranscriptCell
    ? Omit<C, "id" | "ts">
    : never
  : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Recorded tool events read `Name target` or `Name {json args}`. */
export function parseToolCall(event: ReplayEvent): {
  name: string;
  args: Record<string, unknown> | null;
  target: string | null;
} {
  const content = event.content?.trim() ?? "";
  const leading = /^([\w.:/-]+)(?:\s+|$)/.exec(content);
  const metadata = Array.isArray(event.toolCalls) ? event.toolCalls.find(isRecord) : event.toolCalls;
  const recorded = isRecord(metadata) ? metadata : null;
  const recordedName = recorded?.name ?? recorded?.tool;
  const name = event.toolName ?? (typeof recordedName === "string" ? recordedName : null) ?? leading?.[1] ?? "";
  const rawArgs = recorded?.args ?? recorded?.arguments ?? recorded?.input ?? recorded?.parameters;
  if (isRecord(rawArgs)) return { name, args: rawArgs, target: null };
  if (typeof rawArgs === "string") {
    try {
      const args: unknown = JSON.parse(rawArgs);
      if (isRecord(args)) return { name, args, target: null };
    } catch {
      // Fall back to recorded display text for incomplete structured arguments.
    }
  }
  const rest =
    leading && leading[1] === name ? content.slice(leading[0].length) : content;
  if (rest.startsWith("{")) {
    try {
      const args: unknown = JSON.parse(rest);
      if (isRecord(args)) return { name, args, target: null };
    } catch {
      // Truncated or display-only argument text still names a target.
    }
  }
  return { name, args: null, target: rest && rest !== event.kind && rest !== event.type ? rest : null };
}

// Claude Code wraps oversized results and tool errors; show only their text.
const RESULT_WRAPPERS = /^\s*<(persisted-output|tool_use_error)>\n?([\s\S]*?)\n?<\/\1>\s*$/;

/** Text of a tool result, unwrapping recorded content-block arrays. */
export function resultText(event: ReplayEvent | null): string | null {
  const recorded = event?.content;
  if (!recorded) return null;
  const content = RESULT_WRAPPERS.exec(recorded)?.[2] ?? recorded;
  if (content.trimStart().startsWith("[")) {
    try {
      const blocks: unknown = JSON.parse(content);
      if (Array.isArray(blocks)) {
        const text = blocks
          .map((block) => (isRecord(block) ? str(block.text) : null))
          .filter(Boolean)
          .join("\n");
        if (text) return text;
      }
    } catch {
      // Not a block array; show it as recorded.
    }
  }
  return content;
}

type CommandResult = { output: string | null; exitCode: number | null };

/** Output and exit code from Codex, Claude Code, and generic shell results. */
export function commandResult(text: string | null): CommandResult {
  if (!text) return { output: null, exitCode: null };
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      let value: unknown = JSON.parse(trimmed);
      // Code-mode scripts often print Promise.allSettled entries.
      if (isRecord(value) && isRecord(value.value)) value = value.value;
      if (isRecord(value) && isRecord(value.reason)) value = value.reason;
      if (isRecord(value) && typeof value.output === "string") {
        const metadata = isRecord(value.metadata) ? value.metadata : value;
        const code = metadata.exit_code ?? metadata.exitCode;
        return {
          output: value.output.trim() || null,
          exitCode: typeof code === "number" ? code : null,
        };
      }
    } catch {
      // Fall through to the text formats.
    }
  }
  const codexExit = /^Process exited with code (-?\d+)$/m.exec(trimmed);
  const claudeExit = /^Exit code (-?\d+)\n?/.exec(trimmed);
  const outputAt = trimmed.search(/^Output:\n?/m);
  const output =
    outputAt >= 0 && /^(Chunk ID|Wall time|Process|Script|Command)/.test(trimmed)
      ? trimmed.slice(outputAt).replace(/^Output:\n?/, "")
      : claudeExit
        ? trimmed.slice(claudeExit[0].length)
        : trimmed;
  const code = codexExit?.[1] ?? claudeExit?.[1];
  return {
    output: output.trim() || null,
    exitCode: code === undefined ? null : Number(code),
  };
}

/** Failure a generic tool records in its result body. File reads, searches,
 * edits, and shell output can contain the same text, so they rely on status. */
function payloadFailed(text: string | null): boolean {
  return Boolean(text) && (/"isError"\s*:\s*true/.test(text!) || /^\s*(?:Error|Failed):/.test(text!));
}

function failedStatus(step: { call: ReplayEvent; result: ReplayEvent | null }) {
  return (
    [step.call.toolStatus, step.result?.toolStatus].some(
      (status) => status && /fail|error/i.test(status),
    ) || /^\s*<tool_use_error>/.test(step.result?.content ?? "")
  );
}

/** Decode a JavaScript string literal from Codex code-mode tool scripts. */
function decodeLiteral(literal: string): string {
  const quote = literal[0];
  const body = literal.slice(1, -1);
  if (quote === "`") return body.replace(/\\(`|\\|\$)/g, "$1").replace(/\\n/g, "\n");
  try {
    return JSON.parse(`"${body.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"')}"`);
  } catch {
    return body;
  }
}

const LITERAL = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\`(?:[^\`\\]|\\.)*\`)`;

type ScriptOp =
  | { type: "exec"; command: string }
  | { type: "patch"; patch: string }
  | { type: "tool"; name: string };

/** The argument text of a call whose `(` precedes `start`, up to its `)`. */
function callArguments(script: string, start: number): string {
  let depth = 1;
  let quote: string | null = null;
  for (let index = start; index < script.length; index += 1) {
    const char = script[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return script.slice(start, index);
  }
  return script.slice(start);
}

/** Tool calls a Codex code-mode `exec` script makes, in source order. */
export function scriptOperations(script: string): ScriptOp[] {
  const ops: ScriptOp[] = [];
  const call = /tools\.(\w+)\s*\(/g;
  for (const match of script.matchAll(call)) {
    const name = match[1]!;
    const args = callArguments(script, match.index! + match[0].length);
    if (name === "exec_command") {
      const literal = new RegExp(String.raw`\bcmd\s*:\s*` + LITERAL).exec(args);
      // A computed command shows as written rather than as a later literal.
      const expression = /\bcmd\b(?:\s*:\s*([^,}]+))?/.exec(args);
      const command = literal
        ? decodeLiteral(literal[1]!)
        : (expression?.[1] ?? expression?.[0])?.trim();
      if (command) ops.push({ type: "exec", command });
    } else if (name === "apply_patch") {
      const patch = new RegExp(String.raw`^\s*(?:\{[^]*?\binput\s*:\s*)?` + LITERAL).exec(args);
      if (patch) ops.push({ type: "patch", patch: decodeLiteral(patch[1]!) });
    } else ops.push({ type: "tool", name });
  }
  return ops;
}

/** Top-level JSON objects embedded in text, in order. */
function jsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"' && depth > 0) inString = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) objects.push(text.slice(start, index + 1));
    }
  }
  return objects;
}

/** Per-command outputs printed by a code-mode script, in order. */
function scriptOutputs(text: string | null): CommandResult[] {
  if (!text) return [];
  return jsonObjects(text).flatMap((object) => {
    const parsed = commandResult(object);
    return parsed.output !== object.trim() &&
      (parsed.output !== null || parsed.exitCode !== null)
      ? [parsed]
      : [];
  });
}

/** Files, counts, and lines of an apply_patch envelope. */
export function parsePatch(patch: string): EditedFile[] {
  const files: EditedFile[] = [];
  let file: EditedFile | null = null;
  for (const line of patch.split("\n")) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      file = {
        verb: header[1] === "Add" ? "Added" : header[1] === "Delete" ? "Deleted" : "Edited",
        path: header[2]!.trim(),
        added: 0,
        removed: 0,
        lines: [],
      };
      files.push(file);
      continue;
    }
    if (!file || line.startsWith("*** ")) {
      const move = /^\*\*\* Move to: (.+)$/.exec(line);
      if (file && move) file.path = `${file.path} → ${move[1]!.trim()}`;
      continue;
    }
    if (line.startsWith("@@")) {
      if (file.lines.length) file.lines.push({ sign: "⋮", text: "" });
      continue;
    }
    const sign = line[0];
    if (sign === "+" || sign === "-" || sign === " ") {
      file.lines.push({ sign, text: line.slice(1) });
      if (sign === "+") file.added += 1;
      if (sign === "-") file.removed += 1;
    }
  }
  return files;
}

function exploreRows(parts: ParsedCommand[]): ExploreRow[] {
  return parts.flatMap((part): ExploreRow[] => {
    if (part.type === "read") return [{ verb: "Read", names: [part.name] }];
    if (part.type === "list") return [{ verb: "List", detail: part.path ?? part.cmd }];
    if (part.type === "search")
      return [
        part.query
          ? { verb: "Search", query: part.query, path: part.path }
          : { verb: "Search", query: part.cmd, path: null },
      ];
    return [];
  });
}

function execBody(command: string, result: CommandResult | null, failed: boolean): CellBody {
  const script = unwrapShell(command);
  const parts = parseCommand(script);
  const exitCode = result?.exitCode ?? null;
  const exitFailed = failed || (exitCode !== null && exitCode !== 0);
  if (isExploring(parts))
    // A search with no matches exits non-zero; Codex keeps exploring cells dim.
    return { kind: "explored", rows: exploreRows(parts), failed };
  return {
    kind: "exec",
    title: "Ran",
    command: script,
    output: result?.output ?? null,
    recorded: result !== null,
    failed: exitFailed,
    exitCode,
  };
}

function planSteps(items: unknown, textKey: string): PlanStep[] {
  return Array.isArray(items)
    ? items.flatMap((item) => {
        if (!isRecord(item)) return [];
        const text = str(item[textKey]);
        const status = item.status;
        return text
          ? [{
              text,
              status:
                status === "completed" || status === "in_progress" ? status : "pending",
            }]
          : [];
      })
    : [];
}

function invocation(name: string, args: Record<string, unknown> | null, target: string | null) {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  const label = mcp ? `${mcp[1]}.${mcp[2]}` : name;
  const detail = args ? JSON.stringify(args) : target;
  return `${label}(${detail ?? ""})`;
}

/** Paths inside the session's project display relative to it, like Codex. */
function relativeTo(projectPath: string | null) {
  const root = projectPath?.replace(/\/+$/, "");
  if (!root) return (path: string) => path;
  // Recorded content abbreviates the home directory as `~`.
  const roots = [root, root.replace(/^\/(?:Users|home)\/[^/]+/, "~")];
  return (path: string) => {
    const match = roots.find((candidate) => path.startsWith(`${candidate}/`));
    return match ? path.slice(match.length + 1) : path;
  };
}

/** The cells one recorded tool call renders as. */
export function toolCells(step: { call: ReplayEvent; result: ReplayEvent | null }): CellBody[] {
  const relative = relativeTo(step.call.projectPath);
  return rawToolCells(step).map((cell) =>
    cell.kind === "edited"
      ? { ...cell, files: cell.files.map((file) => ({ ...file, path: relative(file.path) })) }
      : cell.kind === "explored"
        ? {
            ...cell,
            rows: cell.rows.map((row) =>
              row.verb === "Search" && row.path
                ? { ...row, path: relative(row.path) }
                : row.verb === "List"
                  ? { ...row, detail: relative(row.detail) }
                  : row,
            ),
          }
        : cell,
  );
}

function rawToolCells(step: { call: ReplayEvent; result: ReplayEvent | null }): CellBody[] {
  const { name, args, target } = parseToolCall(step.call);
  const text = resultText(step.result);
  const failed = failedStatus(step);
  const lower = name.toLowerCase();
  const arg = (key: string) => (args ? str(args[key]) : null);

  if (lower === "exec" && (arg("input") ?? target)) {
    const script = arg("input") ?? target!;
    const ops = scriptOperations(script);
    if (ops.length) {
      const outputs = scriptOutputs(text);
      const execs = ops.filter((op) => op.type === "exec").length;
      let execIndex = 0;
      return ops.map((op): CellBody => {
        if (op.type === "patch") {
          return { kind: "edited", files: parsePatch(op.patch), output: null, failed };
        }
        if (op.type === "tool") {
          return { kind: "called", invocation: `${op.name}()`, output: null, failed };
        }
        // Unattributable script output is not claimed by any one command.
        const result =
          outputs[execIndex] ?? (execs === 1 && step.result ? commandResult(text) : null);
        execIndex += 1;
        return execBody(op.command, result, failed);
      });
    }
  }

  const command =
    lower === "bash" || lower === "exec_command" || lower === "shell" || lower === "shell_command" || lower === "local_shell"
      ? (arg("command") ?? arg("cmd") ??
          (args && Array.isArray(args.command) ? (args.command as unknown[]).map(String).join(" ") : null) ??
          target)
      : null;
  if (command) return [execBody(command, step.result ? commandResult(text) : null, failed)];

  if (lower === "write_stdin") {
    const chars = arg("chars");
    return [{
      kind: "notice",
      text: chars ? `Interacted with background terminal, sent ${JSON.stringify(chars.slice(0, 80))}` : "Waited for background terminal",
      // Keep the terminal output the call returned.
      output: text?.trim() ? text : null,
    }];
  }

  if (lower === "apply_patch") {
    const patch = arg("input") ?? (target?.includes("*** Begin Patch") ? target : null);
    const files = patch
      ? parsePatch(patch)
      : [{ verb: "Edited" as const, path: target ?? "files", added: 0, removed: 0, lines: [] }];
    return [{ kind: "edited", files, output: failed ? text : null, failed }];
  }
  if (["edit", "multiedit", "write", "notebookedit"].includes(lower)) {
    const path = arg("file_path") ?? arg("notebook_path") ?? target ?? "file";
    const lines: DiffLine[] = [];
    if (args && lower === "write" && typeof args.content === "string")
      lines.push(...args.content.split("\n").map((line) => ({ sign: "+" as const, text: line })));
    if (args && lower === "edit" && typeof args.old_string === "string" && typeof args.new_string === "string") {
      lines.push(...args.old_string.split("\n").map((line) => ({ sign: "-" as const, text: line })));
      lines.push(...args.new_string.split("\n").map((line) => ({ sign: "+" as const, text: line })));
    }
    return [{
      kind: "edited",
      files: [{
        verb: "Edited",
        path,
        added: lines.filter((line) => line.sign === "+").length,
        removed: lines.filter((line) => line.sign === "-").length,
        lines,
      }],
      output: failed ? text : null,
      failed,
    }];
  }

  if (lower === "read" || lower === "read_file" || lower === "view") {
    const path = arg("file_path") ?? arg("path") ?? target;
    if (path) return [{ kind: "explored", rows: [{ verb: "Read", names: [shortPath(path)] }], failed }];
  }
  if (lower === "grep" || lower === "glob" || lower === "grep_files") {
    const query = arg("pattern") ?? target;
    if (query) return [{ kind: "explored", rows: [{ verb: "Search", query, path: arg("path") }], failed }];
  }
  if (lower === "ls" || lower === "list_dir") {
    const path = arg("path") ?? target;
    if (path) return [{ kind: "explored", rows: [{ verb: "List", detail: path }], failed }];
  }

  if (lower === "todowrite" || lower === "update_plan") {
    const steps = lower === "todowrite" ? planSteps(args?.todos, "content") : planSteps(args?.plan, "step");
    return [{ kind: "plan", title: "Updated Plan", steps, text: arg("explanation") }];
  }
  if (lower === "exitplanmode") {
    return [{ kind: "plan", title: "Proposed Plan", steps: [], text: arg("plan") }];
  }
  if (lower === "websearch" || lower === "web_search") {
    return [{ kind: "web", action: "Searched the web for", detail: arg("query") ?? target ?? "" }];
  }
  if (lower === "webfetch") {
    return [{ kind: "web", action: "Opened", detail: arg("url") ?? target ?? "page" }];
  }

  return [{ kind: "called", invocation: invocation(name || "tool", args, target), output: text, failed: failed || payloadFailed(text) }];
}

/** Merge consecutive explore cells and adjacent Read rows, as Codex does. */
function mergeExplored(cells: TranscriptCell[]): TranscriptCell[] {
  const merged: TranscriptCell[] = [];
  for (const cell of cells) {
    const previous = merged.at(-1);
    if (cell.kind !== "explored" || previous?.kind !== "explored") {
      merged.push(cell);
      continue;
    }
    const rows = [...previous.rows, ...cell.rows];
    merged[merged.length - 1] = { ...previous, rows, failed: previous.failed || cell.failed };
  }
  return merged.map((cell) =>
    cell.kind === "explored"
      ? {
          ...cell,
          rows: cell.rows.reduce<ExploreRow[]>((rows, row) => {
            const last = rows.at(-1);
            if (row.verb === "Read" && last?.verb === "Read")
              rows[rows.length - 1] = { verb: "Read", names: [...new Set([...last.names, ...row.names])] };
            else rows.push(row);
            return rows;
          }, []),
        }
      : cell,
  );
}

/** Build the transcript cells for replay events in chronological order. */
export function buildTranscript(events: ReplayEvent[]): TranscriptCell[] {
  events = transcriptEvents(events);
  const cells: TranscriptCell[] = [];
  // Pair calls and results within each turn: a reply can arrive between a
  // call and its result, and the result still belongs under its call.
  const results = new Map<ReplayEvent, ReplayEvent | null>();
  let turnTools: ReplayEvent[] = [];
  const pairTurn = () => {
    for (const step of pairToolSteps(turnTools)) results.set(step.call, step.result);
    turnTools = [];
  };
  let previousUser: ReplayEvent | null = null;
  const startsUserMessage = (event: ReplayEvent) => {
    if (messageRole(event) !== "user") { previousUser = null; return false; }
    const sameMessage = previousUser && (sessionImage(event.content) || sessionImage(previousUser.content)) && (event.messageId && previousUser.messageId
      ? event.messageId === previousUser.messageId
      : event.ts === previousUser.ts);
    previousUser = event;
    return !sameMessage;
  };
  const boundaries = new Map(events.map(event => [event, startsUserMessage(event)]));
  for (const event of events) {
    if (sessionImage(event.content)) {
      if (boundaries.get(event)) pairTurn();
      continue;
    }
    if (isToolActivity(event)) turnTools.push(event);
    // Only a visible prompt starts a turn; injected user-role records
    // (reminders, notifications, context) can land between call and result.
    else if (
      messageRole(event) === "user" &&
      displayUserMessage(event.content).kind === "prompt"
    )
      pairTurn();
  }
  pairTurn();

  let turnStart: string | null = null;
  let turnEnd: string | null = null;
  let turnHasWork = false;
  const extendTurn = (ts: string) => {
    if (!turnEnd || Date.parse(ts) > Date.parse(turnEnd)) turnEnd = ts;
    turnHasWork = true;
  };

  const closeTurn = (id: string) => {
    if (turnStart && turnEnd && turnHasWork) {
      const durationMs = Date.parse(turnEnd) - Date.parse(turnStart);
      if (Number.isFinite(durationMs) && durationMs >= 0)
        cells.push({ kind: "worked", durationMs, id: `worked:${id}`, ts: turnEnd });
    }
    turnStart = null;
    turnEnd = null;
    turnHasWork = false;
  };

  for (const event of events) {
    const image = sessionImage(event.content);
    if (image) {
      const startsExchange = boundaries.get(event) === true;
      if (startsExchange) { closeTurn(event.eventId); turnStart = event.ts; }
      cells.push({ kind: "image", url: image, id: event.eventId, ts: event.ts, startsExchange });
      continue;
    }
    if (["system", "developer"].includes(event.actorRole ?? "") || ["system", "developer", "context"].includes(event.type ?? "") || (messageRole(event) === "user" && isSystemContext(event.content))) {
      if (event.content?.trim()) cells.push({ kind: "context", text: event.content, id: event.eventId, ts: event.ts, ...(event.contentTruncated ? { truncated: true } : {}) });
      continue;
    }
    if (isToolActivity(event)) {
      if (!results.has(event)) continue; // Results render under their calls.
      const step = { call: event, result: results.get(event) ?? null };
      const truncated = event.contentTruncated || Boolean(step.result?.contentTruncated);
      toolCells(step).forEach((body, index) => {
        cells.push({ ...body, id: `${event.eventId}:${index}`, ts: event.ts, ...(truncated ? { truncated } : {}) } as TranscriptCell);
      });
      extendTurn((step.result ?? event).ts);
      continue;
    }
    const role = messageRole(event);
    if (!role) continue; // Reasoning, system records, and markers stay out.
    const truncated = event.contentTruncated ? { truncated: true } : {};
    if (role === "assistant") {
      const text = event.content?.trim();
      if (!text) continue;
      cells.push({ kind: "assistant", text, id: event.eventId, ts: event.ts, ...truncated });
      extendTurn(event.ts);
      continue;
    }
    const display = displayUserMessage(event.content);
    if (display.kind === "hidden") continue;
    if (display.kind === "prompt") {
      const startsExchange = boundaries.get(event) !== false;
      if (startsExchange) { closeTurn(event.eventId); turnStart = event.ts; }
      cells.push({ kind: "user", ...(startsExchange ? {} : { startsExchange: false }), text: display.text, attachments: display.attachments, id: event.eventId, ts: event.ts, ...truncated });
    } else if (display.kind === "interrupted") {
      cells.push({ kind: "interrupted", id: event.eventId, ts: event.ts });
    } else if (display.kind === "shell") {
      cells.push({ kind: "exec", title: "You ran", command: display.command, output: null, recorded: false, failed: false, exitCode: null, id: event.eventId, ts: event.ts });
    } else {
      const previous = cells.at(-1);
      // Shell-mode output belongs under the command the person ran.
      if (display.output && previous?.kind === "exec" && previous.title === "You ran" && previous.output === null)
        cells[cells.length - 1] = { ...previous, output: display.output };
      else cells.push({ kind: "notice", text: display.text, output: display.output, id: event.eventId, ts: event.ts });
    }
  }
  closeTurn("end");
  return mergeExplored(cells);
}
