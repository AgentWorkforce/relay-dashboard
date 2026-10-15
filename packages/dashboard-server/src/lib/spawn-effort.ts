import { resolveDiscoveryCommand, type ModelCatalog } from './model-catalog.js';
import { isRecord } from './utils.js';

export class InvalidEffortError extends Error {}

/** Translate only an explicit dashboard selection; preserve legacy CLI arguments. */
export async function applySpawnEffort(body: Record<string, unknown>, catalog: ModelCatalog, localBroker = false): Promise<Record<string, unknown>> {
  if (body.reasoningEffort === undefined || body.reasoningEffort === '') return body;
  const cli = body.cli;
  const provider = cli === 'claude' ? 'Claude' : cli === 'codex' ? 'Codex' : cli === 'opencode' ? 'Opencode' : undefined;
  const effort = body.reasoningEffort;
  if (!provider || typeof effort !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(effort)) {
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
    const content = env.OPENCODE_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT;
    if (content !== undefined) {
      if (typeof content !== 'string') throw new Error();
      const parsed: unknown = JSON.parse(content);
      if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error();
      config = parsed;
    }
  } catch { throw new InvalidEffortError('Invalid OpenCode inline configuration'); }
  let agent = 'build';
  let hasAgent = false;
  for (let i = 0; i < effectiveArgs.length; i++) {
    if (effectiveArgs[i] === '--agent') { agent = effectiveArgs[++i]; hasAgent = true; }
    else if (effectiveArgs[i].startsWith('--agent=')) { agent = effectiveArgs[i].slice('--agent='.length); hasAgent = true; }
  }
  if (!agent || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(agent)) throw new InvalidEffortError('Invalid OpenCode agent');
  if (!hasAgent) effectiveArgs.push('--agent', agent);
  const agents = isRecord(config.agent) ? config.agent : {};
  const agentConfig = agents[agent];
  const selected = isRecord(agentConfig) ? agentConfig : {};
  config = { ...config, agent: { ...agents, [agent]: { ...selected, model: model.value, variant: effort } } };
  // Resolve on this host only for a local broker; preserve explicit wrappers and remote paths.
  const launch = localBroker && (!harness.command || harness.command === 'opencode')
    ? await resolveDiscoveryCommand('opencode')
    : { command: harness.command ?? cli, args: [] };
  return {
    ...result, args,
    harnessConfig: {
      ...harness, runtime: 'pty', command: launch.command, args: [...launch.args, ...effectiveArgs, '--model', model.value],
      ...(!harness.cwd && body.cwd ? { cwd: body.cwd } : {}),
      env: { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    },
  };
}
