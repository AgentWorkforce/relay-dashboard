import { identifier, resolveDiscoveryCommand, type ModelCatalog } from './model-catalog.js';
import { isRecord } from './utils.js';
import { readDefaultOpenCodeAgent } from './opencode-agent.js';
import path from 'node:path';

export class InvalidEffortError extends Error {}

/** Translate only an explicit dashboard selection; preserve legacy CLI arguments. */
export async function applySpawnEffort(body: Record<string, unknown>, catalog: ModelCatalog, localBroker = false): Promise<Record<string, unknown>> {
  if (body.reasoningEffort === undefined || body.reasoningEffort === '') return body;
  const cli = body.cli;
  const provider = cli === 'claude' ? 'Claude' : cli === 'codex' ? 'Codex' : cli === 'opencode' ? 'Opencode' : undefined;
  const effort = body.reasoningEffort;
  if (!provider || !identifier(effort)) {
    throw new InvalidEffortError('Unsupported reasoning effort');
  }
  const model = (await catalog.get()).modelOptions[provider]?.find(option => option.value === body.model);
  if (!model?.reasoningEfforts?.includes(effort)) throw new InvalidEffortError('Unsupported effort for this model; refresh the model catalog');
  const { reasoningEffort: _effort, ...result } = body;
  const args = Array.isArray(body.args) ? [...body.args] as string[] : [];
  const harness = isRecord(body.harnessConfig) ? body.harnessConfig : {};
  if (harness.runtime && harness.runtime !== 'pty') throw new InvalidEffortError('Reasoning effort requires a PTY harness');
  const effectiveArgs = Array.isArray(harness.args) && harness.args.length ? [...harness.args] as string[] : [...args];
  if (!effectiveArgs.every(arg => typeof arg === 'string')) throw new InvalidEffortError('Invalid harness arguments');
  if (cli === 'claude' || cli === 'codex') {
    const flags = cli === 'claude' ? ['--effort', effort] : ['-c', `model_reasoning_effort="${effort}"`];
    return {
      ...result, args: [...args, ...flags],
      ...(body.harnessConfig ? { harnessConfig: { ...harness, args: [...effectiveArgs, ...flags] } } : {}),
    };
  }
  const env = isRecord(harness.env) ? harness.env : {};
  let config: Record<string, unknown> = {};
  try {
    const content = env.OPENCODE_CONFIG_CONTENT ?? (localBroker ? process.env.OPENCODE_CONFIG_CONTENT : undefined);
    if (content !== undefined) {
      if (typeof content !== 'string') throw new Error();
      const parsed: unknown = JSON.parse(content);
      if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error();
      config = parsed;
    }
  } catch { throw new InvalidEffortError('Invalid OpenCode inline configuration'); }
  // Resolve once so configuration discovery and the worker use the same executable.
  let resolved: Awaited<ReturnType<typeof resolveDiscoveryCommand>> | undefined;
  if (localBroker && (!harness.command || harness.command === 'opencode')) {
    try { resolved = await resolveDiscoveryCommand('opencode'); }
    catch { /* Explicit-agent launches can leave command resolution to the broker. */ }
  }
  let agent = '';
  let hasAgent = false;
  for (let i = 0; i < effectiveArgs.length; i++) {
    if (effectiveArgs[i] === '--agent') { agent = effectiveArgs[++i]; hasAgent = true; }
    else if (effectiveArgs[i].startsWith('--agent=')) { agent = effectiveArgs[i].slice('--agent='.length); hasAgent = true; }
  }
  if (!hasAgent) {
    if (!localBroker || (harness.command && harness.command !== 'opencode')) {
      throw new InvalidEffortError('OpenCode effort requires an explicit --agent for remote brokers or custom launchers');
    }
    const cwd = harness.cwd ?? body.cwd;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || path.resolve(cwd) !== path.normalize(cwd)) {
      throw new InvalidEffortError('OpenCode effort requires an absolute working directory to discover the default agent; specify a directory or --agent, or use CLI default effort');
    }
    try {
      if (!resolved) throw new Error();
      agent = await readDefaultOpenCodeAgent(resolved, cwd, env);
    } catch { throw new InvalidEffortError('Cannot determine the OpenCode default agent; specify --agent or use CLI default effort'); }
  }
  if (!agent || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(agent)) throw new InvalidEffortError('Invalid OpenCode agent');
  const agents = isRecord(config.agent) ? config.agent : {};
  const agentConfig = agents[agent];
  const selected = isRecord(agentConfig) ? agentConfig : {};
  config = { ...config, agent: { ...agents, [agent]: { ...selected, model: model.value, variant: effort } } };
  const launch = resolved ?? { command: harness.command ?? cli, args: [] as string[] };
  return {
    ...result, args,
    harnessConfig: {
      ...harness, runtime: 'pty', command: launch.command, args: [...launch.args, ...effectiveArgs, '--model', model.value],
      ...(!harness.cwd && body.cwd ? { cwd: body.cwd } : {}),
      env: { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    },
  };
}
