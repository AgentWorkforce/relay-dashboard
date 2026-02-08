import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '@/app/login/page';

const mocks = vi.hoisted(() => ({
  validateApiKey: vi.fn(),
  registerHumanAgent: vi.fn(),
  rotateToken: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock('@/lib/relay', () => ({
  validateApiKey: mocks.validateApiKey,
  registerHumanAgent: mocks.registerHumanAgent,
  rotateToken: mocks.rotateToken,
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setAuth: mocks.setAuth }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error mock
    delete window.location;
    // @ts-expect-error mock
    window.location = { href: '' };
  });

  it('renders the login form', () => {
    render(<LoginPage />);
    expect(screen.getByText('Relaycast')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('rk_live_...')).toBeInTheDocument();
    expect(screen.getByText('Connect')).toBeInTheDocument();
  });

  it('disables button when input is empty', () => {
    render(<LoginPage />);
    const btn = screen.getByText('Connect');
    expect(btn).toBeDisabled();
  });

  it('shows error on invalid API key', async () => {
    mocks.validateApiKey.mockRejectedValue(new Error('Invalid API key'));

    render(<LoginPage />);
    const input = screen.getByPlaceholderText('rk_live_...');
    const btn = screen.getByText('Connect');

    fireEvent.change(input, { target: { value: 'bad_key' } });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid API key');
    });
  });

  it('redirects on successful login', async () => {
    mocks.validateApiKey.mockResolvedValue({ name: 'TestWS', plan: 'free' });
    mocks.registerHumanAgent.mockResolvedValue({
      name: 'Human',
      token: 'at_test_token',
    });

    render(<LoginPage />);
    const input = screen.getByPlaceholderText('rk_live_...');

    fireEvent.change(input, { target: { value: 'rk_test_valid' } });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(mocks.setAuth).toHaveBeenCalledWith(
        'rk_test_valid',
        'at_test_token',
        { name: 'TestWS', plan: 'free' },
      );
      expect(window.location.href).toBe('/');
    });
  });

  it('rotates token when human agent already exists', async () => {
    mocks.validateApiKey.mockResolvedValue({ name: 'TestWS' });
    mocks.registerHumanAgent.mockRejectedValue(
      new Error('Agent already exists'),
    );
    mocks.rotateToken.mockResolvedValue({
      name: 'Human',
      token: 'at_test_rotated',
    });

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('rk_live_...'), {
      target: { value: 'rk_test_valid' },
    });
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => {
      expect(mocks.rotateToken).toHaveBeenCalledWith('rk_test_valid', 'Human');
      expect(mocks.setAuth).toHaveBeenCalledWith(
        'rk_test_valid',
        'at_test_rotated',
        { name: 'TestWS', plan: undefined },
      );
    });
  });
});
