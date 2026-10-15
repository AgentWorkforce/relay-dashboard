import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { readDefaultOpenCodeAgent } from './opencode-agent.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
const launch = { command: '/portable/opencode', args: [] };
afterEach(() => vi.clearAllMocks());

/** Simulate the CLI's resolved configuration without reading user files. */
function configOutput(config: unknown, error: Error | null = null) {
  vi.mocked(execFile).mockImplementation(((_command: unknown, _args: unknown, _options: unknown, callback: Function) => {
    callback(error, JSON.stringify(config), 'private diagnostics');
  }) as typeof execFile);
}

describe('OpenCode default-agent discovery', () => {
  it('uses the effective workspace and environment and returns only the agent name', async () => {
    configOutput({ default_agent: 'review', provider: { secret: 'private-key' } });
    expect(await readDefaultOpenCodeAgent(launch, '/worker', { PATH: '/another/installation', OPENCODE_CONFIG: '/worker/config.json' })).toBe('review');
    expect(execFile).toHaveBeenCalledWith('/portable/opencode', ['debug', 'config'], expect.objectContaining({ cwd: '/worker', shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024, env: expect.objectContaining({ PATH: '/another/installation', OPENCODE_CONFIG: '/worker/config.json' }) }), expect.any(Function));
  });
  it('retains the normal build default', async () => {
    configOutput({});
    expect(await readDefaultOpenCodeAgent(launch, '/worker')).toBe('build');
  });
  it.each([{ disable: true }, { hidden: true }, { mode: 'subagent' }])('requires explicit selection when build is ineligible: %j', async build => {
    configOutput({ agent: { build } });
    await expect(readDefaultOpenCodeAgent(launch, '/worker')).rejects.toThrow('OpenCode default agent unavailable');
  });
  it('does not expose failed CLI output or diagnostics', async () => {
    configOutput({ secret: 'private-key' }, new Error('private diagnostics'));
    await expect(readDefaultOpenCodeAgent(launch, '/worker')).rejects.toThrow('OpenCode default agent unavailable');
  });
});
