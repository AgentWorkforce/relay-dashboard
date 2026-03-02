/**
 * Provider Setup Client Component
 *
 * Full-page provider setup that supports both workspace mode and onboarding mode.
 * - Workspace mode: optionally route back to a specific workspace
 * - Onboarding mode: no workspaceId required; use auth mode "onboarding"
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogoIcon } from '../../../../components/Logo';
import { TerminalProviderSetup } from '../../../../components/TerminalProviderSetup';
import { ProviderAuthFlow } from '../../../../components/ProviderAuthFlow';
import { PROVIDER_CONFIGS } from './constants';

// Provider auth configuration - determines which auth method to use
const PROVIDER_AUTH_CONFIG: Record<string, {
  authMethod: 'terminal' | 'oauth';
  requiresUrlCopy?: boolean;
}> = {
  anthropic: { authMethod: 'oauth', requiresUrlCopy: true },
  codex: { authMethod: 'oauth', requiresUrlCopy: true },
  openai: { authMethod: 'oauth', requiresUrlCopy: true },
  cursor: { authMethod: 'oauth', requiresUrlCopy: true },
  google: { authMethod: 'terminal' },
  opencode: { authMethod: 'terminal' },
  droid: { authMethod: 'terminal' },
};

type SetupMode = 'api_key' | 'cli';

export interface ProviderSetupClientProps {
  provider: string;
}

export function ProviderSetupClient({ provider }: ProviderSetupClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace') || undefined;

  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [setupMode, setSetupMode] = useState<SetupMode>(workspaceId ? 'cli' : 'api_key');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySuccess, setApiKeySuccess] = useState<string | null>(null);
  const [isSubmittingApiKey, setIsSubmittingApiKey] = useState(false);

  const config = PROVIDER_CONFIGS[provider];

  useEffect(() => {
    fetch('/api/auth/session', { credentials: 'include' })
      .then((res) => {
        const token = res.headers.get('X-CSRF-Token');
        if (token) {
          setCsrfToken(token);
        }
      })
      .catch(() => {
        // Ignore CSRF bootstrap errors here; requests still run without token if server allows.
      });
  }, []);

  const returnPath = workspaceId ? `/app?workspace=${workspaceId}` : '/app/onboarding';

  const handleSuccess = useCallback(() => {
    router.push(returnPath);
  }, [router, returnPath]);

  const handleCancel = useCallback(() => {
    router.push(returnPath);
  }, [router, returnPath]);

  const handleConnectAnother = useCallback(() => {
    if (workspaceId) {
      router.push(`/providers?workspace=${workspaceId}`);
      return;
    }

    router.push('/app/onboarding');
  }, [router, workspaceId]);

  const supportsApiKey = useMemo(
    () => ['anthropic', 'codex', 'openai', 'google'].includes(config?.name || ''),
    [config?.name]
  );

  const authConfig = config ? PROVIDER_AUTH_CONFIG[config.name] : undefined;
  const isOAuthProvider = authConfig?.authMethod === 'oauth';

  const submitApiKey = useCallback(async () => {
    if (!config) {
      return;
    }

    if (!apiKey.trim()) {
      setApiKeyError('Please enter an API key');
      return;
    }

    setIsSubmittingApiKey(true);
    setApiKeyError(null);
    setApiKeySuccess(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const providerCandidates = config.name === 'codex'
        ? ['openai', 'codex']
        : [config.name];

      let connected = false;
      let lastError = 'Failed to connect API key';

      for (const providerName of providerCandidates) {
        const body: Record<string, string> = { apiKey: apiKey.trim() };
        if (workspaceId) {
          body.workspaceId = workspaceId;
        }

        const res = await fetch(`/api/providers/${providerName}/api-key`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(body),
        });

        if (res.ok) {
          connected = true;
          break;
        }

        const data = await res.json().catch(() => ({}));
        lastError = data.error || data.message || 'Failed to connect API key';
      }

      if (!connected) {
        throw new Error(lastError);
      }

      setApiKey('');
      setApiKeySuccess(`${config.displayName} connected successfully.`);
      setTimeout(() => {
        handleSuccess();
      }, 800);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Failed to connect API key');
    } finally {
      setIsSubmittingApiKey(false);
    }
  }, [apiKey, config, csrfToken, handleSuccess, workspaceId]);

  if (!config) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0d1117] to-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <p className="text-error">Unknown provider: {provider}</p>
          <a href="/providers" className="mt-4 text-accent-cyan hover:underline">
            Back to providers
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0d1117] to-[#0a0a0f] p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <a href="/app" className="flex items-center gap-3 group">
            <LogoIcon className="w-8 h-8 text-accent-cyan group-hover:scale-105 transition-transform" />
            <span className="text-lg font-bold text-white">Agent Relay</span>
          </a>
          <a
            href={returnPath}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Skip for now →
          </a>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg"
              style={{
                backgroundColor: config.color,
                boxShadow: `0 4px 20px ${config.color}40`,
              }}
            >
              {config.displayName[0]}
            </div>
            <h1 className="text-2xl font-bold text-white">
              Set up {config.displayName}
            </h1>
          </div>
          <p className="text-text-muted">
            {workspaceId
              ? 'Authenticate provider access for this workspace.'
              : 'Authenticate provider access during onboarding before workspace provisioning.'}
          </p>
        </div>

        {/* Setup mode selector */}
        {supportsApiKey && (
          <div className="mb-6 flex gap-2 p-1 bg-bg-primary/80 backdrop-blur-sm border border-border-subtle rounded-xl">
            <button
              onClick={() => setSetupMode('api_key')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm transition-colors ${
                setupMode === 'api_key'
                  ? 'bg-accent-cyan text-bg-deep font-semibold'
                  : 'text-text-muted hover:text-white'
              }`}
            >
              API Key Input
            </button>
            <button
              onClick={() => setSetupMode('cli')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm transition-colors ${
                setupMode === 'cli'
                  ? 'bg-accent-cyan text-bg-deep font-semibold'
                  : 'text-text-muted hover:text-white'
              }`}
            >
              Authenticate via CLI
            </button>
          </div>
        )}

        {/* API key setup */}
        {supportsApiKey && setupMode === 'api_key' ? (
          <div className="bg-bg-primary/80 backdrop-blur-sm border border-border-subtle rounded-2xl p-6 shadow-2xl space-y-4">
            <p className="text-sm text-text-muted">
              Enter your {config.displayName} API key. In onboarding mode, this is stored at the user level and reused during workspace provisioning.
            </p>
            <div className="flex gap-3">
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={`Enter ${config.displayName} API key`}
                className="flex-1 px-4 py-3 bg-bg-tertiary border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-all"
              />
              <button
                onClick={submitApiKey}
                disabled={isSubmittingApiKey || !apiKey.trim()}
                className="px-5 py-3 bg-accent-cyan text-bg-deep font-semibold rounded-lg text-sm hover:bg-accent-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSubmittingApiKey ? 'Connecting...' : 'Connect'}
              </button>
            </div>

            {apiKeyError && (
              <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-sm text-error">
                {apiKeyError}
              </div>
            )}

            {apiKeySuccess && (
              <div className="p-3 bg-success/10 border border-success/30 rounded-lg text-sm text-success">
                {apiKeySuccess}
              </div>
            )}
          </div>
        ) : isOAuthProvider ? (
          <ProviderAuthFlow
            provider={{
              id: config.name,
              name: config.name,
              displayName: config.displayName,
              color: config.color,
              requiresUrlCopy: authConfig?.requiresUrlCopy,
            }}
            workspaceId={workspaceId}
            mode={workspaceId ? 'workspace' : 'onboarding'}
            csrfToken={csrfToken || undefined}
            showManualDone={!workspaceId}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
            onError={(err) => {
              setApiKeyError(err);
            }}
          />
        ) : workspaceId ? (
          <TerminalProviderSetup
            provider={{
              id: config.id,
              name: config.name,
              displayName: config.displayName,
              color: config.color,
            }}
            workspaceId={workspaceId}
            maxHeight="500px"
            showHeader={true}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
            onConnectAnother={handleConnectAnother}
            onError={(err) => setApiKeyError(err)}
            className="shadow-2xl"
          />
        ) : (
          <div className="bg-bg-primary/80 backdrop-blur-sm border border-border-subtle rounded-2xl p-6 text-center">
            <p className="text-text-muted text-sm">
              Interactive terminal setup requires a workspace. Use API key input or CLI authentication for onboarding mode.
            </p>
          </div>
        )}

        {/* Help text */}
        <div className="mt-6 p-4 bg-bg-primary/80 backdrop-blur-sm border border-border-subtle rounded-xl">
          <h3 className="text-white font-medium mb-2">How this works:</h3>
          {setupMode === 'api_key' && supportsApiKey ? (
            <ol className="text-sm text-text-muted space-y-1 list-decimal list-inside">
              <li>Paste your provider API key</li>
              <li>Click connect to store credentials securely</li>
              <li>Continue back to onboarding or dashboard</li>
            </ol>
          ) : (
            <ol className="text-sm text-text-muted space-y-1 list-decimal list-inside">
              <li>Copy the command shown and run it in your terminal</li>
              <li>Complete the authentication flow in browser/CLI</li>
              <li>Return here and continue once connected</li>
            </ol>
          )}
        </div>

        {/* Fallback link */}
        <div className="mt-4 text-center">
          <a
            href={workspaceId ? `/providers?connect=${config.id}&workspace=${workspaceId}` : '/app/onboarding'}
            className="text-sm text-text-muted hover:text-accent-cyan transition-colors"
          >
            Having trouble? Try another connection method →
          </a>
        </div>
      </div>
    </div>
  );
}

export default ProviderSetupClient;
