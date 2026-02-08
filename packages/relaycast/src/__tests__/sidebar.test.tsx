import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RelaycastSidebar from '@/components/RelaycastSidebar';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  setChannels: vi.fn(),
  setActiveChannel: vi.fn(),
  fetchChannels: vi.fn(),
  fetchDmConversations: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: () => ({
    apiKey: 'rk_test_key',
    agentToken: 'at_test_token',
    workspace: { name: 'Test Workspace' },
    logout: mocks.logout,
  }),
  useChannelStore: () => ({
    channels: [
      { name: 'general', topic: 'General' },
      { name: 'code-review', topic: 'Reviews' },
    ],
    activeChannel: 'general',
    setChannels: mocks.setChannels,
    setActiveChannel: mocks.setActiveChannel,
  }),
}));

vi.mock('@/lib/relay', () => ({
  fetchChannels: mocks.fetchChannels.mockResolvedValue([]),
  fetchDmConversations: mocks.fetchDmConversations.mockResolvedValue([]),
}));

describe('RelaycastSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error mock
    delete window.location;
    // @ts-expect-error mock
    window.location = { href: '' };
  });

  it('renders workspace name', () => {
    render(<RelaycastSidebar />);
    expect(screen.getByText('Test Workspace')).toBeInTheDocument();
  });

  it('renders channel list with # prefix', () => {
    render(<RelaycastSidebar />);
    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('code-review')).toBeInTheDocument();
  });

  it('highlights active channel', () => {
    render(<RelaycastSidebar />);
    const generalBtn = screen.getByText('general').closest('button');
    expect(generalBtn?.className).toContain('accent');
  });

  it('clicking channel calls setActiveChannel', () => {
    render(<RelaycastSidebar />);
    fireEvent.click(screen.getByText('code-review'));
    expect(mocks.setActiveChannel).toHaveBeenCalledWith('code-review');
  });

  it('renders navigation links', () => {
    render(<RelaycastSidebar />);
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('logout clears state and redirects', () => {
    render(<RelaycastSidebar />);
    fireEvent.click(screen.getByText('Log out'));
    expect(mocks.logout).toHaveBeenCalled();
    expect(window.location.href).toBe('/login');
  });
});
