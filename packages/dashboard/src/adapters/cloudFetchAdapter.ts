/**
 * Lightweight Cloud API Adapter
 *
 * Fetch-based implementation of CloudApiAdapter for when the dashboard
 * is served by the relay-cloud server. Uses the same-origin API endpoints
 * with cookie-based session auth and CSRF tokens.
 *
 * Only implements methods that the App component actually calls.
 * All other methods return stub errors — they're handled by the
 * DashboardPageClient directly or by settings panels.
 */

import type {
  CloudApiAdapter,
  CloudAuthAdapter,
  CloudApiResult,
  CloudApiResultWithoutSession,
  SessionStatus,
  CloudUser,
  NangoLoginSession,
  NangoLoginStatus,
  NangoRepoSession,
  NangoRepoStatus,
  SessionExpiredCallback,
} from './types';

let _csrfToken: string | null = null;
const _sessionExpiredListeners = new Set<SessionExpiredCallback>();

/**
 * Set the CSRF token (called by DashboardPageClient after session check)
 */
export function setCloudCsrfToken(token: string | null): void {
  _csrfToken = token;
}

/**
 * Generic fetch wrapper with CSRF + credentials
 */
async function cloudFetch<T>(path: string, init?: RequestInit): Promise<CloudApiResult<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> || {}),
  };

  if (_csrfToken) {
    headers['X-CSRF-Token'] = _csrfToken;
  }

  try {
    const res = await fetch(path, {
      ...init,
      credentials: 'include',
      headers,
    });

    // Capture updated CSRF token
    const newToken = res.headers.get('X-CSRF-Token');
    if (newToken) {
      _csrfToken = newToken;
    }

    if (res.status === 401) {
      const err = await res.json().catch(() => ({ error: 'Session expired' }));
      // Notify listeners
      for (const cb of _sessionExpiredListeners) {
        cb({ error: err.error || 'Session expired', code: 'SESSION_EXPIRED', message: err.message || '' });
      }
      return { success: false, error: err.error || 'Session expired' };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { success: false, error: err.error || `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

function notImplemented(method: string): Promise<CloudApiResult<never>> {
  return Promise.resolve({ success: false, error: `${method} not implemented in lightweight adapter` });
}

/**
 * Cloud API adapter — implements methods used by the App component.
 */
export function createCloudApiAdapter(): CloudApiAdapter {
  return {
    // ===== Methods used by App component =====

    spawnAgent: (workspaceId, params) =>
      cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agents`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    getAgents: (workspaceId) =>
      cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agents`),

    stopAgent: (workspaceId, agentName) =>
      cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentName)}`, {
        method: 'DELETE',
      }),

    getAccessibleWorkspaces: () =>
      cloudFetch('/api/workspaces/accessible'),

    getWorkspaceSummary: () =>
      cloudFetch('/api/workspaces/summary'),

    restartWorkspace: (id) =>
      cloudFetch(`/api/workspaces/${encodeURIComponent(id)}/restart`, { method: 'POST' }),

    // ===== Session & Auth =====

    checkSession: async () => {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (!res.ok) return { authenticated: false };
      return res.json();
    },

    getMe: () => cloudFetch('/api/auth/me'),

    logout: async () => {
      const headers: Record<string, string> = {};
      if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      return { success: res.ok };
    },

    // ===== Workspace Management =====

    getWorkspaces: () => cloudFetch('/api/workspaces'),
    getWorkspace: (id) => cloudFetch(`/api/workspaces/${encodeURIComponent(id)}`),
    createWorkspace: (data) => cloudFetch('/api/workspaces', { method: 'POST', body: JSON.stringify(data) }),
    getPrimaryWorkspace: () => cloudFetch('/api/workspaces/primary'),
    getWorkspaceStatus: (id) => cloudFetch(`/api/workspaces/${encodeURIComponent(id)}/status`),
    wakeupWorkspace: (id) => cloudFetch(`/api/workspaces/${encodeURIComponent(id)}/restart`, { method: 'POST' }),
    rebuildWorkspace: (id) => cloudFetch(`/api/workspaces/${encodeURIComponent(id)}/rebuild`, { method: 'POST' }),
    stopWorkspace: (id) => cloudFetch(`/api/workspaces/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
    deleteWorkspace: (id) => cloudFetch(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getWorkspaceDetails: (id) => cloudFetch(`/api/workspaces/${encodeURIComponent(id)}`),

    // ===== Providers & Credentials =====

    getProviders: (workspaceId) => cloudFetch(`/api/providers?workspaceId=${encodeURIComponent(workspaceId)}`),
    disconnectProvider: (provider, workspaceId) =>
      cloudFetch(`/api/providers/${encodeURIComponent(provider)}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: 'DELETE' }),
    getUserCredentials: () => cloudFetch('/api/credentials'),
    assignCredentialToWorkspace: (credentialId, workspaceId) =>
      cloudFetch(`/api/credentials/${encodeURIComponent(credentialId)}/assign`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      }),
    unassignCredentialFromWorkspace: (credentialId, workspaceId) =>
      cloudFetch(`/api/credentials/${encodeURIComponent(credentialId)}/unassign`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      }),

    // ===== Nango Auth =====

    getNangoLoginSession: () => cloudFetch('/api/nango/login/session') as Promise<CloudApiResultWithoutSession<NangoLoginSession>>,
    checkNangoLoginStatus: (connectionId) =>
      cloudFetch(`/api/nango/login/status?connectionId=${encodeURIComponent(connectionId)}`) as Promise<CloudApiResultWithoutSession<NangoLoginStatus>>,
    getNangoRepoSession: () => cloudFetch('/api/nango/repo/session'),
    checkNangoRepoStatus: (connectionId) =>
      cloudFetch(`/api/nango/repo/status?connectionId=${encodeURIComponent(connectionId)}`),

    // ===== Teams =====

    getWorkspaceMembers: (workspaceId) => cloudFetch(`/api/teams/${encodeURIComponent(workspaceId)}/members`),
    getRepoCollaborators: (workspaceId) => cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/repo-collaborators`),
    inviteMember: (workspaceId, githubUsername, role) =>
      cloudFetch(`/api/teams/${encodeURIComponent(workspaceId)}/invite`, {
        method: 'POST',
        body: JSON.stringify({ githubUsername, role }),
      }),
    getPendingInvites: () => cloudFetch('/api/teams/invites/pending'),
    acceptInvite: (inviteId) => cloudFetch(`/api/teams/invites/${encodeURIComponent(inviteId)}/accept`, { method: 'POST' }),
    declineInvite: (inviteId) => cloudFetch(`/api/teams/invites/${encodeURIComponent(inviteId)}/decline`, { method: 'POST' }),
    updateMemberRole: (workspaceId, memberId, role) =>
      cloudFetch(`/api/teams/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    removeMember: (workspaceId, memberId) =>
      cloudFetch(`/api/teams/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`, { method: 'DELETE' }),

    // ===== Repos =====

    addReposToWorkspace: (workspaceId, repositoryIds) =>
      cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/repos`, {
        method: 'POST',
        body: JSON.stringify({ repositoryIds }),
      }),
    getRepos: () => cloudFetch('/api/github-app/repos'),
    syncRepo: (repoId) => cloudFetch(`/api/github-app/repos/${encodeURIComponent(repoId)}/sync`, { method: 'POST' }),

    // ===== Custom Domain =====

    setCustomDomain: (workspaceId, domain) =>
      cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/domain`, {
        method: 'POST',
        body: JSON.stringify({ domain }),
      }),
    verifyCustomDomain: (workspaceId) =>
      cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/domain/verify`, { method: 'POST' }),
    removeCustomDomain: (workspaceId) =>
      cloudFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/domain`, { method: 'DELETE' }),

    // ===== Billing =====

    getBillingPlans: () => cloudFetch('/api/billing/plans'),
    getSubscription: () => cloudFetch('/api/billing/subscription'),
    createCheckoutSession: (tier, interval) =>
      cloudFetch('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ tier, interval }) }),
    createBillingPortal: () => cloudFetch('/api/billing/portal', { method: 'POST' }),
    changeSubscription: (tier, interval) =>
      cloudFetch('/api/billing/subscription', { method: 'PATCH', body: JSON.stringify({ tier, interval }) }),
    cancelSubscription: () => cloudFetch('/api/billing/subscription/cancel', { method: 'POST' }),
    resumeSubscription: () => cloudFetch('/api/billing/subscription/resume', { method: 'POST' }),
    getInvoices: () => cloudFetch('/api/billing/invoices'),

    // ===== Onboarding =====

    getOnboardingNextStep: async () => {
      const res = await fetch('/api/onboarding/next-step', { credentials: 'include' });
      return res.json();
    },
  };
}

/**
 * Cloud auth adapter — implements auth methods used by the App component.
 */
export function createCloudAuthAdapter(): CloudAuthAdapter {
  return {
    checkSession: async () => {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      const token = res.headers.get('X-CSRF-Token');
      if (token) _csrfToken = token;
      if (!res.ok) return { authenticated: false };
      return res.json();
    },

    getUser: () => cloudFetch('/api/auth/me'),

    logout: async () => {
      const headers: Record<string, string> = {};
      if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      return { success: res.ok };
    },

    redirectToLogin: () => {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?returnTo=${returnTo}`;
    },

    onSessionExpired: (callback: SessionExpiredCallback) => {
      _sessionExpiredListeners.add(callback);
      return () => { _sessionExpiredListeners.delete(callback); };
    },
  };
}
