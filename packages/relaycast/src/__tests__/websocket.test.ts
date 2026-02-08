import { describe, it, expect, beforeEach } from 'vitest';
import { useWsStore } from '@/hooks/useWebSocket';

describe('useWsStore', () => {
  beforeEach(() => {
    useWsStore.setState({ status: 'disconnected' });
  });

  it('initializes with disconnected status', () => {
    expect(useWsStore.getState().status).toBe('disconnected');
  });

  it('updates to connecting', () => {
    useWsStore.getState().setStatus('connecting');
    expect(useWsStore.getState().status).toBe('connecting');
  });

  it('updates to connected', () => {
    useWsStore.getState().setStatus('connected');
    expect(useWsStore.getState().status).toBe('connected');
  });

  it('transitions through connection lifecycle', () => {
    const store = useWsStore.getState();
    store.setStatus('connecting');
    expect(useWsStore.getState().status).toBe('connecting');

    store.setStatus('connected');
    expect(useWsStore.getState().status).toBe('connected');

    store.setStatus('disconnected');
    expect(useWsStore.getState().status).toBe('disconnected');
  });
});
