import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface ModelOption {
  value: string;
  label: string;
  aliases?: string[];
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
}
export interface ModelCatalogData {
  modelOptions: Record<string, ModelOption[]>;
  defaultModels: Record<string, string>;
  catalogWarnings?: string[];
}
export interface ModelCatalog { get(): Promise<ModelCatalogData> }
const TTL = 10 * 60 * 1000;
const OUTPUT_LIMIT = 8 * 1024 * 1024;
const providers = { Claude: 'claude', Codex: 'codex', Opencode: 'opencode' } as const;
/** Narrow CLI metadata to an object, excluding null and arrays. */
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** Accept bounded model/variant identifiers before exposing CLI metadata. */
export const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,255}$/.test(value);
/** Keep distinct valid effort identifiers; absent or malformed lists become empty. */
function efforts(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(identifier))] : [];
}

/**
 * Normalize Claude initialization metadata, preferring resolved model IDs.
 * Alias-only responses retain previous choices; duplicate IDs use the fresh entry.
 * @throws If the response is not an array.
 */
export function parseClaudeModels(raw: unknown, previous: ModelOption[] = []): ModelOption[] {
  if (!Array.isArray(raw)) throw new Error('Invalid Claude catalog');
  const entries = raw.filter(record).filter(m => m.value !== 'default');
  const partial = entries.length > 0 && entries.every(m => typeof m.displayName === 'string' && !/\d/.test(m.displayName));
  const result = entries.flatMap(m => {
    const value = m.resolvedModel ?? m.value;
    if (!identifier(value) || typeof m.displayName !== 'string') return [];
    // Some CLI versions return family labels alongside resolved versioned IDs.
    const version = value.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/i);
    const label = !/\d/.test(m.displayName) && version
      ? `${version[1][0].toUpperCase()}${version[1].slice(1)} ${version[2]}${version[3] ? `.${version[3]}` : ''}`
      : m.displayName;
    return [{ value, label, aliases: identifier(m.value) && m.value !== value ? [m.value] : [], reasoningEfforts: efforts(m.supportedEffortLevels) }];
  });
  const merged = new Map<string, ModelOption>();
  const claimedAliases = new Set<string>();
  for (const model of [...result, ...(partial ? previous : [])]) {
    const aliases = (model.aliases ?? []).filter(alias => !claimedAliases.has(alias));
    aliases.forEach(alias => claimedAliases.add(alias));
    const existing = merged.get(model.value);
    if (existing) existing.aliases = [...(existing.aliases ?? []), ...aliases];
    else merged.set(model.value, { ...model, aliases });
  }
  return [...merged.values()];
}

/**
 * Parse `opencode models --verbose` ID/JSON blocks into labeled provider models.
 * Disabled variants are omitted. Malformed JSON throws so discovery can fall back.
 */
export function parseOpenCodeModels(text: string): ModelOption[] {
  const chunks = text.replace(/\r/g, '').split(/^([^\s{}]+\/[^\s{}]+)\s*$/m);
  const result: ModelOption[] = [];
  for (let i = 1; i < chunks.length; i += 2) {
    const model: unknown = JSON.parse(chunks[i + 1]);
    if (!identifier(chunks[i]) || !record(model) || typeof model.name !== 'string') continue;
    result.push({
      value: chunks[i], label: `${model.name} — ${chunks[i]}`,
      reasoningEfforts: record(model.variants)
        ? Object.entries(model.variants).filter(([key, value]) => identifier(key) && record(value) && !value.disabled).map(([key]) => key)
        : [],
    });
  }
  return result;
}

/**
 * Extract listed Codex cache entries and their advertised effort metadata.
 * Hidden or invalid model IDs are omitted; a missing models array throws.
 */
export function parseCodexModels(raw: unknown): ModelOption[] {
  if (!record(raw) || !Array.isArray(raw.models)) throw new Error('Invalid Codex catalog');
  return raw.models.filter(record).filter(m => m.visibility === 'list' && identifier(m.slug)).map(m => ({
    value: m.slug as string,
    label: typeof m.display_name === 'string' ? m.display_name : m.slug as string,
    reasoningEfforts: efforts(Array.isArray(m.supported_reasoning_levels)
      ? m.supported_reasoning_levels.filter(record).map(level => level.effort) : []),
    ...(identifier(m.default_reasoning_level) ? { defaultReasoningEffort: m.default_reasoning_level } : {}),
  }));
}

/** Resolve only fixed discovery commands; never execute .cmd files through a shell. */
export async function resolveDiscoveryCommand(
  cli: 'claude' | 'opencode',
  platform = process.platform,
  env = process.env,
): Promise<{ command: string; args: string[] }> {
  if (platform !== 'win32') return { command: cli, args: [] };
  const envPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of envPath.split(';').filter(Boolean)) {
    const base = directory.replace(/^"|"$/g, '');
    const candidates = cli === 'claude'
      ? [[path.join(base, 'claude.exe')], [process.execPath, path.join(base, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')]]
      : [[path.join(base, 'opencode.exe')], [path.join(base, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')], [path.join(base, 'node_modules', 'opencode-windows-x64', 'bin', 'opencode.exe')]];
    for (const [command, script] of candidates) {
      try { await access(script ?? command); return { command, args: script ? [script] : [] }; } catch { /* next PATH entry */ }
    }
  }
  throw new Error('CLI unavailable');
}

/** Fixed commands, bounded output/time, no prompts and no raw diagnostics exposed. */
export async function readCliCatalog(cli: 'claude' | 'opencode'): Promise<unknown> {
  const resolved = await resolveDiscoveryCommand(cli);
  return new Promise((resolve, reject) => {
    const args = cli === 'claude'
      ? ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence']
      : ['models', '--verbose'];
    const child = spawn(resolved.command, [...resolved.args, ...args], { windowsHide: true, shell: false, cwd: os.homedir() });
    child.stdout.setEncoding('utf8');
    let output = '', bytes = 0, settled = false;
    /** Settle discovery once and release its timeout and child process. */
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('CLI discovery timed out')), 10_000);
    child.on('error', () => finish(new Error('CLI unavailable')));
    child.stdin.on('error', () => finish(new Error('CLI unavailable')));
    child.stderr.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > OUTPUT_LIMIT) finish(new Error('CLI output limit exceeded'));
    });
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > OUTPUT_LIMIT) return finish(new Error('CLI output limit exceeded'));
      output += chunk.toString();
      if (cli !== 'claude') return;
      const lines = output.split('\n');
      output = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.type === 'control_response' && message.response?.request_id === 'dashboard-models') {
            finish(undefined, message.response?.response?.models);
          }
        } catch { /* Other CLI output is not catalog metadata. */ }
      }
    });
    child.on('close', code => {
      if (cli === 'opencode' && code === 0) finish(undefined, output);
      else finish(new Error('CLI did not return a catalog'));
    });
    if (cli === 'claude') child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'dashboard-models', request: { subtype: 'initialize' } }) + '\n');
    else child.stdin.end();
  });
}

/**
 * Create a ten-minute catalog cache with shared in-flight refreshes.
 * Provider failures retain cached or bundled options and expose generic warnings.
 * Set discover=false for remote brokers to avoid querying this host's CLIs.
 */
export function createModelCatalog(fallback: () => Promise<ModelCatalogData>, discover = true): ModelCatalog {
  let cached: ModelCatalogData | undefined;
  let expires = 0;
  let pending: Promise<ModelCatalogData> | undefined;
  return {
  /** Return fresh cached data or share one refresh across concurrent callers. */
  get() {
    if (cached && Date.now() < expires) return Promise.resolve(cached);
    if (pending) return pending;
    pending = (async () => {
      const bundled = await fallback();
      if (!discover) return bundled;
      const modelOptions = { ...bundled.modelOptions, ...cached?.modelOptions };
      const catalogWarnings: string[] = [];
      await Promise.all(Object.keys(providers).map(async provider => {
        try {
          let models: ModelOption[];
          if (provider === 'Claude') models = parseClaudeModels(await readCliCatalog('claude'), cached?.modelOptions.Claude);
          else if (provider === 'Opencode') models = parseOpenCodeModels(await readCliCatalog('opencode') as string);
          else {
            const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json');
            const contents = await readFile(file, 'utf8');
            if (Buffer.byteLength(contents) > OUTPUT_LIMIT) throw new Error('Catalog too large');
            models = parseCodexModels(JSON.parse(contents));
          }
          if (!models.length) throw new Error('Empty catalog');
          modelOptions[provider] = models;
        } catch {
          catalogWarnings.push(`${provider}: discovery unavailable; using ${cached?.modelOptions[provider] ? 'cached' : 'bundled'} models`);
        }
      }));
      const defaultModels = { ...bundled.defaultModels };
      for (const [provider, cli] of Object.entries(providers)) {
        const options = modelOptions[provider] ?? [];
        const selected = options.find(m => m.value === defaultModels[cli])
          ?? options.find(m => m.aliases?.includes(defaultModels[cli])) ?? options[0];
        if (selected) defaultModels[cli] = selected.value;
      }
      return { modelOptions, defaultModels, catalogWarnings };
    })().then(result => { cached = result; expires = Date.now() + TTL; return result; }).finally(() => { pending = undefined; });
    return pending;
  } };
}
