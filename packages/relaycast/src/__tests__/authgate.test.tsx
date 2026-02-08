import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AuthGate from '@/components/AuthGate';

const mocks = vi.hoisted(() => ({
  apiKey: null as string | null,
  logout: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: () => ({
    apiKey: mocks.apiKey,
    logout: mocks.logout,
  }),
}));

vi.mock('@/lib/relay', () => ({
  validateApiKey: mocks.validateApiKey,
}));

describe('AuthGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiKey = null;
    // @ts-expect-error mock
    delete window.location;
    // @ts-expect-error mock
    window.location = { href: '' };
  });

  it('redirects to /login when no API key', () => {
    mocks.apiKey = null;
    render(
      <AuthGate>
        <div>Protected</div>
      </AuthGate>,
    );
    expect(window.location.href).toBe('/login');
  });

  it('shows loading while validating', () => {
    mocks.apiKey = 'rk_test_key';
    mocks.validateApiKey.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <AuthGate>
        <div>Protected</div>
      </AuthGate>,
    );
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders children when valid key', async () => {
    mocks.apiKey = 'rk_test_key';
    mocks.validateApiKey.mockResolvedValue({ name: 'WS' });
    render(
      <AuthGate>
        <div>Protected</div>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByText('Protected')).toBeInTheDocument();
    });
  });

  it('logs out and redirects on invalid key', async () => {
    mocks.apiKey = 'rk_test_bad';
    mocks.validateApiKey.mockRejectedValue(new Error('Unauthorized'));
    render(
      <AuthGate>
        <div>Protected</div>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(mocks.logout).toHaveBeenCalled();
      expect(window.location.href).toBe('/login');
    });
  });
});
