/**
 * Provider Auth Flow Component
 *
 * Shared component for AI provider authentication via SSH tunnel.
 * Used by both the onboarding page and workspace settings.
 *
 * Flow:
 * 1. Calls /api/auth/ssh/init to get a CLI command with one-time token
 * 2. User copies and runs the command in their local terminal
 * 3. CLI establishes SSH to workspace and runs the provider's auth command
 * 4. User completes interactive auth (OAuth in browser, etc.)
 * 5. CLI calls /api/auth/ssh/complete to mark provider as connected
 * 6. Dashboard polls /api/auth/ssh/status/:workspaceId to detect completion
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';

export interface ProviderInfo {
  id: string;
  name: string;
  displayName: string;
  color: string;
  cliCommand?: string;
  /** Whether this provider's OAuth redirects to localhost (shows "site can't be reached") */
  requiresUrlCopy?: boolean;
  /** Whether this provider supports device flow */
  supportsDeviceFlow?: boolean;
}

export interface ProviderAuthFlowProps {
  provider: ProviderInfo;
  workspaceId: string;
  csrfToken?: string;
  onSuccess: () => void;
  onCancel: () => void;
  onError: (error: string) => void;
  /** Whether to use device flow (for providers that support it) */
  useDeviceFlow?: boolean;
}

type AuthStatus = 'idle' | 'starting' | 'waiting' | 'success' | 'error';

/**
 * Map dashboard provider IDs to SSH backend provider names.
 * The SSH status endpoint uses PROVIDER_COMMANDS keys (anthropic, openai, google, etc.)
 * while the dashboard uses its own IDs (anthropic, codex, google, etc.)
 */
const PROVIDER_STATUS_MAP: Record<string, string> = {
  codex: 'openai',
};

function getStatusProviderName(providerId: string): string {
  return PROVIDER_STATUS_MAP[providerId] || providerId;
}

export function ProviderAuthFlow({
  provider,
  workspaceId,
  csrfToken,
  onSuccess,
  onCancel,
  onError,
}: ProviderAuthFlowProps) {
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cliCommand, setCliCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollingRef = useRef(false);
  const completingRef = useRef(false);

  const backendProviderId = provider.id;
  const statusProviderId = getStatusProviderName(backendProviderId);

  // Start the SSH auth flow
  const startAuth = useCallback(async () => {
    setStatus('starting');
    setErrorMessage(null);
    completingRef.current = false;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch('/api/auth/ssh/init', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          provider: backendProviderId,
          workspaceId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start authentication');
      }

      setCliCommand(data.commandWithUrl || data.command);
      setStatus('waiting');

      // Start polling for completion
      if (data.workspaceId) {
        startPolling(data.workspaceId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start authentication';
      setErrorMessage(msg);
      setStatus('error');
      onError(msg);
    }
  }, [backendProviderId, workspaceId, csrfToken, onError]);

  // Poll SSH auth status endpoint to detect when provider is connected
  const startPolling = useCallback((wsId: string) => {
    if (pollingRef.current) return;
    pollingRef.current = true;

    const maxAttempts = 120; // 10 minutes at 5s intervals
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts || !pollingRef.current) {
        pollingRef.current = false;
        if (attempts >= maxAttempts) {
          setErrorMessage('Authentication timed out. Please try again.');
          setStatus('error');
          onError('Authentication timed out');
        }
        return;
      }

      try {
        const res = await fetch(`/api/auth/ssh/status/${wsId}`, {
          credentials: 'include',
        });

        if (res.ok) {
          const data = await res.json() as {
            providers: Array<{ name: string; status: string }>;
          };

          const providerStatus = data.providers?.find(
            (p) => p.name === statusProviderId
          );

          if (providerStatus?.status === 'connected') {
            pollingRef.current = false;
            if (!completingRef.current) {
              completingRef.current = true;
              setStatus('success');
              setTimeout(() => onSuccess(), 1500);
            }
            return;
          }
        }

        attempts++;
        setTimeout(poll, 5000);
      } catch (err) {
        console.error('Poll error:', err);
        attempts++;
        setTimeout(poll, 5000);
      }
    };

    poll();
  }, [statusProviderId, onError, onSuccess]);

  // Cancel auth flow
  const handleCancel = useCallback(() => {
    pollingRef.current = false;
    setStatus('idle');
    setCliCommand(null);
    setErrorMessage(null);
    setCopied(false);
    onCancel();
  }, [onCancel]);

  // Copy command to clipboard
  const handleCopy = useCallback(() => {
    if (cliCommand) {
      navigator.clipboard.writeText(cliCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [cliCommand]);

  // Start auth when component mounts
  useEffect(() => {
    if (status === 'idle') {
      startAuth();
    }
    return () => {
      pollingRef.current = false;
    };
  }, [startAuth, status]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
          style={{ backgroundColor: provider.color }}
        >
          {provider.displayName[0]}
        </div>
        <div>
          <h3 className="font-medium text-white">{provider.displayName}</h3>
          <p className="text-sm text-text-muted">
            {status === 'starting' && 'Starting authentication...'}
            {status === 'waiting' && 'Complete authentication below'}
            {status === 'success' && 'Connected!'}
            {status === 'error' && (errorMessage || 'Authentication failed')}
          </p>
        </div>
      </div>

      {/* Starting state */}
      {status === 'starting' && (
        <div className="flex items-center justify-center gap-3 py-4">
          <svg className="w-5 h-5 text-accent-cyan animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-text-muted">Preparing authentication...</span>
        </div>
      )}

      {/* Waiting state - SSH CLI flow */}
      {status === 'waiting' && cliCommand && (
        <div className="space-y-4">
          {/* Step 1: Copy and run the command */}
          <div className="p-3 bg-accent-cyan/10 border border-accent-cyan/30 rounded-lg">
            <p className="text-sm text-accent-cyan mb-2">
              <strong>Step 1:</strong> Copy and run this command in your terminal
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-bg-deep rounded-lg text-xs font-mono text-white overflow-x-auto">
                {cliCommand}
              </code>
              <button
                onClick={handleCopy}
                className="px-3 py-2 bg-bg-tertiary border border-border-subtle rounded-lg text-text-muted hover:text-white hover:border-accent-cyan/50 transition-colors text-xs whitespace-nowrap"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Step 2: Accept SSH warnings */}
          <div className="p-3 bg-bg-tertiary border border-border-subtle rounded-lg">
            <p className="text-sm text-white mb-1">
              <strong>Step 2:</strong> Accept any SSH host key warnings
            </p>
            <p className="text-xs text-text-muted">
              If prompted with &quot;Are you sure you want to continue connecting?&quot;, type <code className="px-1 py-0.5 bg-bg-deep rounded text-accent-cyan">yes</code> and press Enter.
            </p>
          </div>

          {/* Step 3: Complete sign-in */}
          <div className="p-3 bg-bg-tertiary border border-border-subtle rounded-lg">
            <p className="text-sm text-white mb-1">
              <strong>Step 3:</strong> Complete the sign-in
            </p>
            <p className="text-xs text-text-muted">
              A browser window will open for {provider.displayName} authentication. Sign in with your account and authorize access.
            </p>
          </div>

          {/* Step 4: Wait for the input prompt, then exit */}
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <p className="text-sm text-amber-400 mb-1">
              <strong>Step 4:</strong> Wait for the {provider.displayName} input prompt, then type <code className="px-1 py-0.5 bg-bg-deep rounded">exit</code>
            </p>
            <p className="text-xs text-amber-400/80">
              Do NOT close the terminal early. After sign-in completes, wait until you see the {provider.displayName} input screen (e.g. the <code className="px-1 py-0.5 bg-bg-deep rounded">&gt;</code> prompt). Then type <code className="px-1 py-0.5 bg-bg-deep rounded">exit</code> and press Enter. This page will update automatically.
            </p>
          </div>

          {/* Polling indicator */}
          <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/30 rounded-lg text-sm text-success">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Waiting for authentication to complete...</span>
          </div>

          {/* Cancel button */}
          <button
            onClick={handleCancel}
            className="w-full py-2 text-text-muted hover:text-white transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Success state */}
      {status === 'success' && (
        <div className="flex items-center justify-center gap-3 py-4">
          <div className="w-10 h-10 bg-success/20 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-white font-medium">{provider.displayName} connected!</span>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className="space-y-3">
          <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
            {errorMessage || 'Authentication failed. Please try again.'}
          </div>
          <div className="flex gap-3">
            <button
              onClick={startAuth}
              className="flex-1 py-2 px-4 bg-bg-tertiary border border-border-subtle text-white rounded-lg hover:border-accent-cyan/50 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={handleCancel}
              className="py-2 px-4 text-text-muted hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
