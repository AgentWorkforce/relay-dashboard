/**
 * Tests for AgentList component
 *
 * Covers: collapse all/expand all behavior, solo agent rendering,
 * and group display logic.
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentList } from './AgentList';
import type { Agent } from '../types';

function makeAgent(name: string, overrides: Partial<Agent> = {}): Agent {
  return {
    name,
    status: 'online',
    ...overrides,
  };
}

describe('AgentList', () => {
  describe('empty states', () => {
    it('shows empty message when no agents', () => {
      render(<AgentList agents={[]} />);
      expect(screen.getByText('No agents connected')).toBeTruthy();
    });

    it('shows search empty message when no agents match query', () => {
      const agents = [makeAgent('backend-api')];
      render(<AgentList agents={agents} searchQuery="zzz" />);
      expect(screen.getByText(/No agents match/)).toBeTruthy();
    });
  });

  describe('Collapse all / Expand all', () => {
    const agents = [
      makeAgent('backend-api'),
      makeAgent('backend-db'),
      makeAgent('frontend-ui'),
      makeAgent('frontend-components'),
    ];

    it('shows agent count in header', () => {
      render(<AgentList agents={agents} />);
      expect(screen.getByText('4 agents')).toBeTruthy();
    });

    it('shows Collapse all button by default', () => {
      render(<AgentList agents={agents} />);
      expect(screen.getByText('Collapse all')).toBeTruthy();
    });

    it('hides all agent cards when Collapse all is clicked', () => {
      render(<AgentList agents={agents} />);

      // Groups should be visible initially
      expect(screen.getByText('Backend')).toBeTruthy();
      expect(screen.getByText('Frontend')).toBeTruthy();

      fireEvent.click(screen.getByText('Collapse all'));

      // After collapse, groups should be hidden entirely
      expect(screen.queryByText('Backend')).toBeNull();
      expect(screen.queryByText('Frontend')).toBeNull();
    });

    it('shows Expand all button after collapsing', () => {
      render(<AgentList agents={agents} />);
      fireEvent.click(screen.getByText('Collapse all'));
      expect(screen.getByText('Expand all')).toBeTruthy();
    });

    it('still shows agent count when collapsed', () => {
      render(<AgentList agents={agents} />);
      fireEvent.click(screen.getByText('Collapse all'));
      expect(screen.getByText('4 agents')).toBeTruthy();
    });

    it('restores all groups when Expand all is clicked after collapse', () => {
      render(<AgentList agents={agents} />);

      fireEvent.click(screen.getByText('Collapse all'));
      expect(screen.queryByText('Backend')).toBeNull();

      fireEvent.click(screen.getByText('Expand all'));
      expect(screen.getByText('Backend')).toBeTruthy();
      expect(screen.getByText('Frontend')).toBeTruthy();
    });

    it('hides pinned agents section when collapsed', () => {
      render(
        <AgentList
          agents={agents}
          pinnedAgents={['backend-api']}
        />
      );

      expect(screen.getByText('Pinned')).toBeTruthy();

      fireEvent.click(screen.getByText('Collapse all'));
      expect(screen.queryByText('Pinned')).toBeNull();
    });
  });

  describe('solo agent rendering', () => {
    it('renders solo agent without group header', () => {
      // "Lead" agent with prefix "lead" and only one agent in group
      const agents = [
        makeAgent('Lead'),
        makeAgent('backend-api'),
        makeAgent('backend-db'),
      ];

      render(<AgentList agents={agents} />);

      // "Backend" should appear as a group header
      expect(screen.getByText('Backend')).toBeTruthy();
      // "Lead" should render as a standalone card (name appears in display + subtitle)
      expect(screen.getAllByText('Lead').length).toBeGreaterThan(0);
    });
  });

  describe('filters out system agents', () => {
    it('filters out __setup__ agents', () => {
      const agents = [
        makeAgent('__setup__google'),
        makeAgent('backend-api'),
      ];

      render(<AgentList agents={agents} />);
      // Should only count the non-setup agent
      expect(screen.getByText('1 agent')).toBeTruthy();
    });

    it('filters out Dashboard agent', () => {
      const agents = [
        makeAgent('Dashboard'),
        makeAgent('backend-api'),
      ];

      render(<AgentList agents={agents} />);
      expect(screen.getByText('1 agent')).toBeTruthy();
    });
  });
});
