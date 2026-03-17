import type { ModelOption } from '../components/SpawnModal';

export type ReasoningEffort = NonNullable<ModelOption['defaultReasoningEffort']>;

const REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORTS.includes(value as ReasoningEffort);
}

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function tokenizeCommand(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function hasOptionValue(options: ModelOption[], value: string | undefined): value is string {
  return typeof value === 'string' && options.some((option) => option.value === value);
}

function getModelOption(options: ModelOption[], value: string | undefined): ModelOption | undefined {
  return typeof value === 'string'
    ? options.find((option) => option.value === value)
    : undefined;
}

export function resolveSupportedModel(options: ModelOption[], ...candidates: Array<string | undefined>): string {
  if (options.length === 0) {
    return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0) ?? '';
  }

  for (const candidate of candidates) {
    if (hasOptionValue(options, candidate)) {
      return candidate;
    }
  }

  return options[0]?.value ?? '';
}

export function getDefaultReasoningEffortForModel(
  options: ModelOption[],
  model: string | undefined,
): ReasoningEffort | undefined {
  return getModelOption(options, model)?.defaultReasoningEffort;
}

export function parseSpawnCommand(command: string): {
  provider: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
} {
  const tokens = tokenizeCommand(command.trim());
  const provider = tokens[0] ?? '';
  let model: string | undefined;
  let reasoningEffort: ReasoningEffort | undefined;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--model') {
      const next = tokens[index + 1];
      if (typeof next === 'string' && next.length > 0) {
        model = stripWrappingQuotes(next);
      }
      index += 1;
      continue;
    }

    if (token.startsWith('--model=')) {
      const value = stripWrappingQuotes(token.slice('--model='.length));
      if (value) {
        model = value;
      }
      continue;
    }

    const configToken = token === '-c' ? tokens[index + 1] : token;
    if (typeof configToken === 'string' && configToken.startsWith('model_reasoning_effort=')) {
      const value = stripWrappingQuotes(configToken.slice('model_reasoning_effort='.length));
      if (isReasoningEffort(value)) {
        reasoningEffort = value;
      }
      if (token === '-c') {
        index += 1;
      }
    }
  }

  return { provider, model, reasoningEffort };
}

export function buildCommandWithModel(
  baseCommand: string,
  cli: string,
  model: string,
  options: ModelOption[],
): string {
  const parts = [baseCommand, '--model', model];
  const reasoningEffort = cli === 'codex'
    ? getDefaultReasoningEffortForModel(options, model)
    : undefined;

  if (reasoningEffort) {
    parts.push('-c', 'model_reasoning_effort="' + reasoningEffort + '"');
  }

  return parts.join(' ');
}
