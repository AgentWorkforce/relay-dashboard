/**
 * Onboarding Page - Dedicated route for new users and post-deletion flow
 *
 * This page now supports provider-first onboarding after GitHub connection:
 * 1. Determine current onboarding step via /api/onboarding/next-step
 * 2. Connect an AI provider (API key or CLI auth)
 * 3. Auto-create and provision workspace
 */

'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LogoIcon } from '../../../components/Logo';
import { WorkspaceStatusIndicator } from '../../../components/WorkspaceStatusIndicator';
import { getOnboardingNextStep } from '../../../lib/cloudApi';

interface Repository {
  id: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  syncStatus: string;
  hasNangoConnection: boolean;
}

interface NextStepResponse {
  nextStep?: string;
  selectedRepo?: string;
  repositoryFullName?: string;
  repository?: {
    fullName?: string;
  };
  connectedProviders?: string[];
}

type OnboardingReason = 'new' | 'deleted';
type ProviderId = 'anthropic' | 'openai' | 'google';
type AuthMode = 'api_key' | 'cli';
type WorkspaceLifecycleState = 'idle' | 'provisioning' | 'running' | 'error';

type OnboardingEvent =
  | 'onboarding_page_view'
  | 'onboarding_repo_selected'
  | 'onboarding_workspace_created'
  | 'onboarding_connect_repos_clicked';

interface ProviderOption {
  id: ProviderId;
  label: string;
  description: string;
  color: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models via Anthropic',
    color: '#D97757',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Codex and GPT models',
    color: '#10A37F',
  },
  {
    id: 'google',
    label: 'Google',
    description: 'Gemini models via Google AI',
    color: '#4285F4',
  },
];

const PROVIDER_STATUS_NAMES: Record<ProviderId, string[]> = {
  anthropic: ['anthropic'],
  openai: ['openai', 'codex'],
  google: ['google'],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function useOnboardingAnalytics() {
  const trackEvent = useCallback((event: OnboardingEvent, properties?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Onboarding Analytics]', event, properties);
    }

    try {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ event, properties, timestamp: Date.now() }),
      }).catch(() => {
        // Analytics should never block onboarding
      });
    } catch {
      // Analytics should never block onboarding
    }
  }, []);

  return { trackEvent };
}

function OnboardingContent() {
  const searchParams = useSearchParams();
  const reason = (searchParams.get('reason') as OnboardingReason) || 'new';

  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [nextStep, setNextStep] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('anthropic');
  const [authMode, setAuthMode] = useState<AuthMode>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [cliCommand, setCliCommand] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingProvider, setIsSubmittingProvider] = useState(false);
  const [isPollingCli, setIsPollingCli] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  const [workspaceState, setWorkspaceState] = useState<WorkspaceLifecycleState>('idle');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [provisioningStage, setProvisioningStage] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [providerFeedback, setProviderFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const cliPollingRef = useRef(false);
  const workspacePollingRef = useRef(false);

  const { trackEvent } = useOnboardingAnalytics();

  const selectedProviderMeta = useMemo(
    () => PROVIDERS.find((provider) => provider.id === selectedProvider) || PROVIDERS[0],
    [selectedProvider]
  );

  const buildHeaders = useCallback(
    (includeContentType = true): Record<string, string> => {
      const headers: Record<string, string> = includeContentType ? { 'Content-Type': 'application/json' } : {};
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
      return headers;
    },
    [csrfToken]
  );

  const resolveSelectedRepo = useCallback((repositories: Repository[], stepData: NextStepResponse | null): string => {
    const stepRepo =
      stepData?.selectedRepo ||
      stepData?.repositoryFullName ||
      stepData?.repository?.fullName ||
      '';

    if (stepRepo && repositories.some((repo) => repo.fullName === stepRepo)) {
      return stepRepo;
    }

    return repositories[0]?.fullName || '';
  }, []);

  const refreshNextStep = useCallback(async (): Promise<NextStepResponse | null> => {
    try {
      const data = (await getOnboardingNextStep()) as NextStepResponse;
      if (typeof data.nextStep === 'string') {
        setNextStep(data.nextStep);
      }
      return data;
    } catch {
      return null;
    }
  }, []);

  const verifyProviderConnected = useCallback(
    async (statusWorkspaceId?: string): Promise<boolean> => {
      if (statusWorkspaceId) {
        try {
          const statusRes = await fetch(`/api/auth/ssh/status/${statusWorkspaceId}`, {
            credentials: 'include',
          });

          if (statusRes.ok) {
            const statusData = (await statusRes.json()) as {
              providers?: Array<{ name: string; status: string }>;
            };

            const connectedFromStatus = PROVIDER_STATUS_NAMES[selectedProvider].some((providerName) =>
              statusData.providers?.some((provider) => provider.name === providerName && provider.status === 'connected')
            );

            if (connectedFromStatus) {
              return true;
            }
          }
        } catch {
          // Fall through to onboarding next-step check.
        }
      }

      const nextStepData = await refreshNextStep();
      if (!nextStepData) {
        return false;
      }

      if (nextStepData.nextStep && nextStepData.nextStep !== 'connect_ai_provider') {
        return true;
      }

      const connectedProviders = Array.isArray(nextStepData.connectedProviders)
        ? nextStepData.connectedProviders
        : [];

      return PROVIDER_STATUS_NAMES[selectedProvider].some((providerName) => connectedProviders.includes(providerName));
    },
    [refreshNextStep, selectedProvider]
  );

  const pollWorkspaceUntilRunning = useCallback(async (createdWorkspaceId: string): Promise<void> => {
    workspacePollingRef.current = true;

    try {
      const maxAttempts = 150; // 5 minutes at 2s intervals
      let attempts = 0;

      while (workspacePollingRef.current && attempts < maxAttempts) {
        const statusRes = await fetch(`/api/workspaces/${createdWorkspaceId}/status`, {
          credentials: 'include',
        });

        const statusData = (await statusRes.json()) as {
          status?: string;
          errorMessage?: string;
          provisioning?: { stage?: string | null };
        };

        if (statusData.provisioning?.stage) {
          setProvisioningStage(statusData.provisioning.stage);
        }

        if (statusData.status === 'running') {
          setWorkspaceState('running');
          return;
        }

        if (statusData.status === 'error') {
          throw new Error(statusData.errorMessage || 'Workspace provisioning failed');
        }

        await sleep(2000);
        attempts += 1;
      }

      throw new Error('Workspace provisioning timed out after 5 minutes.');
    } finally {
      workspacePollingRef.current = false;
    }
  }, []);

  const startWorkspaceCreation = useCallback(
    async (repoFullName?: string) => {
      const repository = repoFullName || selectedRepo;

      if (!repository || isCreatingWorkspace || workspaceState === 'provisioning' || workspaceState === 'running') {
        return;
      }

      setError(null);
      setWorkspaceState('provisioning');
      setProvisioningStage(null);
      setIsCreatingWorkspace(true);

      trackEvent('onboarding_repo_selected', { repository });

      try {
        const res = await fetch('/api/workspaces/quick', {
          method: 'POST',
          credentials: 'include',
          headers: buildHeaders(),
          body: JSON.stringify({ repositoryFullName: repository }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to create workspace');
        }

        if (!data.workspaceId || typeof data.workspaceId !== 'string') {
          throw new Error('Workspace created but no workspace ID was returned');
        }

        setWorkspaceId(data.workspaceId);
        await pollWorkspaceUntilRunning(data.workspaceId);

        trackEvent('onboarding_workspace_created', {
          workspaceId: data.workspaceId,
          repository,
        });
      } catch (err) {
        setWorkspaceState('error');
        setError(err instanceof Error ? err.message : 'Failed to create workspace');
      } finally {
        setIsCreatingWorkspace(false);
      }
    },
    [selectedRepo, isCreatingWorkspace, workspaceState, trackEvent, buildHeaders, pollWorkspaceUntilRunning]
  );

  const pollForCliCompletion = useCallback(
    async (statusWorkspaceId?: string): Promise<boolean> => {
      cliPollingRef.current = true;
      setIsPollingCli(true);

      try {
        const maxAttempts = 120; // 10 minutes at 5s intervals
        let attempts = 0;

        while (cliPollingRef.current && attempts < maxAttempts) {
          const connected = await verifyProviderConnected(statusWorkspaceId);
          if (connected) {
            setProviderFeedback({ type: 'success', text: `${selectedProviderMeta.label} connected successfully.` });
            setNextStep('create_workspace');
            return true;
          }

          await sleep(5000);
          attempts += 1;
        }

        return false;
      } finally {
        cliPollingRef.current = false;
        setIsPollingCli(false);
      }
    },
    [selectedProviderMeta.label, verifyProviderConnected]
  );

  useEffect(() => {
    const init = async () => {
      try {
        const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });

        if (sessionRes.status === 404) {
          window.location.href = '/app';
          return;
        }

        const token = sessionRes.headers.get('X-CSRF-Token');
        if (token) {
          setCsrfToken(token);
        }

        const session = await sessionRes.json();

        if (!session.authenticated) {
          window.location.href = '/login';
          return;
        }

        const workspacesRes = await fetch('/api/workspaces', { credentials: 'include' });
        if (workspacesRes.ok) {
          const workspacesData = await workspacesRes.json();
          if ((workspacesData.workspaces || []).length > 0) {
            window.location.href = '/app';
            return;
          }
        }

        const reposRes = await fetch('/api/github-app/repos', { credentials: 'include' });
        const repositories: Repository[] = [];

        if (reposRes.ok) {
          const reposData = await reposRes.json();
          repositories.push(...(reposData.repositories || []));
        }

        setRepos(repositories);

        let nextStepData: NextStepResponse | null = null;
        try {
          nextStepData = (await getOnboardingNextStep()) as NextStepResponse;
        } catch {
          nextStepData = null;
        }

        const calculatedStep =
          nextStepData?.nextStep ||
          (repositories.length > 0 ? 'connect_ai_provider' : 'connect_repos');

        setNextStep(calculatedStep);
        setSelectedRepo(resolveSelectedRepo(repositories, nextStepData));

        trackEvent('onboarding_page_view', { reason, nextStep: calculatedStep });
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
        setIsLoading(false);
      }
    };

    init();

    return () => {
      cliPollingRef.current = false;
      workspacePollingRef.current = false;
    };
  }, [reason, resolveSelectedRepo, trackEvent]);

  useEffect(() => {
    if (
      !isLoading &&
      repos.length > 0 &&
      selectedRepo &&
      nextStep !== null &&
      nextStep !== 'connect_ai_provider' &&
      !workspaceId &&
      workspaceState === 'idle' &&
      !isCreatingWorkspace
    ) {
      startWorkspaceCreation(selectedRepo);
    }
  }, [
    isLoading,
    repos.length,
    selectedRepo,
    nextStep,
    workspaceId,
    workspaceState,
    isCreatingWorkspace,
    startWorkspaceCreation,
  ]);

  const handleConnectRepos = useCallback(() => {
    trackEvent('onboarding_connect_repos_clicked', { reason });
    window.location.href = '/connect-repos';
  }, [reason, trackEvent]);

  const handleConnectApiKey = useCallback(async () => {
    if (!apiKey.trim()) {
      setProviderFeedback({ type: 'error', text: 'Please enter an API key.' });
      return;
    }

    if (!selectedRepo) {
      setProviderFeedback({ type: 'error', text: 'Select a repository before connecting a provider.' });
      return;
    }

    setIsSubmittingProvider(true);
    setProviderFeedback(null);
    setError(null);

    try {
      const providerCandidates = selectedProvider === 'openai' ? ['openai', 'codex'] : [selectedProvider];
      let lastError = 'Failed to connect provider';
      let connected = false;

      for (const providerName of providerCandidates) {
        const res = await fetch(`/api/providers/${providerName}/api-key`, {
          method: 'POST',
          credentials: 'include',
          headers: buildHeaders(),
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        });

        if (res.ok) {
          connected = true;
          break;
        }

        const data = await res.json().catch(() => ({}));
        lastError = data.error || data.message || `Failed to connect ${selectedProviderMeta.label}`;
      }

      if (!connected) {
        throw new Error(lastError);
      }

      setApiKey('');
      setProviderFeedback({ type: 'success', text: `${selectedProviderMeta.label} connected.` });
      setNextStep('create_workspace');
      await startWorkspaceCreation(selectedRepo);
    } catch (err) {
      setProviderFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to connect provider',
      });
    } finally {
      setIsSubmittingProvider(false);
    }
  }, [apiKey, selectedRepo, selectedProvider, selectedProviderMeta.label, buildHeaders, startWorkspaceCreation]);

  const handleStartCliAuth = useCallback(async () => {
    if (!selectedRepo) {
      setProviderFeedback({ type: 'error', text: 'Select a repository before starting provider auth.' });
      return;
    }

    setIsSubmittingProvider(true);
    setProviderFeedback(null);
    setCliCommand(null);
    setError(null);

    try {
      const headers = buildHeaders();
      const providerCandidates = selectedProvider === 'openai' ? ['openai', 'codex'] : [selectedProvider];

      let initData: { command?: string; commandWithUrl?: string; workspaceId?: string } | null = null;
      let lastError = 'Failed to start CLI authentication';

      for (const providerName of providerCandidates) {
        const res = await fetch('/api/auth/ssh/init', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({
            provider: providerName,
            mode: 'onboarding',
          }),
        });

        if (res.ok) {
          initData = (await res.json()) as { command?: string; commandWithUrl?: string; workspaceId?: string };
          break;
        }

        const data = await res.json().catch(() => ({}));
        lastError = data.error || data.message || 'Failed to start CLI authentication';
      }

      if (!initData) {
        throw new Error(lastError);
      }

      const rawCommand = initData.commandWithUrl || initData.command;
      if (!rawCommand) {
        throw new Error('Auth broker did not return a command');
      }

      const commandWithNpx = rawCommand.trim().startsWith('npx ') ? rawCommand : `npx ${rawCommand}`;
      setCliCommand(commandWithNpx);
      setProviderFeedback({
        type: 'info',
        text: 'Run the command below in your terminal. This page will update automatically when auth completes.',
      });

      const connected = await pollForCliCompletion(initData.workspaceId);
      if (connected) {
        await startWorkspaceCreation(selectedRepo);
      } else {
        setProviderFeedback({
          type: 'error',
          text: 'Still waiting for authentication. Complete the CLI flow, then click "Done".',
        });
      }
    } catch (err) {
      setProviderFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to start CLI authentication',
      });
    } finally {
      setIsSubmittingProvider(false);
    }
  }, [buildHeaders, selectedProvider, selectedRepo, pollForCliCompletion, startWorkspaceCreation]);

  const handleCliDone = useCallback(async () => {
    setIsSubmittingProvider(true);
    try {
      const connected = await verifyProviderConnected();
      if (!connected) {
        setProviderFeedback({
          type: 'error',
          text: 'Provider is not connected yet. Complete the CLI authentication first.',
        });
        return;
      }

      setProviderFeedback({ type: 'success', text: `${selectedProviderMeta.label} connected.` });
      setNextStep('create_workspace');
      await startWorkspaceCreation(selectedRepo);
    } finally {
      setIsSubmittingProvider(false);
    }
  }, [selectedProviderMeta.label, selectedRepo, startWorkspaceCreation, verifyProviderConnected]);

  const handleCopyCommand = useCallback(async () => {
    if (!cliCommand) {
      return;
    }
    await navigator.clipboard.writeText(cliCommand);
    setProviderFeedback({ type: 'info', text: 'CLI command copied to clipboard.' });
  }, [cliCommand]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0d1117] to-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <svg className="w-8 h-8 text-accent-cyan animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-4 text-text-muted">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  if (workspaceState === 'provisioning' || isCreatingWorkspace) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0d1117] to-[#0a0a0f] flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-bg-primary/80 backdrop-blur-sm border border-border-subtle rounded-2xl p-8">
          <div className="text-center mb-6">
            <LogoIcon size={48} withGlow={true} />
            <h1 className="mt-4 text-2xl font-bold text-white">Provisioning Workspace</h1>
            <p className="mt-2 text-text-muted">
              Setting up your environment for <span className="text-white">{selectedRepo}</span>.
            </p>
          </div>

          <WorkspaceStatusIndicator expanded={true} className="mb-6" />

          <div className="flex items-center gap-3 p-4 bg-accent-cyan/10 border border-accent-cyan/30 rounded-xl">
            <svg className="w-5 h-5 text-accent-cyan animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div>
              <p className="text-sm text-white font-medium">Creating compute resources</p>
              <p className="text-xs text-text-muted">
                {provisioningStage ? `Stage: ${provisioningStage}` : 'Preparing machine and services...'}
              </p>
            </div>
          </div>

          {workspaceId && (
            <p className="mt-4 text-xs text-text-muted text-center">Workspace ID: {workspaceId}</p>
          )}

          {error && (
            <div className="mt-4 p-3 bg-error/10 border border-error/30 rounded-lg text-sm text-error">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (workspaceState === 'running' && workspaceId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0d1117] to-[#0a0a0f] flex items-center justify-center p-4">
        <div className="w-full max-w-xl bg-bg-primary/80 backdrop-blur-sm border border-border-subtle rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Workspace Ready</h1>
          <p className="mt-2 text-text-muted">
            Your workspace is running and ready for your first agent.
          </p>
          <a
            href={`/app?workspace=${workspaceId}`}
            className="mt-6 inline-flex items-center gap-2 py-3 px-6 bg-gradient-to-r from-accent-cyan to-[#00b8d9] text-bg-deep font-semibold rounded-xl hover:shadow-glow-cyan transition-all"
          >
            Spawn your first agent
          </a>
        </div>
      </div>
    );
  }

  const isDeletedWorkspace = reason === 'deleted';
  const showProviderStep = repos.length > 0 && nextStep === 'connect_ai_provider';

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0d1117] to-[#0a0a0f] flex flex-col items-center justify-center p-4">
      <div className="fixed inset-0 opacity-10 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(0, 217, 255, 0.1) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(0, 217, 255, 0.1) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-2xl">
        <div className="flex flex-col items-center mb-8">
          <LogoIcon size={56} withGlow={true} />
          <h1 className="mt-6 text-3xl font-bold text-white">
            {isDeletedWorkspace ? 'Workspace Deleted' : 'Welcome to Agent Relay'}
          </h1>
          <p className="mt-3 text-text-muted text-center max-w-md">
            {isDeletedWorkspace
              ? 'Your workspace was deleted. Reconnect and provision a new environment to continue.'
              : 'Connect an AI provider, then we will automatically provision your first workspace.'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/20 rounded-xl">
            <p className="text-error text-center">{error}</p>
          </div>
        )}

        <div className="bg-bg-primary/80 backdrop-blur-sm border border-border-subtle rounded-2xl p-8">
          {repos.length > 0 && (
            <div className="flex items-center justify-center gap-3 mb-8">
              <StepBadge label="Repository" active={Boolean(selectedRepo)} done={Boolean(selectedRepo)} />
              <div className="w-12 h-px bg-border-subtle" />
              <StepBadge
                label="Provider"
                active={showProviderStep}
                done={nextStep !== 'connect_ai_provider'}
              />
              <div className="w-12 h-px bg-border-subtle" />
              <StepBadge label="Provision" active={false} done={false} />
            </div>
          )}

          {repos.length === 0 ? (
            <div className="text-center py-8 bg-bg-tertiary rounded-xl border border-border-subtle">
              <h3 className="text-lg font-semibold text-white mb-2">No Repositories Connected</h3>
              <p className="text-text-muted mb-6 max-w-sm mx-auto">
                Connect your GitHub repositories to continue onboarding.
              </p>
              <button
                onClick={handleConnectRepos}
                className="inline-flex items-center gap-2 py-3 px-6 bg-gradient-to-r from-accent-cyan to-[#00b8d9] text-bg-deep font-semibold rounded-xl hover:shadow-glow-cyan transition-all"
              >
                Connect GitHub
              </button>
            </div>
          ) : showProviderStep ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm text-text-muted mb-2">Repository</label>
                <select
                  value={selectedRepo}
                  onChange={(event) => setSelectedRepo(event.target.value)}
                  className="w-full px-4 py-3 bg-bg-tertiary border border-border-subtle rounded-xl text-white focus:outline-none focus:border-accent-cyan/50"
                >
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.fullName}>
                      {repo.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p className="text-sm text-text-muted mb-3">Select AI provider</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PROVIDERS.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => setSelectedProvider(provider.id)}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        selectedProvider === provider.id
                          ? 'border-accent-cyan bg-accent-cyan/10'
                          : 'border-border-subtle bg-bg-tertiary hover:border-accent-cyan/40'
                      }`}
                    >
                      <p className="text-white font-medium">{provider.label}</p>
                      <p className="text-xs text-text-muted mt-1">{provider.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 p-1 bg-bg-tertiary rounded-xl border border-border-subtle">
                <button
                  type="button"
                  onClick={() => setAuthMode('api_key')}
                  className={`flex-1 py-2.5 px-4 text-sm rounded-lg transition-colors ${
                    authMode === 'api_key' ? 'bg-accent-cyan text-bg-deep font-semibold' : 'text-text-muted hover:text-white'
                  }`}
                >
                  API Key Input
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('cli')}
                  className={`flex-1 py-2.5 px-4 text-sm rounded-lg transition-colors ${
                    authMode === 'cli' ? 'bg-accent-cyan text-bg-deep font-semibold' : 'text-text-muted hover:text-white'
                  }`}
                >
                  Authenticate via CLI
                </button>
              </div>

              {authMode === 'api_key' ? (
                <div className="space-y-3">
                  <label className="block text-sm text-text-muted">{selectedProviderMeta.label} API Key</label>
                  <div className="flex gap-3">
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder="Paste API key"
                      className="flex-1 px-4 py-3 bg-bg-tertiary border border-border-subtle rounded-xl text-white placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50"
                    />
                    <button
                      type="button"
                      onClick={handleConnectApiKey}
                      disabled={isSubmittingProvider || !apiKey.trim()}
                      className="px-5 py-3 bg-accent-cyan text-bg-deep font-semibold rounded-xl hover:bg-accent-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSubmittingProvider ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleStartCliAuth}
                    disabled={isSubmittingProvider}
                    className="w-full py-3 px-4 bg-gradient-to-r from-accent-cyan to-[#00b8d9] text-bg-deep font-semibold rounded-xl hover:shadow-glow-cyan transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isSubmittingProvider ? 'Starting auth...' : 'Authenticate via CLI'}
                  </button>

                  {cliCommand && (
                    <div className="p-3 bg-bg-tertiary border border-border-subtle rounded-xl space-y-3">
                      <p className="text-xs text-text-muted">Run this command in your terminal:</p>
                      <code className="block px-3 py-2 bg-bg-deep rounded-lg text-xs text-white overflow-x-auto">
                        {cliCommand}
                      </code>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCopyCommand}
                          className="px-3 py-2 bg-bg-card border border-border-subtle text-text-muted rounded-lg text-xs hover:text-white hover:border-accent-cyan/50 transition-colors"
                        >
                          Copy command
                        </button>
                        <button
                          type="button"
                          onClick={handleCliDone}
                          disabled={isSubmittingProvider}
                          className="px-3 py-2 bg-accent-cyan text-bg-deep rounded-lg text-xs font-semibold hover:bg-accent-cyan/90 disabled:opacity-50 transition-colors"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}

                  {isPollingCli && (
                    <div className="flex items-center gap-2 text-sm text-success p-3 bg-success/10 border border-success/30 rounded-lg">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span>Waiting for authentication to complete...</span>
                    </div>
                  )}
                </div>
              )}

              {providerFeedback && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    providerFeedback.type === 'success'
                      ? 'bg-success/10 border border-success/30 text-success'
                      : providerFeedback.type === 'error'
                        ? 'bg-error/10 border border-error/30 text-error'
                        : 'bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan'
                  }`}
                >
                  {providerFeedback.text}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <svg className="w-8 h-8 text-accent-cyan animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="mt-4 text-white font-medium">Preparing workspace provisioning...</p>
              <p className="mt-2 text-text-muted text-sm">You will be redirected automatically when ready.</p>
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-center gap-6 text-sm">
          {repos.length > 0 && (
            <button onClick={handleConnectRepos} className="text-text-muted hover:text-white transition-colors">
              Connect More Repositories
            </button>
          )}
          <a href="/app" className="text-text-muted hover:text-white transition-colors">
            Back to Dashboard
          </a>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
                headers: buildHeaders(false),
              });
              window.location.href = '/login';
            }}
            className="text-text-muted hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function StepBadge({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
          done
            ? 'bg-success text-bg-deep'
            : active
              ? 'bg-accent-cyan text-bg-deep'
              : 'bg-bg-tertiary border border-border-subtle text-text-muted'
        }`}
      >
        {done ? '✓' : label[0]}
      </div>
      <span className={`${active || done ? 'text-white' : 'text-text-muted'} text-sm`}>{label}</span>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0d1117] to-[#0a0a0f] flex items-center justify-center">
          <div className="text-center">
            <svg className="w-8 h-8 text-accent-cyan animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="mt-4 text-text-muted">Loading...</p>
          </div>
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
