/**
 * Tests for AgentCard component
 *
 * Covers: CLI type display, model display in compact view,
 * and action button rendering.
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AgentCard } from './AgentCard';
import type { Agent } from '../types';

afterEach(() => {
  cleanup();
});

function makeAgent(name: string, overrides: Partial<Agent> = {}): Agent {
  return {
    name,
    status: 'online',
    ...overrides,
  };
}

describe('AgentCard', () => {
  describe('compact view - CLI type', () => {
    it('shows agent CLI type when available', () => {
      const agent = makeAgent('backend-api', { cli: 'claude' });
      render(<AgentCard agent={agent} compact />);
      expect(screen.getByText('claude')).toBeTruthy();
    });

    it('shows codex CLI type', () => {
      const agent = makeAgent('worker-1', { cli: 'codex' });
      render(<AgentCard agent={agent} compact />);
      expect(screen.getByText('codex')).toBeTruthy();
    });

    it('does not show CLI line when cli is not set', () => {
      const agent = makeAgent('backend-api');
      const { container } = render(<AgentCard agent={agent} compact />);
      // Should not have the CLI text span (font-mono opacity-70)
      const cliSpans = container.querySelectorAll('.font-mono.opacity-70');
      expect(cliSpans.length).toBe(0);
    });
  });

  describe('compact view - model display', () => {
    it('shows model from agent.model', () => {
      const agent = makeAgent('backend-api', { model: 'claude-sonnet-4-5-20250929' });
      render(<AgentCard agent={agent} compact />);
      expect(screen.getByText('claude-sonnet-4-5-20250929')).toBeTruthy();
    });

    it('shows model from agent.profile.model as fallback', () => {
      const agent = makeAgent('backend-api', {
        profile: { model: 'gpt-5.2-codex' },
      });
      render(<AgentCard agent={agent} compact />);
      expect(screen.getByText('gpt-5.2-codex')).toBeTruthy();
    });

    it('prefers agent.model over profile.model', () => {
      const agent = makeAgent('backend-api', {
        model: 'claude-sonnet-4-5-20250929',
        profile: { model: 'old-model' },
      });
      render(<AgentCard agent={agent} compact />);
      expect(screen.getByText('claude-sonnet-4-5-20250929')).toBeTruthy();
      expect(screen.queryByText('old-model')).toBeNull();
    });

    it('does not show model line when no model set', () => {
      const agent = makeAgent('backend-api');
      render(<AgentCard agent={agent} compact />);
      const modelSpan = screen.queryByTitle(/Model:/);
      expect(modelSpan).toBeNull();
    });
  });

  describe('compact view - action buttons', () => {
    it('renders pin button when onPinToggle provided', () => {
      const agent = makeAgent('backend-api');
      render(<AgentCard agent={agent} compact onPinToggle={vi.fn()} />);
      expect(screen.getByTitle('Pin to top')).toBeTruthy();
    });

    it('renders profile button when onProfileClick provided', () => {
      const agent = makeAgent('backend-api');
      render(<AgentCard agent={agent} compact onProfileClick={vi.fn()} />);
      expect(screen.getByTitle('View profile')).toBeTruthy();
    });

    it('renders logs button when onLogsClick provided', () => {
      const agent = makeAgent('backend-api');
      render(<AgentCard agent={agent} compact onLogsClick={vi.fn()} />);
      expect(screen.getByTitle('View logs')).toBeTruthy();
    });

    it('renders logs button even for non-spawned agents', () => {
      const agent = makeAgent('backend-api', { isSpawned: false });
      render(<AgentCard agent={agent} compact onLogsClick={vi.fn()} />);
      expect(screen.getByTitle('View logs')).toBeTruthy();
    });

    it('renders release button for spawned agents', () => {
      const agent = makeAgent('backend-api', { isSpawned: true });
      render(<AgentCard agent={agent} compact onReleaseClick={vi.fn()} />);
      expect(screen.getByTitle('Kill agent')).toBeTruthy();
    });

    it('does not render release for non-spawned agents', () => {
      const agent = makeAgent('backend-api', { isSpawned: false });
      render(
        <AgentCard
          agent={agent}
          compact
          onReleaseClick={vi.fn()}
        />
      );
      expect(screen.queryByTitle('Kill agent')).toBeNull();
    });
  });

  describe('full view - model display', () => {
    it('shows model badge in full view', () => {
      const agent = makeAgent('backend-api', { model: 'haiku' });
      render(<AgentCard agent={agent} />);
      expect(screen.getByTitle('Model: haiku')).toBeTruthy();
    });
  });
});
