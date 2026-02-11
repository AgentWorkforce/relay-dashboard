/**
 * Tests for SpawnModal component
 *
 * Covers: repo dropdown in cloud mode, working directory in local mode,
 * cwd derivation from selected repo, and activeRepoId pre-selection.
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SpawnModal } from './SpawnModal';

const MOCK_WORKSPACE_ID = '12345678-1234-1234-1234-123456789012';

// Mock cloudApi to return connected providers so the button is enabled
vi.mock('../lib/cloudApi', () => ({
  cloudApi: {
    getProviders: vi.fn().mockResolvedValue({
      success: true,
      data: {
        providers: [
          { id: 'anthropic', name: 'Claude', displayName: 'Claude', isConnected: true },
          { id: 'codex', name: 'Codex', displayName: 'Codex', isConnected: true },
        ],
      },
    }),
  },
}));

const mockRepos = [
  { id: 'repo-1', githubFullName: 'AgentWorkforce/relay' },
  { id: 'repo-2', githubFullName: 'AgentWorkforce/trajectories' },
  { id: 'repo-3', githubFullName: 'AgentWorkforce/relay-cloud' },
];

function getForm(): HTMLFormElement {
  const form = document.querySelector('form');
  if (!form) throw new Error('Form not found');
  return form;
}

function renderSpawnModal(overrides: Partial<React.ComponentProps<typeof SpawnModal>> = {}) {
  const defaultProps: React.ComponentProps<typeof SpawnModal> = {
    isOpen: true,
    onClose: vi.fn(),
    onSpawn: vi.fn().mockResolvedValue(true),
    existingAgents: [],
    ...overrides,
  };
  return { ...render(<SpawnModal {...defaultProps} />), props: defaultProps };
}

describe('SpawnModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('repo dropdown (cloud mode)', () => {
    it('shows repo dropdown when isCloudMode and repos are provided', () => {
      renderSpawnModal({ isCloudMode: true, repos: mockRepos });
      expect(screen.getByLabelText('Repository')).toBeTruthy();
      expect(screen.queryByLabelText(/Working Directory/)).toBeNull();
    });

    it('lists all repos in the dropdown', () => {
      renderSpawnModal({ isCloudMode: true, repos: mockRepos });
      const select = screen.getByLabelText('Repository') as HTMLSelectElement;
      const options = select.querySelectorAll('option');
      // 3 repos + "All Repositories (Coordinator)" option when repos.length > 1
      expect(options.length).toBe(4);
      expect(options[0].textContent).toBe('All Repositories (Coordinator)');
      expect(options[1].textContent).toBe('AgentWorkforce/relay');
      expect(options[2].textContent).toBe('AgentWorkforce/trajectories');
      expect(options[3].textContent).toBe('AgentWorkforce/relay-cloud');
    });

    it('pre-selects the active repo', async () => {
      renderSpawnModal({
        isCloudMode: true,
        repos: mockRepos,
        activeRepoId: 'repo-2',
      });
      // Wait for useEffect to run and set selectedRepoId
      await waitFor(() => {
        const select = screen.getByLabelText('Repository') as HTMLSelectElement;
        expect(select.value).toBe('repo-2');
      });
    });

    it('defaults to All Repositories when no activeRepoId and multiple repos', () => {
      renderSpawnModal({ isCloudMode: true, repos: mockRepos });
      const select = screen.getByLabelText('Repository') as HTMLSelectElement;
      expect(select.value).toBe('__all__');
    });

    it('derives cwd from selected repo githubFullName on submit', async () => {
      const onSpawn = vi.fn().mockResolvedValue(true);
      renderSpawnModal({
        isCloudMode: true,
        repos: mockRepos,
        activeRepoId: 'repo-2',
        workspaceId: MOCK_WORKSPACE_ID,
        onSpawn,
      });

      // Wait for credential check to resolve and button to be enabled
      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        const spawnBtn = buttons.find((b) => b.textContent?.includes('Spawn Agent'));
        expect(spawnBtn).toBeTruthy();
        expect((spawnBtn as HTMLButtonElement).disabled).toBe(false);
      });

      fireEvent.submit(getForm());

      await waitFor(() => {
        expect(onSpawn).toHaveBeenCalled();
      });

      const config = onSpawn.mock.calls[0][0];
      expect(config.cwd).toBe('trajectories');
    });

    it('allows changing the selected repo', async () => {
      const onSpawn = vi.fn().mockResolvedValue(true);
      renderSpawnModal({
        isCloudMode: true,
        repos: mockRepos,
        activeRepoId: 'repo-1',
        workspaceId: MOCK_WORKSPACE_ID,
        onSpawn,
      });

      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        const spawnBtn = buttons.find((b) => b.textContent?.includes('Spawn Agent'));
        expect((spawnBtn as HTMLButtonElement).disabled).toBe(false);
      });

      const select = screen.getByLabelText('Repository') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'repo-3' } });
      expect(select.value).toBe('repo-3');

      fireEvent.submit(getForm());

      await waitFor(() => {
        expect(onSpawn).toHaveBeenCalled();
      });

      const config = onSpawn.mock.calls[0][0];
      expect(config.cwd).toBe('relay-cloud');
    });
  });

  describe('working directory (local mode)', () => {
    it('shows working directory input when not in cloud mode', () => {
      renderSpawnModal({ isCloudMode: false });
      expect(screen.getByLabelText(/Working Directory/)).toBeTruthy();
      expect(screen.queryByLabelText('Repository')).toBeNull();
    });

    it('shows working directory input when cloud mode but no repos', () => {
      renderSpawnModal({ isCloudMode: true, repos: [] });
      expect(screen.getByLabelText(/Working Directory/)).toBeTruthy();
      expect(screen.queryByLabelText('Repository')).toBeNull();
    });

    it('passes cwd from text input on submit', async () => {
      const onSpawn = vi.fn().mockResolvedValue(true);
      renderSpawnModal({ isCloudMode: false, onSpawn });

      const cwdInput = screen.getByLabelText(/Working Directory/) as HTMLInputElement;
      fireEvent.change(cwdInput, { target: { value: '/custom/path' } });

      fireEvent.submit(getForm());

      await waitFor(() => {
        expect(onSpawn).toHaveBeenCalled();
      });

      const config = onSpawn.mock.calls[0][0];
      expect(config.cwd).toBe('/custom/path');
    });
  });
});
