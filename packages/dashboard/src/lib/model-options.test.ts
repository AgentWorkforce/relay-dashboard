import { describe, expect, it } from 'vitest';

import { parseSpawnCommand, resolveSupportedModel } from './model-options';

describe('resolveSupportedModel', () => {
  it('preserves a saved alias ahead of a registry default from another family', () => {
    const options = [
      { value: 'claude-sonnet-4-6', label: 'Sonnet', aliases: ['sonnet'] },
      { value: 'claude-opus-4-6', label: 'Opus', aliases: ['opus'] },
    ];
    expect(resolveSupportedModel(options, 'opus', 'claude-sonnet-4-6')).toBe('claude-opus-4-6');
    expect(resolveSupportedModel(options, 'claude-sonnet-4-6', 'opus')).toBe('claude-sonnet-4-6');
  });
});

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
