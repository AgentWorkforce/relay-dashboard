import { execFile } from 'node:child_process';
import { isRecord } from './utils.js';

/**
 * Read the workspace's merged CLI configuration, retaining only its default agent.
 * Bound execution and suppress raw configuration/diagnostics, which can contain secrets.
 * Require explicit selection when a customized fallback cannot be determined safely.
 */
export async function readDefaultOpenCodeAgent(launch: { command: string; args: string[] }, cwd: string, overrides: Record<string, unknown> = {}): Promise<string> {
  try {
    const env = { ...process.env };
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value !== 'string') throw new Error();
      env[key] = value;
    }
    const output = await new Promise<string>((resolve, reject) => {
      execFile(launch.command, [...launch.args, 'debug', 'config'], {
        cwd, env, shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024,
      }, (error, stdout) => { if (error) reject(new Error()); else resolve(stdout); });
    });
    const config: unknown = JSON.parse(output);
    if (!isRecord(config) || Array.isArray(config)) throw new Error();
    if (typeof config.default_agent === 'string' && config.default_agent) return config.default_agent;
    const build = isRecord(config.agent) && isRecord(config.agent.build) ? config.agent.build : {};
    if (build.disable || build.hidden || build.mode === 'subagent' || (build.name && build.name !== 'build')) throw new Error();
    return 'build';
  } catch { throw new Error('OpenCode default agent unavailable'); }
}
