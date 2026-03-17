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
import { DashboardConfigProvider } from '../adapters';

const MOCK_WORKSPACE_ID = '12345678-1234-1234-1234-123456789012';

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

type SpawnModalOverrides = Partial<React.ComponentProps<typeof SpawnModal>> & {
  isCloudMode?: boolean;
};

function renderSpawnModal(overrides: SpawnModalOverrides = {}) {
  const { isCloudMode = false, ...spawnModalOverrides } = overrides;
  const defaultProps: React.ComponentProps<typeof SpawnModal> = {
    isOpen: true,
    onClose: vi.fn(),
    onSpawn: vi.fn().mockResolvedValue(true),
    existingAgents: [],
    ...spawnModalOverrides,
  };
  return {
    ...render(
      <DashboardConfigProvider config={{ features: { workspaces: isCloudMode } }}>
        <SpawnModal {...defaultProps} />
      </DashboardConfigProvider>
    ),
    props: defaultProps,
  };
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

  describe('resume previous session', () => {
    it('includes continueFrom when toggle is enabled', async () => {
      const onSpawn = vi.fn().mockResolvedValue(true);
      renderSpawnModal({ onSpawn });

      // Enable the resume toggle
      const resumeSection = screen.getByText('Resume Previous Session');
      const toggle = resumeSection.closest('div')?.parentElement?.querySelector('button[aria-pressed]');
      if (toggle) fireEvent.click(toggle);

      fireEvent.submit(getForm());

      await waitFor(() => {
        expect(onSpawn).toHaveBeenCalled();
      });

      const config = onSpawn.mock.calls[0][0];
      expect(config.continueFrom).toBe('claude-1'); // default suggested name
    });

    it('does not include continueFrom when toggle is disabled', async () => {
      const onSpawn = vi.fn().mockResolvedValue(true);
      renderSpawnModal({ onSpawn });

      fireEvent.submit(getForm());

      await waitFor(() => {
        expect(onSpawn).toHaveBeenCalled();
      });

      const config = onSpawn.mock.calls[0][0];
      expect(config.continueFrom).toBeUndefined();
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

  describe('model selection', () => {
    it('falls back to a supported Codex model and applies the default reasoning effort override', async () => {
      const onSpawn = vi.fn().mockResolvedValue(true);

      renderSpawnModal({
        onSpawn,
        agentDefaults: {
          defaultCliType: 'codex',
          defaultModels: {
            codex: 'gpt-5.1-codex-mini',
          },
        },
        modelOptions: {
          codex: [
            {
              value: 'gpt-5.4',
              label: 'GPT-5.4',
              reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
              defaultReasoningEffort: 'xhigh',
            },
            {
              value: 'gpt-5.1-codex-max',
              label: 'GPT-5.1 Codex Max',
              reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
              defaultReasoningEffort: 'xhigh',
            },
          ],
        },
        registryDefaultModels: {
          codex: 'gpt-5.4',
        },
      });

      const modelSelect = await screen.findByLabelText('Model') as HTMLSelectElement;
      expect(modelSelect.value).toBe('gpt-5.4');

      fireEvent.submit(getForm());

      await waitFor(() => {
        expect(onSpawn).toHaveBeenCalled();
      });

      const config = onSpawn.mock.calls[0][0];
      expect(config.command).toBe('codex --model gpt-5.4 -c model_reasoning_effort="xhigh"');
    });

    it('applies the Codex mini reasoning effort override when mini is selected', async () => {
      const onSpawn = vi.fn().mockResolvedValue(true);

      renderSpawnModal({
        onSpawn,
        agentDefaults: {
          defaultCliType: 'codex',
          defaultModels: {
            codex: 'gpt-5.1-codex-mini',
          },
        },
        modelOptions: {
          codex: [
            {
              value: 'gpt-5.1-codex-mini',
              label: 'GPT-5.1 Codex Mini',
              reasoningEfforts: ['medium', 'high'],
              defaultReasoningEffort: 'high',
            },
            {
              value: 'gpt-5.4',
              label: 'GPT-5.4',
              reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
              defaultReasoningEffort: 'xhigh',
            },
          ],
        },
        registryDefaultModels: {
          codex: 'gpt-5.4',
        },
      });

      const modelSelect = await screen.findByLabelText('Model') as HTMLSelectElement;
      expect(modelSelect.value).toBe('gpt-5.1-codex-mini');

      fireEvent.submit(getForm());

      await waitFor(() => {
        expect(onSpawn).toHaveBeenCalled();
      });

      const config = onSpawn.mock.calls[0][0];
      expect(config.command).toBe('codex --model gpt-5.1-codex-mini -c model_reasoning_effort="high"');
    });

    it('falls back to a supported OpenCode model when a saved default is no longer offered', async () => {
      const onSpawn = vi.fn().mockResolvedValue(true);

      renderSpawnModal({
        onSpawn,
        agentDefaults: {
          defaultCliType: 'opencode',
          defaultModels: {
            opencode: 'openai/gpt-5.1-codex',
          },
        },
        modelOptions: {
          opencode: [
            { value: 'openai/gpt-5.2', label: 'GPT-5.2' },
            { value: 'openai/gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
          ],
        },
        registryDefaultModels: {
          opencode: 'openai/gpt-5.2',
        },
      });

      const modelSelect = await screen.findByLabelText('Model') as HTMLSelectElement;
      expect(modelSelect.value).toBe('openai/gpt-5.2');

      fireEvent.submit(getForm());

      await waitFor(() => {
        expect(onSpawn).toHaveBeenCalled();
      });

      const config = onSpawn.mock.calls[0][0];
      expect(config.command).toBe('opencode --model openai/gpt-5.2');
    });
  });
});
