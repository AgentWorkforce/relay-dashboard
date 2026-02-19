/**
 * Credential Assignment Section
 *
 * Shows all user credentials with toggle switches for workspace assignment.
 * Allows attaching existing credentials to a workspace without re-authenticating.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { cloudApi } from '../../lib/cloudApi';

interface UserCredential {
  id: string;
  provider: string;
  providerAccountEmail?: string;
  createdAt: string;
  updatedAt: string;
  workspaces: Array<{ id: string; name: string }>;
}

export interface CredentialAssignmentSectionProps {
  workspaceId: string;
  workspaceName?: string;
}

const PROVIDER_DISPLAY: Record<string, { name: string; color: string }> = {
  anthropic: { name: 'Claude', color: '#D97757' },
  openai: { name: 'Codex', color: '#10A37F' },
  codex: { name: 'Codex', color: '#10A37F' },
  google: { name: 'Gemini', color: '#4285F4' },
  cursor: { name: 'Cursor', color: '#7C3AED' },
  factory: { name: 'Droid', color: '#6366F1' },
  opencode: { name: 'OpenCode', color: '#00D4AA' },
};

function getProviderDisplay(provider: string) {
  return PROVIDER_DISPLAY[provider] ?? { name: provider, color: '#6B7280' };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CredentialAssignmentSection({
  workspaceId,
  workspaceName,
}: CredentialAssignmentSectionProps) {
  const [credentials, setCredentials] = useState<UserCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await cloudApi.getUserCredentials();
    if (result.success) {
      setCredentials(result.data.credentials);
    } else {
      setError(result.error || 'Failed to load credentials');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials]);

  const isAssigned = (cred: UserCredential) =>
    cred.workspaces.some((w) => w.id === workspaceId);

  const handleToggle = useCallback(async (cred: UserCredential) => {
    setTogglingId(cred.id);
    setError(null);

    try {
      const assigned = isAssigned(cred);
      const result = assigned
        ? await cloudApi.unassignCredentialFromWorkspace(cred.id, workspaceId)
        : await cloudApi.assignCredentialToWorkspace(cred.id, workspaceId);

      if (result.success) {
        // Update local state optimistically
        setCredentials((prev) =>
          prev.map((c) => {
            if (c.id !== cred.id) return c;
            if (assigned) {
              return { ...c, workspaces: c.workspaces.filter((w) => w.id !== workspaceId) };
            }
            return {
              ...c,
              workspaces: [...c.workspaces, { id: workspaceId, name: workspaceName || 'This workspace' }],
            };
          }),
        );
      } else {
        setError(result.error || 'Failed to update assignment');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assignment');
    } finally {
      setTogglingId(null);
    }
  }, [workspaceId, workspaceName]);

  if (loading) {
    return (
      <div className="space-y-8">
        <SectionHeader />
        <div className="flex items-center justify-center py-12">
          <SpinnerIcon />
          <span className="ml-3 text-sm text-text-muted">Loading credentials...</span>
        </div>
      </div>
    );
  }

  if (credentials.length === 0) {
    return (
      <div className="space-y-8">
        <SectionHeader />
        <div className="p-8 text-center bg-bg-tertiary rounded-xl border border-border-subtle">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-bg-elevated flex items-center justify-center">
            <KeyIcon />
          </div>
          <p className="text-sm text-text-secondary mb-1">No credentials found</p>
          <p className="text-xs text-text-muted">
            Connect an AI provider first, then you can assign it to workspaces here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeader />

      {error && (
        <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm flex items-center gap-3">
          <AlertIcon />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-error/60 hover:text-error">
            <CloseIcon />
          </button>
        </div>
      )}

      <div className="space-y-4">
        {credentials.map((cred) => {
          const display = getProviderDisplay(cred.provider);
          const assigned = isAssigned(cred);
          const toggling = togglingId === cred.id;
          const otherWorkspaces = cred.workspaces.filter((w) => w.id !== workspaceId);

          return (
            <div
              key={cred.id}
              className={`p-5 bg-bg-tertiary rounded-xl border transition-all duration-200 ${
                assigned
                  ? 'border-accent-cyan/30 shadow-[0_0_12px_rgba(0,217,255,0.08)]'
                  : 'border-border-subtle hover:border-border-medium'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Provider badge */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg"
                    style={{
                      backgroundColor: display.color,
                      boxShadow: `0 4px 20px ${display.color}40`,
                    }}
                  >
                    {display.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary">
                        {display.name}
                      </span>
                      <span className="text-xs text-text-muted">
                        ({cred.provider})
                      </span>
                    </div>
                    {cred.providerAccountEmail && (
                      <p className="text-xs text-text-secondary mt-0.5">
                        {cred.providerAccountEmail}
                      </p>
                    )}
                    <p className="text-xs text-text-muted mt-0.5">
                      Added {formatDate(cred.createdAt)}
                      {otherWorkspaces.length > 0 && (
                        <span>
                          {' · '}Also in: {otherWorkspaces.map((w) => w.name).join(', ')}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Toggle switch */}
                <button
                  onClick={() => handleToggle(cred)}
                  disabled={toggling}
                  className={`relative w-12 h-7 rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent-cyan/40 ${
                    toggling ? 'opacity-50 cursor-wait' : 'cursor-pointer'
                  } ${
                    assigned
                      ? 'bg-accent-cyan/30'
                      : 'bg-bg-elevated'
                  }`}
                  aria-label={assigned ? 'Unassign from workspace' : 'Assign to workspace'}
                >
                  <div
                    className={`absolute top-1 w-5 h-5 rounded-full transition-all duration-200 shadow-md ${
                      assigned
                        ? 'left-6 bg-accent-cyan'
                        : 'left-1 bg-text-muted'
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Local sub-components

function SectionHeader() {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Credentials</h3>
      <p className="text-xs text-text-muted mt-1">
        Attach existing credentials to this workspace. Toggle on to assign, off to unassign.
      </p>
    </div>
  );
}

function KeyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin text-accent-cyan">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
