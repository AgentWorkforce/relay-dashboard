/**
 * Shared message-ID utilities used by both the broker proxy and the
 * Relaycast provider so that ID extraction / generation logic lives in
 * exactly one place.
 */

/**
 * Extract a message ID from a parsed JSON payload by checking, in order:
 *   1. `event_id`
 *   2. `messageId`
 *   3. `id`
 *
 * Returns `null` when no suitable string field is found.
 */
export function extractMessageId(payload: Record<string, unknown>): string | null {
  const eventId = payload.event_id;
  if (typeof eventId === 'string' && eventId.trim()) {
    return eventId;
  }

  const messageId = payload.messageId;
  if (typeof messageId === 'string' && messageId.trim()) {
    return messageId;
  }

  const id = payload.id;
  if (typeof id === 'string' && id.trim()) {
    return id;
  }

  return null;
}

/**
 * Generate a synthetic message ID for cases where the upstream does not
 * provide one.
 */
export function syntheticMessageId(): string {
  return `synthetic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Return `true` when the given ID was generated optimistically by the
 * dashboard client before a server round-trip.
 */
export function isOptimisticId(id: string): boolean {
  return id.startsWith('optimistic-');
}

/**
 * Return `true` when the given ID looks like a broker event ID (prefixed
 * with `http_`).
 */
export function isBrokerEventId(id: string): boolean {
  return id.startsWith('http_');
}
