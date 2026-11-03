// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
/**
 * Classify a shell command the way Codex's TUI does
 * (codex-rs/shell-command/src/parse_command.rs): a command made only of file
 * reads, listings, and searches renders inside an "Explored" cell; anything
 * else is a plain "Ran" cell.
 */
export type ParsedCommand =
  | { type: "read"; name: string; cmd: string }
  | { type: "list"; path: string | null; cmd: string }
  | { type: "search"; query: string | null; path: string | null; cmd: string }
  | { type: "unknown"; cmd: string };

const SHELLS = new Set(["bash", "zsh", "sh", "/bin/bash", "/bin/zsh", "/bin/sh"]);
// Pipeline stages that only format another command's output.
const FORMATTERS = new Set([
  "wc", "tr", "cut", "sort", "uniq", "head", "tail", "column", "awk", "sed", "nl", "less", "more", "grep", "rg", "jq",
]);
const READERS = new Set(["cat", "bat", "batcat", "less", "more", "nl", "head", "tail"]);
const LISTERS = new Set(["ls", "eza", "exa", "tree", "du"]);
const SEARCHERS = new Set(["rg", "rga", "grep", "egrep", "fgrep", "ag", "ack", "pt"]);

/** Split a command line into words, honoring quotes and backslashes. */
function shellWords(command: string): string[] | null {
  const words: string[] = [];
  let word = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < command.length)
        word += command[++index];
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === "\\" && index + 1 < command.length) {
      word += command[++index];
      started = true;
    } else if (/\s/.test(char)) {
      if (started || word) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started || word) words.push(word);
  return words;
}

type Segment = { text: string; piped: boolean; writes: boolean };

/**
 * Split on `&&`, `||`, `;`, and `|` outside quotes, noting segments that
 * redirect output into a file (anything but `/dev/null` or another fd).
 */
function segments(command: string): Segment[] {
  const parts: Segment[] = [];
  let quote: string | null = null;
  let start = 0;
  let piped = false;
  let writes = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\") index += 1;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "\\") index += 1;
    else if (char === ">") {
      const target = /^>?\s*(&\d|[^\s;&|]+)/.exec(command.slice(index + 1))?.[1];
      if (target && !target.startsWith("&") && target !== "/dev/null") writes = true;
    } else if (char === ";" || char === "\n" || char === "&" || char === "|") {
      const double = command[index + 1] === char;
      if (char === "&" && !double) continue;
      parts.push({ text: command.slice(start, index), piped, writes });
      piped = char === "|" && !double;
      writes = false;
      if (double) index += 1;
      start = index + 1;
    }
  }
  parts.push({ text: command.slice(start), piped, writes });
  return parts.filter((part) => part.text.trim());
}

/** `bash -lc "script"` displays as its script, like Codex's exec cells. */
export function unwrapShell(command: string): string {
  const words = shellWords(command.trim());
  if (
    words &&
    words.length === 3 &&
    SHELLS.has(words[0]!) &&
    (words[1] === "-lc" || words[1] === "-c")
  )
    return words[2]!;
  return command.trim();
}

/** Last path segment, skipping build-output directory names. */
export function shortPath(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  while (
    parts.length > 1 &&
    ["build", "dist", "node_modules", "src"].includes(parts.at(-1)!)
  )
    parts.pop();
  return parts.at(-1) ?? path;
}

function operands(words: string[]): string[] {
  return words.slice(1).filter((word) => !word.startsWith("-"));
}

function parseSegment(words: string[], cmd: string): ParsedCommand {
  const [program, ...rest] = words;
  const name = program?.split("/").at(-1) ?? "";
  const args = operands(words);
  if (READERS.has(name) && args.length > 0) {
    const file = args.at(-1)!;
    if ((name === "head" || name === "tail") && /^\d+$/.test(file))
      return { type: "unknown", cmd };
    return { type: "read", name: shortPath(file), cmd };
  }
  if (name === "sed" && rest[0] === "-n" && args.length >= 2)
    return { type: "read", name: shortPath(args.at(-1)!), cmd };
  if (LISTERS.has(name))
    return { type: "list", path: args[0] ?? null, cmd };
  if (name === "git" && rest[0] === "ls-files")
    return { type: "list", path: operands(words.slice(1))[0] ?? null, cmd };
  if (name === "git" && rest[0] === "grep") {
    const [query, path] = operands(words.slice(1));
    return { type: "search", query: query ?? null, path: path ?? null, cmd };
  }
  if (SEARCHERS.has(name)) {
    const valueFlags = new Set(["-g", "--glob", "-t", "--type", "-m", "-A", "-B", "-C", "--max-count"]);
    const patternFlags = new Set(["-e", "--regexp"]);
    const positional: string[] = [];
    let pattern: string | null = null;
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index]!;
      if (patternFlags.has(word)) pattern ??= words[++index] ?? null;
      else if (valueFlags.has(word)) index += 1;
      else if (!word.startsWith("-")) positional.push(word);
    }
    // With -e the pattern is a flag value, so every positional is a path.
    if (pattern !== null) positional.unshift(pattern);
    if (rest.includes("--files"))
      return { type: "list", path: positional[0] ?? null, cmd };
    const [query, path] = positional;
    return { type: "search", query: query ?? null, path: path ?? null, cmd };
  }
  if (name === "fd" || name === "find") {
    const pattern =
      name === "find"
        ? (rest[rest.findIndex((word) => /^-i?name$|^-path$/.test(word)) + 1] ?? null)
        : (args[0] ?? null);
    const hasPattern = name === "find" ? rest.some((word) => /^-i?name$|^-path$/.test(word)) : args.length > 0;
    return hasPattern
      ? { type: "search", query: pattern, path: name === "find" ? (args[0] ?? null) : (args[1] ?? null), cmd }
      : { type: "list", path: args[0] ?? null, cmd };
  }
  return { type: "unknown", cmd };
}

/**
 * Parse a command into the parts Codex would summarize. Any unrecognized part
 * makes the whole command one unknown part, which renders as "Ran".
 */
export function parseCommand(command: string): ParsedCommand[] {
  const script = unwrapShell(command);
  const parsed: ParsedCommand[] = [];
  for (const segment of segments(script)) {
    const text = segment.text.trim();
    const words = shellWords(text);
    if (!words?.length || segment.writes) return [{ type: "unknown", cmd: script }];
    const name = words[0]!.split("/").at(-1)!;
    if (name === "cd" || name === "echo" || name === "true" || name === "pwd") continue;
    if (segment.piped && FORMATTERS.has(name)) continue;
    const part = parseSegment(words, text);
    if (part.type === "unknown") return [{ type: "unknown", cmd: script }];
    const previous = parsed.at(-1);
    if (previous && JSON.stringify(previous) === JSON.stringify(part)) continue;
    parsed.push(part);
  }
  return parsed.length ? parsed : [{ type: "unknown", cmd: script }];
}

export function isExploring(parts: ParsedCommand[]): boolean {
  return parts.every((part) => part.type !== "unknown");
}
