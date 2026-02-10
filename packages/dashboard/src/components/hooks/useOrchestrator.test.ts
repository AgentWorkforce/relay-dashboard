/**
 * Tests for useOrchestrator hook
 *
 * Covers: spawnAgent cwd parameter forwarding.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrchestrator } from './useOrchestrator';

// Mock WebSocket to prevent actual connections
vi.stubGlobal(
  'WebSocket',
  class MockWebSocket {
    static CLOSED = 3;
    readyState = 3;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    close() {
      /* no-op */
    }
  },
);

// Mock fetch
const mockFetch = vi.fn();

describe('useOrchestrator', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    // Default mock for workspace/agents fetches
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/workspaces') && !url.includes('/agents')) {
        return {
          ok: true,
          json: async () => ({
            workspaces: [
              { id: 'ws-1', name: 'test', lastActiveAt: new Date().toISOString() },
            ],
            activeWorkspaceId: 'ws-1',
          }),
        };
      }
      if (url.includes('/agents') && !url.includes('POST')) {
        return {
          ok: true,
          json: async () => ({ agents: [] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Re-stub WebSocket for next test
    vi.stubGlobal(
      'WebSocket',
      class MockWebSocket {
        static CLOSED = 3;
        readyState = 3;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onmessage: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        close() {
          /* no-op */
        }
      },
    );
  });

  describe('spawnAgent', () => {
    it('includes cwd in POST body when provided', async () => {
      const { result } = renderHook(() =>
        useOrchestrator({ apiUrl: 'http://localhost:3456', enabled: true }),
      );

      // Wait for initial data fetch
      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Set up mock for the spawn POST
      mockFetch.mockImplementationOnce(async (_url: string, opts?: RequestInit) => {
        return {
          ok: true,
          json: async () => ({
            id: 'agent-1',
            name: 'worker',
            workspaceId: 'ws-1',
            provider: 'claude',
            status: 'running',
            spawnedAt: new Date().toISOString(),
            restartCount: 0,
          }),
        };
      });

      // Call spawnAgent with cwd
      await act(async () => {
        await result.current.spawnAgent('worker', 'do stuff', 'claude', 'trajectories');
      });

      // Find the POST call to /agents (spawn call)
      const spawnCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('/agents') &&
          call[1]?.method === 'POST',
      );
      expect(spawnCall).toBeTruthy();

      const body = JSON.parse(spawnCall![1].body as string);
      expect(body.cwd).toBe('trajectories');
      expect(body.name).toBe('worker');
      expect(body.task).toBe('do stuff');
      expect(body.provider).toBe('claude');
    });

    it('sends cwd as undefined when not provided', async () => {
      const { result } = renderHook(() =>
        useOrchestrator({ apiUrl: 'http://localhost:3456', enabled: true }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      mockFetch.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          id: 'agent-1',
          name: 'worker',
          workspaceId: 'ws-1',
          provider: 'claude',
          status: 'running',
          spawnedAt: new Date().toISOString(),
          restartCount: 0,
        }),
      }));

      await act(async () => {
        await result.current.spawnAgent('worker', 'do stuff', 'claude');
      });

      const spawnCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('/agents') &&
          call[1]?.method === 'POST',
      );
      expect(spawnCall).toBeTruthy();

      const body = JSON.parse(spawnCall![1].body as string);
      expect(body.name).toBe('worker');
      // cwd should not be set (undefined serializes away in JSON.stringify)
      expect(body.cwd).toBeUndefined();
    });
  });
});
