import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  updateWorkspace: vi.fn(),
  fetchSystemPrompt: vi.fn(),
  updateSystemPrompt: vi.fn(),
  validateApiKey: vi.fn(),
  setAuth: vi.fn(),
  logout: vi.fn(),
}));

const storeState = {
  apiKey: 'rk_test_key',
  agentToken: 'at_test',
  workspace: { name: 'My Workspace' },
  setAuth: mocks.setAuth,
  logout: mocks.logout,
};

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/settings'),
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
  updateWorkspace: mocks.updateWorkspace,
  fetchSystemPrompt: mocks.fetchSystemPrompt,
  updateSystemPrompt: mocks.updateSystemPrompt,
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

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateApiKey.mockResolvedValue({ name: 'My Workspace' });
    mocks.fetchSystemPrompt.mockResolvedValue({ prompt: 'You are helpful.' });
    mocks.updateWorkspace.mockResolvedValue({ name: 'New Name' });
    mocks.updateSystemPrompt.mockResolvedValue(undefined);
  });

  it('renders settings heading', async () => {
    const { default: SettingsPage } = await import('@/app/settings/page');
    render(<SettingsPage />);
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { name: 'Settings' });
      expect(headings.length).toBe(1);
    });
  });

  it('shows workspace name in input', async () => {
    const { default: SettingsPage } = await import('@/app/settings/page');
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('My Workspace')).toBeInTheDocument();
    });
  });

  it('saves workspace name on click', async () => {
    const { default: SettingsPage } = await import('@/app/settings/page');
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('My Workspace')).toBeInTheDocument();
    });
    const input = screen.getByDisplayValue('My Workspace');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(mocks.updateWorkspace).toHaveBeenCalledWith('rk_test_key', {
        name: 'New Name',
      });
    });
  });

  it('loads and displays system prompt', async () => {
    const { default: SettingsPage } = await import('@/app/settings/page');
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('You are helpful.')).toBeInTheDocument();
    });
  });

  it('has link to billing page', async () => {
    const { default: SettingsPage } = await import('@/app/settings/page');
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('Manage billing and usage')).toBeInTheDocument();
    });
    const link = screen.getByText('Manage billing and usage');
    expect(link).toHaveAttribute('href', '/settings/billing');
  });
});

