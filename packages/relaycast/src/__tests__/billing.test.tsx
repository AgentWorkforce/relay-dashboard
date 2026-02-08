import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetchBillingUsage: vi.fn(),
  fetchBillingSubscription: vi.fn(),
  createBillingPortal: vi.fn(),
  validateApiKey: vi.fn(),
  logout: vi.fn(),
}));

const storeState = {
  apiKey: 'rk_test_key',
  agentToken: 'at_test',
  workspace: { name: 'Test WS' },
  setAuth: vi.fn(),
  logout: mocks.logout,
};

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/settings/billing'),
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
  fetchBillingUsage: mocks.fetchBillingUsage,
  fetchBillingSubscription: mocks.fetchBillingSubscription,
  createBillingPortal: mocks.createBillingPortal,
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

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateApiKey.mockResolvedValue({ name: 'Test WS' });
    mocks.fetchBillingUsage.mockResolvedValue({
      messages: { used: 500, limit: 10000 },
      agents: { used: 3, limit: 10 },
      storage: { used_mb: 50, limit_mb: 200 },
    });
    mocks.fetchBillingSubscription.mockResolvedValue({
      plan: 'Pro',
      status: 'active',
      current_period_end: '2026-03-01T00:00:00Z',
    });
    mocks.createBillingPortal.mockResolvedValue({
      url: 'https://billing.stripe.com/session',
    });
  });

  it('renders billing heading', async () => {
    const { default: BillingPage } = await import(
      '@/app/settings/billing/page'
    );
    render(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText('Billing')).toBeInTheDocument();
    });
  });

  it('displays plan name', async () => {
    const { default: BillingPage } = await import(
      '@/app/settings/billing/page'
    );
    render(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });
  });

  it('shows usage meters', async () => {
    const { default: BillingPage } = await import(
      '@/app/settings/billing/page'
    );
    render(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText('500 / 10000')).toBeInTheDocument();
    });
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
    expect(screen.getByText('50 / 200')).toBeInTheDocument();
  });

  it('shows manage billing button', async () => {
    const { default: BillingPage } = await import(
      '@/app/settings/billing/page'
    );
    render(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText('Manage Billing')).toBeInTheDocument();
    });
  });

  it('opens stripe portal on manage billing click', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { default: BillingPage } = await import(
      '@/app/settings/billing/page'
    );
    render(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText('Manage Billing')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Manage Billing'));
    await waitFor(() => {
      expect(mocks.createBillingPortal).toHaveBeenCalledWith('rk_test_key');
    });
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        'https://billing.stripe.com/session',
        '_blank',
      );
    });
    openSpy.mockRestore();
  });
});
