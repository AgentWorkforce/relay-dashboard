/**
 * IntegrationConnect - External service integration connection UI
 *
 * Displays a grid of external service providers (GitHub, Slack, Linear, etc.)
 * organized by category. Users can connect/disconnect integrations via Nango OAuth.
 *
 * Part of Unified Agent Auth - Phase 2
 */

import React, { useState, useEffect, useCallback } from 'react';

// Provider categories for grouping
export type ProviderCategory = 'project' | 'communication' | 'monitoring' | 'deploy' | 'storage' | 'other';

// Provider tier determines available features
export type ProviderTier = 1 | 2; // Tier 1 = curated actions, Tier 2 = proxy-only

export interface IntegrationProvider {
  id: string;
  name: string;
  category: ProviderCategory;
  tier: ProviderTier;
  icon?: string;
  color: string;
  description: string;
  docsUrl?: string;
  isConnected?: boolean;
  connectedAt?: string;
  connectionId?: string;
  comingSoon?: boolean;
}

export interface IntegrationConnectProps {
  workspaceId: string;
  csrfToken?: string;
  onConnectionChange?: (providerId: string, connected: boolean) => void;
  /** Filter to specific categories */
  categories?: ProviderCategory[];
  /** Show only tier 1 providers */
  tier1Only?: boolean;
  /** Compact mode for embedding in other components */
  compact?: boolean;
}

// Category metadata
const CATEGORY_INFO: Record<ProviderCategory, { label: string; icon: React.ReactNode; color: string }> = {
  project: { label: 'Project Management', icon: <ProjectIcon />, color: 'text-blue-400' },
  communication: { label: 'Communication', icon: <ChatIcon />, color: 'text-green-400' },
  monitoring: { label: 'Monitoring', icon: <MonitorIcon />, color: 'text-amber-400' },
  deploy: { label: 'Deploy & CI/CD', icon: <RocketIcon />, color: 'text-purple-400' },
  storage: { label: 'Storage & Docs', icon: <FolderIcon />, color: 'text-cyan-400' },
  other: { label: 'Other', icon: <GridIcon />, color: 'text-gray-400' },
};

// Base provider list (matches relay-cloud provider registry)
const BASE_PROVIDERS: IntegrationProvider[] = [
  // Tier 1 - Curated actions
  { id: 'slack', name: 'Slack', category: 'communication', tier: 1, color: '#4A154B', description: 'Team messaging and notifications', comingSoon: true },
  { id: 'linear', name: 'Linear', category: 'project', tier: 1, color: '#5E6AD2', description: 'Issue tracking and project management', comingSoon: true },
  { id: 'jira', name: 'Jira', category: 'project', tier: 1, color: '#0052CC', description: 'Issue and project tracking', comingSoon: true },
  { id: 'notion', name: 'Notion', category: 'storage', tier: 1, color: '#000000', description: 'Notes and documentation', comingSoon: true },
  { id: 'google-docs', name: 'Google Docs', category: 'storage', tier: 1, color: '#4285F4', description: 'Document collaboration', comingSoon: true },
  { id: 'gmail', name: 'Gmail', category: 'communication', tier: 1, color: '#EA4335', description: 'Email integration', comingSoon: true },
  { id: 'outlook', name: 'Outlook', category: 'communication', tier: 1, color: '#0078D4', description: 'Microsoft email and calendar', comingSoon: true },

  // Tier 2 - Proxy-only
  { id: 'datadog', name: 'Datadog', category: 'monitoring', tier: 2, color: '#632CA6', description: 'Infrastructure monitoring', comingSoon: true },
  { id: 'sentry', name: 'Sentry', category: 'monitoring', tier: 2, color: '#362D59', description: 'Error tracking', comingSoon: true },
  { id: 'vercel', name: 'Vercel', category: 'deploy', tier: 2, color: '#000000', description: 'Frontend deployment', comingSoon: true },
  { id: 'netlify', name: 'Netlify', category: 'deploy', tier: 2, color: '#00C7B7', description: 'Web hosting and deployment', comingSoon: true },
  { id: 'circleci', name: 'CircleCI', category: 'deploy', tier: 2, color: '#343434', description: 'Continuous integration', comingSoon: true },
  { id: 'pagerduty', name: 'PagerDuty', category: 'monitoring', tier: 2, color: '#06AC38', description: 'Incident management', comingSoon: true },
  { id: 'confluence', name: 'Confluence', category: 'storage', tier: 2, color: '#172B4D', description: 'Team documentation', comingSoon: true },
];

export function IntegrationConnect({
  workspaceId,
  csrfToken,
  onConnectionChange,
  categories,
  tier1Only = false,
  compact = false,
}: IntegrationConnectProps) {
  const [providers, setProviders] = useState<IntegrationProvider[]>(BASE_PROVIDERS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ProviderCategory | 'all'>('all');

  // Load connected integrations from API
  useEffect(() => {
    async function loadIntegrations() {
      if (!workspaceId || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/proxy/providers?workspaceId=${encodeURIComponent(workspaceId)}`, {
          credentials: 'include',
        });

        if (res.ok) {
          const data = await res.json();
          // Merge connection status with base providers
          const connectedMap = new Map(
            (data.providers || []).map((p: { id: string; isConnected: boolean; connectedAt?: string; connectionId?: string }) =>
              [p.id, { isConnected: p.isConnected, connectedAt: p.connectedAt, connectionId: p.connectionId }]
            )
          );

          setProviders(BASE_PROVIDERS.map(p => ({
            ...p,
            ...(connectedMap.get(p.id) || {}),
          })));
        }
      } catch (err) {
        console.error('Failed to load integrations:', err);
        setError('Failed to load integrations');
      } finally {
        setIsLoading(false);
      }
    }

    loadIntegrations();
  }, [workspaceId]);

  // Start Nango OAuth flow for a provider
  const handleConnect = useCallback(async (provider: IntegrationProvider) => {
    setConnectingProvider(provider.id);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      // Get Nango connect session
      const res = await fetch('/api/proxy/connect-session', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ workspaceId, provider: provider.id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start connection');
      }

      const { connectUrl, sessionToken } = await res.json();

      // Open Nango connect popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        connectUrl,
        `Connect ${provider.name}`,
        `width=${width},height=${height},left=${left},top=${top},popup=yes`
      );

      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/proxy/connect-status/${sessionToken}`, {
            credentials: 'include',
          });

          if (statusRes.ok) {
            const status = await statusRes.json();

            if (status.connected) {
              clearInterval(pollInterval);
              popup?.close();

              setProviders(prev => prev.map(p =>
                p.id === provider.id
                  ? { ...p, isConnected: true, connectedAt: new Date().toISOString() }
                  : p
              ));

              onConnectionChange?.(provider.id, true);
              setConnectingProvider(null);
            } else if (status.error) {
              clearInterval(pollInterval);
              popup?.close();
              setError(status.error);
              setConnectingProvider(null);
            }
          }
        } catch {
          // Continue polling
        }
      }, 2000);

      // Stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (connectingProvider === provider.id) {
          setConnectingProvider(null);
          setError('Connection timed out');
        }
      }, 300000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setConnectingProvider(null);
    }
  }, [workspaceId, csrfToken, connectingProvider, onConnectionChange]);

  // Disconnect a provider
  const handleDisconnect = useCallback(async (provider: IntegrationProvider) => {
    const confirmed = window.confirm(
      `Are you sure you want to disconnect ${provider.name}? Agents will no longer be able to access this integration.`
    );
    if (!confirmed) return;

    setDisconnectingProvider(provider.id);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch(`/api/proxy/disconnect/${provider.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers,
        body: JSON.stringify({ workspaceId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to disconnect');
      }

      setProviders(prev => prev.map(p =>
        p.id === provider.id
          ? { ...p, isConnected: false, connectedAt: undefined, connectionId: undefined }
          : p
      ));

      onConnectionChange?.(provider.id, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnectingProvider(null);
    }
  }, [workspaceId, csrfToken, onConnectionChange]);

  // Filter providers
  const filteredProviders = providers.filter(p => {
    if (tier1Only && p.tier !== 1) return false;
    if (categories && !categories.includes(p.category)) return false;
    if (activeCategory !== 'all' && p.category !== activeCategory) return false;
    return true;
  });

  // Group providers by category
  const groupedProviders = filteredProviders.reduce((acc, provider) => {
    if (!acc[provider.category]) {
      acc[provider.category] = [];
    }
    acc[provider.category].push(provider);
    return acc;
  }, {} as Record<ProviderCategory, IntegrationProvider[]>);

  const connectedCount = providers.filter(p => p.isConnected).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan animate-spin" />
        </div>
        <span className="ml-3 text-text-muted text-sm">Loading integrations...</span>
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {/* Header */}
      {!compact && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">External Integrations</h2>
            <p className="text-sm text-text-muted mt-1">
              Connect external services for your agents to use. {connectedCount} connected.
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary rounded-full border border-border-subtle">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-medium text-text-secondary">{connectedCount} Active</span>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="p-4 bg-error/10 border border-error/30 rounded-lg text-error text-sm flex items-center gap-3">
          <AlertIcon />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-error/60 hover:text-error">
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Category filter */}
      {!compact && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <CategoryButton
            active={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
          >
            All
          </CategoryButton>
          {Object.entries(CATEGORY_INFO).map(([key, info]) => (
            <CategoryButton
              key={key}
              active={activeCategory === key}
              onClick={() => setActiveCategory(key as ProviderCategory)}
              icon={info.icon}
            >
              {info.label}
            </CategoryButton>
          ))}
        </div>
      )}

      {/* Provider grid */}
      {activeCategory === 'all' ? (
        // Show grouped by category
        Object.entries(groupedProviders).map(([category, categoryProviders]) => (
          <div key={category} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={CATEGORY_INFO[category as ProviderCategory].color}>
                {CATEGORY_INFO[category as ProviderCategory].icon}
              </span>
              <h3 className="text-sm font-medium text-text-secondary">
                {CATEGORY_INFO[category as ProviderCategory].label}
              </h3>
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {categoryProviders.map(provider => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onConnect={() => handleConnect(provider)}
                  onDisconnect={() => handleDisconnect(provider)}
                  isConnecting={connectingProvider === provider.id}
                  isDisconnecting={disconnectingProvider === provider.id}
                  compact={compact}
                />
              ))}
            </div>
          </div>
        ))
      ) : (
        // Show flat grid for single category
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {filteredProviders.map(provider => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onConnect={() => handleConnect(provider)}
              onDisconnect={() => handleDisconnect(provider)}
              isConnecting={connectingProvider === provider.id}
              isDisconnecting={disconnectingProvider === provider.id}
              compact={compact}
            />
          ))}
        </div>
      )}

      {filteredProviders.length === 0 && (
        <div className="text-center py-8 text-text-muted">
          No integrations available for the selected filters.
        </div>
      )}
    </div>
  );
}

// Provider card component
interface ProviderCardProps {
  provider: IntegrationProvider;
  onConnect: () => void;
  onDisconnect: () => void;
  isConnecting: boolean;
  isDisconnecting: boolean;
  compact?: boolean;
}

function ProviderCard({ provider, onConnect, onDisconnect, isConnecting, isDisconnecting, compact }: ProviderCardProps) {
  const isLoading = isConnecting || isDisconnecting;

  return (
    <div
      className={`relative p-4 bg-bg-tertiary rounded-xl border transition-all duration-200 ${
        provider.comingSoon
          ? 'border-border-subtle opacity-60'
          : provider.isConnected
          ? 'border-success/30 hover:border-success/50'
          : 'border-border-subtle hover:border-accent-cyan/50'
      }`}
    >
      {/* Tier badge */}
      {provider.tier === 1 && (
        <div className="absolute top-2 right-2">
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-accent-cyan/20 text-accent-cyan rounded">
            Tier 1
          </span>
        </div>
      )}

      <div className="flex items-start gap-3">
        {/* Provider icon */}
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
          style={{ backgroundColor: provider.color }}
        >
          {provider.name[0]}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-text-primary truncate">{provider.name}</h4>
          {!compact && (
            <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{provider.description}</p>
          )}
        </div>
      </div>

      {/* Connection status & actions */}
      <div className="mt-3 pt-3 border-t border-border-subtle">
        {provider.comingSoon ? (
          <div className="flex justify-center">
            <span className="px-2 py-1 bg-amber-400/15 text-amber-400 text-xs font-medium rounded-full">
              Coming Soon
            </span>
          </div>
        ) : provider.isConnected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-xs text-success font-medium">Connected</span>
            </div>
            <button
              onClick={onDisconnect}
              disabled={isLoading}
              className="text-xs text-error/70 hover:text-error transition-colors disabled:opacity-50"
            >
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <button
            onClick={onConnect}
            disabled={isLoading}
            className="w-full py-2 px-3 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-xs font-medium rounded-lg hover:bg-accent-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isConnecting ? (
              <>
                <div className="w-3 h-3 border border-accent-cyan/30 border-t-accent-cyan rounded-full animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <LinkIcon />
                Connect
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// Category filter button
interface CategoryButtonProps {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

function CategoryButton({ active, onClick, icon, children }: CategoryButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
        active
          ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30'
          : 'bg-bg-tertiary text-text-secondary border border-border-subtle hover:border-accent-cyan/30'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// Icons
function ProjectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function RocketIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
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
