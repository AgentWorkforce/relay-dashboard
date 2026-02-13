/**
 * Workspace Settings Panel
 *
 * Manage workspace configuration including repositories,
 * AI providers, custom domains, and agent policies.
 *
 * Design: Mission Control theme with deep space aesthetic
 */

import React, { useState, useEffect, useCallback } from 'react';
import { cloudApi } from '../../lib/cloudApi';
import { ProviderAuthFlow } from '../ProviderAuthFlow';
import { TerminalProviderSetup } from '../TerminalProviderSetup';
import { RepositoriesPanel } from '../RepositoriesPanel';
import { IntegrationConnect } from '../IntegrationConnect';
import { SlackIntegrationPanel } from './SlackIntegrationPanel';

export interface WorkspaceSettingsPanelProps {
  workspaceId: string;
  csrfToken?: string;
  onClose?: () => void;
  onReposChanged?: () => void;
}

interface WorkspaceDetails {
  id: string;
  name: string;
  status: string;
  publicUrl?: string;
  computeProvider: string;
  config: {
    providers: string[];
    repositories: string[];
    supervisorEnabled?: boolean;
    maxAgents?: number;
  };
  customDomain?: string;
  customDomainStatus?: string;
  errorMessage?: string;
  repositories: Array<{
    id: string;
    fullName: string;
    syncStatus: string;
    lastSyncedAt?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface AvailableRepo {
  id: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  syncStatus: string;
  hasNangoConnection: boolean;
  lastSyncedAt?: string;
}

interface AIProvider {
  id: string;
  name: string;
  displayName: string;
  description: string;
  color: string;
  cliCommand: string;
  apiKeyUrl?: string;
  apiKeyName?: string;
  supportsOAuth?: boolean;
  preferApiKey?: boolean; // Show API key input by default (simpler for mobile/containers)
  isConnected?: boolean;
  comingSoon?: boolean; // Provider is not yet fully tested/available
}

const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'anthropic',
    name: 'anthropic', // Must be lowercase to match backend validation
    displayName: 'Claude',
    description: 'Claude Code - recommended for code tasks',
    color: '#D97757',
    cliCommand: 'claude',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    apiKeyName: 'API key',
    supportsOAuth: true,
  },
  {
    id: 'codex',
    name: 'codex', // Must match backend provider key
    displayName: 'Codex',
    description: 'Codex - OpenAI coding assistant',
    color: '#10A37F',
    cliCommand: 'codex login',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    apiKeyName: 'API key',
    supportsOAuth: true,
  },
  {
    id: 'google',
    name: 'google', // Must be lowercase to match backend validation
    displayName: 'Gemini',
    description: 'Gemini - Google AI coding assistant',
    color: '#4285F4',
    cliCommand: 'gemini',
    // No apiKeyUrl - Gemini uses interactive terminal where user can choose OAuth or API key
    supportsOAuth: true,
  },
  {
    id: 'opencode',
    name: 'opencode', // Must be lowercase to match backend validation
    displayName: 'OpenCode',
    description: 'OpenCode - AI coding assistant',
    color: '#00D4AA',
    cliCommand: 'opencode',
    supportsOAuth: true,
    comingSoon: true, // Not yet fully tested
  },
  {
    id: 'droid',
    name: 'factory', // Must be lowercase to match backend validation
    displayName: 'Droid',
    description: 'Droid - Factory AI coding agent',
    color: '#6366F1',
    cliCommand: 'droid',
    supportsOAuth: true,
    comingSoon: true, // Not yet fully tested
  },
  {
    id: 'cursor',
    name: 'cursor', // Must be lowercase to match backend validation
    displayName: 'Cursor',
    description: 'Cursor - AI-first code editor agent',
    color: '#7C3AED',
    cliCommand: 'agent',
    supportsOAuth: true,
  },
];

export function WorkspaceSettingsPanel({
  workspaceId,
  csrfToken,
  onClose,
  onReposChanged,
}: WorkspaceSettingsPanelProps) {
  const [workspace, setWorkspace] = useState<WorkspaceDetails | null>(null);
  const [availableRepos, setAvailableRepos] = useState<AvailableRepo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'general' | 'providers' | 'integrations' | 'repos' | 'github-access' | 'domain' | 'danger'>('general');

  // Slack integration collapsed state
  const [slackExpanded, setSlackExpanded] = useState(false);

  // Provider connection state
  const [providerStatus, setProviderStatus] = useState<Record<string, boolean>>({});
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [providerError, setProviderError] = useState<string | null>(null);
  const [showApiKeyFallback, setShowApiKeyFallback] = useState<Record<string, boolean>>({});
  // Use terminal-based setup (default for Claude, Cursor, and Gemini - Codex uses CLI helper flow)
  const [useTerminalSetup, setUseTerminalSetup] = useState<Record<string, boolean>>({
    anthropic: false, // CLI-assisted SSH tunnel flow for Claude
    cursor: false,    // CLI-assisted SSH tunnel flow for Cursor
    google: true,     // Default to terminal for Gemini - allows choosing OAuth or API key
  });

  // CLI command copy state

  // Provider disconnection state
  const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null);

  // Repo sync state
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);

  // Custom domain form
  const [customDomain, setCustomDomain] = useState('');
  const [domainLoading, setDomainLoading] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [domainInstructions, setDomainInstructions] = useState<{
    type: string;
    name: string;
    value: string;
    ttl: number;
  } | null>(null);

  // Load workspace details
  useEffect(() => {
    // Skip loading if workspaceId is invalid (not a UUID)
    if (!workspaceId || workspaceId === 'default' || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
      setIsLoading(false);
      return;
    }

    async function loadWorkspace() {
      setIsLoading(true);
      setError(null);

      const [wsResult, reposResult, providersResult] = await Promise.all([
        cloudApi.getWorkspaceDetails(workspaceId),
        cloudApi.getRepos(),
        cloudApi.getProviders(workspaceId),
      ]);

      if (wsResult.success) {
        setWorkspace(wsResult.data);
        if (wsResult.data.customDomain) {
          setCustomDomain(wsResult.data.customDomain);
        }
      } else {
        setError(wsResult.error);
      }

      if (reposResult.success) {
        setAvailableRepos(reposResult.data.repositories);
      }

      // Mark connected providers for this workspace
      if (providersResult.success) {
        const connected: Record<string, boolean> = {};
        providersResult.data.providers.forEach((p) => {
          if (p.isConnected) {
            connected[p.id] = true;
            // Map backend 'openai' to frontend 'codex' for consistency
            if (p.id === 'openai') {
              connected['codex'] = true;
            }
          }
        });
        setProviderStatus(connected);
      }

      setIsLoading(false);
    }

    loadWorkspace();
  }, [workspaceId]);

  // Start CLI-based OAuth flow for a provider
  // This just sets state to show the ProviderAuthFlow component, which handles the actual auth
  const startOAuthFlow = (provider: AIProvider) => {
    setProviderError(null);
    setConnectingProvider(provider.id);
    // ProviderAuthFlow will handle the rest when it mounts
  };

  // Disconnect a provider
  const handleDisconnectProvider = useCallback(async (provider: AIProvider) => {
    const confirmed = window.confirm(
      `Are you sure you want to disconnect ${provider.displayName}? This will remove the authentication and delete credential files from the workspace.`
    );
    if (!confirmed) return;

    setDisconnectingProvider(provider.id);
    setProviderError(null);

    try {
      const result = await cloudApi.disconnectProvider(provider.id, workspaceId);
      if (result.success) {
        setProviderStatus(prev => {
          const updated = { ...prev };
          delete updated[provider.id];
          return updated;
        });
      } else {
        setProviderError(result.error);
      }
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : 'Failed to disconnect provider');
    } finally {
      setDisconnectingProvider(null);
    }
  }, [workspaceId]);

  const submitApiKey = async (provider: AIProvider) => {
    if (!apiKeyInput.trim()) {
      setProviderError('Please enter an API key');
      return;
    }

    setProviderError(null);
    setConnectingProvider(provider.id);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch(`/api/onboarding/token/${provider.id}`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ token: apiKeyInput.trim(), workspaceId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to connect');
      }

      setProviderStatus(prev => ({ ...prev, [provider.id]: true }));
      setApiKeyInput('');
      setConnectingProvider(null);
      setShowApiKeyFallback(prev => ({ ...prev, [provider.id]: false }));
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : 'Failed to connect');
      setConnectingProvider(null);
    }
  };

  // Restart workspace
  const handleRestart = useCallback(async () => {
    if (!workspace) return;

    const confirmed = window.confirm('Are you sure you want to restart this workspace?');
    if (!confirmed) return;

    const result = await cloudApi.restartWorkspace(workspace.id);
    if (result.success) {
      const wsResult = await cloudApi.getWorkspaceDetails(workspaceId);
      if (wsResult.success) {
        setWorkspace(wsResult.data);
      }
    } else {
      setError(result.error);
    }
  }, [workspace, workspaceId]);

  // Stop workspace
  const handleStop = useCallback(async () => {
    if (!workspace) return;

    const confirmed = window.confirm('Are you sure you want to stop this workspace?');
    if (!confirmed) return;

    const result = await cloudApi.stopWorkspace(workspace.id);
    if (result.success) {
      const wsResult = await cloudApi.getWorkspaceDetails(workspaceId);
      if (wsResult.success) {
        setWorkspace(wsResult.data);
      }
    } else {
      setError(result.error);
    }
  }, [workspace, workspaceId]);

  // Add repository to workspace
  const handleAddRepo = useCallback(async (repoId: string) => {
    if (!workspace) return;

    const result = await cloudApi.addReposToWorkspace(workspace.id, [repoId]);
    if (result.success) {
      const wsResult = await cloudApi.getWorkspaceDetails(workspaceId);
      if (wsResult.success) {
        setWorkspace(wsResult.data);
      }
    } else {
      setError(result.error);
    }
  }, [workspace, workspaceId]);

  // Sync repository to workspace (clone/pull)
  const handleSyncRepo = useCallback(async (repoId: string) => {
    if (!workspace) return;

    setSyncingRepoId(repoId);
    setError(null);

    const result = await cloudApi.syncRepo(repoId);
    if (result.success) {
      // Refresh workspace to get updated sync status
      const wsResult = await cloudApi.getWorkspaceDetails(workspaceId);
      if (wsResult.success) {
        setWorkspace(wsResult.data);
      }
    } else {
      setError(result.error);
    }

    setSyncingRepoId(null);
  }, [workspace, workspaceId]);

  // Set custom domain
  const handleSetDomain = useCallback(async () => {
    if (!workspace || !customDomain.trim()) return;

    setDomainLoading(true);
    setDomainError(null);
    setDomainInstructions(null);

    const result = await cloudApi.setCustomDomain(workspace.id, customDomain.trim());
    if (result.success) {
      setDomainInstructions(result.data.instructions);
      const wsResult = await cloudApi.getWorkspaceDetails(workspaceId);
      if (wsResult.success) {
        setWorkspace(wsResult.data);
      }
    } else {
      setDomainError(result.error);
    }

    setDomainLoading(false);
  }, [workspace, customDomain, workspaceId]);

  // Verify custom domain
  const handleVerifyDomain = useCallback(async () => {
    if (!workspace) return;

    setDomainLoading(true);
    setDomainError(null);

    const result = await cloudApi.verifyCustomDomain(workspace.id);
    if (result.success) {
      const wsResult = await cloudApi.getWorkspaceDetails(workspaceId);
      if (wsResult.success) {
        setWorkspace(wsResult.data);
      }
      if (result.data.status === 'active') {
        setDomainInstructions(null);
      }
    } else {
      setDomainError(result.error);
    }

    setDomainLoading(false);
  }, [workspace, workspaceId]);

  // Remove custom domain
  const handleRemoveDomain = useCallback(async () => {
    if (!workspace) return;

    const confirmed = window.confirm('Are you sure you want to remove the custom domain?');
    if (!confirmed) return;

    setDomainLoading(true);
    const result = await cloudApi.removeCustomDomain(workspace.id);
    if (result.success) {
      setCustomDomain('');
      setDomainInstructions(null);
      const wsResult = await cloudApi.getWorkspaceDetails(workspaceId);
      if (wsResult.success) {
        setWorkspace(wsResult.data);
      }
    } else {
      setDomainError(result.error);
    }
    setDomainLoading(false);
  }, [workspace, workspaceId]);

  // Delete workspace
  const handleDelete = useCallback(async () => {
    if (!workspace) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${workspace.name}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    const doubleConfirm = window.confirm(
      'This will permanently delete all workspace data. Are you absolutely sure?'
    );
    if (!doubleConfirm) return;

    const result = await cloudApi.deleteWorkspace(workspace.id);
    if (result.success) {
      // Redirect to onboarding page with deleted reason
      window.location.href = '/app/onboarding?reason=deleted';
    } else {
      setError(result.error);
    }
  }, [workspace]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full bg-accent-cyan/40 animate-pulse" />
          </div>
        </div>
        <span className="ml-4 text-text-muted font-mono text-sm tracking-wide">
          LOADING WORKSPACE CONFIG...
        </span>
      </div>
    );
  }

  if (error && !workspace) {
    return (
      <div className="p-6">
        <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error flex items-center gap-3">
          <AlertIcon />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!workspace) {
    return null;
  }

  const unassignedRepos = availableRepos.filter(
    (r) => !workspace.repositories.some((wr) => wr.id === r.id)
  );

  const sections = [
    { id: 'general', label: 'General', icon: <SettingsGearIcon /> },
    { id: 'providers', label: 'AI Providers', icon: <ProviderIcon /> },
    { id: 'integrations', label: 'Integrations', icon: <IntegrationIcon /> },
    { id: 'repos', label: 'Repositories', icon: <RepoIcon /> },
    { id: 'domain', label: 'Domain', icon: <GlobeIcon /> },
    { id: 'danger', label: 'Danger', icon: <AlertIcon /> },
  ];

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Section Navigation - horizontally scrollable on mobile */}
      <div
        className="flex gap-1 p-2 sm:p-3 border-b border-border-subtle bg-gradient-to-b from-bg-tertiary to-bg-primary overflow-x-auto scrollbar-hide scroll-smooth snap-x snap-mandatory touch-pan-x"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id as typeof activeSection)}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap shrink-0 snap-start ${
              activeSection === section.id
                ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30 shadow-[0_0_12px_rgba(0,217,255,0.15)]'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-transparent'
            }`}
          >
            <span className={activeSection === section.id ? 'text-accent-cyan' : 'text-text-muted'}>
              {section.icon}
            </span>
            {section.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {error && (
          <div className="mb-6 p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm flex items-center gap-3">
            <AlertIcon />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-error/60 hover:text-error">
              <CloseIcon />
            </button>
          </div>
        )}

        {/* General Section */}
        {activeSection === 'general' && (
          <div className="space-y-8">
            <SectionHeader
              title="Workspace Overview"
              subtitle="Core configuration and status"
            />

            <div className="grid grid-cols-2 gap-4">
              <InfoCard label="Name" value={workspace.name} />
              <InfoCard
                label="Status"
                value={workspace.status.charAt(0).toUpperCase() + workspace.status.slice(1)}
                valueColor={
                  workspace.status === 'running' ? 'text-success' :
                  workspace.status === 'stopped' ? 'text-amber-400' :
                  workspace.status === 'error' ? 'text-error' : 'text-text-muted'
                }
                indicator={workspace.status === 'running'}
              />
              <InfoCard
                label="Public URL"
                value={workspace.publicUrl || 'Not available'}
                mono
              />
              <InfoCard
                label="Compute Provider"
                value={workspace.computeProvider.charAt(0).toUpperCase() + workspace.computeProvider.slice(1)}
              />
            </div>

            <div>
              <SectionHeader title="Actions" subtitle="Manage workspace state" />
              <div className="flex gap-3 mt-4">
                {workspace.status === 'running' && (
                  <ActionButton
                    onClick={handleStop}
                    variant="warning"
                    icon={<StopIcon />}
                  >
                    Stop Workspace
                  </ActionButton>
                )}
                <ActionButton
                  onClick={handleRestart}
                  variant="primary"
                  icon={<RestartIcon />}
                >
                  Restart Workspace
                </ActionButton>
              </div>
            </div>
          </div>
        )}

        {/* AI Providers Section */}
        {activeSection === 'providers' && (
          <div className="space-y-8">
            <SectionHeader
              title="AI Providers"
              subtitle="Connect AI providers to spawn agents in this workspace"
            />

            {providerError && (
              <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm flex items-center gap-3">
                <AlertIcon />
                <span>{providerError}</span>
              </div>
            )}

            <div className="space-y-4">
              {AI_PROVIDERS.map((provider) => (
                <div
                  key={provider.id}
                  className={`p-5 bg-bg-tertiary rounded-xl border border-border-subtle transition-all duration-200 ${
                    provider.comingSoon ? 'opacity-60' : 'hover:border-border-medium'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg ${
                          provider.comingSoon ? 'grayscale' : ''
                        }`}
                        style={{
                          backgroundColor: provider.color,
                          boxShadow: provider.comingSoon ? 'none' : `0 4px 20px ${provider.color}40`,
                        }}
                      >
                        {provider.displayName[0]}
                      </div>
                      <div>
                        <h4 className="text-base font-semibold text-text-primary flex items-center gap-2">
                          {provider.displayName}
                          {provider.comingSoon && (
                            <span className="px-2 py-0.5 bg-amber-400/20 text-amber-400 text-xs font-medium rounded-full">
                              Coming Soon
                            </span>
                          )}
                        </h4>
                        <p className="text-sm text-text-muted">{provider.description}</p>
                      </div>
                    </div>

                    {provider.comingSoon ? (
                      <div className="px-4 py-2 bg-bg-card rounded-full border border-border-subtle">
                        <span className="text-sm text-text-muted">Not available yet</span>
                      </div>
                    ) : providerStatus[provider.id] ? (
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-4 py-2 bg-success/15 rounded-full border border-success/30">
                          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                          <span className="text-sm font-medium text-success">Connected</span>
                        </div>
                        <button
                          onClick={() => handleDisconnectProvider(provider)}
                          disabled={disconnectingProvider === provider.id}
                          className="px-3 py-2 text-xs font-medium text-error/80 hover:text-error hover:bg-error/10 rounded-lg border border-transparent hover:border-error/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          title={`Disconnect ${provider.displayName}`}
                        >
                          {disconnectingProvider === provider.id ? 'Disconnecting...' : 'Disconnect'}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {!providerStatus[provider.id] && !provider.comingSoon && (
                    <div className="mt-5 pt-5 border-t border-border-subtle">
                      {connectingProvider === provider.id && !showApiKeyFallback[provider.id] ? (
                        useTerminalSetup[provider.id] ? (
                          <TerminalProviderSetup
                            provider={{
                              id: provider.id,
                              name: provider.name,
                              displayName: provider.displayName,
                              color: provider.color,
                            }}
                            workspaceId={workspaceId}
                            csrfToken={csrfToken}
                            maxHeight="350px"
                            onSuccess={() => {
                              setProviderStatus(prev => ({ ...prev, [provider.id]: true }));
                              setConnectingProvider(null);
                            }}
                            onCancel={() => {
                              setConnectingProvider(null);
                            }}
                            onError={(err) => {
                              setProviderError(err);
                              setConnectingProvider(null);
                            }}
                            onConnectAnother={() => {
                              // Mark current provider as connected and clear selection
                              // User can then click another provider to connect
                              setProviderStatus(prev => ({ ...prev, [provider.id]: true }));
                              setConnectingProvider(null);
                            }}
                          />
                        ) : (
                          <ProviderAuthFlow
                            provider={{
                              id: provider.id,
                              name: provider.name,
                              displayName: provider.displayName,
                              color: provider.color,
                              requiresUrlCopy: ['codex', 'anthropic', 'cursor'].includes(provider.id),
                            }}
                            workspaceId={workspaceId}
                            csrfToken={csrfToken}
                            onSuccess={() => {
                              setProviderStatus(prev => ({ ...prev, [provider.id]: true }));
                              setConnectingProvider(null);
                            }}
                            onCancel={() => {
                              setConnectingProvider(null);
                            }}
                            onError={(err) => {
                              setProviderError(err);
                              setConnectingProvider(null);
                            }}
                          />
                        )
                      ) : showApiKeyFallback[provider.id] ? (
                        <div className="space-y-4">
                          <div className="flex gap-3">
                            <input
                              type="password"
                              placeholder={`Enter ${provider.displayName} ${provider.apiKeyName || 'API key'}`}
                              value={connectingProvider === provider.id ? apiKeyInput : ''}
                              onChange={(e) => {
                                setConnectingProvider(provider.id);
                                setApiKeyInput(e.target.value);
                              }}
                              onFocus={() => setConnectingProvider(provider.id)}
                              className="flex-1 px-4 py-3 bg-bg-card border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-all"
                            />
                            <button
                              onClick={() => submitApiKey(provider)}
                              disabled={connectingProvider !== provider.id || !apiKeyInput.trim()}
                              className="px-5 py-3 bg-accent-cyan text-bg-deep font-semibold rounded-lg text-sm hover:bg-accent-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                              Connect
                            </button>
                          </div>
                          {provider.apiKeyUrl && (
                            <p className="text-xs text-text-muted">
                              Get your API key from{' '}
                              <a
                                href={provider.apiKeyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent-cyan hover:underline"
                              >
                                {new URL(provider.apiKeyUrl).hostname}
                              </a>
                            </p>
                          )}
                          {provider.supportsOAuth && (
                            <button
                              onClick={() => setShowApiKeyFallback(prev => ({ ...prev, [provider.id]: false }))}
                              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
                            >
                              ← Back to OAuth login
                            </button>
                          )}
                        </div>
                      ) : provider.supportsOAuth ? (
                        <div className="space-y-3">
                          {/* CLI info for providers using SSH tunnel auth */}
                          {['codex', 'anthropic', 'cursor'].includes(provider.id) && (
                            <div className="p-3 bg-accent-cyan/10 border border-accent-cyan/30 rounded-lg">
                              <p className="text-sm text-accent-cyan font-medium mb-1">CLI-assisted authentication</p>
                              <p className="text-xs text-accent-cyan/80">
                                Click the button below to get a CLI command with a unique session token.
                                Run it on your local machine to authenticate with {provider.displayName} via a secure SSH tunnel.
                              </p>
                            </div>
                          )}
                          <button
                            onClick={() => startOAuthFlow(provider)}
                            disabled={connectingProvider !== null}
                            className="w-full py-3 px-4 bg-gradient-to-r from-accent-cyan to-[#00b8d9] text-bg-deep font-semibold rounded-lg text-sm hover:shadow-glow-cyan hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none transition-all duration-200 flex items-center justify-center gap-2"
                          >
                            <LockIcon />
                            Connect with {provider.displayName}
                          </button>
                          {provider.apiKeyUrl && (
                            <button
                              onClick={() => setShowApiKeyFallback(prev => ({ ...prev, [provider.id]: true }))}
                              className="w-full text-xs text-text-muted hover:text-text-secondary transition-colors"
                            >
                              Or enter API key manually
                            </button>
                          )}
                        </div>
                      ) : (
                        /* Provider doesn't support OAuth - show API key input directly */
                        <div className="space-y-4">
                          <div className="flex gap-3">
                            <input
                              type="password"
                              placeholder={`Enter ${provider.displayName} ${provider.apiKeyName || 'API key'}`}
                              value={connectingProvider === provider.id ? apiKeyInput : ''}
                              onChange={(e) => {
                                setConnectingProvider(provider.id);
                                setApiKeyInput(e.target.value);
                              }}
                              onFocus={() => setConnectingProvider(provider.id)}
                              className="flex-1 px-4 py-3 bg-bg-card border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-all"
                            />
                            <button
                              onClick={() => submitApiKey(provider)}
                              disabled={connectingProvider !== provider.id || !apiKeyInput.trim()}
                              className="px-5 py-3 bg-accent-cyan text-bg-deep font-semibold rounded-lg text-sm hover:bg-accent-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                              Connect
                            </button>
                          </div>
                          {provider.apiKeyUrl && (
                            <p className="text-xs text-text-muted">
                              Get your API key from{' '}
                              <a
                                href={provider.apiKeyUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent-cyan hover:underline"
                              >
                                {new URL(provider.apiKeyUrl).hostname}
                              </a>
                            </p>
                          )}
                          <p className="text-xs text-amber-400/80">
                            OAuth not available for {provider.displayName} in container environments
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              ))}
            </div>
          </div>
        )}

        {/* Integrations Section */}
        {activeSection === 'integrations' && (
          <div className="space-y-6">
            <SectionHeader
              title="External Integrations"
              subtitle="Connect external services for agents to use (GitHub, Slack, Linear, etc.)"
            />

            {/* Slack - compact collapsible row */}
            <div className="bg-bg-tertiary rounded-xl border border-border-subtle overflow-hidden">
              <button
                onClick={() => setSlackExpanded(!slackExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#4A154B] flex items-center justify-center">
                    <SlackMark />
                  </div>
                  <span className="text-sm font-medium text-text-primary">Slack</span>
                </div>
                <div className="flex items-center gap-3">
                  <SlackConnectionStatus workspaceId={workspaceId} />
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`text-text-muted transition-transform duration-200 ${slackExpanded ? 'rotate-180' : ''}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>
              {slackExpanded && (
                <div className="border-t border-border-subtle p-4">
                  <SlackIntegrationPanel csrfToken={csrfToken} />
                </div>
              )}
            </div>

            {/* Other integrations grid */}
            <IntegrationConnect
              workspaceId={workspaceId}
              csrfToken={csrfToken}
            />
          </div>
        )}

        {/* Repositories Section */}
        {activeSection === 'repos' && (
          <div className="space-y-6">
            <SectionHeader
              title="Repositories"
              subtitle="Manage repositories for this workspace"
            />
            <RepositoriesPanel
              workspaceId={workspaceId}
              workspaceRepos={workspace.repositories}
              onRepoAdded={() => {
                // Refresh workspace data after adding a repo
                cloudApi.getWorkspaceDetails(workspaceId).then(result => {
                  if (result.success) {
                    setWorkspace(result.data);
                  }
                });
                onReposChanged?.();
              }}
              onRepoRemoved={() => {
                // Refresh workspace data after removing a repo
                cloudApi.getWorkspaceDetails(workspaceId).then(result => {
                  if (result.success) {
                    setWorkspace(result.data);
                  }
                });
                onReposChanged?.();
              }}
              csrfToken={csrfToken}
              className="bg-bg-tertiary rounded-xl border border-border-subtle overflow-hidden"
            />
          </div>
        )}

        {/* Custom Domain Section */}
        {activeSection === 'domain' && (
          <div className="space-y-8">
            <SectionHeader
              title="Custom Domain"
              subtitle="Connect your own domain to this workspace"
            />

            <div className="p-5 bg-gradient-to-r from-accent-purple/10 to-accent-cyan/10 border border-accent-purple/20 rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-accent-purple/20 flex items-center justify-center">
                  <GlobeIcon className="text-accent-purple" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-text-primary">Premium Feature</h4>
                  <p className="text-xs text-text-secondary">Requires Team or Enterprise plan</p>
                </div>
              </div>
            </div>

            {workspace.customDomain ? (
              <div className="space-y-4">
                <div className="p-5 bg-bg-tertiary rounded-xl border border-border-subtle">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-text-muted uppercase tracking-wide font-semibold">
                      Current Domain
                    </span>
                    <StatusBadge status={workspace.customDomainStatus || 'pending'} />
                  </div>
                  <p className="text-lg font-mono text-text-primary">{workspace.customDomain}</p>
                </div>

                {workspace.customDomainStatus === 'pending' && (
                  <ActionButton
                    onClick={handleVerifyDomain}
                    disabled={domainLoading}
                    variant="primary"
                    icon={<CheckIcon />}
                    fullWidth
                  >
                    {domainLoading ? 'Verifying...' : 'Verify DNS Configuration'}
                  </ActionButton>
                )}

                <ActionButton
                  onClick={handleRemoveDomain}
                  disabled={domainLoading}
                  variant="danger"
                  icon={<TrashIcon />}
                  fullWidth
                >
                  Remove Custom Domain
                </ActionButton>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2 block">
                    Domain Name
                  </label>
                  <input
                    type="text"
                    value={customDomain}
                    onChange={(e) => setCustomDomain(e.target.value)}
                    placeholder="workspace.yourdomain.com"
                    className="w-full px-4 py-3 bg-bg-tertiary border border-border-subtle rounded-lg text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-all"
                  />
                </div>

                <ActionButton
                  onClick={handleSetDomain}
                  disabled={domainLoading || !customDomain.trim()}
                  variant="primary"
                  icon={<GlobeIcon />}
                  fullWidth
                >
                  {domainLoading ? 'Setting up...' : 'Set Custom Domain'}
                </ActionButton>
              </div>
            )}

            {domainError && (
              <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
                {domainError}
              </div>
            )}

            {domainInstructions && (
              <div className="p-5 bg-bg-tertiary rounded-xl border border-border-subtle space-y-4">
                <h4 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <InfoIcon />
                  DNS Configuration Required
                </h4>
                <p className="text-xs text-text-secondary">
                  Add the following DNS record to your domain provider:
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <DNSField label="Type" value={domainInstructions.type} />
                  <DNSField label="Name" value={domainInstructions.name} />
                  <DNSField label="Value" value={domainInstructions.value} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Danger Zone Section */}
        {activeSection === 'danger' && (
          <div className="space-y-8">
            <div className="p-6 bg-error/5 border-2 border-error/20 rounded-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-error/20 flex items-center justify-center">
                  <AlertIcon className="text-error" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-error">Danger Zone</h3>
                  <p className="text-xs text-text-secondary">
                    These actions are destructive and cannot be undone
                  </p>
                </div>
              </div>

              <div className="p-5 border border-error/30 rounded-lg bg-bg-primary">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">Delete Workspace</h4>
                    <p className="text-xs text-text-muted mt-1">
                      Permanently delete this workspace and all its data
                    </p>
                  </div>
                  <button
                    onClick={handleDelete}
                    className="px-5 py-2.5 bg-error text-white rounded-lg text-sm font-semibold hover:bg-error/90 transition-colors"
                  >
                    Delete Workspace
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Utility Components
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">{title}</h3>
      <p className="text-xs text-text-muted mt-1">{subtitle}</p>
    </div>
  );
}

function InfoCard({
  label,
  value,
  valueColor = 'text-text-primary',
  mono = false,
  indicator = false,
}: {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
  indicator?: boolean;
}) {
  return (
    <div className="p-4 bg-bg-tertiary rounded-lg border border-border-subtle">
      <label className="text-xs text-text-muted uppercase tracking-wide font-medium">{label}</label>
      <div className="flex items-center gap-2 mt-1">
        {indicator && <div className="w-2 h-2 rounded-full bg-success animate-pulse" />}
        <p className={`text-sm font-medium ${valueColor} ${mono ? 'font-mono' : ''} break-all`}>
          {value}
        </p>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant,
  icon,
  fullWidth,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant: 'primary' | 'warning' | 'danger';
  icon?: React.ReactNode;
  fullWidth?: boolean;
}) {
  const variants = {
    primary: 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/20',
    warning: 'bg-amber-400/10 border-amber-400/30 text-amber-400 hover:bg-amber-400/20',
    danger: 'bg-error/10 border-error/30 text-error hover:bg-error/20',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${fullWidth ? 'w-full' : ''} px-5 py-2.5 border rounded-lg text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${variants[variant]}`}
    >
      {icon}
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    synced: 'bg-success/15 text-success border-success/30',
    active: 'bg-success/15 text-success border-success/30',
    syncing: 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30',
    verifying: 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30',
    pending: 'bg-amber-400/15 text-amber-400 border-amber-400/30',
    error: 'bg-error/15 text-error border-error/30',
  };

  return (
    <span className={`text-xs px-3 py-1 rounded-full border ${styles[status] || 'bg-bg-hover text-text-muted border-border-subtle'}`}>
      {status}
    </span>
  );
}

function DNSField({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-bg-card rounded-lg">
      <label className="text-xs text-text-muted block mb-1">{label}</label>
      <p className="font-mono text-sm text-text-primary break-all">{value}</p>
    </div>
  );
}

// Icons
function SettingsGearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ProviderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function RepoIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-text-muted ${className}`}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GlobeIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function IntegrationIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function SlackMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
      <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E"/>
    </svg>
  );
}

function SlackConnectionStatus({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<'loading' | 'connected' | 'not_connected'>('loading');

  useEffect(() => {
    async function check() {
      try {
        const { cloudApi } = await import('../../lib/cloudApi');
        const result = await cloudApi.getSlackConnections();
        if (result.success && result.data.connections.length > 0) {
          setStatus('connected');
        } else {
          setStatus('not_connected');
        }
      } catch {
        setStatus('not_connected');
      }
    }
    check();
  }, [workspaceId]);

  if (status === 'loading') {
    return <span className="text-xs text-text-muted">...</span>;
  }

  return status === 'connected' ? (
    <span className="flex items-center gap-1.5 text-xs font-medium text-success">
      <span className="w-1.5 h-1.5 rounded-full bg-success" />
      Connected
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
      <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
      Not connected
    </span>
  );
}

function SyncIcon({ spinning = false }: { spinning?: boolean } = {}) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'animate-spin' : ''}
    >
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  );
}
