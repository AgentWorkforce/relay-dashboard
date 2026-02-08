import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useWsStore } from '@/hooks/useWebSocket';
import ConnectionStatus from '@/components/ConnectionStatus';

// Mock next/navigation for any transitive imports
vi.mock('next/navigation', () => ({
  useParams: () => ({ name: 'general' }),
  usePathname: () => '/channels/general',
}));

describe('ConnectionStatus', () => {
  it('shows Connected when status is connected', () => {
    useWsStore.setState({ status: 'connected' });
    render(<ConnectionStatus />);
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('shows Connecting... when status is connecting', () => {
    useWsStore.setState({ status: 'connecting' });
    render(<ConnectionStatus />);
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  it('shows Disconnected when status is disconnected', () => {
    useWsStore.setState({ status: 'disconnected' });
    render(<ConnectionStatus />);
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });
});
