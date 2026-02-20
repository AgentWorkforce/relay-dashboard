/**
 * IntegrationPolicyEditor - Edit agent integration permissions
 *
 * Allows workspace admins to configure which integrations each agent
 * can access and with what scopes (read/write).
 * 
 * Part of Unified Agent Auth - Phase 2
 */

import React, { useState, useCallback, useMemo } from 'react';

// Integration permission types matching relay-cloud schema
export interface IntegrationPermission {
  provider: string;
  scopes: ('read' | 'write')[];
  rateLimit?: number;
}

export interface AgentPolicyRule {
  name: string;
  allowedTools?: string[];
  canSpawn?: string[];
  canMessage?: string[];
  maxSpawns?: number;
  rateLimit?: number;
  canBeSpawned?: boolean;
  allowedIntegrations?: IntegrationPermission[];
}

export interface IntegrationPolicyEditorProps {
  /** Current policy rule being edited */
  policy: AgentPolicyRule;
  /** Available providers in the workspace */
  availableProviders: Array<{ id: string; name: string; isConnected: boolean }>;
  /** Callback when policy changes */
  onChange: (policy: AgentPolicyRule) => void;
  /** Whether the form is disabled */
  disabled?: boolean;
  /** Compact mode for embedding */
  compact?: boolean;
}

// Scope display info
const SCOPE_INFO = {
  read: { label: 'Read', description: 'Can read data from this integration', color: 'text-blue-400' },
  write: { label: 'Write', description: 'Can create/modify data in this integration', color: 'text-amber-400' },
};

export function IntegrationPolicyEditor({
  policy,
  availableProviders,
  onChange,
  disabled = false,
  compact = false,
}: IntegrationPolicyEditorProps) {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  // Create a map of current permissions
  const permissionMap = useMemo(() => {
    const map = new Map<string, IntegrationPermission>();
    (policy.allowedIntegrations || []).forEach(perm => {
      map.set(perm.provider, perm);
    });
    return map;
  }, [policy.allowedIntegrations]);

  // Check if a provider has any permissions
  const hasPermission = useCallback((providerId: string) => {
    return permissionMap.has(providerId) || permissionMap.has('*');
  }, [permissionMap]);

  // Check if a specific scope is allowed for a provider
  const hasScope = useCallback((providerId: string, scope: 'read' | 'write') => {
    // Check wildcard first
    const wildcardPerm = permissionMap.get('*');
    if (wildcardPerm?.scopes.includes(scope)) return true;
    
    // Check specific provider
    const perm = permissionMap.get(providerId);
    return perm?.scopes.includes(scope) ?? false;
  }, [permissionMap]);

  // Get rate limit for a provider
  const getRateLimit = useCallback((providerId: string) => {
    return permissionMap.get(providerId)?.rateLimit;
  }, [permissionMap]);

  // Toggle a provider's access entirely
  const toggleProvider = useCallback((providerId: string) => {
    if (disabled) return;

    const currentPerms = [...(policy.allowedIntegrations || [])];
    const existingIndex = currentPerms.findIndex(p => p.provider === providerId);

    if (existingIndex >= 0) {
      // Remove provider access
      currentPerms.splice(existingIndex, 1);
    } else {
      // Add provider with read access by default
      currentPerms.push({ provider: providerId, scopes: ['read'] });
    }

    onChange({ ...policy, allowedIntegrations: currentPerms });
  }, [policy, onChange, disabled]);

  // Toggle a specific scope for a provider
  const toggleScope = useCallback((providerId: string, scope: 'read' | 'write') => {
    if (disabled) return;

    const currentPerms = [...(policy.allowedIntegrations || [])];
    const existingIndex = currentPerms.findIndex(p => p.provider === providerId);

    if (existingIndex >= 0) {
      const existing = currentPerms[existingIndex];
      const hasThisScope = existing.scopes.includes(scope);

      if (hasThisScope) {
        // Remove scope
        const newScopes = existing.scopes.filter(s => s !== scope);
        if (newScopes.length === 0) {
          // Remove provider entirely if no scopes left
          currentPerms.splice(existingIndex, 1);
        } else {
          currentPerms[existingIndex] = { ...existing, scopes: newScopes };
        }
      } else {
        // Add scope
        currentPerms[existingIndex] = { ...existing, scopes: [...existing.scopes, scope] };
      }
    } else {
      // Add provider with this scope
      currentPerms.push({ provider: providerId, scopes: [scope] });
    }

    onChange({ ...policy, allowedIntegrations: currentPerms });
  }, [policy, onChange, disabled]);

  // Update rate limit for a provider
  const updateRateLimit = useCallback((providerId: string, rateLimit: number | undefined) => {
    if (disabled) return;

    const currentPerms = [...(policy.allowedIntegrations || [])];
    const existingIndex = currentPerms.findIndex(p => p.provider === providerId);

    if (existingIndex >= 0) {
      if (rateLimit === undefined) {
        // Remove rate limit
        const { rateLimit: _, ...rest } = currentPerms[existingIndex];
        currentPerms[existingIndex] = rest as IntegrationPermission;
      } else {
        currentPerms[existingIndex] = { ...currentPerms[existingIndex], rateLimit };
      }
      onChange({ ...policy, allowedIntegrations: currentPerms });
    }
  }, [policy, onChange, disabled]);

  // Toggle wildcard access (all integrations)
  const hasWildcard = permissionMap.has('*');
  const wildcardScopes = permissionMap.get('*')?.scopes || [];

  const toggleWildcard = useCallback(() => {
    if (disabled) return;

    const currentPerms = [...(policy.allowedIntegrations || [])];
    const wildcardIndex = currentPerms.findIndex(p => p.provider === '*');

    if (wildcardIndex >= 0) {
      // Remove wildcard
      currentPerms.splice(wildcardIndex, 1);
    } else {
      // Add wildcard with read access
      currentPerms.push({ provider: '*', scopes: ['read'] });
    }

    onChange({ ...policy, allowedIntegrations: currentPerms });
  }, [policy, onChange, disabled]);

  // Quick preset buttons
  const applyPreset = useCallback((preset: 'none' | 'read-only' | 'full') => {
    if (disabled) return;

    let newPerms: IntegrationPermission[];
    
    switch (preset) {
      case 'none':
        newPerms = [];
        break;
      case 'read-only':
        newPerms = [{ provider: '*', scopes: ['read'] }];
        break;
      case 'full':
        newPerms = [{ provider: '*', scopes: ['read', 'write'] }];
        break;
    }

    onChange({ ...policy, allowedIntegrations: newPerms });
  }, [policy, onChange, disabled]);

  // Separate connected and not connected providers
  const connectedProviders = availableProviders.filter(p => p.isConnected);
  const notConnectedProviders = availableProviders.filter(p => !p.isConnected);

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      {/* Header with presets */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Integration Access</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Configure which integrations this agent can access
          </p>
        </div>
        
        {!compact && (
          <div className="flex gap-1">
            <PresetButton
              active={!hasWildcard && (policy.allowedIntegrations?.length || 0) === 0}
              onClick={() => applyPreset('none')}
              disabled={disabled}
            >
              None
            </PresetButton>
            <PresetButton
              active={hasWildcard && wildcardScopes.length === 1 && wildcardScopes.includes('read')}
              onClick={() => applyPreset('read-only')}
              disabled={disabled}
            >
              Read Only
            </PresetButton>
            <PresetButton
              active={hasWildcard && wildcardScopes.includes('read') && wildcardScopes.includes('write')}
              onClick={() => applyPreset('full')}
              disabled={disabled}
            >
              Full Access
            </PresetButton>
          </div>
        )}
      </div>

      {/* Wildcard access toggle */}
      <div className={`p-3 rounded-lg border ${hasWildcard ? 'bg-accent-cyan/5 border-accent-cyan/30' : 'bg-bg-tertiary border-border-subtle'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasWildcard ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-bg-card text-text-muted'}`}>
              <WildcardIcon />
            </div>
            <div>
              <span className="text-sm font-medium text-text-primary">All Integrations</span>
              <p className="text-xs text-text-muted">Grant access to all current and future integrations</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {hasWildcard && (
              <div className="flex gap-1">
                <ScopeToggle
                  scope="read"
                  active={wildcardScopes.includes('read')}
                  onClick={() => toggleScope('*', 'read')}
                  disabled={disabled}
                />
                <ScopeToggle
                  scope="write"
                  active={wildcardScopes.includes('write')}
                  onClick={() => toggleScope('*', 'write')}
                  disabled={disabled}
                />
              </div>
            )}
            <Toggle
              checked={hasWildcard}
              onChange={toggleWildcard}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      {/* Per-provider permissions */}
      {!hasWildcard && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Individual Integrations
          </h4>
          
          {connectedProviders.length === 0 ? (
            <div className="p-4 bg-bg-tertiary rounded-lg border border-border-subtle text-center">
              <p className="text-sm text-text-muted">No integrations connected to this workspace.</p>
              <p className="text-xs text-text-muted mt-1">Connect integrations first to configure access.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {connectedProviders.map(provider => {
                const isExpanded = expandedProvider === provider.id;
                const providerHasAccess = hasPermission(provider.id);
                const readAccess = hasScope(provider.id, 'read');
                const writeAccess = hasScope(provider.id, 'write');
                const rateLimit = getRateLimit(provider.id);

                return (
                  <div
                    key={provider.id}
                    className={`rounded-lg border transition-all ${
                      providerHasAccess
                        ? 'bg-success/5 border-success/30'
                        : 'bg-bg-tertiary border-border-subtle'
                    }`}
                  >
                    {/* Provider row */}
                    <div className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-xs ${
                          providerHasAccess ? 'bg-success/80' : 'bg-bg-card text-text-muted'
                        }`}>
                          {provider.name[0]}
                        </div>
                        <div>
                          <span className="text-sm font-medium text-text-primary">{provider.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-success flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-success" />
                              Connected
                            </span>
                            {providerHasAccess && (
                              <span className="text-xs text-text-muted">
                                {readAccess && writeAccess ? 'Read & Write' : readAccess ? 'Read Only' : writeAccess ? 'Write Only' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        {providerHasAccess && (
                          <>
                            <div className="flex gap-1">
                              <ScopeToggle
                                scope="read"
                                active={readAccess}
                                onClick={() => toggleScope(provider.id, 'read')}
                                disabled={disabled}
                              />
                              <ScopeToggle
                                scope="write"
                                active={writeAccess}
                                onClick={() => toggleScope(provider.id, 'write')}
                                disabled={disabled}
                              />
                            </div>
                            <button
                              onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                              className="p-1 text-text-muted hover:text-text-primary transition-colors"
                              title="Advanced settings"
                            >
                              <ChevronIcon rotated={isExpanded} />
                            </button>
                          </>
                        )}
                        <Toggle
                          checked={providerHasAccess}
                          onChange={() => toggleProvider(provider.id)}
                          disabled={disabled}
                        />
                      </div>
                    </div>

                    {/* Expanded settings */}
                    {isExpanded && providerHasAccess && (
                      <div className="px-3 pb-3 pt-0 border-t border-border-subtle/50">
                        <div className="pt-3 flex items-center gap-3">
                          <label className="text-xs text-text-muted">Rate Limit (req/min):</label>
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            placeholder="Unlimited"
                            value={rateLimit || ''}
                            onChange={(e) => {
                              const val = e.target.value ? parseInt(e.target.value) : undefined;
                              updateRateLimit(provider.id, val);
                            }}
                            disabled={disabled}
                            className="w-24 px-2 py-1 bg-bg-card border border-border-subtle rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan disabled:opacity-50"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Not connected providers info */}
          {notConnectedProviders.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-text-muted mb-2">
                {notConnectedProviders.length} integration{notConnectedProviders.length > 1 ? 's' : ''} not connected:
                {' '}
                <span className="text-text-secondary">
                  {notConnectedProviders.map(p => p.name).join(', ')}
                </span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="p-3 bg-bg-card rounded-lg border border-border-subtle">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
          Access Summary
        </h4>
        <p className="text-sm text-text-secondary">
          {hasWildcard ? (
            <>
              Agent has <span className="text-accent-cyan font-medium">wildcard</span> access to all integrations
              {wildcardScopes.length === 2 ? ' (read & write)' : wildcardScopes.includes('read') ? ' (read only)' : ' (write only)'}
            </>
          ) : (policy.allowedIntegrations?.length || 0) === 0 ? (
            <>Agent has <span className="text-error font-medium">no access</span> to any integrations</>
          ) : (
            <>
              Agent can access <span className="text-success font-medium">{policy.allowedIntegrations?.length}</span> integration{(policy.allowedIntegrations?.length || 0) !== 1 ? 's' : ''}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// Toggle component
interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? 'bg-accent-cyan' : 'bg-bg-card border border-border-subtle'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// Scope toggle button
interface ScopeToggleProps {
  scope: 'read' | 'write';
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function ScopeToggle({ scope, active, onClick, disabled }: ScopeToggleProps) {
  const info = SCOPE_INFO[scope];
  
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={info.description}
      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
        active
          ? scope === 'read'
            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
          : 'bg-bg-card text-text-muted border border-border-subtle hover:border-border-medium'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {info.label}
    </button>
  );
}

// Preset button
interface PresetButtonProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function PresetButton({ active, onClick, disabled, children }: PresetButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
        active
          ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
          : 'bg-bg-tertiary text-text-muted border border-border-subtle hover:border-accent-cyan/30'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

// Icons
function WildcardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
    </svg>
  );
}

function ChevronIcon({ rotated }: { rotated?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${rotated ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default IntegrationPolicyEditor;
