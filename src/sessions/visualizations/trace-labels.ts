// Ported from Cloud session visualizations, head55bfc58fb.
/** Display labels describe recorded actions; raw arguments stay in the drilldown. */
export function commandLabel(command: string): string {
  const text = command.trim();
  const pr = /pullRequest\(\s*number:\s*(\d+)/.exec(text)?.[1]
    ?? /\bgh\s+pr\s+\w+\s+(\d+)/.exec(text)?.[1];
  const prName = pr ? `PR #${pr}` : "pull request";
  if (/\bgh\s+pr\s+edit\b/.test(text)) return `Update ${prName}`;
  if (/\bgh\s+pr\s+create\b/.test(text)) return "Create pull request";
  if (/\bgh\s+pr\s+merge\b/.test(text)) return `Merge ${prName}`;
  if (/\bgh\s+run\s+(?:view|list|watch)\b/.test(text)) return "Check build and test status";
  if (/\bgh\b/.test(text) && /actions\/runs|check-runs|check-suites/.test(text)) return "Check build and test progress";
  if (/\bgh\b/.test(text) && /reviewThreads|reviewDecision/.test(text)) return `Check ${prName} reviews`;
  if (/\bgh\b/.test(text) && /mergeable/.test(text)) return `Check ${prName} readiness`;
  if (/\bgh\s+pr\s+(?:checks|status)\b/.test(text)) return `Check ${prName} status`;
  if (/\bgh\s+pr\s+(?:view|diff)\b/.test(text)) return `Read ${prName}`;
  if (/\bgh\s+api\b/.test(text)) return "Use GitHub integration";
  if (/\bgit\s+(?:-C\s+\S+\s+)?diff\b/.test(text)) return "Review code changes";
  if (/\bgit\s+(?:-C\s+\S+\s+)?status\b/.test(text)) return "Check working tree";
  if (/\bgit\s+push\b/.test(text)) return "Push changes";
  if (/\bgit\s+commit\b/.test(text)) return "Commit changes";
  if (/\bgit\s+(?:log|show)\b/.test(text)) return "Read commit history";
  if (/\bgit\s+(?:fetch|pull)\b/.test(text)) return "Fetch repository updates";
  if (/(?:^|[\s/])tsc(?:\s|$)|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?typecheck\b/.test(text)) return "Check types";
  if (/(?:^|[\s/])(?:eslint|prettier)(?:\s|$)|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b/.test(text)) return "Check code style";
  if (/(?:^|[\s/])(?:vitest|jest|pytest)(?:[.\s]|$)|\b(?:npm|pnpm|yarn|bun|cargo|swift)\s+(?:run\s+)?(?:[\w-]+:)?test\b|node\s+--test/.test(text)) return "Run tests";
  if (/\b(?:npm|pnpm|yarn|bun|cargo|swift)\b.*\bbuild\b/.test(text)) return "Build project";
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:ci|install|add)\b/.test(text)) return "Install dependencies";
  if (/^(?:sleep\s+\d|.*clock\.sleep)/.test(text)) return "Wait before checking again";
  if (/\b(?:rg|grep)\b/.test(text)) return "Search project files";
  if (/\b(?:cat|head|tail|sed)\s/.test(text)) return "Read project files";
  if (/\b(?:ls|find|pwd)\b/.test(text)) return "Inspect project folders";
  if (/\b(?:curl|wget)\b/.test(text)) return "Make web request";
  if (/\bpython[\d.]*\b/.test(text)) return "Run Python script";
  if (/\bnode\b/.test(text)) return "Run JavaScript script";
  return "Run shell command";
}

export function namedFiles(verb: string, paths: string[]): string {
  if (paths.length > 1) return `${verb} ${paths.length} files`;
  const name = paths[0]?.split(/[\\/]/).filter(Boolean).at(-1);
  return name && name.length <= 24 ? `${verb} ${name}` : `${verb} project file`;
}

export function toolActionLabel(name: string, args: Record<string, unknown> | null): string {
  const kind = name.split(/[.:/]/).at(-1)?.replace(/^mcp__.*?__/, "") ?? name;
  if (/sleep|wait_agent|wait_threads/.test(kind)) return "Wait for work to finish";
  if (/write_stdin/.test(kind)) return args?.chars ? "Send terminal input" : "Check command progress";
  if (/spawn_agent|create_thread/.test(kind)) return "Delegate work to an agent";
  if (/send_message|followup_task/.test(kind)) return "Send agent instructions";
  if (/list_agents/.test(kind)) return "Check agent progress";
  if (/apply_patch|edit|write_file/.test(kind)) return "Edit project files";
  if (/read|view_file/.test(kind)) return "Read project information";
  if (/search/.test(kind)) return "Search for information";
  if (/plan/.test(kind)) return "Update work plan";
  if (/screenshot|view_image/.test(kind)) return "Inspect screenshot";
  if (/browser|playwright/.test(kind)) return "Inspect browser page";
  if (/exec|bash|shell|terminal/.test(kind)) return "Run shell command";
  return "Use connected tool";
}

export function messageLabel(text: string, request = false): string {
  if (/^[\s]*[[{]/.test(text) && !/^\s*\[[^\]]+\]\(/.test(text)) return request ? "Read structured request" : "Share structured response";
  const plain = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_#]/g, "").replace(/\s+/g, " ").trim();
  const sentence = plain.split(/(?<=[.!?])\s/)[0] ?? "";
  if (sentence.length <= 42 && sentence) return sentence.replace(/[.!]$/, "");
  if (request) return "Review user request";
  if (/\b(?:CI|checks|jobs|compiling|build|tests)\b/i.test(plain)) return "Report build and test progress";
  if (/^Fixed and pushed\b/i.test(plain)) return "Report completed changes";
  if (/\b(?:blocked|cannot continue|need your)\b/i.test(plain)) return "Explain a blocker";
  if (/\b(?:review threads|conflict-free|pull request)\b/i.test(plain)) return "Report pull request status";
  return "Share progress update";
}
