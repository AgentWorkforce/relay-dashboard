// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessages } from './useMessages';

const mockSendMessage = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  },
}));

describe('useMessages', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
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
});
