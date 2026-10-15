// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProvider, useAgentContext } from './AgentProvider';

const mocks = vi.hoisted(() => ({
  cloud: {} as Record<string, unknown>,
  localSpawn: vi.fn(), cloudSpawn: vi.fn(), orchestratorSpawn: vi.fn(),
  repos: { repos: [], refetch: vi.fn() },
}));
vi.mock('./CloudWorkspaceProvider', () => ({ useCloudWorkspace: () => mocks.cloud }));
vi.mock('../components/hooks/useWorkspaceRepos', () => ({ useWorkspaceRepos: () => mocks.repos }));
vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, api: { ...actual.api, spawnAgent: mocks.localSpawn,
    getBridgeData: async () => ({ success: false }), getFleetServers: async () => ({ success: false }), getDecisions: async () => ({ success: false }),
  } };
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.localSpawn.mockResolvedValue({ success: true });
  mocks.cloudSpawn.mockResolvedValue({ success: true });
  mocks.orchestratorSpawn.mockResolvedValue({});
  mocks.cloud = {
    features: { workspaces: false }, effectiveWorkspaces: [], orchestratorWorkspaces: [], orchestratorAgents: [], localAgents: [],
    orchestratorSpawnAgent: mocks.orchestratorSpawn,
  };
});
afterEach(cleanup);
function setup() {
  return renderHook(() => useAgentContext(), { wrapper: ({ children }) => <AgentProvider data={null} isConnected={false}>{children}</AgentProvider> });
}
describe('spawn effort transport', () => {
  it('forwards the selected effort through the local API', async () => {
    const { result } = setup();
    await act(async () => { await result.current.handleSpawn({ name: 'worker', command: 'claude --model opus', reasoningEffort: 'max' }); });
    expect(mocks.localSpawn).toHaveBeenCalledWith(expect.objectContaining({ cli: 'claude --model opus', reasoningEffort: 'max' }));
  });
  it('forwards the selected effort through the cloud adapter', async () => {
    Object.assign(mocks.cloud, { features: { workspaces: true }, apiAdapter: { spawnAgent: mocks.cloudSpawn }, activeCloudWorkspaceId: 'ws-1' });
    const { result } = setup();
    await act(async () => { await result.current.handleSpawn({ name: 'worker', command: 'codex --model current', reasoningEffort: 'ultra' }); });
    expect(mocks.cloudSpawn).toHaveBeenCalledWith('ws-1', expect.objectContaining({ provider: 'codex', model: 'current', reasoningEffort: 'ultra' }));
    expect(mocks.localSpawn).not.toHaveBeenCalled();
  });
  it('rejects unsupported orchestrator effort instead of silently discarding it', async () => {
    Object.assign(mocks.cloud, { orchestratorWorkspaces: [{ id: 'ws-1', path: '/work', name: 'Work' }], activeWorkspaceId: 'ws-1' });
    const { result } = setup();
    await act(async () => { expect(await result.current.handleSpawn({ name: 'worker', command: 'opencode --model provider/current', reasoningEffort: 'high' })).toBe(false); });
    expect(mocks.orchestratorSpawn).not.toHaveBeenCalled();
    expect(result.current.spawnError).toMatch(/does not support/);
    await act(async () => { expect(await result.current.handleSpawn({ name: 'worker', command: 'opencode --model provider/current' })).toBe(true); });
    expect(mocks.orchestratorSpawn).toHaveBeenCalledWith('worker', undefined, 'opencode --model provider/current', undefined);
  });
});
