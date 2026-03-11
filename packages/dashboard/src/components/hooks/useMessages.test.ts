// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessages } from './useMessages';

const mockSendMessage = vi.fn();

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
};

vi.mock('../../lib/api', () => ({
  api: {
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  },
}));

describe('useMessages', () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    mockSendMessage.mockReset();
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal('localStorage', localStorageMock);
  });

  it('keeps optimistic messages in sending status after successful send', async () => {
    mockSendMessage.mockResolvedValue({ success: true });
    const baseMessages: Parameters<typeof useMessages>[0]['messages'] = [];

    const { result } = renderHook(() =>
      useMessages({
        messages: baseMessages,
        senderName: 'Dashboard',
      })
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.sendMessage('Lead', 'hello world');
    });

    expect(ok).toBe(true);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.status).toBe('sending');
    expect(result.current.messages[0]?.to).toBe('Lead');
  });

  it('uses canonical message id from send response when available', async () => {
    mockSendMessage.mockResolvedValue({ success: true, data: { messageId: 'evt_123' } });
    const baseMessages: Parameters<typeof useMessages>[0]['messages'] = [];

    const { result } = renderHook(() =>
      useMessages({
        messages: baseMessages,
        senderName: 'Dashboard',
      })
    );

    await act(async () => {
      await result.current.sendMessage('Lead', 'hello world');
    });

    expect(result.current.messages[0]?.id).toBe('evt_123');
    expect(result.current.messages[0]?.status).toBe('sending');
  });

  it('removes optimistic message and surfaces error on failed send', async () => {
    mockSendMessage.mockResolvedValue({ success: false, error: 'send failed' });
    const baseMessages: Parameters<typeof useMessages>[0]['messages'] = [];

    const { result } = renderHook(() =>
      useMessages({
        messages: baseMessages,
        senderName: 'Dashboard',
      })
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.sendMessage('Lead', 'hello world');
    });

    expect(ok).toBe(false);
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.sendError).toBe('send failed');
  });

  it('hides third-party private DMs from the selected agent feed', () => {
    const baseMessages: Parameters<typeof useMessages>[0]['messages'] = [
      {
        id: 'viewer-to-lead',
        from: 'khaliqgant',
        to: 'Lead',
        content: 'Need an update',
        timestamp: '2026-03-11T10:00:00.000Z',
      },
      {
        id: 'lead-to-viewer',
        from: 'Lead',
        to: 'khaliqgant',
        content: 'On it',
        timestamp: '2026-03-11T10:01:00.000Z',
      },
      {
        id: 'lead-to-fixer',
        from: 'Lead',
        to: 'Fixer',
        content: 'Private handoff',
        timestamp: '2026-03-11T10:02:00.000Z',
      },
      {
        id: 'fixer-to-lead',
        from: 'Fixer',
        to: 'Lead',
        content: 'Sending private notes',
        timestamp: '2026-03-11T10:03:00.000Z',
      },
      {
        id: 'lead-broadcast',
        from: 'Lead',
        to: '*',
        content: 'Broadcast update',
        timestamp: '2026-03-11T10:04:00.000Z',
        isBroadcast: true,
      },
    ];

    const { result } = renderHook(() =>
      useMessages({
        messages: baseMessages,
        currentChannel: 'Lead',
        senderName: 'khaliqgant',
      })
    );

    expect(result.current.messages.map((message) => message.id)).toEqual([
      'viewer-to-lead',
      'lead-to-viewer',
      'lead-broadcast',
    ]);
  });

  it('keeps legacy Dashboard messages visible for local project conversations', () => {
    localStorage.setItem('relay_username', 'relay-dashboard');

    const baseMessages: Parameters<typeof useMessages>[0]['messages'] = [
      {
        id: 'dashboard-to-lead',
        from: 'Dashboard',
        to: 'Lead',
        content: 'Please investigate',
        timestamp: '2026-03-11T10:00:00.000Z',
      },
      {
        id: 'lead-to-dashboard',
        from: 'Lead',
        to: 'Dashboard',
        content: 'Looking now',
        timestamp: '2026-03-11T10:01:00.000Z',
      },
      {
        id: 'lead-to-fixer',
        from: 'Lead',
        to: 'Fixer',
        content: 'Private follow-up',
        timestamp: '2026-03-11T10:02:00.000Z',
      },
    ];

    const { result } = renderHook(() =>
      useMessages({
        messages: baseMessages,
        currentChannel: 'Lead',
        senderName: 'relay-dashboard',
      })
    );

    expect(result.current.messages.map((message) => message.id)).toEqual([
      'dashboard-to-lead',
      'lead-to-dashboard',
    ]);
  });
});
