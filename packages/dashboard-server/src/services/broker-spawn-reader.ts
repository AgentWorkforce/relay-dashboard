/**
 * BrokerSpawnReader — Implements SpawnManagerLike using RelayAdapter.
 *
 * Bridges the dashboard's sync SpawnManagerLike interface with the
 * async broker SDK by maintaining an internal cache of agents and
 * worker output, updated via broker event subscription.
 */

import type { RelayAdapter, RelayAgentInfo } from '@agent-relay/broker-sdk';
import type { SpawnManagerLike } from '../types/index.js';

/** Max lines of output to buffer per agent (matches xterm scrollback). */
const MAX_OUTPUT_LINES = 10_000;

interface CachedAgent {
  name: string;
  cli: string;
  task: string;
  team?: string;
  spawnerName?: string;
  spawnedAt: number;
  pid?: number;
}

export class BrokerSpawnReader implements SpawnManagerLike {
  private agentCache = new Map<string, CachedAgent>();
  private outputBuffers = new Map<string, string[]>();
  private rawOutputBuffers = new Map<string, string>();
  private unsubscribe?: () => void;

  constructor(private adapter: RelayAdapter) {}

  /**
   * Start listening to broker events.
   * Must be called once after adapter.start() to seed state and begin tracking.
   */
  async initialize(): Promise<void> {
    // Seed cache from current agent list
    try {
      const agents = await this.adapter.listAgents();
      for (const a of agents) {
        this.agentCache.set(a.name, {
          name: a.name,
          cli: a.cli || 'unknown',
          task: '',
          spawnedAt: Date.now(),
          pid: a.pid,
        });
      }
    } catch {
      // Non-fatal — broker may not have agents yet
    }

    // Subscribe to events for live updates
    this.unsubscribe = this.adapter.onEvent((event) => {
      switch (event.kind) {
        case 'agent_spawned': {
          this.agentCache.set(event.name, {
            name: event.name,
            cli: 'unknown',
            task: '',
            spawnedAt: Date.now(),
          });
          // Initialize output buffers
          this.outputBuffers.set(event.name, []);
          this.rawOutputBuffers.set(event.name, '');
          break;
        }

        case 'agent_released':
        case 'agent_exited': {
          this.agentCache.delete(event.name);
          // Keep output buffers so logs are still accessible after exit
          break;
        }

        case 'worker_stream': {
          const lines = this.outputBuffers.get(event.name);
          if (lines) {
            lines.push(event.chunk);
            // Trim to max buffer size
            if (lines.length > MAX_OUTPUT_LINES) {
              lines.splice(0, lines.length - MAX_OUTPUT_LINES);
            }
          } else {
            this.outputBuffers.set(event.name, [event.chunk]);
          }

          // Append to raw buffer
          const raw = this.rawOutputBuffers.get(event.name) ?? '';
          this.rawOutputBuffers.set(event.name, raw + event.chunk + '\n');
          break;
        }
      }
    });
  }

  hasWorker(name: string): boolean {
    return this.agentCache.has(name);
  }

  getActiveWorkers(): Array<{
    name: string;
    cli: string;
    task: string;
    team?: string;
    spawnerName?: string;
    spawnedAt: number;
    pid?: number;
  }> {
    return Array.from(this.agentCache.values());
  }

  getWorkerOutput(name: string, limit = 500): string[] | undefined {
    const lines = this.outputBuffers.get(name);
    if (!lines) return undefined;
    return lines.slice(-limit);
  }

  getWorkerRawOutput(name: string): string | undefined {
    return this.rawOutputBuffers.get(name);
  }

  sendWorkerInput(name: string, data: string): boolean {
    // Fire-and-forget to match the sync interface
    this.adapter.sendInput(name, data).catch(() => {});
    return true;
  }

  /** Refresh the agent cache from the broker. */
  async refresh(): Promise<void> {
    try {
      const agents = await this.adapter.listAgents();
      const currentNames = new Set(agents.map((a) => a.name));

      // Remove agents no longer present
      for (const name of this.agentCache.keys()) {
        if (!currentNames.has(name)) {
          this.agentCache.delete(name);
        }
      }

      // Add/update agents
      for (const a of agents) {
        const existing = this.agentCache.get(a.name);
        if (existing) {
          existing.pid = a.pid;
        } else {
          this.agentCache.set(a.name, {
            name: a.name,
            cli: a.cli || 'unknown',
            task: '',
            spawnedAt: Date.now(),
            pid: a.pid,
          });
        }
      }
    } catch {
      // Non-fatal
    }
  }

  /** Clean up event subscriptions. */
  destroy(): void {
    this.unsubscribe?.();
    this.agentCache.clear();
    this.outputBuffers.clear();
    this.rawOutputBuffers.clear();
  }
}
