// Ported from AgentWorkforce/cloud packages/web/lib/flows/flow-source-requirements.ts, verbatim
// except: an own-property alias lookup, and a fresh empty result per call.
// Reads what a flow source declares it needs, without executing it.
/**
 * What an authored flow source declares it needs, read from the header of its
 * `flow(name, { … }, body)` call without loading or executing it. Shared by
 * the deploy route's connection check and the wizard's integrations step, so
 * both refuse — or ask for — the same set.
 *
 * Deliberately conservative: only the header's `tools` object is read
 * (`tools: { slack: true }` flags, `tools.relayfile` mounts, `tools.mcp`
 * servers). Body use such as `f.slack.post` without a flag is left to the
 * flows CLI's `flowRequirements`, which can name it from the loaded
 * definition and sends the result as the deploy body's `requirements`.
 */

export type FlowSourceRequirements = {
  /** Helper namespaces flagged `true` in `tools`. */
  tools: string[];
  /** Providers named by `tools.relayfile` mount paths (first path segment). */
  relayfile: string[];
  /** `tools.mcp` server names. */
  mcp: string[];
};

/**
 * Helper namespaces whose Cloud integration id differs from the namespace:
 * `@relayflows/surface` generates camelCase namespaces from hyphenated
 * adapter ids, and Gmail's adapter is `gmail` where Cloud says `google-mail`.
 */
const PROVIDER_ALIASES: Record<string, string> = {
  gmail: "google-mail",
  azureBlob: "azure-blob",
  dockerHub: "docker-hub",
  googleCalendar: "google-calendar",
  googleDrive: "google-drive",
  webhookServer: "webhook-server",
};

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const empty = (): FlowSourceRequirements => ({ tools: [], relayfile: [], mcp: [] });

/** The Cloud integration provider a helper namespace or mount root maps to, or null if it is not one. */
export function helperProviderId(name: string): string | null {
  const provider = (Object.hasOwn(PROVIDER_ALIASES, name) ? PROVIDER_ALIASES[name]! : name).trim().toLowerCase();
  return PROVIDER_ID.test(provider) ? provider : null;
}

export function extractFlowSourceRequirements(source: string): FlowSourceRequirements {
  const header = flowHeaderObject(source);
  if (header === null) return empty();
  const toolsEntry = objectEntries(header).find((entry) => entry.key === "tools");
  if (!toolsEntry || !toolsEntry.value.startsWith("{")) return empty();
  const tools: string[] = [];
  const relayfile: string[] = [];
  const mcp: string[] = [];
  for (const entry of objectEntries(toolsEntry.value.slice(1, -1))) {
    if (entry.key === "relayfile" || entry.key === "mcp") {
      const list = entry.key === "relayfile" ? relayfile : mcp;
      for (const item of stringArray(entry.value)) {
        const value = entry.key === "relayfile" ? item.split("/")[0]!.trim() : item.trim();
        if (value && !list.includes(value)) list.push(value);
      }
      continue;
    }
    if (entry.value === "true" && !tools.includes(entry.key)) tools.push(entry.key);
  }
  return { tools, relayfile, mcp };
}

export type FlowIntegrationReason = "repository" | "source" | "tools" | "relayfile" | "requirements" | "human";

export type RequiredFlowIntegration = {
  /** Cloud integration provider id. */
  provider: string;
  reason: FlowIntegrationReason;
  /** The declaration, as a reader would name it: `deploy target`, `linear source`, `tools.slack`. */
  detail: string;
};

/**
 * Every integration a deployment must have connected: the repository's host
 * — GitHub unless the deployment targets GitLab — (each launched run lands in
 * the deployment's repository), the ticket sources, the header's
 * declared tools and mounts, and whatever the client computed from the loaded
 * definition and sent as `requirements.integrations`. First declaration wins
 * when a provider is named twice.
 */
export function requiredFlowIntegrations(input: {
  source: string;
  sources: readonly { provider: string }[] | readonly string[];
  requirements?: { integrations?: readonly string[] } | null;
  /** Where the deployment's repository lives; GitHub when omitted. */
  repositoryHost?: "github" | "gitlab";
  /** Read-only prompt runs receive no repository credential or checkout. */
  repositoryRequired?: boolean;
}): RequiredFlowIntegration[] {
  const required: RequiredFlowIntegration[] = input.repositoryRequired === false
    ? []
    : [{ provider: input.repositoryHost === "gitlab" ? "gitlab" : "github", reason: "repository", detail: "deploy target" }];
  const add = (provider: string | null, reason: FlowIntegrationReason, detail: string) => {
    if (!provider || provider === "markdown" || required.some((entry) => entry.provider === provider)) return;
    required.push({ provider, reason, detail });
  };
  for (const source of input.sources) {
    const provider = typeof source === "string" ? source : source.provider;
    add(provider, "source", `${provider} source`);
  }
  const declared = extractFlowSourceRequirements(input.source);
  for (const tool of declared.tools) add(helperProviderId(tool), "tools", `tools.${tool}`);
  for (const mount of declared.relayfile) add(helperProviderId(mount), "relayfile", "tools.relayfile");
  // `f.human(q, { to: "slack:#eng" })` is delivered through that provider at
  // park time, so a literal `to` is a requirement of the flow (flows
  // `flowRequirements` reads the same forms). A bare approver or a computed
  // `to` is resolved against the run's own trigger and needs nothing extra.
  for (const to of humanRecipientsInSource(input.source)) {
    add(humanRecipientProvider(to) ?? null, "human", "f.human to");
  }
  for (const provider of input.requirements?.integrations ?? []) {
    if (typeof provider === "string") add(helperProviderId(provider), "requirements", "declared by the flow");
  }
  return required;
}

/**
 * The literal `to` of each `f.human(question, { to: "…" })` in the source.
 *
 * Same algorithm as flows `packages/sdk/src/flow-requirements.ts`
 * (`humanRecipients`): the scan is bounded to the call's OWN balanced argument
 * list (string-, template- and comment-aware), then to its second argument's
 * object literal, and reads a plain string `to` at that object's top level
 * only. A `to` in a later call, a nested object, the question string, an
 * unrelated `{ to }` elsewhere, or an interpolated template / identifier
 * (computed; Cloud resolves those at park time) contributes nothing. The
 * receiver must be the flow callback's context parameter, not any `.human(`.
 */
export function humanRecipientsInSource(source: string): string[] {
  const roots = flowContextParameters(source);
  if (roots.length === 0) return [];
  // Call starts are found on a copy with comments and strings blanked (same
  // length, so offsets hold); the arguments are walked on the real source.
  const code = stripCommentsAndStringsKeepingLength(source);
  const call = new RegExp(`(?:^|[^\\w$.])(?:${roots.map(escapeRegExp).join("|")})\\s*\\.\\s*human\\s*\\(`, "gu");
  const found: string[] = [];
  for (const match of code.matchAll(call)) {
    const open = match.index! + match[0].length - 1;
    const close = matchingClose(source, open);
    if (close === -1) break;
    const options = secondArgumentObject(source.slice(open + 1, close));
    if (options === undefined) continue;
    const to = topLevelStringProperty(options, "to");
    if (to !== undefined) found.push(to);
  }
  return found;
}

/** Whether authored source contains an actual per-run human gate. */
export function flowHasHumanGate(source: string): boolean {
  const root = flowBodyParameter(source);
  const body = flowBodyBlock(source);
  if (!root || !body) return false;

  // Use a constrained-source contract instead of trying to prove arbitrary
  // TypeScript control flow. Approval must be the first executable statement
  // in the main callback. Gates hidden in closures/callbacks, conditional or
  // short-circuit branches, and computed provider work before approval all
  // fail closed.
  let cursor = skipSpace(source, body.open + 1);
  if (!source.startsWith("await", cursor) || /[\w$]/u.test(source[cursor + 5] ?? "")) return false;
  cursor = skipSpace(source, cursor + 5);
  if (!source.startsWith(root, cursor) || /[\w$]/u.test(source[cursor + root.length] ?? "")) return false;
  cursor = skipSpace(source, cursor + root.length);
  if (source[cursor] !== ".") return false;
  cursor = skipSpace(source, cursor + 1);
  if (!source.startsWith("human", cursor) || /[\w$]/u.test(source[cursor + 5] ?? "")) return false;
  cursor = skipSpace(source, cursor + 5);
  if (source[cursor] !== "(") return false;
  const callEnd = matchingClose(source, cursor);
  if (callEnd < 0 || callEnd >= body.close || !safeHumanGateArguments(source.slice(cursor + 1, callEnd))) return false;
  // A standalone statement prevents chaining a write onto the approval
  // promise (for example `.then(() => f[provider].write())`).
  return source[skipSpace(source, callEnd + 1)] === ";";
}

/**
 * Main callback block of the first Flow call. Concise arrow bodies fail closed:
 * the activation contract deliberately requires a visible statement boundary.
 */
function flowBodyBlock(source: string): { open: number; close: number } | null {
  const start = flowBodyStart(source);
  if (start === null) return null;
  const code = stripCommentsAndStringsKeepingLength(source);
  let open = -1;
  if (/^(?:async\s+)?function\b/u.test(code.slice(start))) {
    const parameters = code.indexOf("(", start);
    if (parameters < 0) return null;
    const parametersEnd = matchingClose(code, parameters);
    if (parametersEnd < 0) return null;
    open = code.indexOf("{", parametersEnd + 1);
  } else {
    let depth = 0;
    for (let i = start; i < code.length - 1; i += 1) {
      const char = code[i]!;
      if (char === "(" || char === "[" || char === "{") depth += 1;
      else if (char === ")" || char === "]" || char === "}") depth -= 1;
      else if (char === "=" && code[i + 1] === ">" && depth === 0) {
        open = skipSpace(source, i + 2);
        break;
      }
    }
  }
  if (open < 0 || source[open] !== "{") return null;
  const close = matchingClose(source, open);
  return close < 0 ? null : { open, close };
}

/** Only inert, bounded approval arguments may execute before the run pauses. */
function safeHumanGateArguments(raw: string): boolean {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let i = 0;
  while (i < raw.length) {
    const skipped = skipCommentOrString(raw, i);
    if (skipped < 0) return false;
    if (skipped !== i) { i = skipped; continue; }
    const char = raw[i]!;
    if (char === "(" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) { args.push(raw.slice(start, i).trim()); start = i + 1; }
    if (depth < 0) return false;
    i += 1;
  }
  args.push(raw.slice(start).trim());
  if (depth !== 0 || args.length < 1 || args.length > 2 || plainStringLiteral(args[0]!) === null) return false;
  if (args.length === 1) return true;
  const options = args[1]!;
  if (!options.startsWith("{") || skipBalanced(options, 0, "{", "}") !== options.length) return false;
  const entries = fullyReadEntries(options.slice(1, -1));
  if (!entries || entries.length !== 1 || entries[0]!.key !== "to") return false;
  const recipient = entries[0]!.value;
  return plainStringLiteral(recipient) !== null || /^input\.approver$/u.test(recipient);
}

/**
 * The relayfile helper providers an authored flow uses, so the run can be
 * given their mounts (cloud#3812). Read the way the flows SDK's own
 * `preflightHelpers` decides a namespace is used: a `tools.<namespace>: true`
 * flag, a `tools.relayfile` mount root, or a body reference through the
 * flow callback's context parameter (`f.github.comment(…)`,
 * `f['github']`). A run that uses none gets no helper mount; a namespace
 * Cloud cannot mount is reported so the caller can refuse it legibly rather
 * than launch a run whose helper refuses `helper_provider.mount_required`.
 *
 * Only `MOUNTABLE` namespaces are reported. The SDK checks `f.human` and
 * `f.mcp` too, but those are not relayfile providers.
 */
export const FLOW_HELPER_MOUNT_PROVIDERS: readonly string[] = ["github", "gitlab", "jira", "linear", "shortcut", "slack"];

function helperProvidersFromSource(
  source: string,
  { includeRelayfile }: { includeRelayfile: boolean },
): string[] {
  const providers: string[] = [];
  const add = (namespace: string) => {
    const provider = helperProviderId(namespace);
    if (provider && FLOW_HELPER_MOUNT_PROVIDERS.includes(provider) && !providers.includes(provider)) {
      providers.push(provider);
    }
  };
  const declared = extractFlowSourceRequirements(source);
  for (const tool of declared.tools) add(tool);
  if (includeRelayfile) {
    for (const mount of declared.relayfile) add(mount);
  }
  const roots = flowContextParameters(source);
  if (roots.length > 0) {
    // Dot access is read on the copy with comments AND strings blanked, so
    // `// f.github` and `"f.slack.post"` name nothing. Bracket access needs
    // the quoted key, so it is read on the copy with only comments blanked
    // and then confirmed against the fully blanked copy: the `f[` before the
    // key must have survived, which it does not inside a string.
    const code = stripCommentsAndStringsKeepingLength(source);
    const withStrings = stripCommentsKeepingLength(source);
    const root = `(?:${roots.map(escapeRegExp).join("|")})`;
    for (const namespace of FLOW_HELPER_MOUNT_PROVIDERS) {
      if (providers.includes(namespace)) continue;
      const dot = new RegExp(`(?:^|[^\\w$.])${root}\\s*\\.\\s*${namespace}\\b`, "u");
      if (dot.test(code)) {
        add(namespace);
        continue;
      }
      const bracket = new RegExp(`(?:^|[^\\w$.])(${root}\\s*\\[\\s*)['"]${namespace}['"]\\s*\\]`, "gu");
      for (const match of withStrings.matchAll(bracket)) {
        const start = match.index! + match[0].length - match[0].trimStart().length;
        const prefix = match[1]!;
        const at = withStrings.indexOf(prefix, start);
        if (at !== -1 && code.slice(at, at + prefix.length) === prefix) {
          add(namespace);
          break;
        }
      }
    }
  }
  return providers.sort();
}

export function flowHelperMountProviders(source: string): string[] {
  return helperProvidersFromSource(source, { includeRelayfile: true });
}

/**
 * Provider helpers are effect-only (`f.github.comment`, `f.slack.post`, …).
 * Keep read-only Relayfile declarations out of this set: a read-only Flow may
 * mount provider records to inspect them, but may not call a helper that
 * drafts a provider writeback.
 */
export function flowEffectHelperProviders(source: string): string[] {
  return helperProvidersFromSource(source, { includeRelayfile: false });
}

/** Comments blanked to spaces (offsets preserved); strings left intact. */
function stripCommentsKeepingLength(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if ((ch === "/" && next === "/") || (ch === "/" && next === "*")) {
      const skipped = skipCommentOrString(source, i);
      if (skipped === -1) return out + " ".repeat(source.length - i);
      out += " ".repeat(skipped - i);
      i = skipped;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const skipped = skipCommentOrString(source, i);
      if (skipped === -1) return out + source.slice(i);
      out += source.slice(i, skipped);
      i = skipped;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The names the flow callbacks bind their context to: the `flow(…)` call's
 * own body parameter first (`async f =>` included), then the first parameter
 * of the callback passed to each `.on(…, async (f) => …)` handler; a callback
 * passed by name resolves to its local declaration. Other
 * function literals (`items.map((item) => item.github)`) are data callbacks,
 * not flow contexts, so their parameters are not read (self-host change).
 */
function flowContextParameters(source: string): string[] {
  const names = new Set<string>();
  const code = stripCommentsAndStringsKeepingLength(source);
  const call = selectedFlowCall(source, code);
  const inline = flowBodyParameter(source);
  if (inline) names.add(inline);
  else if (call) for (const name of namedCallbackParameters(code, call.bodyReference)) names.add(name);
  if (!call) return [...names];
  // `.on(…)` handlers chained from the selected flow call, or called on the
  // variable it is bound to. Other emitters' `.on` are not flow contexts.
  const chains = [call.close + 1];
  if (call.binding) {
    const bound = new RegExp(`(?:^|[^\\w$.])${escapeRegExp(call.binding)}(?=\\s*\\.)`, "gu");
    for (const use of code.matchAll(bound)) chains.push(use.index! + use[0].length);
  }
  for (const from of chains) {
    let at = from;
    for (;;) {
      const member = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/u.exec(code.slice(at));
      if (!member) break;
      const open = at + member[0].length - 1;
      const close = matchingClose(code, open);
      if (close === -1) break;
      if (member[1] === "on") {
        const args = topLevelArguments(code, open, close);
        const handler = args[1]?.trim();
        if (handler) {
          const literal = callbackLiteralParameter(handler);
          if (literal) names.add(literal);
          else if (/^[A-Za-z_$][\w$]*$/u.test(handler)) {
            for (const name of namedCallbackParameters(code, handler)) names.add(name);
          }
        }
      }
      at = close + 1;
    }
  }
  return [...names];
}

/**
 * The flow call the page reads: the default-exported one when present, then
 * the one assigned to the default-exported variable, otherwise the first call of an imported flow callee (`flow`, an alias, or
 * `ns.flow`). Returns its argument span, the body argument when it is a bare
 * identifier, and the variable it is assigned to (`const w = flow(…)`).
 */
function selectedFlowCall(
  source: string,
  code: string,
): { open: number; close: number; bodyReference: string | null; binding: string | null } | null {
  const { local, namespaces } = flowCalleeNames(source);
  const callees = [
    ...[...local].map(escapeRegExp),
    ...namespaces.map((ns) => `${escapeRegExp(ns)}\\s*\\.\\s*flow`),
  ];
  if (callees.length === 0) return null;
  const pattern = new RegExp(`(?:^|[^\\w$.])(?:${callees.join("|")})\\s*(?:<[^>()]*>)?\\s*\\(`, "gu");
  // `export default main;` names the variable a flow call is assigned to.
  const exportedName = /(?:^|[^\w$.])export\s+default\s+([A-Za-z_$][\w$]*)\s*(?:;|$)/mu.exec(code)?.[1] ?? null;
  const bindingOf = (before: string) =>
    /(?:^|[^\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*$/u.exec(before)?.[1] ?? null;
  let first: { open: number; before: string } | null = null;
  let exported: { open: number; before: string } | null = null;
  let exportedBinding: { open: number; before: string } | null = null;
  for (const match of code.matchAll(pattern)) {
    const open = match.index! + match[0].length - 1;
    const before = code.slice(0, match.index! + (/^[^\w$.]/u.test(match[0]) ? 1 : 0));
    first ??= { open, before };
    if (/\bexport\s+default\s*$/u.test(before)) { exported = { open, before }; break; }
    if (exportedName && !exportedBinding && bindingOf(before) === exportedName) exportedBinding = { open, before };
  }
  const chosen = exported ?? exportedBinding ?? first;
  if (!chosen) return null;
  const close = matchingClose(code, chosen.open);
  if (close === -1) return null;
  const args = topLevelArguments(code, chosen.open, close);
  const last = args.length >= 2 && args.length <= 3 ? args[args.length - 1]!.trim() : "";
  const bodyReference = /^[A-Za-z_$][\w$]*$/u.test(last) && last !== "async" && last !== "function" ? last : null;
  const binding = bindingOf(chosen.before);
  return { open: chosen.open, close, bodyReference, binding };
}

/** Top-level comma-separated arguments between `open` and its matching `close`. */
function topLevelArguments(code: string, open: number, close: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = code[i]!;
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) { args.push(code.slice(from, i)); from = i + 1; }
  }
  const tail = code.slice(from, close);
  if (tail.trim() !== "") args.push(tail);
  return args;
}

/** First parameter of a function literal at the start of `text`, if any. */
function callbackLiteralParameter(text: string): string | null {
  const literal =
    /^(?:async(?:\s+|(?=\s*\()))?(?:function\s*\*?\s*[\w$]*\s*\(\s*([A-Za-z_$][\w$]*)|\(\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*=>)/u.exec(
      text,
    );
  return literal ? (literal[1] ?? literal[2] ?? literal[3] ?? null) : null;
}

/**
 * First parameters of the callbacks declared in this file under `name`:
 * `function name(ctx)`, `async function name(ctx)`,
 * `const name = async (ctx) =>`, `const name = ctx =>`, `const name = function (ctx)`.
 * Scope is not resolved, so every declaration of the name is read: a shadowed
 * duplicate can only add a provider, never hide the real callback's.
 */
function namedCallbackParameters(code: string, name: string | null): string[] {
  if (!name) return [];
  const id = escapeRegExp(name);
  const declaration = new RegExp(
    `(?:^|[^\\w$.])(?:async\\s+)?function\\s*\\*?\\s*${id}\\s*\\(\\s*([A-Za-z_$][\\w$]*)` +
      `|(?:^|[^\\w$.])(?:const|let|var)\\s+${id}\\s*(?::[^=]*)?=\\s*`,
    "gu",
  );
  const names: string[] = [];
  for (const match of code.matchAll(declaration)) {
    const parameter = match[1] ?? callbackLiteralParameter(code.slice(match.index! + match[0].length));
    if (parameter && !names.includes(parameter)) names.push(parameter);
  }
  return names;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Comments and string contents blanked to spaces, so offsets are preserved. */
function stripCommentsAndStringsKeepingLength(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const skipped = skipCommentOrString(source, i);
    if (skipped === -1) return out + " ".repeat(source.length - i);
    if (skipped !== i) { out += " ".repeat(skipped - i); i = skipped; continue; }
    out += source[i];
    i += 1;
  }
  return out;
}

/**
 * Skip the comment or string starting at `i`, returning the index just past
 * it; `i` itself when nothing skippable starts there; -1 when unterminated.
 */
function skipCommentOrString(text: string, i: number): number {
  const ch = text[i]!;
  const next = text[i + 1];
  if (ch === "/" && next === "/") { const end = text.indexOf("\n", i); return end === -1 ? text.length : end + 1; }
  if (ch === "/" && next === "*") { const end = text.indexOf("*/", i + 2); return end === -1 ? -1 : end + 2; }
  if (ch === '"' || ch === "'" || ch === "`") { const end = stringEnd(text, i); return end === -1 ? -1 : end + 1; }
  return i;
}

/** Index of the `)`/`}`/`]` closing the bracket at `open`; -1 if unbalanced. */
function matchingClose(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [pairs[text[open]!]!];
  let i = open + 1;
  while (i < text.length && stack.length > 0) {
    const skipped = skipCommentOrString(text, i);
    if (skipped === -1) return -1;
    if (skipped !== i) { i = skipped; continue; }
    const ch = text[i]!;
    if (ch in pairs) stack.push(pairs[ch]!);
    else if (ch === ")" || ch === "}" || ch === "]") { if (stack.pop() !== ch) return -1; }
    i += 1;
  }
  return stack.length === 0 ? i - 1 : -1;
}

/** Index of the quote closing the string opening at `start` (template `${…}` skipped); -1 if unterminated. */
function stringEnd(text: string, start: number): number {
  const quote = text[start]!;
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") { i += 2; continue; }
    if (ch === quote) return i;
    if (quote === "`" && ch === "$" && text[i + 1] === "{") {
      const end = matchingClose(text, i + 1);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return -1;
}

/** The `{ … }` that is the call's second top-level argument, or undefined. */
function secondArgumentObject(args: string): string | undefined {
  let depth = 0;
  let i = 0;
  let commas = 0;
  while (i < args.length) {
    const skipped = skipCommentOrString(args, i);
    if (skipped === -1) return undefined;
    if (skipped !== i) { i = skipped; continue; }
    const ch = args[i]!;
    if (ch === "(" || ch === "{" || ch === "[") {
      if (depth === 0 && commas === 1 && ch === "{") {
        const close = matchingClose(args, i);
        return close === -1 ? undefined : args.slice(i, close + 1);
      }
      depth += 1;
    } else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) commas += 1;
    i += 1;
  }
  return undefined;
}

/** The plain string literal value of `name:` at the top level of an object literal, else undefined. */
function topLevelStringProperty(object: string, name: string): string | undefined {
  const key = new RegExp(`^(?:${name}|'${name}'|"${name}")\\s*:\\s*`, "u");
  let depth = 0;
  let i = 1;
  const end = object.length - 1;
  while (i < end) {
    const skipped = skipCommentOrString(object, i);
    if (skipped === -1) return undefined;
    if (skipped !== i) { i = skipped; continue; }
    const ch = object[i]!;
    if (ch === "(" || ch === "{" || ch === "[") { depth += 1; i += 1; continue; }
    if (ch === ")" || ch === "}" || ch === "]") { depth -= 1; i += 1; continue; }
    if (depth === 0 && (i === 1 || /[\s,{/]/u.test(object[i - 1]!))) {
      const match = key.exec(object.slice(i));
      if (match !== null) {
        const valueStart = i + match[0].length;
        const quote = object[valueStart];
        if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
        const valueEnd = stringEnd(object, valueStart);
        if (valueEnd === -1) return undefined;
        const raw = object.slice(valueStart + 1, valueEnd);
        return quote === "`" && /\$\{/u.test(raw) ? undefined : raw.replace(/\\(.)/gu, "$1");
      }
    }
    i += 1;
  }
  return undefined;
}

/** Mirrors flows `humanRecipientProvider`: the integration a literal, well-formed `to` needs. */
export function humanRecipientProvider(to: string): "slack" | "github" | undefined {
  const trimmed = to.trim();
  const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(.*)$/su.exec(trimmed);
  if (!match) return undefined;
  const provider = match[1]!.toLowerCase();
  const rest = match[2]!.trim();
  if ((provider !== "slack" && provider !== "github") || rest === "") return undefined;
  const target = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
  if (rest.startsWith("#")) return provider === "slack" && target.test(rest.slice(1)) ? "slack" : undefined;
  return target.test(rest.replace(/^@/u, "")) ? provider : undefined;
}

/** The provider ids of `requiredFlowIntegrations`, in the same order. */
export function requiredFlowProviders(input: Parameters<typeof requiredFlowIntegrations>[0]): string[] {
  return requiredFlowIntegrations(input).map((entry) => entry.provider);
}

const WALLCLOCK_UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const LEGACY_BUDGET_KEYS = ["maxTokensIn", "maxTokensOut", "maxTokens", "maxDollars", "maxWallclockMs", "window", "pricing"];

/**
 * The run budget a deployment without `inputs.runBudgetMinutes` launches with:
 * core's `RELAYFLOW_V2_RUN_BUDGET_DEFAULT_MINUTES`, mirrored because this module
 * is bundled into the dashboard, which does not import `@cloud/core`. A test
 * pins the two together.
 */
export const DEFAULT_FLOW_RUN_BUDGET_MINUTES = 40;

/** Core's `RELAYFLOW_V2_RUN_BUDGET_MAX_MINUTES`, mirrored like the default above. */
export const MAX_FLOW_RUN_BUDGET_MINUTES = 180;

/**
 * Apply the hosted execution cap to the next run of existing deployments too.
 * Stored inputs and flow source remain intact; new explicit requests validate
 * against core's accepted range.
 */
export function effectiveFlowRunBudgetMinutes(source: string, runBudgetMinutes: number | undefined): number | undefined {
  if (runBudgetMinutes !== undefined) return Math.min(runBudgetMinutes, MAX_FLOW_RUN_BUDGET_MINUTES);
  const declared = declaredFlowWallclock(source);
  if (declared === null) return undefined;
  const declaredMinutes = Math.ceil(declared.ms / 60_000);
  return declaredMinutes > DEFAULT_FLOW_RUN_BUDGET_MINUTES
    ? Math.min(declaredMinutes, MAX_FLOW_RUN_BUDGET_MINUTES) : undefined;
}

/** The declared wallclock limit and the header key that declares it. */
export type DeclaredFlowWallclock = { ms: number; key: "wallclock" | "maxWallclockMs" };

/**
 * The wallclock limit the flow's header declares in `budget`, read the way
 * the flows SDK's `parseBudget` reads it: `wallclock: "2h"` (one integer and
 * one of ms/s/m/h/d) or the legacy `maxWallclockMs`. The kernel charges the
 * sum of the steps' wallclock against it and refuses the next step once it is
 * spent, whatever the deployment's run budget allows.
 *
 * Null whenever the value cannot be read with certainty (no header, a `$…`
 * string budget, a computed value or key, a spread that could override it, a
 * per-day window), so a caller never warns about a limit it only guessed.
 */
export function declaredFlowWallclock(source: string): DeclaredFlowWallclock | null {
  const header = flowHeaderObject(source);
  if (header === null) return null;
  const headerEntries = fullyReadEntries(header);
  const budget = headerEntries?.filter((entry) => entry.key === "budget").at(-1);
  if (!budget?.value.startsWith("{")) return null;
  const end = skipBalanced(budget.value, 0, "{", "}");
  if (end !== budget.value.length) return null;
  const entries = fullyReadEntries(budget.value.slice(1, -1));
  if (entries === null) return null;
  const last = (key: string) => entries.filter((entry) => entry.key === key).at(-1)?.value;
  const legacy = entries.some((entry) => LEGACY_BUDGET_KEYS.includes(entry.key));
  if (!legacy) {
    const literal = last("wallclock");
    const text = literal === undefined ? null : plainStringLiteral(literal);
    const match = text === null ? null : /^(\d+)(ms|s|m|h|d)$/.exec(text);
    if (!match) return null;
    const ms = Number(match[1]) * WALLCLOCK_UNIT_MS[match[2]!]!;
    return Number.isSafeInteger(ms) ? { ms, key: "wallclock" } : null;
  }
  // `parseBudget` refuses legacy and current keys mixed; a daily window is a
  // per-day allowance, not a cap on one run.
  if (entries.some((entry) => !LEGACY_BUDGET_KEYS.includes(entry.key)) || last("window") !== undefined) return null;
  // Any decimal numeric literal TypeScript evaluates (3_600_000, 36e5),
  // accepted when it is a non-negative safe integer, as the kernel needs.
  const raw = last("maxWallclockMs");
  const ms = raw === undefined ? null : numericLiteralValue(raw);
  return ms !== null && ms >= 0 && Number.isSafeInteger(ms) ? { ms, key: "maxWallclockMs" } : null;
}

/** The declared per-run dollar limit, as its exact decimal, and the key that declares it. */
export type DeclaredFlowDollars = { dollars: string; key: "dollars" | "maxDollars" | "$/run" };

const DOLLARS_DECIMAL = /^\d+(?:\.\d{1,6})?$/u;
/**
 * TypeScript numeric literals: decimal (`25`, `1.`, `.5`, `1e-3`, `1_000`)
 * and hex/octal/binary integers (`0x10`, `0o17`, `0b101`), `_`-separated.
 */
const NUMERIC_LITERAL = new RegExp([
  /^(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/u.source,
  /^0[xX][\da-fA-F](?:_?[\da-fA-F])*$/u.source,
  /^0[oO][0-7](?:_?[0-7])*$/u.source,
  /^0[bB][01](?:_?[01])*$/u.source,
].join("|"), "u");

/**
 * A TypeScript decimal numeric literal (`25`, `0.125`, `1e-3`, `1_000`) as the
 * dollar string the SDK's `parseBudget` would accept: it reads the number the
 * literal evaluates to and checks `String(value)`. Null for anything else.
 */
function numericLiteralValue(raw: string): number | null {
  if (!NUMERIC_LITERAL.test(raw)) return null;
  // `Number` reads every form the pattern admits once separators are gone.
  const value = Number(raw.replace(/_/gu, ""));
  return Number.isFinite(value) ? value : null;
}

function numericLiteralDollars(raw: string): string | null {
  const value = numericLiteralValue(raw);
  if (value === null || value < 0) return null;
  const text = String(value);
  return DOLLARS_DECIMAL.test(text) ? text : null;
}

/**
 * The per-run dollar limit the flow's header declares, read the way the flows
 * SDK's `parseBudget` reads it: `budget: "$25/run"`, `dollars: 25`, or the
 * legacy `maxDollars`. Same certainty rules as `declaredFlowWallclock`: null for
 * anything computed, spread, mixed, or scoped to a daily window, so a display
 * never shows a cap it only guessed.
 */
export function declaredFlowDollars(source: string): DeclaredFlowDollars | null {
  const header = flowHeaderObject(source);
  if (header === null) return null;
  const budget = fullyReadEntries(header)?.filter((entry) => entry.key === "budget").at(-1);
  if (budget === undefined) return null;
  const literal = plainStringLiteral(budget.value);
  if (literal !== null) {
    const match = /^\$(\d+(?:\.\d{1,6})?)\/run$/u.exec(literal);
    return match ? { dollars: match[1]!, key: "$/run" } : null;
  }
  if (!budget.value.startsWith("{")) return null;
  if (skipBalanced(budget.value, 0, "{", "}") !== budget.value.length) return null;
  const entries = fullyReadEntries(budget.value.slice(1, -1));
  if (entries === null) return null;
  const last = (key: string) => entries.filter((entry) => entry.key === key).at(-1)?.value;
  const legacy = entries.some((entry) => LEGACY_BUDGET_KEYS.includes(entry.key));
  if (!legacy) {
    const raw = last("dollars");
    const dollars = raw === undefined ? null : numericLiteralDollars(raw);
    return dollars === null ? null : { dollars, key: "dollars" };
  }
  if (entries.some((entry) => !LEGACY_BUDGET_KEYS.includes(entry.key)) || last("window") !== undefined) return null;
  const raw = last("maxDollars");
  if (raw === undefined) return null;
  const text = plainStringLiteral(raw);
  const value = text !== null ? (DOLLARS_DECIMAL.test(text) ? text : null) : numericLiteralDollars(raw);
  return value === null ? null : { dollars: value, key: "maxDollars" };
}

/** `declaredFlowWallclock` in milliseconds, or null. */
export function declaredFlowWallclockMs(source: string): number | null {
  return declaredFlowWallclock(source)?.ms ?? null;
}

/**
 * Why a deployment's run budget cannot take effect, or null: the flow's own
 * budget wallclock stops the run first when it is below the run budget, so
 * raising `runBudgetMinutes` alone gives the run no more time. A deployment
 * without a run budget is compared against the default it launches with.
 */
export function flowRunBudgetCapWarning(source: string, runBudgetMinutes: number | undefined): string | null {
  const declared = declaredFlowWallclock(source);
  const effective = effectiveFlowRunBudgetMinutes(source, runBudgetMinutes) ?? DEFAULT_FLOW_RUN_BUDGET_MINUTES;
  if (declared === null || effective * 60_000 <= declared.ms) return null;
  const runBudget = runBudgetMinutes === undefined
    ? `the default ${effective}-minute run budget this deployment launches with`
    : `this deployment's ${effective}-minute run budget`;
  return `This flow's own budget allows ${formatWallclock(declared.ms)} of step time (budget.${declared.key} in its header), `
    + `less than ${runBudget}. The flow's budget stops the run first, `
    + `so raising the run budget alone gives runs no more time: raise budget.${declared.key} in the flow source too.`;
}

/**
 * Every `key: value` entry of an object body, or null when any entry is one
 * `objectEntries` cannot read (a computed `["key"]`, a shorthand, a spread,
 * a method), since such an entry could set or override the key asked about.
 */
function fullyReadEntries(body: string): { key: string; value: string }[] | null {
  let count = 0;
  let i = 0;
  while (i < body.length) {
    i = skipSpace(body, i);
    if (i >= body.length) break;
    count += 1;
    i = skipToComma(body, i) + 1;
  }
  const entries = objectEntries(body);
  return entries.length === count ? entries : null;
}

/** A duration as the dashboard words it: whole hours, else whole minutes, else seconds. */
export function formatWallclock(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  if (Number.isInteger(minutes)) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return `${Math.round(ms / 1000)} seconds`;
}

/** The value of a whole `'…'`, `"…"` or placeholder-free template literal, else null. */
function plainStringLiteral(value: string): string | null {
  const quote = value[0];
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;
  if (skipString(value, 0) !== value.length) return null;
  const inner = value.slice(1, -1);
  if (quote === "`" && inner.includes("${")) return null;
  return inner.includes("\\") ? null : inner;
}


// --- header scanning ---------------------------------------------------------

/**
 * The text inside the braces of the first `flow(name, { … }` header, or null.
 * The source is walked token by token so a `flow(` inside a comment or a
 * string (a usage note, a decoy in a template literal) is never the one read.
 */
function flowHeaderObject(source: string): string | null {
  return flowCall(source)?.header ?? null;
}

/**
 * The flow's body parameter, read from the `flow(name, { … }, body)` call
 * itself: the argument after the header, matched the way the flows SDK's
 * `contextParameter` reads `Function.prototype.toString(body)` —
 * `async (f, input) =>`, `async f =>`, `f =>`, `function (f)`,
 * `async function name(f)`. Null when the source has no such call or the body
 * is not a function literal (a reference to a function defined elsewhere).
 */
function flowBodyParameter(source: string): string | null {
  const start = flowBodyStart(source);
  if (start === null) return null;
  const body = source.slice(start);
  const parameter = /^(?:async\s+)?(?:function(?:\s+[\w$]+)?\s*)?(?:\(\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*=>)/u.exec(body);
  return parameter?.[1] ?? parameter?.[2] ?? null;
}

/** Start of the main callback in either `flow(name, body)` or `flow(name, header, body)`. */
function flowBodyStart(source: string): number | null {
  const exported = defaultExportFlowBodyStart(source);
  if (exported.found) return exported.start;

  const call = flowCall(source);
  if (call) {
    const comma = skipSpace(source, call.headerEnd);
    return source[comma] === "," ? skipSpace(source, comma + 1) : null;
  }

  // The header scanner deliberately returns null for the two-argument SDK
  // overload. Walk the same imported callee names and accept only a string
  // name followed immediately by a function literal.
  const names = flowCalleeNames(source);
  let i = 0;
  while (i < source.length) {
    i = skipSpace(source, i);
    const char = source[i];
    if (char === undefined) break;
    if (char === "'" || char === '"' || char === "`") {
      const end = skipString(source, i);
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (!/[A-Za-z_$]/u.test(char)) { i += 1; continue; }
    const word = /^[A-Za-z_$][\w$]*/u.exec(source.slice(i))![0];
    const callee = names.local.has(word) && (i === 0 || !/[\w$.]/u.test(source[i - 1]!))
      || (word === "flow" && i > 0 && source[i - 1] === "." && names.namespaces.some((ns) => {
        const start = i - 1 - ns.length;
        return start >= 0 && source.slice(start, i - 1) === ns && (start === 0 || !/[\w$.]/u.test(source[start - 1]!));
      }));
    if (!callee) { i += word.length; continue; }
    let cursor = skipSpace(source, i + word.length);
    if (source[cursor] === "<") {
      cursor = skipTypeArguments(source, cursor);
      if (cursor < 0) return null;
      cursor = skipSpace(source, cursor);
    }
    if (source[cursor] !== "(") { i += word.length; continue; }
    cursor = skipSpace(source, cursor + 1);
    const nameEnd = skipString(source, cursor);
    if (nameEnd < 0) { i += word.length; continue; }
    cursor = skipSpace(source, nameEnd);
    if (source[cursor] !== ",") { i += word.length; continue; }
    cursor = skipSpace(source, cursor + 1);
    if (/^(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/u.test(source.slice(cursor))) return cursor;
    i += word.length;
  }
  return null;
}

/**
 * A direct `export default flow(…)` is the runtime entrypoint, even when an
 * earlier helper or decoy also calls `flow`. Once a default export exists we
 * never fall back to another call: indirect/unsupported exports fail closed
 * for activation-time approval enforcement.
 */
function defaultExportFlowBodyStart(source: string): { found: boolean; start: number | null } {
  const code = stripCommentsAndStringsKeepingLength(source);
  const names = flowCalleeNames(source);
  let i = 0;
  while (i < code.length) {
    if (!/[A-Za-z_$]/u.test(code[i]!)) { i += 1; continue; }
    const word = /^[A-Za-z_$][\w$]*/u.exec(code.slice(i))![0];
    if (word !== "export" || (i > 0 && /[\w$.]/u.test(code[i - 1]!))) {
      i += word.length;
      continue;
    }
    let cursor = skipSpace(source, i + word.length);
    if (source[cursor] === "{") {
      const end = skipBalanced(source, cursor, "{", "}");
      if (end < 0) return { found: true, start: null };
      const specifiers = stripCommentsKeepingLength(source)
        .slice(cursor + 1, end - 1)
        .split(",")
        .map((specifier) => specifier.trim());
      if (specifiers.some((specifier) => /(?:^|\bas\s+)(?:default|["']default["'])$/u.test(specifier))) {
        return { found: true, start: null };
      }
      i = end;
      continue;
    }
    if (source[cursor] === "=") return { found: true, start: null };
    if (!source.startsWith("default", cursor) || /[\w$]/u.test(source[cursor + 7] ?? "")) {
      i += word.length;
      continue;
    }
    cursor = skipSpace(source, cursor + 7);
    const callee = /^[A-Za-z_$][\w$]*/u.exec(source.slice(cursor))?.[0];
    if (!callee) return { found: true, start: null };
    if (names.local.has(callee)) {
      return { found: true, start: bodyAfterFlowCallee(source, cursor + callee.length) };
    }
    if (names.namespaces.includes(callee)) {
      let member = skipSpace(source, cursor + callee.length);
      if (source[member] !== ".") return { found: true, start: null };
      member = skipSpace(source, member + 1);
      if (!source.startsWith("flow", member) || /[\w$]/u.test(source[member + 4] ?? "")) {
        return { found: true, start: null };
      }
      return { found: true, start: bodyAfterFlowCallee(source, member + 4) };
    }
    return { found: true, start: null };
  }
  return { found: false, start: null };
}

/** Main callback start immediately after a known imported `flow` callee. */
function bodyAfterFlowCallee(source: string, start: number): number | null {
  let cursor = skipSpace(source, start);
  if (source[cursor] === "<") {
    cursor = skipTypeArguments(source, cursor);
    if (cursor < 0) return null;
    cursor = skipSpace(source, cursor);
  }
  if (source[cursor] !== "(") return null;
  cursor = skipSpace(source, cursor + 1);
  const nameEnd = skipString(source, cursor);
  if (nameEnd < 0) return null;
  cursor = skipSpace(source, nameEnd);
  if (source[cursor] !== ",") return null;
  cursor = skipSpace(source, cursor + 1);
  if (source[cursor] === "{") {
    cursor = skipBalanced(source, cursor, "{", "}");
    if (cursor < 0) return null;
    cursor = skipSpace(source, cursor);
    if (source[cursor] !== ",") return null;
    cursor = skipSpace(source, cursor + 1);
  }
  return /^(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/u.test(source.slice(cursor))
    ? cursor
    : null;
}

/** The `flow(…)` call's header object and where it ends (the index after its `}`). */
function flowCall(source: string): { header: string; headerEnd: number; name: string } | null {
  const names = flowCalleeNames(source);
  let i = 0;
  while (i < source.length) {
    const next = skipSpace(source, i);
    if (next !== i) { i = next; continue; }
    const char = source[i]!;
    if (char === "'" || char === '"' || char === "`") {
      const end = skipString(source, i);
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))![0];
      // `flow(`, an import alias, or `<namespace>.flow(` from a namespace import.
      const callee = names.local.has(word) && (i === 0 || !/[\w$.]/.test(source[i - 1]!))
        || (word === "flow" && i > 0 && source[i - 1] === "." && names.namespaces.some((ns) => {
          const start = i - 1 - ns.length;
          return start >= 0 && source.slice(start, i - 1) === ns && (start === 0 || !/[\w$.]/.test(source[start - 1]!));
        }));
      if (callee) {
        const header = headerAfterFlow(source, i + word.length);
        if (header !== null) return header;
      }
      i += word.length;
      continue;
    }
    i += 1;
  }
  return null;
}

/**
 * The identifiers a source may call `flow` through: `flow` itself, every
 * `import { flow as X } from "@relayflows/surface"` alias, and the namespaces
 * of `import * as ns from "@relayflows/surface"`. Only binding imports of the
 * surface package count — `import type` binds nothing, and an `import` inside
 * a comment or a string is not an import — so an unrelated `flow` binding is
 * not read as a header, and a source with no binding surface import keeps
 * the plain spelling.
 */
function flowCalleeNames(source: string): { local: Set<string>; namespaces: string[] } {
  const local = new Set<string>();
  const namespaces: string[] = [];
  let bindingSurfaceImport = false;
  let i = 0;
  while (i < source.length) {
    const next = skipSpace(source, i);
    if (next !== i) { i = next; continue; }
    const char = source[i]!;
    if (char === "'" || char === '"' || char === "`") {
      const end = skipString(source, i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (!/[A-Za-z_$]/.test(char)) { i += 1; continue; }
    const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))![0];
    if (word !== "import" || (i > 0 && /[\w$.]/.test(source[i - 1]!))) { i += word.length; continue; }
    const statement = importStatement(source, i + word.length);
    i = statement.end;
    if (statement.module === null || !/^@relayflows\/surface(?:\/[\w-]+)?$/.test(statement.module) || statement.typeOnly) continue;
    bindingSurfaceImport = true;
    if (statement.namespace !== null) namespaces.push(statement.namespace);
    for (const specifier of statement.named) {
      const named = /^(?:type\s+)?flow(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(specifier);
      if (named && !specifier.startsWith("type ")) local.add(named[1] ?? "flow");
    }
  }
  if (!bindingSurfaceImport) local.add("flow");
  return { local, namespaces };
}

/** One `import …` statement from just after the keyword: what it binds and the module it names. */
function importStatement(source: string, start: number): {
  end: number; module: string | null; typeOnly: boolean; namespace: string | null; named: string[];
} {
  let i = skipSpace(source, start);
  let typeOnly = false;
  let namespace: string | null = null;
  const named: string[] = [];
  const word = () => /^[A-Za-z_$][\w$]*/.exec(source.slice(i))?.[0];
  if (word() === "type") {
    // `import type { … }` / `import type * as …` is erased at compile time and
    // binds nothing; `import type from "x"` is a default import called `type`.
    const after = skipSpace(source, i + 4);
    const following = /^[A-Za-z_$][\w$]*/.exec(source.slice(after))?.[0];
    if (after > i + 4 && following !== "from" && source[after] !== ",") {
      typeOnly = true;
      i = after;
    }
  }
  while (i < source.length) {
    i = skipSpace(source, i);
    const char = source[i];
    if (char === undefined || char === ";") return { end: i + 1, module: null, typeOnly, namespace, named };
    if (char === "'" || char === '"') {
      // `import "side-effect"` — or the `from "module"` this loop was heading for.
      const end = skipString(source, i);
      return { end: end < 0 ? source.length : end, module: end < 0 ? null : source.slice(i + 1, end - 1), typeOnly, namespace, named };
    }
    if (char === "{") {
      const end = skipBalanced(source, i, "{", "}");
      if (end < 0) return { end: source.length, module: null, typeOnly, namespace, named };
      for (const entry of source.slice(i + 1, end - 1).split(",")) {
        const specifier = entry.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ").trim().replace(/\s+/g, " ");
        if (specifier) named.push(specifier);
      }
      i = end;
      continue;
    }
    if (char === "*") {
      i = skipSpace(source, i + 1);
      if (word() === "as") {
        i = skipSpace(source, i + 2);
        namespace = word() ?? null;
        i += namespace?.length ?? 0;
      }
      continue;
    }
    const token = word();
    if (token === undefined) { i += 1; continue; }
    i += token.length;
  }
  return { end: i, module: null, typeOnly, namespace, named };
}

/** From just after the identifier `flow`: `<…>`? `(` string `,` `{…}` → the object body, else null. */
function headerAfterFlow(source: string, start: number): { header: string; headerEnd: number; name: string } | null {
  let index = skipSpace(source, start);
  if (source[index] === "<") {
    index = skipTypeArguments(source, index);
    if (index < 0) return null;
    index = skipSpace(source, index);
  }
  if (source[index] !== "(") return null;
  index = skipSpace(source, index + 1);
  const nameStart = index;
  const nameEnd = skipString(source, index);
  if (nameEnd < 0) return null;
  index = skipSpace(source, nameEnd);
  if (source[index] !== ",") return null;
  index = skipSpace(source, index + 1);
  if (source[index] !== "{") return null;
  const end = skipBalanced(source, index, "{", "}");
  if (end < 0) return null;
  return { header: source.slice(index + 1, end - 1), headerEnd: end, name: source.slice(nameStart + 1, nameEnd - 1) };
}

/** `<…>` after `flow`, allowing nested generics and `=>`. Returns the index after `>`, or -1. */
function skipTypeArguments(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "=" && source[i + 1] === ">") { i += 1; continue; }
    if (char === "'" || char === '"' || char === "`") {
      const end = skipString(source, i);
      if (end < 0) return -1;
      i = end - 1;
      continue;
    }
    if (char === "<") depth += 1;
    else if (char === ">") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function skipSpace(source: string, start: number): number {
  let i = start;
  for (;;) {
    while (i < source.length && /\s/.test(source[i]!)) i += 1;
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    return i;
  }
}

/** A string literal starting at `start`; returns the index after its closing quote, or -1. */
function skipString(source: string, start: number): number {
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== "`") return -1;
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\\") { i += 1; continue; }
    if (quote === "`" && char === "$" && source[i + 1] === "{") {
      const end = skipBalanced(source, i + 1, "{", "}");
      if (end < 0) return -1;
      i = end - 1;
      continue;
    }
    if (char === quote) return i + 1;
    if (quote !== "`" && char === "\n") return -1;
  }
  return -1;
}

/** From an opener at `start`, the index after its matching closer (strings and comments skipped), or -1. */
function skipBalanced(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const char = source[i]!;
    if (char === "'" || char === '"' || char === "`") {
      const end = skipString(source, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (source.startsWith("//", i) || source.startsWith("/*", i)) {
      i = skipSpace(source, i);
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

/** `key: value` pairs at the top level of an object body; values keep their source text. */
function objectEntries(body: string): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  let i = 0;
  while (i < body.length) {
    i = skipSpace(body, i);
    if (i >= body.length) break;
    let key: string;
    if (body[i] === "'" || body[i] === '"') {
      const end = skipString(body, i);
      if (end < 0) break;
      key = body.slice(i + 1, end - 1);
      i = end;
    } else {
      const match = /^[A-Za-z_$][\w$]*/.exec(body.slice(i));
      if (!match) break;
      key = match[0];
      i += key.length;
    }
    i = skipSpace(body, i);
    if (body[i] !== ":") {
      // Shorthand or spread: not a declaration this reader understands; skip to the next comma.
      i = skipToComma(body, i) + 1;
      continue;
    }
    i = skipSpace(body, i + 1);
    const valueStart = i;
    i = skipToComma(body, i);
    entries.push({ key, value: body.slice(valueStart, i).trim() });
    i += 1;
  }
  return entries;
}

/** Index of the next top-level comma, or the body's end. */
function skipToComma(body: string, start: number): number {
  let i = start;
  while (i < body.length) {
    const char = body[i]!;
    if (char === ",") return i;
    if (char === "'" || char === '"' || char === "`") {
      const end = skipString(body, i);
      if (end < 0) return body.length;
      i = end;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") {
      const end = skipBalanced(body, i, char, char === "{" ? "}" : char === "[" ? "]" : ")");
      if (end < 0) return body.length;
      i = end;
      continue;
    }
    if (isComment(body, i)) {
      i = skipSpace(body, i);
      continue;
    }
    i += 1;
  }
  return body.length;
}

function isComment(body: string, index: number): boolean {
  return body.startsWith("//", index) || body.startsWith("/*", index);
}

/** The top-level string literals of an array literal such as `["slack", 'notion/pages']`; comments and nested values are skipped. */
function stringArray(value: string): string[] {
  if (!value.startsWith("[")) return [];
  const end = skipBalanced(value, 0, "[", "]");
  const body = value.slice(1, end < 0 ? value.length : end - 1);
  const items: string[] = [];
  let i = 0;
  while (i < body.length) {
    i = skipSpace(body, i);
    if (i >= body.length) break;
    const char = body[i]!;
    if (char === "'" || char === '"' || char === "`") {
      const close = skipString(body, i);
      if (close < 0) break;
      const literal = body.slice(i + 1, close - 1);
      // A template with `${…}` is not a literal mount name.
      if (!(char === "`" && literal.includes("${"))) items.push(literal);
      i = skipToComma(body, close) + 1;
      continue;
    }
    // Anything else (a spread, an identifier, a nested array) is not a mount name.
    i = skipToComma(body, i) + 1;
  }
  return items;
}

export function flowSourceIdentity(
  source: string,
): { name: string; version?: string } | null {
  const call = flowCall(source);
  if (!call || /[\\$]/.test(call.name)) return null;
  const version = topLevelStringProperty(`{${call.header}}`, "version");
  return { name: call.name, ...(version ? { version } : {}) };
}
