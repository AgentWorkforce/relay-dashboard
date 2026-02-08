import { describe, it, expect, beforeEach } from 'vitest';
import { useThreadStore } from '@/lib/store';

describe('useThreadStore', () => {
  beforeEach(() => {
    useThreadStore.setState({
      parentMessage: null,
      replies: [],
    });
  });

  it('initializes with null parent and empty replies', () => {
    const state = useThreadStore.getState();
    expect(state.parentMessage).toBeNull();
    expect(state.replies).toEqual([]);
  });

  it('opens a thread with a parent message', () => {
    const msg = {
      id: '1',
      agent_name: 'Alice',
      text: 'Hello',
      created_at: '2026-01-01T00:00:00Z',
    };
    useThreadStore.getState().openThread(msg);

    const state = useThreadStore.getState();
    expect(state.parentMessage).toEqual(msg);
    expect(state.replies).toEqual([]);
  });

  it('closes a thread and resets state', () => {
    const msg = {
      id: '1',
      agent_name: 'Alice',
      text: 'Hello',
      created_at: '2026-01-01T00:00:00Z',
    };
    useThreadStore.getState().openThread(msg);
    useThreadStore.getState().appendReply({
      id: '2',
      agent_name: 'Bob',
      text: 'Reply',
      created_at: '2026-01-01T00:01:00Z',
    });
    useThreadStore.getState().closeThread();

    const state = useThreadStore.getState();
    expect(state.parentMessage).toBeNull();
    expect(state.replies).toEqual([]);
  });

  it('sets replies', () => {
    const replies = [
      { id: '2', agent_name: 'Bob', text: 'Reply 1', created_at: '2026-01-01T00:01:00Z' },
      { id: '3', agent_name: 'Carol', text: 'Reply 2', created_at: '2026-01-01T00:02:00Z' },
    ];
    useThreadStore.getState().setReplies(replies);
    expect(useThreadStore.getState().replies).toEqual(replies);
  });

  it('appends a reply', () => {
    useThreadStore.getState().setReplies([
      { id: '2', agent_name: 'Bob', text: 'First reply', created_at: '2026-01-01T00:01:00Z' },
    ]);
    useThreadStore.getState().appendReply({
      id: '3',
      agent_name: 'Carol',
      text: 'Second reply',
      created_at: '2026-01-01T00:02:00Z',
    });

    const replies = useThreadStore.getState().replies;
    expect(replies).toHaveLength(2);
    expect(replies[1].text).toBe('Second reply');
  });

  it('opening a new thread clears previous replies', () => {
    useThreadStore.getState().openThread({
      id: '1',
      agent_name: 'Alice',
      text: 'First thread',
      created_at: '2026-01-01T00:00:00Z',
    });
    useThreadStore.getState().setReplies([
      { id: '2', agent_name: 'Bob', text: 'Reply', created_at: '2026-01-01T00:01:00Z' },
    ]);

    useThreadStore.getState().openThread({
      id: '10',
      agent_name: 'Dave',
      text: 'Second thread',
      created_at: '2026-01-01T01:00:00Z',
    });

    const state = useThreadStore.getState();
    expect(state.parentMessage?.id).toBe('10');
    expect(state.replies).toEqual([]);
  });
});
