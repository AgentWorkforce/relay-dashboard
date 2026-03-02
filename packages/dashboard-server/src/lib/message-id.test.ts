import { describe, it, expect } from 'vitest';
import {
  extractMessageId,
  syntheticMessageId,
  isOptimisticId,
  isBrokerEventId,
} from './message-id.js';

describe('extractMessageId', () => {
  it('returns null when no suitable field exists', () => {
    expect(extractMessageId({ foo: 'bar' })).toBeNull();
    expect(extractMessageId({})).toBeNull();
  });

  it('prefers event_id first', () => {
    expect(extractMessageId({ event_id: 'ev1', messageId: 'mid', id: 'i' })).toBe('ev1');
  });

  it('falls back to messageId when event_id is missing', () => {
    expect(extractMessageId({ messageId: 'mid', id: 'i' })).toBe('mid');
  });

  it('falls back to id when both event_id and messageId are missing', () => {
    expect(extractMessageId({ id: 'i' })).toBe('i');
  });

  it('skips blank strings', () => {
    expect(extractMessageId({ event_id: '  ', messageId: '', id: 'fallback' })).toBe('fallback');
  });

  it('skips non-string values', () => {
    expect(extractMessageId({ event_id: 123, messageId: null, id: 'ok' })).toBe('ok');
  });

});

describe('syntheticMessageId', () => {
  it('starts with "synthetic-"', () => {
    expect(syntheticMessageId()).toMatch(/^synthetic-/);
  });

  it('produces unique values', () => {
    const a = syntheticMessageId();
    const b = syntheticMessageId();
    expect(a).not.toBe(b);
  });
});

describe('isOptimisticId', () => {
  it('returns true for optimistic IDs', () => {
    expect(isOptimisticId('optimistic-123')).toBe(true);
  });

  it('returns false for non-optimistic IDs', () => {
    expect(isOptimisticId('http_abc')).toBe(false);
    expect(isOptimisticId('synthetic-1')).toBe(false);
  });
});

describe('isBrokerEventId', () => {
  it('returns true for broker event IDs', () => {
    expect(isBrokerEventId('http_abc')).toBe(true);
    expect(isBrokerEventId('http_')).toBe(true);
  });

  it('returns false for non-broker IDs', () => {
    expect(isBrokerEventId('optimistic-1')).toBe(false);
    expect(isBrokerEventId('msg-123')).toBe(false);
  });
});
