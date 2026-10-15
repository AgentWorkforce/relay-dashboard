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

const effortModels = { claude: [
  { value: 'claude-opus-4-6', label: 'Opus 4.6', reasoningEfforts: ['high', 'max'] },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5', reasoningEfforts: [] },
] };

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

  it('clears effort when switching to a model that cannot use it', async () => {
    const { props } = renderSpawnModal({ modelOptions: effortModels });
    fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: 'max' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-haiku-4-5' } });
    expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.submit(getForm());
    await waitFor(() => expect(props.onSpawn).toHaveBeenCalled());
    expect(vi.mocked(props.onSpawn).mock.calls[0][0].reasoningEffort).toBeUndefined();
  });

  it('does not offer effort for a host that cannot carry it', async () => {
    const { props } = renderSpawnModal({ modelOptions: effortModels, supportsReasoningEffort: false });
    expect(screen.queryByLabelText('Reasoning effort')).toBeNull();
    fireEvent.submit(getForm());
    await waitFor(() => expect(props.onSpawn).toHaveBeenCalled());
    expect(vi.mocked(props.onSpawn).mock.calls[0][0].reasoningEffort).toBeUndefined();
  });

  it('resets effort when reopened and validates refreshed model metadata', async () => {
    const { props, rerender } = renderSpawnModal({ modelOptions: effortModels });
    fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: 'max' } });
    rerender(<DashboardConfigProvider><SpawnModal {...props} modelOptions={{ claude: [{ ...effortModels.claude[0], reasoningEfforts: ['high'] }] }} /></DashboardConfigProvider>);
    expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).value).toBe('');
    rerender(<DashboardConfigProvider><SpawnModal {...props} modelOptions={effortModels} /></DashboardConfigProvider>);
    expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).value).toBe('');
    rerender(<DashboardConfigProvider><SpawnModal {...props} isOpen={false} /></DashboardConfigProvider>);
    rerender(<DashboardConfigProvider><SpawnModal {...props} /></DashboardConfigProvider>);
    expect((screen.getByLabelText('Reasoning effort') as HTMLSelectElement).value).toBe('');
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
    it('falls back to a supported Codex model without silently overriding CLI effort', async () => {
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
      expect(config.command).toBe('codex --model gpt-5.4');
      expect(config.reasoningEffort).toBeUndefined();
    });

    it('carries an explicitly selected Codex effort separately from the command', async () => {
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

      fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: 'high' } });

      fireEvent.submit(getForm());

      await waitFor(() => {
        expect(onSpawn).toHaveBeenCalled();
      });

      const config = onSpawn.mock.calls[0][0];
      expect(config.command).toBe('codex --model gpt-5.1-codex-mini');
      expect(config.reasoningEffort).toBe('high');
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
