import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore, useChannelStore, useMessageStore } from '@/lib/store';

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      apiKey: null,
      agentToken: null,
      workspace: null,
    });
  });

  it('initializes with null values', () => {
    const state = useAuthStore.getState();
    expect(state.apiKey).toBeNull();
    expect(state.agentToken).toBeNull();
    expect(state.workspace).toBeNull();
  });

  it('sets auth data', () => {
    useAuthStore.getState().setAuth('rk_test_abc', 'at_test_xyz', {
      name: 'My Workspace',
      plan: 'pro',
    });

    const state = useAuthStore.getState();
    expect(state.apiKey).toBe('rk_test_abc');
    expect(state.agentToken).toBe('at_test_xyz');
    expect(state.workspace).toEqual({ name: 'My Workspace', plan: 'pro' });
  });

  it('clears auth on logout', () => {
    useAuthStore.getState().setAuth('rk_test_abc', 'at_test_xyz', {
      name: 'My Workspace',
    });
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.apiKey).toBeNull();
    expect(state.agentToken).toBeNull();
    expect(state.workspace).toBeNull();
  });
});

describe('useChannelStore', () => {
  beforeEach(() => {
    useChannelStore.setState({
      channels: [],
      activeChannel: null,
    });
  });

  it('initializes with empty channels', () => {
    const state = useChannelStore.getState();
    expect(state.channels).toEqual([]);
    expect(state.activeChannel).toBeNull();
  });

  it('sets channels', () => {
    useChannelStore.getState().setChannels([
      { name: 'general', topic: 'General chat' },
      { name: 'code-review' },
    ]);

    expect(useChannelStore.getState().channels).toHaveLength(2);
    expect(useChannelStore.getState().channels[0].name).toBe('general');
  });

  it('sets active channel', () => {
    useChannelStore.getState().setActiveChannel('general');
    expect(useChannelStore.getState().activeChannel).toBe('general');
  });

  it('adds a channel', () => {
    useChannelStore.getState().setChannels([{ name: 'general' }]);
    useChannelStore.getState().addChannel({ name: 'new-channel' });

    expect(useChannelStore.getState().channels).toHaveLength(2);
    expect(useChannelStore.getState().channels[1].name).toBe('new-channel');
  });

  it('removes a channel', () => {
    useChannelStore
      .getState()
      .setChannels([{ name: 'general' }, { name: 'temp' }]);
    useChannelStore.getState().removeChannel('temp');

    expect(useChannelStore.getState().channels).toHaveLength(1);
    expect(useChannelStore.getState().channels[0].name).toBe('general');
  });
});

describe('useMessageStore', () => {
  beforeEach(() => {
    useMessageStore.setState({ messagesByChannel: {} });
  });

  it('initializes with empty messages', () => {
    expect(useMessageStore.getState().messagesByChannel).toEqual({});
  });

  it('sets messages for a channel', () => {
    const msgs = [
      {
        id: '1',
        agent_name: 'Alice',
        text: 'Hello',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    useMessageStore.getState().setMessages('general', msgs);

    expect(useMessageStore.getState().messagesByChannel['general']).toEqual(
      msgs,
    );
  });

  it('appends a message', () => {
    useMessageStore.getState().setMessages('general', [
      {
        id: '1',
        agent_name: 'Alice',
        text: 'First',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);

    useMessageStore.getState().appendMessage('general', {
      id: '2',
      agent_name: 'Bob',
      text: 'Second',
      created_at: '2026-01-01T00:01:00Z',
    });

    const msgs = useMessageStore.getState().messagesByChannel['general'];
    expect(msgs).toHaveLength(2);
    expect(msgs[1].text).toBe('Second');
  });

  it('prepends messages', () => {
    useMessageStore.getState().setMessages('general', [
      {
        id: '3',
        agent_name: 'Alice',
        text: 'Latest',
        created_at: '2026-01-01T00:02:00Z',
      },
    ]);

    useMessageStore.getState().prependMessages('general', [
      {
        id: '1',
        agent_name: 'Bob',
        text: 'Oldest',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: '2',
        agent_name: 'Bob',
        text: 'Middle',
        created_at: '2026-01-01T00:01:00Z',
      },
    ]);

    const msgs = useMessageStore.getState().messagesByChannel['general'];
    expect(msgs).toHaveLength(3);
    expect(msgs[0].text).toBe('Oldest');
    expect(msgs[2].text).toBe('Latest');
  });

  it('clears messages for a channel', () => {
    useMessageStore.getState().setMessages('general', [
      {
        id: '1',
        agent_name: 'Alice',
        text: 'Hello',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);

    useMessageStore.getState().clearMessages('general');
    expect(
      useMessageStore.getState().messagesByChannel['general'],
    ).toBeUndefined();
  });
});
