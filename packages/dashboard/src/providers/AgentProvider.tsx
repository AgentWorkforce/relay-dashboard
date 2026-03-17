/**
 * Agent Provider
 *
 * Manages the combined agent list (AI agents + human users + local broker agents),
 * project/agent merging, spawn/release operations, fleet, and decisions.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Agent, Project, AgentSummary, ActivityEvent } from '../types';
import type { SpawnConfig } from '../components/SpawnModal';
import type { Decision } from '../components/DecisionQueue';
import type { ServerInfo } from '../components/ServerCard';
import type { TaskCreateRequest } from '../components/CommandPalette';
import { PRIORITY_CONFIG } from '../components/CommandPalette';
import { useAgents as useAgentsHook } from '../components/hooks/useAgents';
import { useRecentRepos } from '../components/hooks/useRecentRepos';
import { useWorkspaceRepos } from '../components/hooks/useWorkspaceRepos';
import { useCloudWorkspace } from './CloudWorkspaceProvider';
import { api, convertApiDecision, getCsrfToken } from '../lib/api';
import { parseSpawnCommand } from '../lib/model-options';
import { mergeAgentsForDashboard } from '../lib/agent-merge';
import type { DashboardData } from '../components/hooks/useWebSocket';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentContextValue {
  // Core agent data
  agents: Agent[];
  combinedAgents: Agent[];
  groups: ReturnType<typeof useAgentsHook>['groups'];
  selectedAgent: Agent | null;
  selectAgent: (name: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  totalCount: number;
  onlineCount: number;
  needsAttentionCount: number;

  // Agent summaries
  agentSummariesMap: Map<string, AgentSummary>;

  // Projects
  projects: Project[];
  mergedProjects: Project[];
  currentProject: string | undefined;
  setCurrentProject: React.Dispatch<React.SetStateAction<string | undefined>>;
  bridgeAgents: Agent[];
  projectAgents: Agent[];
  localAgentsForSidebar: Agent[];
  recentRepos: ReturnType<typeof useRecentRepos>['recentRepos'];
  addRecentRepo: ReturnType<typeof useRecentRepos>['addRecentRepo'];
  getRecentProjects: ReturnType<typeof useRecentRepos>['getRecentProjects'];
  workspaceRepos: ReturnType<typeof useWorkspaceRepos>['repos'];
  refetchWorkspaceRepos: ReturnType<typeof useWorkspaceRepos>['refetch'];

  // Spawn / Release
  handleSpawn: (config: SpawnConfig) => Promise<boolean>;
  handleReleaseAgent: (agent: Agent) => Promise<void>;
  isSpawnModalOpen: boolean;
  setIsSpawnModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSpawning: boolean;
  spawnError: string | null;
  setSpawnError: React.Dispatch<React.SetStateAction<string | null>>;

  // Fleet
  isFleetAvailable: boolean;
  isFleetViewActive: boolean;
  setIsFleetViewActive: React.Dispatch<React.SetStateAction<boolean>>;
  fleetServers: ServerInfo[];
  selectedServerId: string | undefined;
  setSelectedServerId: React.Dispatch<React.SetStateAction<string | undefined>>;
  handleServerReconnect: (serverId: string) => Promise<void>;

  // Decisions
  isDecisionQueueOpen: boolean;
  setIsDecisionQueueOpen: React.Dispatch<React.SetStateAction<boolean>>;
  decisions: Decision[];
  decisionProcessing: Record<string, boolean>;
  handleDecisionApprove: (id: string, optionId?: string) => Promise<void>;
  handleDecisionReject: (id: string, reason?: string) => Promise<void>;
  handleDecisionDismiss: (id: string) => Promise<void>;

  // Tasks
  handleTaskCreate: (task: TaskCreateRequest) => Promise<void>;
  isCreatingTask: boolean;

  // Activity
  activityEvents: ActivityEvent[];
  addActivityEvent: (event: Omit<ActivityEvent, 'id' | 'timestamp'>) => void;

  // Log viewer
  logViewerAgent: Agent | null;
  setLogViewerAgent: React.Dispatch<React.SetStateAction<Agent | null>>;

  // Agent profile
  selectedAgentProfile: Agent | null;
  setSelectedAgentProfile: React.Dispatch<React.SetStateAction<Agent | null>>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AgentContext = createContext<AgentContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface AgentProviderProps {
  children: React.ReactNode;
  /** WebSocket dashboard data (agents, messages, etc.) */
  data: DashboardData | null;
  /** Whether the WebSocket is connected */
  isConnected: boolean;
}

/** Bridge-level agent names shown separately from project agents */
const BRIDGE_AGENT_NAMES = ['architect'];

export function AgentProvider({ children, data, isConnected }: AgentProviderProps) {
  const {
    cloudUser,
    effectiveActiveWorkspaceId,
    isWorkspaceFeaturesEnabled,
    orchestratorWorkspaces,
    orchestratorAgents,
    activeWorkspaceId,
    orchestratorSpawnAgent,
    orchestratorStopAgent,
    localAgents,
    activeCloudWorkspaceId,
    features,
    apiAdapter,
    setCloudWorkspaces,
  } = useCloudWorkspace();

  const hasWorkspaceApi = features.workspaces && !!apiAdapter;

  // ---------------------------------------------------------------------------
  // Agent merging
  // ---------------------------------------------------------------------------

  const combinedAgents = useMemo(() => {
    return mergeAgentsForDashboard({
      agents: data?.agents,
      users: data?.users,
      localAgents,
    });
  }, [data?.agents, data?.users, localAgents]);

  const {
    agents,
    groups,
    selectedAgent,
    selectAgent,
    searchQuery,
    setSearchQuery,
    totalCount,
    onlineCount,
    needsAttentionCount,
  } = useAgentsHook({ agents: combinedAgents });

  // Agent summaries
  const agentSummariesMap = useMemo(() => {
    const map = new Map<string, AgentSummary>();
    for (const summary of data?.summaries ?? []) {
      map.set(summary.agentName.toLowerCase(), summary);
    }
    return map;
  }, [data?.summaries]);

  // ---------------------------------------------------------------------------
  // Activity feed
  // ---------------------------------------------------------------------------

  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  const addActivityEvent = useCallback((event: Omit<ActivityEvent, 'id' | 'timestamp'>) => {
    const newEvent: ActivityEvent = {
      ...event,
      id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    setActivityEvents(prev => [newEvent, ...prev].slice(0, 200));
  }, []);

  // Track previous agents to detect spawns/releases
  const prevAgentsRef = useRef<Map<string, Agent>>(new Map());

  useEffect(() => {
    if (!combinedAgents || combinedAgents.length === 0) return;

    const currentAgentMap = new Map(combinedAgents.map(a => [a.name, a]));
    const prevAgentMap = prevAgentsRef.current;

    if (prevAgentMap.size > 0) {
      for (const [name, agent] of currentAgentMap) {
        if (!prevAgentMap.has(name)) {
          addActivityEvent({
            type: 'agent_spawned',
            actor: name,
            actorType: 'agent',
            title: 'came online',
            description: agent.currentTask,
            metadata: { cli: agent.cli, task: agent.currentTask },
          });
        } else {
          const prevAgent = prevAgentMap.get(name)!;
          if (prevAgent.status !== agent.status) {
            if (agent.status === 'online' || agent.status === 'busy') {
              addActivityEvent({
                type: 'agent_online',
                actor: name,
                actorType: 'agent',
                title: 'came online',
                metadata: { cli: agent.cli },
              });
            } else if (agent.status === 'offline') {
              addActivityEvent({
                type: 'agent_offline',
                actor: name,
                actorType: 'agent',
                title: 'went offline',
              });
            }
          }
        }
      }

      for (const [name] of prevAgentMap) {
        if (!currentAgentMap.has(name)) {
          addActivityEvent({
            type: 'agent_released',
            actor: name,
            actorType: 'agent',
            title: 'went offline',
          });
        }
      }
    }

    prevAgentsRef.current = currentAgentMap;
  }, [combinedAgents, addActivityEvent]);

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<string | undefined>();

  const { recentRepos, addRecentRepo, getRecentProjects } = useRecentRepos();
  const { repos: workspaceRepos, refetch: refetchWorkspaceRepos } = useWorkspaceRepos({
    workspaceId: effectiveActiveWorkspaceId ?? undefined,
    apiBaseUrl: '/api',
    enabled: isWorkspaceFeaturesEnabled && !!effectiveActiveWorkspaceId,
  });

  // Separate bridge-level agents from regular project agents
  const { bridgeAgents, projectAgents } = useMemo(() => {
    const bridge: Agent[] = [];
    const project: Agent[] = [];

    for (const agent of agents) {
      if (agent.isHuman || agent.cli === 'dashboard') continue;
      if (BRIDGE_AGENT_NAMES.includes(agent.name.toLowerCase())) {
        bridge.push(agent);
      } else {
        project.push(agent);
      }
    }

    return { bridgeAgents: bridge, projectAgents: project };
  }, [agents]);

  // Convert workspaces to projects
  const hasWorkspaces = (isWorkspaceFeaturesEnabled
    ? useCloudWorkspace().effectiveWorkspaces
    : orchestratorWorkspaces
  ).length > 0;
  const effectiveWorkspaces = useCloudWorkspace().effectiveWorkspaces;

  const bridgeBootstrapFetchedRef = useRef(false);
  useEffect(() => {
    if (hasWorkspaces) {
      bridgeBootstrapFetchedRef.current = false;
      if (workspaceRepos.length > 1 && effectiveActiveWorkspaceId) {
        const repoProjects: Project[] = workspaceRepos.map((repo) => {
          const repoName = repo.githubFullName.split('/').pop() || repo.githubFullName;
          return {
            id: repo.id,
            path: repo.githubFullName,
            name: repoName,
            agents: [] as Agent[],
            lead: undefined,
          };
        });
        setProjects(repoProjects);
        if (!currentProject || !repoProjects.find(p => p.id === currentProject)) {
          setCurrentProject(repoProjects[0]?.id);
        }
      } else if (orchestratorWorkspaces.length > 0) {
        const projectList: Project[] = orchestratorWorkspaces.map((workspace) => ({
          id: workspace.id,
          path: workspace.path,
          name: workspace.name,
          agents: orchestratorAgents
            .filter((a) => a.workspaceId === workspace.id)
            .map((a) => ({
              name: a.name,
              status: a.status === 'running' ? 'online' : 'offline',
              isSpawned: true,
              cli: a.provider,
              cwd: a.cwd,
            })) as Agent[],
          lead: undefined,
        }));
        setProjects(projectList);
        setCurrentProject(activeWorkspaceId);
      } else if (isWorkspaceFeaturesEnabled && effectiveActiveWorkspaceId) {
        const activeWs = effectiveWorkspaces.find(w => w.id === effectiveActiveWorkspaceId);
        if (activeWs) {
          const projectList: Project[] = [{
            id: activeWs.id,
            path: activeWs.path,
            name: activeWs.name,
            agents: [] as Agent[],
            lead: undefined,
          }];
          setProjects(projectList);
          setCurrentProject(activeWs.id);
        }
      }
    }
  }, [hasWorkspaces, orchestratorWorkspaces, orchestratorAgents, activeWorkspaceId, workspaceRepos, effectiveActiveWorkspaceId, currentProject, isWorkspaceFeaturesEnabled, effectiveWorkspaces]);

  // Fetch bridge/project data for multi-project mode
  useEffect(() => {
    if (hasWorkspaces) return;

    let cancelled = false;
    const fetchProjects = async () => {
      const result = await api.getBridgeData();
      if (cancelled) return;

      if (result.success && result.data) {
        const bridgeData = result.data as {
          projects?: Array<{
            id: string;
            name?: string;
            path: string;
            connected?: boolean;
            agents?: Array<{ name: string; status: string; task?: string; cli?: string; model?: string; cwd?: string }>;
            lead?: { name: string; connected: boolean };
          }>;
          connected?: boolean;
          currentProjectPath?: string;
        };

        if (bridgeData.projects && bridgeData.projects.length > 0) {
          const projectList: Project[] = bridgeData.projects.map((p) => ({
            id: p.id,
            path: p.path,
            name: p.name || p.path.split('/').pop(),
            agents: (p.agents || [])
              .filter((a) => a.cli !== 'dashboard')
              .map((a) => ({
                name: a.name,
                status: a.status === 'online' || a.status === 'active' ? 'online' : 'offline',
                currentTask: a.task,
                cli: a.cli,
                model: a.model,
                cwd: a.cwd,
              })) as Agent[],
            lead: p.lead,
          }));
          setProjects(projectList);
          setCurrentProject((previous) => previous || projectList[0]?.id || previous);
        }
      }
    };

    if (!bridgeBootstrapFetchedRef.current) {
      bridgeBootstrapFetchedRef.current = true;
      void fetchProjects();
    }

    if (isConnected) {
      return () => { cancelled = true; };
    }

    void fetchProjects();
    const interval = setInterval(fetchProjects, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasWorkspaces, isConnected]);

  // Merge local broker agents into projects
  const mergedProjects = useMemo(() => {
    if (projects.length === 0) return projects;

    if (workspaceRepos.length > 1) {
      const allAgents: Agent[] = [...projectAgents];
      const seenNames = new Set(projectAgents.map(a => a.name.toLowerCase()));
      for (const oa of orchestratorAgents) {
        if (!seenNames.has(oa.name.toLowerCase())) {
          seenNames.add(oa.name.toLowerCase());
          allAgents.push({
            name: oa.name,
            status: oa.status === 'running' ? 'online' : 'offline',
            isSpawned: true,
            cli: oa.provider,
            cwd: oa.cwd,
          } as Agent);
        }
      }

      if (allAgents.length === 0) return projects;

      const repoNames = new Set(projects.map(p => p.name));
      const repoProjects = projects.map((project) => {
        const repoName = project.name;
        const matchingAgents = allAgents.filter((a) => a.cwd === repoName);
        return { ...project, agents: [...project.agents, ...matchingAgents] };
      });

      const placedAgentNames = new Set(repoProjects.flatMap(p => p.agents.map(a => a.name.toLowerCase())));
      const workspaceAgents = allAgents.filter((a) => {
        if (placedAgentNames.has(a.name.toLowerCase())) return false;
        return !a.cwd || !repoNames.has(a.cwd);
      });

      if (workspaceAgents.length > 0) {
        const workspaceProject: Project = {
          id: '__workspace__',
          path: '/workspace',
          name: 'Workspace',
          agents: workspaceAgents,
        };
        return [workspaceProject, ...repoProjects];
      }

      return repoProjects;
    }

    if (projectAgents.length === 0) return projects;

    return projects.map((project, index) => {
      const isCurrentBrokerProject = index === 0 || project.id === currentProject;
      if (isCurrentBrokerProject) {
        const existingNames = new Set(project.agents.map((a) => a.name.toLowerCase()));
        const newAgents = projectAgents.filter((a) => !existingNames.has(a.name.toLowerCase()));
        return { ...project, agents: [...project.agents, ...newAgents] };
      }
      return project;
    });
  }, [projects, projectAgents, orchestratorAgents, currentProject, workspaceRepos.length]);

  // Local agents for sidebar
  const localAgentsForSidebar = useMemo(() => {
    const humanUsers = agents.filter(a => a.isHuman);
    if (mergedProjects.length > 0) return humanUsers;
    const aiAgents = projectAgents.filter(a => !a.isHuman);
    return [...aiAgents, ...humanUsers];
  }, [mergedProjects, projectAgents, agents]);

  // ---------------------------------------------------------------------------
  // Spawn / Release
  // ---------------------------------------------------------------------------

  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('spawn') === 'true') {
        params.delete('spawn');
        const newUrl = params.toString()
          ? `${window.location.pathname}?${params.toString()}`
          : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
        return true;
      }
    }
    return false;
  });
  const [isSpawning, setIsSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const handleSpawn = useCallback(async (config: SpawnConfig): Promise<boolean> => {
    setIsSpawning(true);
    setSpawnError(null);
    try {
      const { provider, model, reasoningEffort } = parseSpawnCommand(config.command);

      if (hasWorkspaceApi && apiAdapter && activeCloudWorkspaceId) {
        const result = await apiAdapter.spawnAgent(activeCloudWorkspaceId, {
          name: config.name,
          provider,
          model,
          reasoningEffort,
          cwd: config.cwd,
        });
        if (!result.success) {
          setSpawnError(result.error || 'Failed to spawn agent');
          return false;
        }
        return true;
      }

      if (orchestratorWorkspaces.length > 0 && activeWorkspaceId) {
        await orchestratorSpawnAgent(config.name, undefined, config.command, config.cwd);
        return true;
      }

      const result = await api.spawnAgent({
        name: config.name,
        cli: config.command,
        cwd: config.cwd,
        team: config.team,
        shadowMode: config.shadowMode,
        shadowOf: config.shadowOf,
        shadowAgent: config.shadowAgent,
        shadowTriggers: config.shadowTriggers,
        shadowSpeakOn: config.shadowSpeakOn,
        continueFrom: config.continueFrom,
      });
      if (!result.success) {
        setSpawnError(result.error || 'Failed to spawn agent');
        return false;
      }
      return true;
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : 'Failed to spawn agent');
      return false;
    } finally {
      setIsSpawning(false);
    }
  }, [hasWorkspaceApi, apiAdapter, activeCloudWorkspaceId, orchestratorWorkspaces.length, activeWorkspaceId, orchestratorSpawnAgent]);

  const handleReleaseAgent = useCallback(async (agent: Agent) => {
    if (!agent.isSpawned) return;

    const confirmed = window.confirm(`Are you sure you want to release agent "${agent.name}"?`);
    if (!confirmed) return;

    try {
      if (hasWorkspaceApi && apiAdapter && activeCloudWorkspaceId) {
        await apiAdapter.stopAgent(activeCloudWorkspaceId, agent.name);
        return;
      }

      if (orchestratorWorkspaces.length > 0 && activeWorkspaceId) {
        await orchestratorStopAgent(agent.name);
        return;
      }

      const result = await api.releaseAgent(agent.name);
      if (!result.success) {
        console.error('Failed to release agent:', result.error);
      }
    } catch (err) {
      console.error('Failed to release agent:', err);
    }
  }, [hasWorkspaceApi, apiAdapter, activeCloudWorkspaceId, orchestratorWorkspaces.length, activeWorkspaceId, orchestratorStopAgent]);

  // ---------------------------------------------------------------------------
  // Fleet
  // ---------------------------------------------------------------------------

  const isFleetAvailable = Boolean(data?.fleet?.servers?.length) || orchestratorWorkspaces.length > 0;
  const [isFleetViewActive, setIsFleetViewActive] = useState(false);
  const [fleetServers, setFleetServers] = useState<ServerInfo[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | undefined>();

  useEffect(() => {
    if (!isFleetViewActive) return;

    const fetchFleetServers = async () => {
      const result = await api.getFleetServers();
      if (result.success && result.data) {
        const servers: ServerInfo[] = result.data.servers.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.id === 'local' ? window.location.origin : `http://${s.id}`,
          status: s.status === 'healthy' ? 'online' : s.status === 'degraded' ? 'degraded' : 'offline',
          agentCount: s.agents.length,
          uptime: s.uptime,
          lastSeen: s.lastHeartbeat,
        }));
        setFleetServers(servers);
      }
    };

    fetchFleetServers();
    const interval = setInterval(fetchFleetServers, 5000);
    return () => clearInterval(interval);
  }, [isFleetViewActive]);

  const handleServerReconnect = useCallback(async (serverId: string) => {
    if (hasWorkspaceApi && apiAdapter) {
      try {
        const result = await apiAdapter.restartWorkspace(serverId);
        if (result.success) {
          setFleetServers(prev => prev.map(s =>
            s.id === serverId ? { ...s, status: 'connecting' as const } : s
          ));
          setTimeout(async () => {
            try {
              const workspacesResult = await apiAdapter.getWorkspaceSummary();
              if (workspacesResult.success && workspacesResult.data.workspaces) {
                setCloudWorkspaces(workspacesResult.data.workspaces);
              }
            } catch (err) {
              console.error('Failed to refresh workspaces after reconnect:', err);
            }
          }, 2000);
        } else {
          console.error('Failed to restart workspace:', result.error);
        }
      } catch (err) {
        console.error('Failed to reconnect to server:', err);
      }
    } else {
      console.warn('Server reconnect not fully supported in orchestrator mode');
    }
  }, [hasWorkspaceApi, apiAdapter, setCloudWorkspaces]);

  // ---------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------

  const [isDecisionQueueOpen, setIsDecisionQueueOpen] = useState(false);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionProcessing, setDecisionProcessing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isDecisionQueueOpen) return;

    const fetchDecisions = async () => {
      const result = await api.getDecisions();
      if (result.success && result.data) {
        setDecisions(result.data.decisions.map(convertApiDecision));
      }
    };

    fetchDecisions();
    const interval = setInterval(fetchDecisions, 5000);
    return () => clearInterval(interval);
  }, [isDecisionQueueOpen]);

  const handleDecisionApprove = useCallback(async (decisionId: string, optionId?: string) => {
    setDecisionProcessing((prev) => ({ ...prev, [decisionId]: true }));
    try {
      const result = await api.approveDecision(decisionId, optionId);
      if (result.success) {
        setDecisions((prev) => prev.filter((d) => d.id !== decisionId));
      } else {
        console.error('Failed to approve decision:', result.error);
      }
    } catch (err) {
      console.error('Failed to approve decision:', err);
    } finally {
      setDecisionProcessing((prev) => ({ ...prev, [decisionId]: false }));
    }
  }, []);

  const handleDecisionReject = useCallback(async (decisionId: string, reason?: string) => {
    setDecisionProcessing((prev) => ({ ...prev, [decisionId]: true }));
    try {
      const result = await api.rejectDecision(decisionId, reason);
      if (result.success) {
        setDecisions((prev) => prev.filter((d) => d.id !== decisionId));
      } else {
        console.error('Failed to reject decision:', result.error);
      }
    } catch (err) {
      console.error('Failed to reject decision:', err);
    } finally {
      setDecisionProcessing((prev) => ({ ...prev, [decisionId]: false }));
    }
  }, []);

  const handleDecisionDismiss = useCallback(async (decisionId: string) => {
    const result = await api.dismissDecision(decisionId);
    if (result.success) {
      setDecisions((prev) => prev.filter((d) => d.id !== decisionId));
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const handleTaskCreate = useCallback(async (task: TaskCreateRequest) => {
    setIsCreatingTask(true);
    try {
      const beadsPriority = PRIORITY_CONFIG[task.priority].beadsPriority;

      const result = await api.createBead({
        title: task.title,
        assignee: task.agentName,
        priority: beadsPriority,
        type: 'task',
      });

      if (result.success && result.data?.bead) {
        await api.sendRelayMessage({
          to: task.agentName,
          content: `New task assigned: "${task.title}" (P${beadsPriority})\nCheck \`bd ready\` for details.`,
        });
        console.log('Task created:', result.data.bead.id);
      } else {
        console.error('Failed to create task bead:', result.error);
        throw new Error(result.error || 'Failed to create task');
      }
    } catch (err) {
      console.error('Failed to create task:', err);
      throw err;
    } finally {
      setIsCreatingTask(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Log viewer & profile
  // ---------------------------------------------------------------------------

  const [logViewerAgent, setLogViewerAgent] = useState<Agent | null>(null);
  const [selectedAgentProfile, setSelectedAgentProfile] = useState<Agent | null>(null);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const value = useMemo<AgentContextValue>(() => ({
    agents, combinedAgents, groups, selectedAgent, selectAgent,
    searchQuery, setSearchQuery, totalCount, onlineCount, needsAttentionCount,
    agentSummariesMap,
    projects, mergedProjects, currentProject, setCurrentProject,
    bridgeAgents, projectAgents, localAgentsForSidebar,
    recentRepos, addRecentRepo, getRecentProjects,
    workspaceRepos, refetchWorkspaceRepos,
    handleSpawn, handleReleaseAgent,
    isSpawnModalOpen, setIsSpawnModalOpen, isSpawning, spawnError, setSpawnError,
    isFleetAvailable, isFleetViewActive, setIsFleetViewActive,
    fleetServers, selectedServerId, setSelectedServerId, handleServerReconnect,
    isDecisionQueueOpen, setIsDecisionQueueOpen,
    decisions, decisionProcessing,
    handleDecisionApprove, handleDecisionReject, handleDecisionDismiss,
    handleTaskCreate, isCreatingTask,
    activityEvents, addActivityEvent,
    logViewerAgent, setLogViewerAgent,
    selectedAgentProfile, setSelectedAgentProfile,
  }), [
    agents, combinedAgents, groups, selectedAgent, selectAgent,
    searchQuery, setSearchQuery, totalCount, onlineCount, needsAttentionCount,
    agentSummariesMap,
    projects, mergedProjects, currentProject,
    bridgeAgents, projectAgents, localAgentsForSidebar,
    recentRepos, addRecentRepo, getRecentProjects,
    workspaceRepos, refetchWorkspaceRepos,
    handleSpawn, handleReleaseAgent,
    isSpawnModalOpen, isSpawning, spawnError,
    isFleetAvailable, isFleetViewActive,
    fleetServers, selectedServerId, handleServerReconnect,
    isDecisionQueueOpen,
    decisions, decisionProcessing,
    handleDecisionApprove, handleDecisionReject, handleDecisionDismiss,
    handleTaskCreate, isCreatingTask,
    activityEvents, addActivityEvent,
    logViewerAgent,
    selectedAgentProfile,
  ]);

  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentContext(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error('useAgentContext must be used within an AgentProvider');
  }
  return ctx;
}
