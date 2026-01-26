/**
 * Tests for needs-attention service
 *
 * Tests the computeNeedsAttention function which determines which agents
 * have pending inbound messages they haven't answered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeNeedsAttention, type AttentionMessage } from './needs-attention.js';

describe('computeNeedsAttention', () => {
  const now = Date.now();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create a message with a relative timestamp
  const createMessage = (
    from: string,
    to: string,
    minutesAgo: number,
    options: { thread?: string; isBroadcast?: boolean } = {}
  ): AttentionMessage => ({
    from,
    to,
    timestamp: new Date(now - minutesAgo * 60 * 1000).toISOString(),
    ...options,
  });

  describe('basic attention detection', () => {
    it('should return empty set for no messages', () => {
      const result = computeNeedsAttention([]);
      expect(result.size).toBe(0);
    });

    it('should detect agent needing attention when they have an unanswered message', () => {
      const messages = [
        createMessage('user', 'agent-1', 5), // 5 minutes ago
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(true);
    });

    it('should not flag agent when they have replied', () => {
      const messages = [
        createMessage('user', 'agent-1', 10), // 10 minutes ago
        createMessage('agent-1', 'user', 5),  // 5 minutes ago - reply
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(false);
    });

    it('should flag agent when reply is older than last inbound', () => {
      const messages = [
        createMessage('agent-1', 'user', 10), // agent replied 10 min ago
        createMessage('user', 'agent-1', 5),  // user sent another 5 min ago
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(true);
    });
  });

  describe('attention window (30 minutes)', () => {
    it('should not flag agent for messages outside attention window', () => {
      const messages = [
        createMessage('user', 'agent-1', 35), // 35 minutes ago - outside window
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(false);
    });

    it('should flag agent for messages within attention window', () => {
      const messages = [
        createMessage('user', 'agent-1', 25), // 25 minutes ago - within window
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(true);
    });
  });

  describe('threaded conversations', () => {
    it('should track attention by thread when thread ID is provided', () => {
      const messages = [
        createMessage('user', 'agent-1', 10, { thread: 'thread-1' }),
        createMessage('agent-1', 'user', 5, { thread: 'thread-1' }), // reply in thread
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(false);
    });

    it('should flag agent when thread has unanswered message', () => {
      const messages = [
        createMessage('agent-1', 'user', 10, { thread: 'thread-1' }),
        createMessage('user', 'agent-1', 5, { thread: 'thread-1' }), // new message in thread
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(true);
    });

    it('should track different threads independently', () => {
      const messages = [
        createMessage('user', 'agent-1', 10, { thread: 'thread-1' }),
        createMessage('agent-1', 'user', 5, { thread: 'thread-2' }), // reply in different thread
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(true);
    });
  });

  describe('broadcast messages', () => {
    it('should not trigger attention for broadcast messages (isBroadcast flag)', () => {
      const messages = [
        createMessage('user', 'agent-1', 5, { isBroadcast: true }),
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(false);
    });

    it('should not trigger attention for broadcast messages (to: *)', () => {
      const messages = [
        createMessage('user', '*', 5),
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('*')).toBe(false);
    });

    it('should clear attention when agent sends a broadcast', () => {
      const messages = [
        createMessage('user', 'agent-1', 10),
        createMessage('agent-1', '*', 5, { isBroadcast: true }), // broadcast clears attention
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(false);
    });
  });

  describe('multiple agents', () => {
    it('should track multiple agents independently', () => {
      const messages = [
        createMessage('user', 'agent-1', 5),
        createMessage('user', 'agent-2', 5),
        createMessage('agent-2', 'user', 3), // agent-2 replied
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(true);
      expect(result.has('agent-2')).toBe(false);
    });

    it('should handle complex conversation patterns', () => {
      const messages = [
        createMessage('agent-1', 'agent-2', 20),
        createMessage('agent-2', 'agent-1', 15),
        createMessage('user', 'agent-1', 10),
        createMessage('agent-1', 'user', 8),
        createMessage('user', 'agent-1', 5), // new message from user
        createMessage('user', 'agent-3', 3), // agent-3 hasn't replied
      ];

      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(true);
      expect(result.has('agent-2')).toBe(false);
      expect(result.has('agent-3')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle invalid timestamps gracefully', () => {
      const messages: AttentionMessage[] = [
        { from: 'user', to: 'agent-1', timestamp: 'invalid-date' },
      ];

      const result = computeNeedsAttention(messages);
      expect(result.size).toBe(0);
    });

    it('should handle empty from/to fields', () => {
      const messages: AttentionMessage[] = [
        { from: '', to: 'agent-1', timestamp: new Date(now - 5 * 60 * 1000).toISOString() },
        { from: 'user', to: '', timestamp: new Date(now - 5 * 60 * 1000).toISOString() },
      ];

      // Should not throw
      const result = computeNeedsAttention(messages);
      expect(result).toBeDefined();
    });

    it('should handle messages at exact boundary of attention window', () => {
      const messages = [
        createMessage('user', 'agent-1', 30), // exactly 30 minutes ago
      ];

      // At exactly 30 minutes, message is at the boundary
      // cutoffTime = now - 30 * 60 * 1000, message ts = now - 30 * 60 * 1000
      // inboundTs < cutoffTime is false (they're equal), so message IS included
      // Agent should be flagged since message is at the boundary, not past it
      const result = computeNeedsAttention(messages);
      expect(result.has('agent-1')).toBe(true);
    });
  });
});
