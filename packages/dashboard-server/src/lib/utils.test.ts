import { describe, it, expect } from 'vitest';
import {
  normalizeRelayUrl,
  withWorkflowConventions,
  parseTimestamp,
  countOnlineAgents,
  normalizeName,
  isDirectRecipient,
  parseCommandDescriptor,
  isRecord,
  normalizeChannelTarget,
  normalizeChannelName,
  parseInviteMembers,
  isPidAlive,
  toIsoTimestamp,
  WORKFLOW_BOOTSTRAP_TASK,
  WORKFLOW_CONVENTIONS,
} from './utils.js';

describe('normalizeRelayUrl', () => {
  it('returns undefined for falsy input', () => {
    expect(normalizeRelayUrl(undefined)).toBeUndefined();
    expect(normalizeRelayUrl('')).toBeUndefined();
    expect(normalizeRelayUrl('   ')).toBeUndefined();
  });

  it('strips trailing slashes', () => {
    expect(normalizeRelayUrl('http://localhost:3889/')).toBe('http://localhost:3889');
    expect(normalizeRelayUrl('http://localhost:3889///')).toBe('http://localhost:3889');
  });

  it('returns trimmed url without trailing slash', () => {
    expect(normalizeRelayUrl('  http://example.com  ')).toBe('http://example.com');
  });
});

describe('withWorkflowConventions', () => {
  it('returns undefined for empty task when conventions disabled', () => {
    expect(withWorkflowConventions('', false)).toBeUndefined();
    expect(withWorkflowConventions(undefined, false)).toBeUndefined();
  });

  it('returns task as-is when conventions disabled', () => {
    expect(withWorkflowConventions('Do something', false)).toBe('Do something');
  });

  it('returns bootstrap + conventions for empty task when enabled', () => {
    const result = withWorkflowConventions('', true);
    expect(result).toContain(WORKFLOW_BOOTSTRAP_TASK);
    expect(result).toContain(WORKFLOW_CONVENTIONS);
  });

  it('appends conventions to normal task', () => {
    const result = withWorkflowConventions('My custom task', true);
    expect(result).toContain('My custom task');
    expect(result).toContain(WORKFLOW_CONVENTIONS);
  });

  it('does not append conventions if already configured', () => {
    const task = 'Use relay_send( to communicate. ACK: got it. DONE: finished.';
    expect(withWorkflowConventions(task, true)).toBe(task);
  });
});

describe('parseTimestamp', () => {
  it('returns null for undefined', () => {
    expect(parseTimestamp(undefined)).toBeNull();
  });

  it('returns null for invalid date', () => {
    expect(parseTimestamp('not-a-date')).toBeNull();
  });

  it('returns epoch ms for valid ISO string', () => {
    const result = parseTimestamp('2024-01-01T00:00:00.000Z');
    expect(result).toBe(new Date('2024-01-01T00:00:00.000Z').getTime());
  });
});

describe('countOnlineAgents', () => {
  it('counts agents with online status', () => {
    const agents = [
      { status: 'online' },
      { status: 'offline' },
      { status: 'Online' },
      { status: undefined },
    ];
    expect(countOnlineAgents(agents)).toBe(2);
  });

  it('returns 0 for empty array', () => {
    expect(countOnlineAgents([])).toBe(0);
  });
});

describe('normalizeName', () => {
  it('trims and lowercases', () => {
    expect(normalizeName('  WorkerA  ')).toBe('workera');
  });

  it('handles undefined-like coercion', () => {
    expect(normalizeName(undefined as unknown as string)).toBe('');
  });
});

describe('isDirectRecipient', () => {
  it('returns true for plain names', () => {
    expect(isDirectRecipient('WorkerA')).toBe(true);
  });

  it('returns false for channels', () => {
    expect(isDirectRecipient('#general')).toBe(false);
  });

  it('returns false for dm targets', () => {
    expect(isDirectRecipient('dm:alice')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isDirectRecipient('')).toBe(false);
    expect(isDirectRecipient('  ')).toBe(false);
  });
});

describe('parseCommandDescriptor', () => {
  it('extracts cli from first token', () => {
    const result = parseCommandDescriptor('claude --model opus');
    expect(result.cli).toBe('claude');
    expect(result.args).toEqual([]);
    expect(result.model).toBe('opus');
  });

  it('extracts --model= syntax', () => {
    const result = parseCommandDescriptor('claude', ['--model=sonnet']);
    expect(result.cli).toBe('claude');
    expect(result.model).toBe('sonnet');
    expect(result.args).toEqual([]);
  });

  it('prefers explicit model over --model in args', () => {
    const result = parseCommandDescriptor('claude', ['--model', 'opus'], 'haiku');
    expect(result.model).toBe('haiku');
  });

  it('merges rawArgs into args', () => {
    const result = parseCommandDescriptor('claude -p', ['--verbose']);
    expect(result.cli).toBe('claude');
    expect(result.args).toEqual(['-p', '--verbose']);
  });

  it('returns unknown for empty cli', () => {
    const result = parseCommandDescriptor(undefined);
    expect(result.cli).toBe('unknown');
  });
});

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('returns false for non-objects', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('string')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });

  it('returns true for arrays (they are objects)', () => {
    expect(isRecord([])).toBe(true);
  });
});

describe('normalizeChannelTarget', () => {
  it('adds # prefix to bare name', () => {
    expect(normalizeChannelTarget('general')).toBe('#general');
  });

  it('keeps # prefix', () => {
    expect(normalizeChannelTarget('#general')).toBe('#general');
  });

  it('keeps dm: prefix', () => {
    expect(normalizeChannelTarget('dm:alice')).toBe('dm:alice');
  });

  it('returns empty for empty input', () => {
    expect(normalizeChannelTarget('')).toBe('');
    expect(normalizeChannelTarget('  ')).toBe('');
  });
});

describe('normalizeChannelName', () => {
  it('strips # prefix', () => {
    expect(normalizeChannelName('#general')).toBe('general');
  });

  it('returns bare name unchanged', () => {
    expect(normalizeChannelName('general')).toBe('general');
  });

  it('keeps dm: prefix', () => {
    expect(normalizeChannelName('dm:alice')).toBe('dm:alice');
  });
});

describe('parseInviteMembers', () => {
  it('parses comma-separated string', () => {
    const result = parseInviteMembers('alice,bob, charlie');
    expect(result).toEqual([
      { id: 'alice', type: 'agent' },
      { id: 'bob', type: 'agent' },
      { id: 'charlie', type: 'agent' },
    ]);
  });

  it('parses array of strings', () => {
    const result = parseInviteMembers(['alice', 'bob']);
    expect(result).toEqual([
      { id: 'alice', type: 'agent' },
      { id: 'bob', type: 'agent' },
    ]);
  });

  it('parses array of objects', () => {
    const result = parseInviteMembers([
      { id: 'alice', type: 'user' },
      { id: 'bot1' },
    ]);
    expect(result).toEqual([
      { id: 'alice', type: 'user' },
      { id: 'bot1', type: 'agent' },
    ]);
  });

  it('returns empty for unsupported input', () => {
    expect(parseInviteMembers(42)).toEqual([]);
    expect(parseInviteMembers(null)).toEqual([]);
  });

  it('filters out empty strings', () => {
    expect(parseInviteMembers(['', '  ', 'alice'])).toEqual([
      { id: 'alice', type: 'agent' },
    ]);
  });
});

describe('toIsoTimestamp', () => {
  it('converts epoch seconds to ISO string', () => {
    expect(toIsoTimestamp(1700000000)).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('returns epoch 0 for invalid input', () => {
    expect(toIsoTimestamp('not a number')).toBe(new Date(0).toISOString());
    expect(toIsoTimestamp(-1)).toBe(new Date(0).toISOString());
    expect(toIsoTimestamp(NaN)).toBe(new Date(0).toISOString());
  });
});

describe('isPidAlive', () => {
  it('returns true for current process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for non-existent pid', () => {
    expect(isPidAlive(999999999)).toBe(false);
  });
});
