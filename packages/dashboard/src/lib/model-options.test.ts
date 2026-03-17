import { describe, expect, it } from 'vitest';

import { parseSpawnCommand } from './model-options';

describe('parseSpawnCommand', () => {
  it('extracts provider, model, and Codex reasoning effort from the modal command', () => {
    expect(parseSpawnCommand('codex --model gpt-5.4 -c model_reasoning_effort="xhigh"')).toEqual({
      provider: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    });
  });

  it('handles inline model syntax and commands without reasoning effort overrides', () => {
    expect(parseSpawnCommand('opencode --model=openai/gpt-5.2')).toEqual({
      provider: 'opencode',
      model: 'openai/gpt-5.2',
      reasoningEffort: undefined,
    });
  });
});
