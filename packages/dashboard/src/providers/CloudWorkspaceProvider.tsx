/**
 * Cloud Workspace Provider
 *
 * Manages workspace list, selection, cloud user state, and effective workspace ID.
 * Handles both cloud mode (API-backed workspaces) and local orchestrator mode.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useDashboardConfig, type CloudUser } from '../adapters';
import type { Agent } from '../types';
import { api, setActiveWorkspaceId as setApiWorkspaceId, getActiveWorkspaceId } from '../lib/api';
import { useOrchestrator } from '../components/hooks/useOrchestrator';
import type { Workspace } from '../components/WorkspaceSelector';
import type { CurrentUser } from '../components/MessageList';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloudWorkspace {
  id: string;
  name: string;
  status: string;
  publicUrl?: string;
  accessType?: 'owner' | 'member' | 'contributor';
  permission?: 'admin' | 'write' | 'read';
}

interface CloudWorkspaceContextValue {
  /** Cloud user (null when not authenticated or in local mode) */
  cloudUser: CloudUser | null;
  /** Current user display info for messages */
  currentUser: CurrentUser | undefined;
  /** Whether workspace features are enabled in dashboard config */
  isWorkspaceFeaturesEnabled: boolean;
  /** Whether header settings link should show */
  canOpenHeaderSettings: boolean;
  /** Whether workspace settings link should show */
  canOpenWorkspaceSettings: boolean;

  // Workspace state
  cloudWorkspaces: CloudWorkspace[];
  effectiveWorkspaces: Workspace[];
  effectiveActiveWorkspaceId: string | null;
  effectiveIsLoading: boolean;
  activeCloudWorkspaceId: string | null;

  // Orchestrator pass-through (for local mode)
  orchestratorWorkspaces: Workspace[];
  orchestratorAgents: ReturnType<typeof useOrchestrator>['agents'];
  activeWorkspaceId: string | undefined;
  isOrchestratorConnected: boolean;
  orchestratorSpawnAgent: ReturnType<typeof useOrchestrator>['spawnAgent'];
  orchestratorStopAgent: ReturnType<typeof useOrchestrator>['stopAgent'];

  // Actions
  handleEffectiveWorkspaceSelect: (workspace: { id: string; name: string }) => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  addWorkspace: (path: string, name?: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  setCloudWorkspaces: React.Dispatch<React.SetStateAction<CloudWorkspace[]>>;
  setActiveCloudWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;

  // Local agents from linked brokers
  localAgents: Agent[];

  // Dashboard config features
  features: ReturnType<typeof useDashboardConfig>['features'];
  apiAdapter: ReturnType<typeof useDashboardConfig>['api'];
  authAdapter: ReturnType<typeof useDashboardConfig>['auth'];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const CloudWorkspaceContext = createContext<CloudWorkspaceContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface CloudWorkspaceProviderProps {
  children: React.ReactNode;
  orchestratorUrl?: string;
}

export function CloudWorkspaceProvider({ children, orchestratorUrl }: CloudWorkspaceProviderProps) {
  const config = useDashboardConfig();
  const { features, api: apiAdapter, auth: authAdapter } = config;

  // Orchestrator for multi-workspace management
  const {
    workspaces: orchestratorWorkspaces,
    activeWorkspaceId,
    agents: orchestratorAgents,
    isConnected: isOrchestratorConnected,
    isLoading: isOrchestratorLoading,
    switchWorkspace,
    addWorkspace: orchestratorAddWorkspace,
    removeWorkspace,
    spawnAgent: orchestratorSpawnAgent,
    stopAgent: orchestratorStopAgent,
  } = useOrchestrator({ apiUrl: orchestratorUrl });

  // Cloud user state
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);

  useEffect(() => {
    if (!features.auth || !authAdapter) {
      setCloudUser(null);
      return;
    }

    let cancelled = false;

    const fetchCurrentUser = async () => {
      try {
        const result = await authAdapter.getUser();
        if (cancelled) return;
        setCloudUser(result.success ? result.data : null);
      } catch {
        if (!cancelled) {
          setCloudUser(null);
        }
      }
    };

    void fetchCurrentUser();
    const interval = setInterval(() => {
      void fetchCurrentUser();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [features.auth, authAdapter]);

  // Derive current user from auth adapter
  const currentUser: CurrentUser | undefined = cloudUser
    ? {
        displayName: cloudUser.githubUsername || cloudUser.displayName || '',
        avatarUrl: cloudUser.avatarUrl,
      }
    : undefined;

  const hasWorkspaceApi = features.workspaces && !!apiAdapter;
  const isWorkspaceFeaturesEnabled = features.workspaces;
  const canOpenWorkspaceSettings = features.workspaces;
  const canOpenHeaderSettings =
    features.auth || features.billing || features.teams || features.workspaces;

  // Cloud workspaces state
  const [cloudWorkspaces, setCloudWorkspaces] = useState<CloudWorkspace[]>([]);
  const [activeCloudWorkspaceId, setActiveCloudWorkspaceId] = useState<string | null>(() => getActiveWorkspaceId());
  const [isLoadingCloudWorkspaces, setIsLoadingCloudWorkspaces] = useState(false);

  // Local agents from linked brokers
  const [localAgents, setLocalAgents] = useState<Agent[]>([]);

  // Fetch cloud workspaces when in cloud mode
  useEffect(() => {
    if (!hasWorkspaceApi || !apiAdapter) {
      setCloudWorkspaces([]);
      setIsLoadingCloudWorkspaces(false);
      return;
    }

    let cancelled = false;

    const fetchCloudWorkspaces = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setIsLoadingCloudWorkspaces(true);
      }
      try {
        const result = await apiAdapter.getAccessibleWorkspaces();
        if (cancelled) return;
        if (result.success && result.data.workspaces) {
          setCloudWorkspaces(result.data.workspaces);
          const workspaceIds = new Set(result.data.workspaces.map((w: CloudWorkspace) => w.id));
          if (activeCloudWorkspaceId && !workspaceIds.has(activeCloudWorkspaceId)) {
            if (result.data.workspaces.length > 0) {
              const firstWorkspaceId = result.data.workspaces[0].id;
              setActiveCloudWorkspaceId(firstWorkspaceId);
              setApiWorkspaceId(firstWorkspaceId);
            } else {
              setActiveCloudWorkspaceId(null);
              setApiWorkspaceId(null);
            }
          } else if (!activeCloudWorkspaceId && result.data.workspaces.length > 0) {
            const firstWorkspaceId = result.data.workspaces[0].id;
            setActiveCloudWorkspaceId(firstWorkspaceId);
            setApiWorkspaceId(firstWorkspaceId);
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch cloud workspaces:', err);
      } finally {
        if (isInitialLoad && !cancelled) {
          setIsLoadingCloudWorkspaces(false);
        }
      }
    };

    void fetchCloudWorkspaces(true);
    const interval = setInterval(() => {
      void fetchCloudWorkspaces(false);
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasWorkspaceApi, apiAdapter, activeCloudWorkspaceId]);

  // Fetch agents for the active workspace
  useEffect(() => {
    if (!activeCloudWorkspaceId) {
      setLocalAgents([]);
      return;
    }

    const useCloudAgents = hasWorkspaceApi && !!apiAdapter;

    const fetchAgents = async () => {
      try {
        if (useCloudAgents && apiAdapter) {
          const result = await apiAdapter.getAgents(activeCloudWorkspaceId);
          if (result.success && result.data?.agents) {
            const agents: Agent[] = result.data.agents.map((a: { name: string; status: string }) => ({
              name: a.name,
              status: a.status === 'online' ? 'online' : 'offline',
              isLocal: false,
              isSpawned: true,
            }));
            setLocalAgents(agents);
          }
        } else {
          const result = await api.get<{
            agents: Array<{
              name: string;
              status: string;
              isLocal: boolean;
              isHuman?: boolean;
              avatarUrl?: string;
              brokerId?: string;
              brokerName?: string;
              brokerStatus?: string;
              machineId: string;
              lastSeenAt: string | null;
            }>;
          }>(`/api/brokers/workspace/${activeCloudWorkspaceId}/agents`);

          if (result.agents) {
            const agents: Agent[] = result.agents.map((a) => {
              const brokerStatus = (a as { brokerStatus?: string }).brokerStatus;
              const resolvedStatus = brokerStatus ?? a.status;
              const brokerName = (a as { brokerName?: string }).brokerName;
              return {
                name: a.name,
                status: resolvedStatus === 'online' ? 'online' : 'offline',
                isLocal: !a.isHuman,
                isHuman: a.isHuman,
                avatarUrl: a.avatarUrl,
                brokerName: a.isHuman ? undefined : brokerName,
                machineId: a.isHuman ? undefined : a.machineId,
                lastSeen: a.lastSeenAt || undefined,
              };
            });
            setLocalAgents(agents);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('HTTP 404')) {
          console.error(
            'BREAKING CHANGE: daemon agent endpoints were removed. Dashboard now requires /api/brokers/workspace/:id/agents.',
            err,
          );
        } else {
          console.error('Failed to fetch agents:', err);
        }
        setLocalAgents([]);
      }
    };

    void fetchAgents();
    const interval = setInterval(fetchAgents, useCloudAgents ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [hasWorkspaceApi, apiAdapter, activeCloudWorkspaceId]);

  // Determine effective workspaces
  const effectiveWorkspaces = useMemo(() => {
    if (isWorkspaceFeaturesEnabled && cloudWorkspaces.length > 0) {
      return cloudWorkspaces.map(ws => ({
        id: ws.id,
        name: ws.name,
        path: ws.publicUrl || `/workspace/${ws.name}`,
        status: ws.status === 'running' ? 'active' as const : 'inactive' as const,
        provider: 'claude' as const,
        lastActiveAt: new Date(),
      }));
    }
    return orchestratorWorkspaces;
  }, [isWorkspaceFeaturesEnabled, cloudWorkspaces, orchestratorWorkspaces]);

  const effectiveActiveWorkspaceId = isWorkspaceFeaturesEnabled
    ? activeCloudWorkspaceId
    : (activeWorkspaceId ?? 'default');
  const effectiveIsLoading = isWorkspaceFeaturesEnabled ? isLoadingCloudWorkspaces : isOrchestratorLoading;

  // Sync the active workspace ID with the api module
  useEffect(() => {
    if (isWorkspaceFeaturesEnabled && activeCloudWorkspaceId) {
      setApiWorkspaceId(activeCloudWorkspaceId);
    } else if (isWorkspaceFeaturesEnabled && !activeCloudWorkspaceId) {
      setApiWorkspaceId(null);
    } else if (!isWorkspaceFeaturesEnabled) {
      setApiWorkspaceId(null);
    }
  }, [isWorkspaceFeaturesEnabled, activeCloudWorkspaceId]);

  // Handle workspace selection
  const handleEffectiveWorkspaceSelect = useCallback(async (workspace: { id: string; name: string }) => {
    if (isWorkspaceFeaturesEnabled) {
      setActiveCloudWorkspaceId(workspace.id);
      setApiWorkspaceId(workspace.id);
    } else {
      await switchWorkspace(workspace.id);
    }
  }, [isWorkspaceFeaturesEnabled, switchWorkspace]);

  // Keep local username for channel API calls
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (currentUser?.displayName) {
        localStorage.setItem('relay_username', currentUser.displayName);
      } else if (!isWorkspaceFeaturesEnabled) {
        localStorage.removeItem('relay_username');
      }
    }
  }, [currentUser?.displayName, isWorkspaceFeaturesEnabled]);

  const handleAddWorkspace = useCallback(async (path: string, name?: string) => {
    await orchestratorAddWorkspace(path, name);
  }, [orchestratorAddWorkspace]);

  const value = useMemo<CloudWorkspaceContextValue>(() => ({
    cloudUser,
    currentUser,
    isWorkspaceFeaturesEnabled,
    canOpenHeaderSettings,
    canOpenWorkspaceSettings,
    cloudWorkspaces,
    effectiveWorkspaces,
    effectiveActiveWorkspaceId,
    effectiveIsLoading,
    activeCloudWorkspaceId,
    orchestratorWorkspaces,
    orchestratorAgents,
    activeWorkspaceId,
    isOrchestratorConnected,
    orchestratorSpawnAgent,
    orchestratorStopAgent,
    handleEffectiveWorkspaceSelect,
    switchWorkspace,
    addWorkspace: handleAddWorkspace,
    removeWorkspace,
    setCloudWorkspaces,
    setActiveCloudWorkspaceId,
    localAgents,
    features,
    apiAdapter,
    authAdapter,
  }), [
    cloudUser, currentUser, isWorkspaceFeaturesEnabled, canOpenHeaderSettings,
    canOpenWorkspaceSettings, cloudWorkspaces, effectiveWorkspaces, effectiveActiveWorkspaceId,
    effectiveIsLoading, activeCloudWorkspaceId, orchestratorWorkspaces, orchestratorAgents,
    activeWorkspaceId, isOrchestratorConnected, orchestratorSpawnAgent, orchestratorStopAgent,
    handleEffectiveWorkspaceSelect, switchWorkspace, handleAddWorkspace, removeWorkspace,
    localAgents, features, apiAdapter, authAdapter,
  ]);

  return (
    <CloudWorkspaceContext.Provider value={value}>
      {children}
    </CloudWorkspaceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCloudWorkspace(): CloudWorkspaceContextValue {
  const ctx = useContext(CloudWorkspaceContext);
  if (!ctx) {
    throw new Error('useCloudWorkspace must be used within a CloudWorkspaceProvider');
  }
  return ctx;
}
