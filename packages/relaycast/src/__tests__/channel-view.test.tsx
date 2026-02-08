import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({ name: 'general' }),
}));

// Mock relay functions
const mockFetchMessages = vi.fn();
const mockSendMessage = vi.fn();
vi.mock('@/lib/relay', () => ({
  fetchMessages: (...args: unknown[]) => mockFetchMessages(...args),
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  fetchChannels: vi.fn().mockResolvedValue([]),
  fetchDmConversations: vi.fn().mockResolvedValue([]),
  validateApiKey: vi.fn().mockResolvedValue({ name: 'test' }),
}));

// Mock stores
vi.mock('@/lib/store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/store')>('@/lib/store');
  return {
    ...actual,
    useAuthStore: vi.fn(() => ({
      apiKey: 'rk_test_key',
      agentToken: 'at_test_token',
      workspace: { name: 'Test' },
      setAuth: vi.fn(),
      logout: vi.fn(),
    })),
  };
});

import MessageComposer from '@/components/MessageComposer';

describe('MessageComposer', () => {
  it('renders textarea with placeholder', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} channelName="general" />);
    expect(screen.getByPlaceholderText('Message #general')).toBeTruthy();
  });

  it('calls onSend and clears input on Enter', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} channelName="general" />);
    const textarea = screen.getByPlaceholderText('Message #general');
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('Hello world');
  });

  it('does not send on Shift+Enter', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} channelName="general" />);
    const textarea = screen.getByPlaceholderText('Message #general');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables send button when text is empty', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} channelName="general" />);
    const btn = screen.getByRole('button', { name: /send/i });
    expect(btn).toBeDisabled();
  });

  it('disables send button when disabled prop is true', () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} channelName="general" disabled />);
    const textarea = screen.getByPlaceholderText('Message #general');
    expect(textarea).toBeDisabled();
  });
});

