/**
 * Spawned agent tracking: extraction, caching, filtering, and merging.
 */

import fs from 'fs';
import path from 'path';
import { buildDashboardProxyUrl, getDashboardProxyRoute } from './proxy-route-table.js';
import type { AgentStatus } from '../relaycast-provider.js';
import type { SpawnedAgentSummary, SpawnedAgentNamesResult, LocalStateAgentSummary } from './types.js';
import {
  normalizeName,
  parseCommandDescriptor,
  isRecord,
  parseTimestamp,
  isPidAlive,
  toIsoTimestamp,
  PHANTOM_OFFLINE_MAX_AGE_MS,
  SPAWNED_CACHE_TTL_MS,
} from './utils.js';

export function extractSpawnedAgentNames(payload: unknown): SpawnedAgentNamesResult {
  const names = new Set<string>();
  const agentsByName = new Map<string, SpawnedAgentSummary>();
  let hasSpawnedList = false;
  let candidates: unknown[] = [];

  const resolveCandidates = (value: unknown): unknown[] => {
    if (Array.isArray(value)) {
      hasSpawnedList = true;
      return value;
    }
    if (!isRecord(value)) {
      return [];
    }
    if (Array.isArray(value.agents)) {
      hasSpawnedList = true;
      return value.agents;
    }
    if (Array.isArray(value.workers)) {
      hasSpawnedList = true;
      return value.workers;
    }
    if (Array.isArray(value.spawned)) {
      hasSpawnedList = true;
      return value.spawned;
    }
    return [];
  };

  candidates = resolveCandidates(payload);
  if (candidates.length === 0 && isRecord(payload)) {
    candidates = resolveCandidates(payload.data);
  }

  const upsertAgent = (candidate: SpawnedAgentSummary): void => {
    const normalizedName = normalizeName(candidate.name);
    if (!normalizedName) {
      return;
    }

    const existing = agentsByName.get(normalizedName);
    if (!existing) {
      agentsByName.set(normalizedName, candidate);
      names.add(normalizedName);
      return;
    }

    agentsByName.set(normalizedName, {
      ...existing,
      cli: existing.cli !== 'unknown' ? existing.cli : candidate.cli,
      model: existing.model ?? candidate.model,
      cwd: existing.cwd ?? candidate.cwd,
      pid: existing.pid ?? candidate.pid,
    });
  };

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmedName = candidate.trim();
      if (!trimmedName) {
        continue;
      }
      upsertAgent({
        name: trimmedName,
        cli: 'unknown',
      });
      continue;
    }

    if (!isRecord(candidate)) {
      continue;
    }

    const name = typeof candidate.name === 'string'
      ? candidate.name
      : (typeof candidate.id === 'string' ? candidate.id : '');

    const trimmedName = name.trim();
    if (!trimmedName) {
      continue;
    }

    const parsed = parseCommandDescriptor(
      typeof candidate.cli === 'string' ? candidate.cli : undefined,
      candidate.args,
      typeof candidate.model === 'string' ? candidate.model : undefined,
    );
    const cwd = typeof candidate.cwd === 'string' && candidate.cwd.trim()
      ? candidate.cwd.trim()
      : undefined;
    const pid = typeof candidate.pid === 'number' && Number.isFinite(candidate.pid)
      ? candidate.pid
      : undefined;

    upsertAgent({
      name: trimmedName,
      cli: parsed.cli,
      model: parsed.model,
      cwd,
      pid,
    });
  }

  const agents = [...agentsByName.values()];
  return { names, agents, hasSpawnedList };
}

export function filterPhantomAgents(
  agents: AgentStatus[],
  spawnedAgentNames: Set<string> | null,
  localAgentNames: Set<string> | null,
): AgentStatus[] {
  const now = Date.now();

  return agents.filter((agent) => {
    const status = (agent.status ?? '').toLowerCase();
    const lastSeenTs = parseTimestamp(agent.lastSeen ?? agent.lastActive);

    if (status === 'offline' && lastSeenTs !== null && (now - lastSeenTs) > PHANTOM_OFFLINE_MAX_AGE_MS) {
      return false;
    }

    if (localAgentNames !== null) {
      const normalizedName = normalizeName(agent.name);
      return normalizedName ? localAgentNames.has(normalizedName) : false;
    }

    if (spawnedAgentNames !== null) {
      const normalizedName = normalizeName(agent.name);
      return normalizedName ? spawnedAgentNames.has(normalizedName) : false;
    }

    return true;
  });
}

export function mergeBrokerSpawnedAgents(
  agents: AgentStatus[],
  spawnedAgents: SpawnedAgentSummary[] | null,
): AgentStatus[] {
  if (!spawnedAgents || spawnedAgents.length === 0) {
    return agents;
  }

  const mergedAgents = [...agents];
  const agentIndexByName = new Map<string, number>();
  for (let index = 0; index < mergedAgents.length; index += 1) {
    const normalized = normalizeName(mergedAgents[index]?.name ?? '');
    if (normalized) {
      agentIndexByName.set(normalized, index);
    }
  }

  for (const spawnedAgent of spawnedAgents) {
    const normalizedName = normalizeName(spawnedAgent.name);
    if (!normalizedName) {
      continue;
    }

    const normalizedCli = spawnedAgent.cli.trim() ? spawnedAgent.cli : 'unknown';
    const existingIndex = agentIndexByName.get(normalizedName);
    if (existingIndex !== undefined) {
      const existing = mergedAgents[existingIndex];
      const existingCli = typeof existing.cli === 'string' && existing.cli.trim() ? existing.cli : 'unknown';
      mergedAgents[existingIndex] = {
        ...existing,
        cli: existingCli !== 'unknown' ? existingCli : normalizedCli,
        model: existing.model ?? spawnedAgent.model,
        cwd: existing.cwd ?? spawnedAgent.cwd,
        isSpawned: true,
      };
      continue;
    }

    mergedAgents.push({
      name: spawnedAgent.name,
      role: 'agent',
      cli: normalizedCli,
      messageCount: 0,
      status: 'offline',
      lastSeen: new Date().toISOString(),
      isSpawned: true,
      model: spawnedAgent.model,
      cwd: spawnedAgent.cwd,
    });
    agentIndexByName.set(normalizedName, mergedAgents.length - 1);
  }

  return mergedAgents;
}

export function readStandaloneStateAgents(dataDir: string): LocalStateAgentSummary[] {
  const statePath = path.join(dataDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    return [];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
    if (!isRecord(raw.agents)) {
      return [];
    }

    const agents: LocalStateAgentSummary[] = [];
    for (const [name, value] of Object.entries(raw.agents)) {
      if (!isRecord(value)) {
        continue;
      }

      const pid = typeof value.pid === 'number' ? value.pid : undefined;
      const spec = isRecord(value.spec) ? value.spec : undefined;
      const cli = typeof spec?.cli === 'string' && spec.cli.trim() ? spec.cli : 'unknown';
      const cwd = typeof spec?.cwd === 'string' && spec.cwd.trim() ? spec.cwd : undefined;

      agents.push({
        name,
        cli,
        cwd,
        pid,
        online: pid !== undefined ? isPidAlive(pid) : false,
        startedAt: toIsoTimestamp(value.started_at),
      });
    }

    agents.sort((a, b) => a.name.localeCompare(b.name));
    return agents;
  } catch {
    return [];
  }
}

/**
 * Creates cached getters for spawned agents and local agent names.
 */
export function createSpawnedAgentsCaches(opts: {
  brokerProxyEnabled: boolean;
  relayUrl: string | undefined;
  dataDir: string;
  verbose: boolean;
}): {
  getSpawnedAgents: () => Promise<{ names: Set<string> | null; agents: SpawnedAgentSummary[] | null }>;
  getLocalAgentNames: () => Set<string> | null;
} {
  const { brokerProxyEnabled, relayUrl, dataDir, verbose } = opts;

  let spawnedAgentsCache: { expiresAt: number; names: Set<string> | null; agents: SpawnedAgentSummary[] | null } = {
    expiresAt: 0,
    names: null,
    agents: null,
  };
  let localAgentNamesCache: { expiresAt: number; names: Set<string> | null } = {
    expiresAt: 0,
    names: null,
  };

  const getSpawnedAgents = async (): Promise<{ names: Set<string> | null; agents: SpawnedAgentSummary[] | null }> => {
    if (!brokerProxyEnabled || !relayUrl) {
      return { names: null, agents: null };
    }

    const now = Date.now();
    if (spawnedAgentsCache.expiresAt > now) {
      return {
        names: spawnedAgentsCache.names,
        agents: spawnedAgentsCache.agents,
      };
    }

    try {
      const response = await fetch(`${relayUrl}/api/spawned`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        if (verbose) {
          console.warn(`[dashboard] Failed to fetch /api/spawned from broker: ${response.status}`);
        }
        spawnedAgentsCache = {
          expiresAt: now + SPAWNED_CACHE_TTL_MS,
          names: null,
          agents: null,
        };
        return { names: null, agents: null };
      }

      const payload = await response.json() as unknown;
      const { names, agents, hasSpawnedList } = extractSpawnedAgentNames(payload);
      const resolvedNames = hasSpawnedList ? names : null;
      const resolvedAgents = hasSpawnedList ? agents : null;

      if (!hasSpawnedList && verbose) {
        console.warn('[dashboard] /api/spawned payload missing agents/workers list; skipping phantom cross-reference');
      }

      spawnedAgentsCache = {
        expiresAt: now + SPAWNED_CACHE_TTL_MS,
        names: resolvedNames,
        agents: resolvedAgents,
      };
      return { names: resolvedNames, agents: resolvedAgents };
    } catch (err) {
      if (verbose) {
        console.warn('[dashboard] Failed to fetch /api/spawned from broker:', (err as Error).message);
      }
      spawnedAgentsCache = {
        expiresAt: now + SPAWNED_CACHE_TTL_MS,
        names: null,
        agents: null,
      };
      return { names: null, agents: null };
    }
  };

  const getLocalAgentNames = (): Set<string> | null => {
    if (brokerProxyEnabled) {
      return null;
    }

    const now = Date.now();
    if (localAgentNamesCache.expiresAt > now) {
      return localAgentNamesCache.names;
    }

    const names = new Set<string>();
    const addName = (value: unknown): void => {
      if (typeof value !== 'string') return;
      const normalized = normalizeName(value);
      if (normalized) {
        names.add(normalized);
      }
    };

    try {
      const statePath = path.join(dataDir, 'state.json');
      if (fs.existsSync(statePath)) {
        const stateRaw = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Record<string, unknown>;
        if (isRecord(stateRaw.agents)) {
          for (const agentName of Object.keys(stateRaw.agents)) {
            addName(agentName);
          }
        }
      }
    } catch {
      // Ignore local state parsing failures.
    }

    localAgentNamesCache = {
      expiresAt: now + (names.size > 0 ? SPAWNED_CACHE_TTL_MS : 500),
      names: names.size > 0 ? names : null,
    };

    return names.size > 0 ? names : null;
  };

  return { getSpawnedAgents, getLocalAgentNames };
}

export interface ProxyRequestHeaders {
  authorization?: string;
  workspaceId?: string;
}

function buildHeaders(headers?: ProxyRequestHeaders): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  if (headers.authorization) out.authorization = headers.authorization;
  if (headers.workspaceId) out['x-workspace-id'] = headers.workspaceId;
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function fetchBrokerSpawnedAgents(opts: {
  env?: NodeJS.ProcessEnv;
  query?: URLSearchParams;
  headers?: ProxyRequestHeaders;
  fetchImpl?: typeof fetch;
} = {}): Promise<Response> {
  const route = getDashboardProxyRoute('brokerSpawned');
  const url = buildDashboardProxyUrl(route, { env: opts.env, query: opts.query });
  const fetchImpl = opts.fetchImpl ?? fetch;
  return fetchImpl(url, {
    method: route.method,
    headers: buildHeaders(opts.headers),
  });
}
