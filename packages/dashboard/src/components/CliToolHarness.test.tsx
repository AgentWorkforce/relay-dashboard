/**
 * Tests for CliToolHarness
 *
 * Covers:
 * - Launching a real tool harness flow (spawn -> log viewer input path)
 * - Releasing tool session
 * - Error handling on launch failure
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CliToolHarness, type CliToolHarnessConfig } from './CliToolHarness';
import { api } from '../lib/api';

vi.mock('./XTermLogViewer', () => ({
  XTermLogViewer: ({ agentName }: { agentName: string }) => (
    <div data-testid="xterm-log-viewer">{agentName}</div>
  ),
}));

const TOOL: CliToolHarnessConfig = {
  id: 'claude',
  name: 'Claude',
  command: 'claude',
  description: 'Test harness entry',
};

describe('CliToolHarness', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('launches a CLI tool and renders a log viewer with the spawned agent', async () => {
    const spawnSpy = vi
      .spyOn(api, 'spawnAgent')
      .mockResolvedValue({ success: true, name: 'claude-tool-1' });
    const releaseSpy = vi
      .spyOn(api, 'releaseAgent')
      .mockResolvedValue({ success: true });

    render(<CliToolHarness tool={TOOL} nameGenerator={() => 'claude-tool-1'} />);

    fireEvent.click(screen.getByRole('button', { name: 'Launch Claude' }));

    await waitFor(() => {
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy).toHaveBeenCalledWith({
        name: 'claude-tool-1',
        cli: 'claude',
        task: undefined,
      });
      expect(screen.getByTestId('xterm-log-viewer')).toHaveTextContent('claude-tool-1');
      expect(screen.getByRole('button', { name: 'Stop Claude' })).toBeTruthy();
    });

    expect(screen.getByText('Claude')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop Claude' }));

    await waitFor(() => {
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(releaseSpy).toHaveBeenCalledWith('claude-tool-1');
    });
  });

  it('shows a friendly error message when launch fails', async () => {
    vi
      .spyOn(api, 'spawnAgent')
      .mockResolvedValue({ success: false, name: 'ignored', error: 'Tool unavailable' });

    render(<CliToolHarness tool={TOOL} />);

    fireEvent.click(screen.getByRole('button', { name: 'Launch Claude' }));

    expect(await screen.findByText('Tool unavailable')).toBeTruthy();
    expect(screen.queryByTestId('xterm-log-viewer')).toBeNull();
  });
});
