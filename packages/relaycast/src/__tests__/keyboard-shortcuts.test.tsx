import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('@/lib/store', () => ({
  useChannelStore: (sel?: (s: Record<string, unknown>) => unknown) => {
    const state = { channels: [{ name: 'general' }, { name: 'random' }] };
    return sel ? sel(state) : state;
  },
}));

describe('KeyboardShortcutProvider', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });

  it('dispatches open-search on Cmd+K', async () => {
    const { default: KSP } = await import(
      '@/components/KeyboardShortcutProvider'
    );
    render(<KSP><div>content</div></KSP>);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const events = dispatchSpy.mock.calls
      .map((c) => (c[0] as CustomEvent).type)
      .filter((t) => t === 'relaycast:open-search');
    expect(events.length).toBeGreaterThan(0);
  });

  it('dispatches close-modal on Escape', async () => {
    const { default: KSP } = await import(
      '@/components/KeyboardShortcutProvider'
    );
    render(<KSP><div>content</div></KSP>);
    fireEvent.keyDown(window, { key: 'Escape' });
    const events = dispatchSpy.mock.calls
      .map((c) => (c[0] as CustomEvent).type)
      .filter((t) => t === 'relaycast:close-modal');
    expect(events.length).toBeGreaterThan(0);
  });

  it('dispatches nav-channel on ArrowDown', async () => {
    const { default: KSP } = await import(
      '@/components/KeyboardShortcutProvider'
    );
    const { container } = render(<KSP><div>content</div></KSP>);
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    const events = dispatchSpy.mock.calls
      .map((c) => (c[0] as CustomEvent).type)
      .filter((t) => t === 'relaycast:nav-channel');
    expect(events.length).toBeGreaterThan(0);
  });
});
