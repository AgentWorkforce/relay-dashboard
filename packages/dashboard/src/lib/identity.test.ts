import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDashboardVariant, getProjectIdentity, normalizeDashboardName } from './identity';

function setRelayUsername(value?: string): void {
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  if (!storage) return;
  if (value) {
    storage.setItem('relay_username', value);
  } else {
    storage.removeItem('relay_username');
  }
}

function installMockLocalStorage(): void {
  if ((globalThis as { localStorage?: Storage }).localStorage) return;

  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  } satisfies Storage;

  vi.stubGlobal('localStorage', mockStorage);
}

describe('isDashboardVariant', () => {
  it('detects "Dashboard"', () => {
    expect(isDashboardVariant('Dashboard')).toBe(true);
  });

  it('detects "Dashboard-<hex>"', () => {
    expect(isDashboardVariant('Dashboard-5b8c70e5')).toBe(true);
  });

  it('detects "dashboard-reader"', () => {
    expect(isDashboardVariant('dashboard-reader')).toBe(true);
  });

  it('detects "human:dashboard"', () => {
    expect(isDashboardVariant('human:dashboard')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isDashboardVariant('DASHBOARD')).toBe(true);
    expect(isDashboardVariant('dashboard')).toBe(true);
  });

  it('returns false for normal agent names', () => {
    expect(isDashboardVariant('Natty')).toBe(false);
    expect(isDashboardVariant('worker-1')).toBe(false);
    expect(isDashboardVariant('test-broker-new')).toBe(false);
  });

  it('returns false for empty/whitespace strings', () => {
    expect(isDashboardVariant('')).toBe(false);
    expect(isDashboardVariant('   ')).toBe(false);
  });
});

describe('getProjectIdentity', () => {
  beforeEach(() => {
    installMockLocalStorage();
    setRelayUsername(undefined);
  });

  afterEach(() => {
    setRelayUsername(undefined);
  });

  it('returns explicit identity when provided', () => {
    expect(getProjectIdentity('my-project')).toBe('my-project');
  });

  it('returns localStorage value when no explicit identity', () => {
    setRelayUsername('stored-user');
    expect(getProjectIdentity()).toBe('stored-user');
  });

  it('returns "Dashboard" as final fallback', () => {
    expect(getProjectIdentity()).toBe('Dashboard');
  });

  it('explicit identity takes priority over localStorage', () => {
    setRelayUsername('stored-user');
    expect(getProjectIdentity('explicit-user')).toBe('explicit-user');
  });

  it('trims whitespace from explicit identity', () => {
    expect(getProjectIdentity('  spaced  ')).toBe('spaced');
  });

  it('skips blank explicit identity and falls back', () => {
    setRelayUsername('stored-user');
    expect(getProjectIdentity('   ')).toBe('stored-user');
  });
});

describe('normalizeDashboardName', () => {
  beforeEach(() => {
    installMockLocalStorage();
    setRelayUsername(undefined);
  });

  afterEach(() => {
    setRelayUsername(undefined);
  });

  it('maps Dashboard variants to the project identity', () => {
    setRelayUsername('test-broker-new');
    expect(normalizeDashboardName('Dashboard-5b8c70e5')).toBe('test-broker-new');
    expect(normalizeDashboardName('Dashboard')).toBe('test-broker-new');
    expect(normalizeDashboardName('dashboard-reader')).toBe('test-broker-new');
  });

  it('passes non-Dashboard names through unchanged', () => {
    expect(normalizeDashboardName('Natty')).toBe('Natty');
    expect(normalizeDashboardName('worker-1')).toBe('worker-1');
  });

  it('falls back to "Dashboard" when no identity is stored', () => {
    expect(normalizeDashboardName('Dashboard-5b8c70e5')).toBe('Dashboard');
  });

  it('uses explicit project identity when provided', () => {
    expect(normalizeDashboardName('Dashboard-5b8c70e5', 'my-project')).toBe('my-project');
  });

  it('returns original value for empty input', () => {
    expect(normalizeDashboardName('')).toBe('');
  });

  it('trims non-Dashboard names', () => {
    expect(normalizeDashboardName('  Natty  ')).toBe('Natty');
  });
});
