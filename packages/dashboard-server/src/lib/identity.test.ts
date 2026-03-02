import { describe, expect, it } from 'vitest';
import {
  normalizeName,
  isDashboardVariant,
  isBrokerIdentity,
  resolveIdentity,
  dashboardDisplayName,
  type IdentityConfig,
} from './identity.js';

const DEFAULT_CONFIG: IdentityConfig = {
  projectIdentity: 'my-project',
  relayAgentName: 'my-project',
};

describe('normalizeName', () => {
  it('lowercases and trims', () => {
    expect(normalizeName('  LeadAgent ')).toBe('leadagent');
  });

  it('handles empty string', () => {
    expect(normalizeName('')).toBe('');
  });

  it('handles undefined-like coercion gracefully', () => {
    // The function signature takes string, but guard against null-ish at runtime
    expect(normalizeName(undefined as unknown as string)).toBe('');
  });
});

describe('isDashboardVariant', () => {
  it('matches "Dashboard"', () => {
    expect(isDashboardVariant('Dashboard')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isDashboardVariant('dashboard')).toBe(true);
    expect(isDashboardVariant('DASHBOARD')).toBe(true);
  });

  it('matches "dashboard-reader"', () => {
    expect(isDashboardVariant('dashboard-reader')).toBe(true);
  });

  it('matches Dashboard-<hex> conflict suffix', () => {
    expect(isDashboardVariant('Dashboard-5b8c70e5')).toBe(true);
    expect(isDashboardVariant('dashboard-abcdef01')).toBe(true);
  });

  it('matches "human:dashboard"', () => {
    expect(isDashboardVariant('human:dashboard')).toBe(true);
  });

  it('rejects normal agent names', () => {
    expect(isDashboardVariant('worker-1')).toBe(false);
    expect(isDashboardVariant('Lead')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isDashboardVariant('')).toBe(false);
    expect(isDashboardVariant('   ')).toBe(false);
  });
});

describe('isBrokerIdentity', () => {
  it('matches "broker"', () => {
    expect(isBrokerIdentity('broker', DEFAULT_CONFIG)).toBe(true);
  });

  it('matches "broker-abc123"', () => {
    expect(isBrokerIdentity('broker-abc123', DEFAULT_CONFIG)).toBe(true);
  });

  it('matches project identity', () => {
    expect(isBrokerIdentity('my-project', DEFAULT_CONFIG)).toBe(true);
  });

  it('matches configured broker identity aliases', () => {
    const config: IdentityConfig = {
      projectIdentity: 'my-project',
      brokerIdentities: ['relay-agent', 'workspace-broker'],
    };
    expect(isBrokerIdentity('relay-agent', config)).toBe(true);
    expect(isBrokerIdentity('workspace-broker', config)).toBe(true);
  });

  it('rejects normal agent names', () => {
    expect(isBrokerIdentity('worker-1', DEFAULT_CONFIG)).toBe(false);
    expect(isBrokerIdentity('alice', DEFAULT_CONFIG)).toBe(false);
  });
});

describe('resolveIdentity', () => {
  it('normalizes "Dashboard" to projectIdentity', () => {
    expect(resolveIdentity('Dashboard', DEFAULT_CONFIG)).toBe('my-project');
  });

  it('normalizes "Dashboard-5b8c70e5" to projectIdentity', () => {
    expect(resolveIdentity('Dashboard-5b8c70e5', DEFAULT_CONFIG)).toBe('my-project');
  });

  it('normalizes "dashboard-reader" to projectIdentity', () => {
    expect(resolveIdentity('dashboard-reader', DEFAULT_CONFIG)).toBe('my-project');
  });

  it('normalizes "human:dashboard" to projectIdentity', () => {
    expect(resolveIdentity('human:dashboard', DEFAULT_CONFIG)).toBe('my-project');
  });

  it('normalizes broker names to projectIdentity', () => {
    expect(resolveIdentity('broker', DEFAULT_CONFIG)).toBe('my-project');
    expect(resolveIdentity('broker-951762d5', DEFAULT_CONFIG)).toBe('my-project');
  });

  it('passes through normal agent names unchanged', () => {
    expect(resolveIdentity('worker-1', DEFAULT_CONFIG)).toBe('worker-1');
    expect(resolveIdentity('Lead', DEFAULT_CONFIG)).toBe('Lead');
    expect(resolveIdentity('alice', DEFAULT_CONFIG)).toBe('alice');
  });

  it('handles empty/undefined gracefully', () => {
    expect(resolveIdentity('', DEFAULT_CONFIG)).toBe('');
    expect(resolveIdentity('   ', DEFAULT_CONFIG)).toBe('');
  });

  it('falls back to relayAgentName when no projectIdentity', () => {
    const config: IdentityConfig = { projectIdentity: '', relayAgentName: 'broker' };
    expect(resolveIdentity('Dashboard', config)).toBe('broker');
    expect(resolveIdentity('broker', config)).toBe('broker');
  });

  it('falls back to DASHBOARD_DISPLAY_NAME when no projectIdentity and no relayAgentName', () => {
    const noProjectConfig: IdentityConfig = { projectIdentity: '' };
    expect(resolveIdentity('Dashboard', noProjectConfig)).toBe('Dashboard');
    expect(resolveIdentity('broker', noProjectConfig)).toBe('Dashboard');
  });

  it('preserves canonical casing when name matches projectIdentity', () => {
    expect(resolveIdentity('My-Project', DEFAULT_CONFIG)).toBe('my-project');
  });

  it('maps relay agent name to project identity', () => {
    const config: IdentityConfig = {
      projectIdentity: 'my-project',
      relayAgentName: 'relay-agent',
    };
    expect(resolveIdentity('relay-agent', config)).toBe('my-project');
  });

  it('maps explicit broker identity aliases to project identity', () => {
    const config: IdentityConfig = {
      projectIdentity: 'my-project',
      brokerIdentities: ['relay-agent'],
    };
    expect(resolveIdentity('relay-agent', config)).toBe('my-project');
  });
});

describe('dashboardDisplayName', () => {
  it('returns projectIdentity when set', () => {
    expect(dashboardDisplayName(DEFAULT_CONFIG)).toBe('my-project');
  });

  it('falls back to relayAgentName when no projectIdentity', () => {
    expect(dashboardDisplayName({ projectIdentity: '', relayAgentName: 'broker' })).toBe('broker');
  });

  it('falls back to Dashboard when no projectIdentity and no relayAgentName', () => {
    expect(dashboardDisplayName({ projectIdentity: '' })).toBe('Dashboard');
  });
});
