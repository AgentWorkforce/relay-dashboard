import { describe, it, expect } from 'vitest';
import {
  extractSpawnedAgentNames,
  filterPhantomAgents,
  mergeBrokerSpawnedAgents,
} from './spawned-agents.js';
import type { AgentStatus } from '../relaycast-provider.js';

describe('extractSpawnedAgentNames', () => {
  it('extracts from array of strings', () => {
    const result = extractSpawnedAgentNames(['Alice', 'Bob']);
    expect(result.hasSpawnedList).toBe(true);
    expect(result.names.has('alice')).toBe(true);
    expect(result.names.has('bob')).toBe(true);
    expect(result.agents).toHaveLength(2);
  });

  it('extracts from objects with name/cli/model', () => {
    const result = extractSpawnedAgentNames([
      { name: 'Worker1', cli: 'claude', model: 'opus' },
    ]);
    expect(result.hasSpawnedList).toBe(true);
    expect(result.names.has('worker1')).toBe(true);
    expect(result.agents[0].cli).toBe('claude');
    expect(result.agents[0].model).toBe('opus');
  });

  it('extracts online state from payload booleans and status values', () => {
    const result = extractSpawnedAgentNames([
      { name: 'WorkerOnline', cli: 'claude', online: true },
      { name: 'WorkerRunning', cli: 'codex', status: 'running' },
      { name: 'WorkerBusy', cli: 'codex', status: '  Busy  ' },
    ]);
    expect(result.hasSpawnedList).toBe(true);
    expect(result.agents.find((a) => a.name === 'WorkerOnline')?.online).toBe(true);
    expect(result.agents.find((a) => a.name === 'WorkerRunning')?.online).toBe(true);
    expect(result.agents.find((a) => a.name === 'WorkerBusy')?.online).toBe(true);
  });

  it('extracts from nested data.agents', () => {
    const result = extractSpawnedAgentNames({
      data: {
        agents: [{ name: 'Nested', cli: 'codex' }],
      },
    });
    expect(result.hasSpawnedList).toBe(true);
    expect(result.names.has('nested')).toBe(true);
  });

  it('extracts from workers key', () => {
    const result = extractSpawnedAgentNames({ workers: ['WorkerX'] });
    expect(result.hasSpawnedList).toBe(true);
    expect(result.names.has('workerx')).toBe(true);
  });

  it('extracts from spawned key', () => {
    const result = extractSpawnedAgentNames({ spawned: ['AgentZ'] });
    expect(result.hasSpawnedList).toBe(true);
    expect(result.names.has('agentz')).toBe(true);
  });

  it('returns empty for unsupported payload', () => {
    const result = extractSpawnedAgentNames('not an object');
    expect(result.hasSpawnedList).toBe(false);
    expect(result.names.size).toBe(0);
  });

  it('skips empty names', () => {
    const result = extractSpawnedAgentNames(['', '  ', 'Valid']);
    expect(result.names.size).toBe(1);
    expect(result.names.has('valid')).toBe(true);
  });

  it('deduplicates by normalized name', () => {
    const result = extractSpawnedAgentNames([
      { name: 'Worker', cli: 'unknown' },
      { name: 'worker', cli: 'claude' },
    ]);
    expect(result.names.size).toBe(1);
    // Second entry enriches the first
    expect(result.agents[0].cli).toBe('claude');
  });

  it('uses id field as fallback for name', () => {
    const result = extractSpawnedAgentNames([{ id: 'AgentById', cli: 'codex' }]);
    expect(result.names.has('agentbyid')).toBe(true);
  });
});

describe('filterPhantomAgents', () => {
  const makeAgent = (name: string, status: string, lastSeen?: string): AgentStatus => ({
    name,
    role: 'agent',
    cli: 'claude',
    messageCount: 0,
    status,
    lastSeen,
  });

  it('removes stale offline agents', () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const agents = [makeAgent('StaleBot', 'offline', staleDate)];
    expect(filterPhantomAgents(agents, null, null)).toHaveLength(0);
  });

  it('keeps recent offline agents', () => {
    const recentDate = new Date(Date.now() - 1000).toISOString();
    const agents = [makeAgent('RecentBot', 'offline', recentDate)];
    expect(filterPhantomAgents(agents, null, null)).toHaveLength(1);
  });

  it('filters by spawned agent names when provided', () => {
    const agents = [
      makeAgent('Known', 'online'),
      makeAgent('Unknown', 'online'),
    ];
    const spawnedNames = new Set(['known']);
    expect(filterPhantomAgents(agents, spawnedNames, null)).toHaveLength(1);
    expect(filterPhantomAgents(agents, spawnedNames, null)[0].name).toBe('Known');
  });

  it('filters by local agent names when provided', () => {
    const agents = [
      makeAgent('Local', 'online'),
      makeAgent('NotLocal', 'online'),
    ];
    const localNames = new Set(['local']);
    expect(filterPhantomAgents(agents, null, localNames)).toHaveLength(1);
    expect(filterPhantomAgents(agents, null, localNames)[0].name).toBe('Local');
  });

  it('keeps all agents when no filter sets are provided', () => {
    const agents = [
      makeAgent('A', 'online'),
      makeAgent('B', 'online'),
    ];
    expect(filterPhantomAgents(agents, null, null)).toHaveLength(2);
  });
});

describe('mergeBrokerSpawnedAgents', () => {
  const makeAgent = (name: string, overrides: Partial<AgentStatus> = {}): AgentStatus => ({
    name,
    role: 'agent',
    cli: 'unknown',
    messageCount: 0,
    status: 'online',
    ...overrides,
  });

  it('returns agents as-is when no spawned agents', () => {
    const agents = [makeAgent('A')];
    expect(mergeBrokerSpawnedAgents(agents, null)).toBe(agents);
    expect(mergeBrokerSpawnedAgents(agents, [])).toBe(agents);
  });

  it('enriches existing agents with spawned info', () => {
    const agents = [makeAgent('Worker', { cli: 'unknown' })];
    const spawned = [{ name: 'Worker', cli: 'claude', model: 'opus' }];
    const result = mergeBrokerSpawnedAgents(agents, spawned);
    expect(result).toHaveLength(1);
    expect(result[0].cli).toBe('claude');
    expect(result[0].model).toBe('opus');
    expect(result[0].isSpawned).toBe(true);
  });

  it('adds missing spawned agents as offline', () => {
    const agents = [makeAgent('Existing')];
    const spawned = [{ name: 'New', cli: 'codex' }];
    const result = mergeBrokerSpawnedAgents(agents, spawned);
    expect(result).toHaveLength(2);
    expect(result[1].name).toBe('New');
    expect(result[1].status).toBe('offline');
    expect(result[1].isSpawned).toBe(true);
  });

  it('marks missing spawned agents online when process is alive', () => {
    const agents = [makeAgent('Existing')];
    const spawned = [{ name: 'Running', cli: 'codex', pid: 12345 }];
    const result = mergeBrokerSpawnedAgents(agents, spawned);
    expect(result[1].name).toBe('Running');
    expect(result[1].status).toBe('online');
    expect(result[1].isSpawned).toBe(true);
  });

  it('respects explicit offline status even when pid is present', () => {
    const agents = [makeAgent('Existing')];
    const spawned = [{ name: 'Stale', cli: 'codex', pid: 12345, online: false }];
    const result = mergeBrokerSpawnedAgents(agents, spawned);
    expect(result[1].name).toBe('Stale');
    expect(result[1].status).toBe('offline');
    expect(result[1].isSpawned).toBe(true);
  });

  it('upgrades existing offline relay agent to online when broker shows it running', () => {
    const agents = [makeAgent('Worker', { status: 'offline' })];
    const spawned = [{ name: 'Worker', cli: 'claude', pid: 1001 }];
    const result = mergeBrokerSpawnedAgents(agents, spawned);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('online');
    expect(result[0].isSpawned).toBe(true);
  });

  it('preserves existing cli when not unknown', () => {
    const agents = [makeAgent('Worker', { cli: 'codex' })];
    const spawned = [{ name: 'Worker', cli: 'claude' }];
    const result = mergeBrokerSpawnedAgents(agents, spawned);
    expect(result[0].cli).toBe('codex');
  });
});
