/**
 * Ring buffer for storing recent WebSocket messages.
 * Used to replay missed messages when clients reconnect after brief disconnects.
 */

export interface BufferedMessage {
  id: number;
  timestamp: number;
  type: string;
  payload: string;
}

export class MessageBuffer {
  private buffer: (BufferedMessage | null)[];
  private capacity: number;
  private writeIndex: number;
  private sequenceCounter: number;

  constructor(capacity: number = 500) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
    this.writeIndex = 0;
    this.sequenceCounter = 0;
  }

  /**
   * Push a new message into the buffer.
   * Returns the assigned sequence ID.
   */
  push(type: string, payload: string): number {
    this.sequenceCounter++;
    const message: BufferedMessage = {
      id: this.sequenceCounter,
      timestamp: Date.now(),
      type,
      payload,
    };
    this.buffer[this.writeIndex] = message;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    return this.sequenceCounter;
  }

  /**
   * Get all messages with an ID greater than the given sequence ID.
   * Returns messages in chronological order.
   */
  getAfter(sequenceId: number): BufferedMessage[] {
    const results: BufferedMessage[] = [];
    for (let i = 0; i < this.capacity; i++) {
      const msg = this.buffer[i];
      if (msg && msg.id > sequenceId) {
        results.push(msg);
      }
    }
    // Sort by id to ensure chronological order
    results.sort((a, b) => a.id - b.id);
    return results;
  }

  /**
   * Get all messages with a timestamp greater than the given timestamp.
   * Returns messages in chronological order.
   */
  getAfterTimestamp(ts: number): BufferedMessage[] {
    const results: BufferedMessage[] = [];
    for (let i = 0; i < this.capacity; i++) {
      const msg = this.buffer[i];
      if (msg && msg.timestamp > ts) {
        results.push(msg);
      }
    }
    // Sort by id to ensure chronological order
    results.sort((a, b) => a.id - b.id);
    return results;
  }

  /**
   * Get the current sequence ID (the ID of the last pushed message).
   * Returns 0 if no messages have been pushed.
   */
  currentId(): number {
    return this.sequenceCounter;
  }
}
