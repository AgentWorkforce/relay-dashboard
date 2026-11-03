// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { describe, expect, it } from "vitest";
import { isExploring, parseCommand, shortPath, unwrapShell } from "./parse-command";

describe("parseCommand", () => {
  it.each([
    ["cat src/app.ts", [{ type: "read", name: "app.ts" }]],
    ["sed -n '1,200p' lib/parser.ts", [{ type: "read", name: "parser.ts" }]],
    ["head -n 40 README.md", [{ type: "read", name: "README.md" }]],
    ["ls -la", [{ type: "list", path: null }]],
    ["rg --files -g '*.ts' src", [{ type: "list", path: "src" }]],
    ["rg -n \"fetchReplay\" packages/web", [{ type: "search", query: "fetchReplay", path: "packages/web" }]],
    ["grep -rn TODO .", [{ type: "search", query: "TODO", path: "." }]],
    ["find . -name '*.md'", [{ type: "search", query: "*.md", path: "." }]],
    ["cd web && rg foo | head -20", [{ type: "search", query: "foo", path: null }]],
  ])("classifies %s as exploring", (command, expected) => {
    const parts = parseCommand(command);
    expect(parts).toMatchObject(expected);
    expect(isExploring(parts)).toBe(true);
  });

  it.each(["git status", "npm test", "cat a.txt && npm run build", "rg foo > out.txt; make"])(
    "treats %s as a plain run",
    (command) => {
      expect(isExploring(parseCommand(command))).toBe(false);
    },
  );

  it("collapses repeated parts and unwraps shell launchers", () => {
    expect(parseCommand("cat a.ts && cat a.ts")).toHaveLength(1);
    expect(unwrapShell("bash -lc 'rg -n foo src'")).toBe("rg -n foo src");
    expect(parseCommand("/bin/zsh -lc \"cat README.md\"")).toMatchObject([
      { type: "read", name: "README.md" },
    ]);
  });

  it("names files by their last meaningful segment", () => {
    expect(shortPath("packages/web/src")).toBe("web");
    expect(shortPath("app/page.tsx")).toBe("page.tsx");
  });
});

describe("review regressions", () => {
  it.each(["rg TODO src > todo.txt", "rg foo > out.txt", "cat file > out", "cat a.txt >> b.txt", "find . -name '*.o' | xargs rm", "cat paths | xargs rm"])(
    "treats %s as a plain run",
    (command) => {
      expect(isExploring(parseCommand(command))).toBe(false);
    },
  );

  it("keeps searches that only discard output", () => {
    expect(isExploring(parseCommand("rg foo src 2>/dev/null"))).toBe(true);
    expect(isExploring(parseCommand("grep -rn foo . 2>&1 | head"))).toBe(true);
  });

  it("keeps here-strings read-only", () => {
    expect(isExploring(parseCommand('cat <<< "$snippet"'))).toBe(true);
    expect(isExploring(parseCommand('rg foo <<< "$text"'))).toBe(true);
  });

  it("uses the -e pattern as the query", () => {
    expect(parseCommand("rg -e fetchReplay packages/web")).toMatchObject([
      { type: "search", query: "fetchReplay", path: "packages/web" },
    ]);
  });

  it.each([
    "cat safe.txt & rm -rf build",
    "cat \"$(rm important)\"",
    "cat `rm important`",
    "diff <(cat a) b",
    "find . -delete",
    "find . -name x -exec rm {} \\;",
    "fd foo -x rm",
    "rg foo | sed -n '1w out.txt'",
    "rg foo | awk '{ system(\"rm \" $1) }'",
    "sed -n '1e rm -rf /' notes.txt",
    "cat a &> out.txt",
    "rg foo | sort -o matches.txt",
    "rg foo | sort --output=matches.txt",
    "rg foo | uniq - out.txt",
  ])("fails closed on %s", (command) => {
    expect(isExploring(parseCommand(command))).toBe(false);
  });

  it("still elides read-only sed and awk formatters", () => {
    expect(isExploring(parseCommand("rg foo | sed -n '1,20p'"))).toBe(true);
    expect(isExploring(parseCommand("rg foo | sed 's/a/b/g'"))).toBe(true);
    expect(isExploring(parseCommand("rg foo | awk '{print $1}'"))).toBe(true);
    expect(isExploring(parseCommand("rg foo src 2>&1 >&2"))).toBe(true);
    expect(isExploring(parseCommand("rg foo | sort -u | uniq -c"))).toBe(true);
  });

  it("uses find's starting point, not its predicate, as the path", () => {
    expect(parseCommand("find -name '*.md'")).toMatchObject([
      { type: "search", query: "*.md", path: null },
    ]);
    expect(parseCommand("find src -type f")).toMatchObject([
      { type: "list", path: "src" },
    ]);
  });
});
