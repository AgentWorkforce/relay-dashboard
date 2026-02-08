import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetchWorkspaceStats: vi.fn(),
  fetchActivity: vi.fn(),
  fetchAgents: vi.fn(),
  validateApiKey: vi.fn(),
  logout: vi.fn(),
}));

const storeState = {
  apiKey: 'rk_test_key',
  agentToken: 'at_test',
  workspace: { name: 'Test WS', plan: 'Pro' },
  setAuth: vi.fn(),
  logout: mocks.logout,
};

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: (sel?: (s: Record<string, unknown>) => unknown) =>
    sel ? sel(storeState) : storeState,
  useChannelStore: (sel?: (s: Record<string, unknown>) => unknown) => {
    const state = { channels: [], setChannels: vi.fn() };
    return sel ? sel(state) : state;
  },
  useThreadStore: (sel?: (s: Record<string, unknown>) => unknown) => {
    const state = { parentMessage: null };
    return sel ? sel(state) : state;
  },
}));

vi.mock('@/lib/relay', () => ({
  fetchWorkspaceStats: mocks.fetchWorkspaceStats,
  fetchActivity: mocks.fetchActivity,
  fetchAgents: mocks.fetchAgents,
  validateApiKey: mocks.validateApiKey,
  fetchChannels: vi.fn().mockResolvedValue([]),
  fetchDmConversations: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(),
  useWsStore: (sel?: (s: Record<string, unknown>) => unknown) => {
    const state = { status: 'connected', setStatus: vi.fn() };
    return sel ? sel(state) : state;
  },
}));

vi.mock('@/components/SearchModal', () => ({
  default: () => null,
}));

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateApiKey.mockResolvedValue({ name: 'Test WS' });
    mocks.fetchWorkspaceStats.mockResolvedValue({
      total_agents: 5,
      online_agents: 3,
      total_channels: 4,
      messages_today: 120,
      active_conversations: 7,
    });
    mocks.fetchActivity.mockResolvedValue([
      {
        type: 'message',
        id: '1',
        channel_name: 'general',
        agent_name: 'Bot-1',
        text: 'Hello world',
        created_at: new Date().toISOString(),
      },
    ]);
    mocks.fetchAgents.mockResolvedValue([
      { name: 'Bot-1', type: 'ai', status: 'online' },
      { name: 'Bot-2', type: 'ai', status: 'offline' },
    ]);
  });

  it('renders workspace name and plan', async () => {
    const { default: OverviewPage } = await import('@/app/page');
    render(<OverviewPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Test WS').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Pro plan')).toBeInTheDocument();
  });

  it('displays stat cards with fetched data', async () => {
    const { default: OverviewPage } = await import('@/app/page');
    render(<OverviewPage />);
    await waitFor(() => {
      expect(screen.getByText('3 / 5')).toBeInTheDocument();
    });
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('renders activity feed items', async () => {
    const { default: OverviewPage } = await import('@/app/page');
    render(<OverviewPage />);
    await waitFor(() => {
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
  });

  it('shows agent grid with status dots', async () => {
    const { default: OverviewPage } = await import('@/app/page');
    render(<OverviewPage />);
    await waitFor(() => {
      expect(screen.getByText('Bot-2')).toBeInTheDocument();
    });
  });
});
