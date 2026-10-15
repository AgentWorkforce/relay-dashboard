import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModelCatalog, parseClaudeModels, parseOpenCodeModels, readCliCatalog, resolveDiscoveryCommand } from './model-catalog.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
const fallback = async () => ({ modelOptions: { Claude: [{ value: 'opus', label: 'Opus' }], Codex: [], Opencode: [] }, defaultModels: { claude: 'opus' } });
let directory: string;
let fail = false;
let children: Array<EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }>;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'dashboard-models-'));
  await Promise.all(['claude.exe', 'opencode.exe'].map(file => writeFile(path.join(directory, file), '')));
  vi.stubEnv('PATH', directory);
  vi.stubEnv('CODEX_HOME', directory);
  await writeFile(path.join(directory, 'models_cache.json'), JSON.stringify({ models: [
    { slug: 'codex-current', display_name: 'Codex Current', visibility: 'list', supported_reasoning_levels: [{ effort: 'ultra' }] },
    { slug: 'hidden', visibility: 'hide' },
  ] }));
  fail = false;
  children = [];
  mocks.spawn.mockReset().mockImplementation((_command, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    children.push(child);
    queueMicrotask(() => {
      if (fail) return child.emit('error', new Error('secret must not escape'));
      if (args.includes('--print')) child.stdout.write(JSON.stringify({ type: 'control_response', response: { request_id: 'dashboard-models', response: { models: [
        { value: 'opus', resolvedModel: 'claude-opus-4-6', displayName: 'Opus 4.6', supportedEffortLevels: ['high', 'max'] },
      ] } } }) + '\n');
      else { child.stdout.write('provider/current\n{"name":"Current","variants":{"high":{},"custom":{}}}\n'); child.emit('close', 0); }
    });
    return child;
  });
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('current local model catalog', () => {
  it('discovers all providers with portable paths and only requests Claude initialization', async () => {
    const result = await createModelCatalog(fallback).get();
    expect(result.modelOptions.Claude[0]).toMatchObject({ value: 'claude-opus-4-6', reasoningEfforts: ['high', 'max'] });
    expect(result.modelOptions.Codex).toEqual([{ value: 'codex-current', label: 'Codex Current', reasoningEfforts: ['ultra'] }]);
    expect(result.modelOptions.Opencode[0].reasoningEfforts).toEqual(['high', 'custom']);
    expect(result.defaultModels.claude).toBe('claude-opus-4-6');
    const initialization = children.find(child => child.stdin.readableLength > 0)!.stdin.read().toString();
    expect(JSON.parse(initialization).request).toEqual({ subtype: 'initialize' });
    expect(children.every(child => child.kill.mock.calls.length === 1)).toBe(true);
    expect(mocks.spawn.mock.calls.every(call => call[2].shell === false)).toBe(true);
  });
  it('coalesces discovery and caches results', async () => {
    const catalog = createModelCatalog(fallback);
    const [first, second] = await Promise.all([catalog.get(), catalog.get()]);
    expect(first).toBe(second);
    await catalog.get();
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });
  it('retains a successful catalog on refresh failure without exposing CLI errors', async () => {
    const catalog = createModelCatalog(fallback);
    await catalog.get();
    fail = true;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001);
    const refreshed = await catalog.get();
    vi.restoreAllMocks();
    expect(refreshed.modelOptions.Claude[0].value).toBe('claude-opus-4-6');
    expect(refreshed.catalogWarnings).toContain('Claude: discovery unavailable; using cached models');
    expect(JSON.stringify(refreshed)).not.toContain('secret');
  });
  it('falls back per provider when CLIs are missing', async () => {
    fail = true;
    const result = await createModelCatalog(fallback).get();
    expect(result.modelOptions.Claude).toEqual([{ value: 'opus', label: 'Opus' }]);
    expect(result.modelOptions.Codex[0].value).toBe('codex-current');
  });
  it('does not start local CLIs for remote catalogs', async () => {
    expect(await createModelCatalog(fallback, false).get()).toEqual(await fallback());
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('preserves versioned choices on an abbreviated Claude response', () => {
    const previous = [{ value: 'claude-opus-4-6', label: 'Opus 4.6' }];
    expect(parseClaudeModels([{ value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus' }], previous).map(m => m.label)).toEqual(['Opus 5.5', 'Opus 4.6']);
  });
  it('does not offer disabled OpenCode variants or malformed executable-like model IDs', () => {
    expect(parseOpenCodeModels('provider/current\n{"name":"Current","variants":{"high":{},"hidden":{"disabled":true}}}')[0].reasoningEfforts).toEqual(['high']);
    expect(parseClaudeModels([{ value: '--model=oops', displayName: 'Bad' }])).toEqual([]);
  });
  it('resolves Windows native and npm installations with spaces without a shell', async () => {
    const npm = path.join(directory, 'npm with spaces');
    const script = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    await mkdir(path.dirname(script), { recursive: true }); await writeFile(script, '');
    expect(await resolveDiscoveryCommand('claude', 'win32', { Path: npm })).toEqual({ command: process.execPath, args: [script] });
    expect(await resolveDiscoveryCommand('opencode', 'linux', {})).toEqual({ command: 'opencode', args: [] });
  });
  it('terminates a stalled discovery process', async () => {
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      children.push(child);
      return child;
    });
    vi.useFakeTimers();
    const result = readCliCatalog('claude');
    const assertion = expect(result).rejects.toThrow('timed out');
    await vi.waitFor(() => expect(children).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(children[0].kill).toHaveBeenCalledOnce();
  });
  it('bounds discovery output and discards raw diagnostics', async () => {
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      children.push(child);
      queueMicrotask(() => child.stderr.write('x'.repeat(8 * 1024 * 1024 + 1)));
      return child;
    });
    await expect(readCliCatalog('opencode')).rejects.toThrow('output limit');
    expect(children[0].kill).toHaveBeenCalledOnce();
  });
});
