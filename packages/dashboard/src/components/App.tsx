/**
 * Dashboard V2 - Main Application Component
 *
 * Layout shell that composes the provider tree and renders the sidebar,
 * header, main content area, and modal overlays. All business logic lives
 * in the provider layer (see src/providers/).
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Agent, Message } from '../types';
import { ActivityFeed } from './ActivityFeed';
import { Sidebar } from './layout/Sidebar';
import { Header } from './layout/Header';
import { MessageList } from './MessageList';
import { ThreadPanel } from './ThreadPanel';
import { CommandPalette, PRIORITY_CONFIG } from './CommandPalette';
import { SpawnModal } from './SpawnModal';
import { NewConversationModal } from './NewConversationModal';
import { SettingsPage } from './settings';
import { ConversationHistory } from './ConversationHistory';
import { NotificationToast, useToasts } from './NotificationToast';
import { WorkspaceSelector } from './WorkspaceSelector';
import { AddWorkspaceModal } from './AddWorkspaceModal';
import { LogViewerPanel } from './LogViewerPanel';
import { TrajectoryViewer } from './TrajectoryViewer';
import { DecisionQueue } from './DecisionQueue';
import { FleetOverview } from './FleetOverview';
import { TypingIndicator } from './TypingIndicator';
import { MessageComposer } from './MessageComposer';
import { OnlineUsersIndicator } from './OnlineUsersIndicator';
import { UserProfilePanel } from './UserProfilePanel';
import { AgentProfilePanel } from './AgentProfilePanel';
import { CoordinatorPanel } from './CoordinatorPanel';
import { UsageBanner } from './UsageBanner';
import { useWebSocket, type DashboardData } from './hooks/useWebSocket';
import { useTrajectory } from './hooks/useTrajectory';
import { useUrlRouting, type Route } from '../lib/useUrlRouting';
import { WorkspaceProvider } from './WorkspaceContext';
import {
  ChannelViewV1,
  CreateChannelModal,
  InviteToChannelModal,
  MemberManagementPanel,
  type ChannelMessage as ChannelApiMessage,
} from './channels';

// Providers
import {
  SettingsProvider,
  useSettings,
  CloudWorkspaceProvider,
  useCloudWorkspace,
  RelayConfigProvider,
  AgentProvider,
  useAgentContext,
  MessageProvider,
  useMessageContext,
  ACTIVITY_FEED_ID,
} from '../providers';

// Re-export for backwards compatibility (MessageList imports this)
export { ACTIVITY_FEED_ID };

export interface AppProps {
  /** Initial WebSocket URL (optional, defaults to current host) */
  wsUrl?: string;
  /** Orchestrator API URL (optional, defaults to localhost:3456) */
  orchestratorUrl?: string;
  /** Enable reaction UI on messages (default: false) */
  enableReactions?: boolean;
}

/**
 * Outer shell: sets up WebSocket + reaction merge, then wraps in providers.
 */
export function App({ wsUrl, orchestratorUrl, enableReactions = false }: AppProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wsEventHandlerRef = useRef<((event: any) => void) | undefined>(undefined);

  const { data: wsData, isConnected, error: wsError } = useWebSocket({
    url: wsUrl,
    onEvent: (event) => wsEventHandlerRef.current?.(event),
  });

  // REST fallback
  const [restData, setRestData] = useState<DashboardData | null>(null);
  const [restFallbackFailed, setRestFallbackFailed] = useState(false);
  useEffect(() => {
    if (wsError && !wsData && !restData) {
      let cancelled = false;
      setRestFallbackFailed(false);
      (async () => {
        try {
          const { api } = await import('../lib/api');
          const resp = await api.getData();
          if (cancelled) return;
          if (resp.success && resp.data) {
            setRestData(resp.data as DashboardData);
          } else {
            setRestFallbackFailed(true);
          }
        } catch {
          if (!cancelled) setRestFallbackFailed(true);
        }
      })();
      return () => { cancelled = true; };
    }
  }, [wsError, wsData, restData]);

  const cloudFallbackData: DashboardData | null = wsUrl ? { agents: [], messages: [] } : null;
  const rawData = wsData || restData || cloudFallbackData;
  const data = rawData; // reaction merging now happens in MessageProvider

  return (
    <SettingsProvider>
      <WorkspaceProvider wsUrl={wsUrl}>
        <CloudWorkspaceProvider orchestratorUrl={orchestratorUrl}>
          <RelayConfigProvider>
            <AgentProvider data={data} isConnected={isConnected}>
              <MessageProvider data={data} rawData={rawData} enableReactions={enableReactions}>
                <AppShell
                  wsUrl={wsUrl}
                  data={data}
                  rawData={rawData}
                  isConnected={isConnected}
                  wsError={wsError}
                  restFallbackFailed={restFallbackFailed}
                  enableReactions={enableReactions}
                  wsEventHandlerRef={wsEventHandlerRef}
                />
              </MessageProvider>
            </AgentProvider>
          </RelayConfigProvider>
        </CloudWorkspaceProvider>
      </WorkspaceProvider>
    </SettingsProvider>
  );
}

// ---------------------------------------------------------------------------
// Inner layout shell -- consumes all providers
// ---------------------------------------------------------------------------

interface AppShellProps {
  wsUrl?: string;
  data: DashboardData | null;
  rawData: DashboardData | null;
  isConnected: boolean;
  wsError: Error | null;
  restFallbackFailed: boolean;
  enableReactions: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wsEventHandlerRef: React.MutableRefObject<((event: any) => void) | undefined>;
}

function AppShell({
  data,
  isConnected,
  wsError,
  restFallbackFailed,
  enableReactions,
  wsEventHandlerRef,
}: AppShellProps) {
  const { settings, updateSettings } = useSettings();
  const {
    cloudUser,
    currentUser,
    isWorkspaceFeaturesEnabled,
    canOpenHeaderSettings,
    canOpenWorkspaceSettings,
    effectiveWorkspaces,
    effectiveActiveWorkspaceId,
    effectiveIsLoading,
    isOrchestratorConnected,
    orchestratorWorkspaces,
    handleEffectiveWorkspaceSelect,
    features,
    apiAdapter,
  } = useCloudWorkspace();
  const {
    agents,
    combinedAgents,
    selectedAgent,
    selectAgent,
    agentSummariesMap,
    mergedProjects,
    currentProject,
    setCurrentProject,
    bridgeAgents,
    localAgentsForSidebar,
    addRecentRepo,
    getRecentProjects,
    workspaceRepos,
    refetchWorkspaceRepos,
    handleSpawn,
    handleReleaseAgent,
    isSpawnModalOpen,
    setIsSpawnModalOpen,
    isSpawning,
    spawnError,
    setSpawnError,
    isFleetAvailable,
    isFleetViewActive,
    setIsFleetViewActive,
    fleetServers,
    selectedServerId,
    setSelectedServerId,
    handleServerReconnect,
    isDecisionQueueOpen,
    setIsDecisionQueueOpen,
    decisions,
    decisionProcessing,
    handleDecisionApprove,
    handleDecisionReject,
    handleDecisionDismiss,
    handleTaskCreate,
    activityEvents,
    logViewerAgent,
    setLogViewerAgent,
    selectedAgentProfile,
    setSelectedAgentProfile,
  } = useAgentContext();
  const {
    messages,
    currentChannel,
    setCurrentChannel,
    currentThread,
    setCurrentThread,
    activeThreads,
    totalUnreadThreadCount,
    sendMessage,
    isSending,
    sendError,
    thread,
    viewMode,
    setViewMode,
    channelsList,
    archivedChannelsList,
    channelMessages: _channelMessages,
    selectedChannelId,
    setSelectedChannelId,
    selectedChannel,
    hasMoreMessages,
    channelUnreadState,
    effectiveChannelMessages,
    handleSelectChannel,
    handleCreateChannel,
    handleCreateChannelSubmit,
    handleInviteToChannel,
    handleInviteSubmit,
    handleLeaveChannel,
    handleShowMembers,
    handleRemoveMember,
    handleAddMember,
    handleArchiveChannel,
    handleUnarchiveChannel,
    handleSendChannelMessage,
    handleLoadMoreMessages,
    isCreateChannelOpen,
    setIsCreateChannelOpen,
    isCreatingChannel,
    isInviteChannelOpen,
    setIsInviteChannelOpen,
    inviteChannelTarget,
    setInviteChannelTarget,
    isInvitingToChannel,
    showMemberPanel,
    setShowMemberPanel,
    channelMembers,
    currentHuman,
    selectedDmAgents,
    dedupedVisibleMessages,
    dmSelectedAgentsByHuman,
    handleDmAgentToggle,
    handleMainComposerSend,
    onlineUsers,
    typingUsers,
    sendTyping,
    humanUsers,
    humanUnreadCounts,
    handleReaction,
    markDmSeen,
    selectedUserProfile,
    setSelectedUserProfile,
    pendingMention,
    setPendingMention,
    hasUnreadMessages,
    handlePresenceEvent,
  } = useMessageContext();

  // Keep the WS event handler ref in sync
  wsEventHandlerRef.current = handlePresenceEvent;

  // ---------------------------------------------------------------------------
  // UI-only state
  // ---------------------------------------------------------------------------

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAddWorkspaceOpen, setIsAddWorkspaceOpen] = useState(false);
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [addWorkspaceError, setAddWorkspaceError] = useState<string | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isFullSettingsOpen, setIsFullSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'dashboard' | 'workspace' | 'team' | 'billing'>('dashboard');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [isCoordinatorOpen, setIsCoordinatorOpen] = useState(false);
  const [isTrajectoryOpen, setIsTrajectoryOpen] = useState(false);

  const { toasts, addToast, dismissToast } = useToasts();
  const [authRevokedAgents, setAuthRevokedAgents] = useState<Set<string>>(new Set());

  // Trajectory
  const {
    steps: trajectorySteps,
    status: trajectoryStatus,
    history: trajectoryHistory,
    isLoading: isTrajectoryLoading,
    selectTrajectory,
    selectedTrajectoryId,
  } = useTrajectory({ autoPoll: isTrajectoryOpen });

  const selectedTrajectoryTitle = useMemo(() => {
    if (!selectedTrajectoryId) return null;
    return trajectoryHistory.find(t => t.id === selectedTrajectoryId)?.title ?? null;
  }, [selectedTrajectoryId, trajectoryHistory]);

  // ---------------------------------------------------------------------------
  // URL routing
  // ---------------------------------------------------------------------------

  const handleRouteChange = useCallback((route: Route) => {
    switch (route.type) {
      case 'channel':
        if (route.id) {
          setViewMode('channels');
          setSelectedChannelId(route.id === 'activity' ? ACTIVITY_FEED_ID : route.id);
        }
        break;
      case 'dm':
      case 'agent':
        if (route.id) {
          setViewMode('local');
          setSelectedChannelId(undefined);
          setCurrentChannel(route.id);
        }
        break;
      case 'settings':
        setSettingsInitialTab(route.tab || 'dashboard');
        setIsFullSettingsOpen(true);
        break;
      case 'activity':
        setViewMode('channels');
        setSelectedChannelId(ACTIVITY_FEED_ID);
        break;
    }
  }, [setCurrentChannel, setViewMode, setSelectedChannelId]);

  const {
    navigateToChannel,
    navigateToDm,
    navigateToAgent,
    navigateToSettings,
    navigateToActivity,
    closeSettings: urlCloseSettings,
  } = useUrlRouting({ onRouteChange: handleRouteChange });

  // ---------------------------------------------------------------------------
  // Handlers (UI wiring only -- no business logic)
  // ---------------------------------------------------------------------------

  const closeSidebarOnMobile = useCallback(() => {
    if (window.innerWidth <= 768) setIsSidebarOpen(false);
  }, []);

  const handleAgentSelect = useCallback((agent: Agent) => {
    setViewMode('local');
    setSelectedChannelId(undefined);
    selectAgent(agent.name);
    setCurrentChannel(agent.name);
    navigateToAgent(agent.name);
    closeSidebarOnMobile();
  }, [selectAgent, setCurrentChannel, closeSidebarOnMobile, navigateToAgent, setViewMode, setSelectedChannelId]);

  const { addWorkspace: cwAddWorkspace, switchWorkspace: cwSwitchWorkspace } = useCloudWorkspace();
  const handleProjectSelect = useCallback((project: { id: string; name?: string; path: string; agents: Agent[] }) => {
    setCurrentProject(project.id);
    setViewMode('local');
    setSelectedChannelId(undefined);
    addRecentRepo(project);

    if (orchestratorWorkspaces.length > 0) {
      cwSwitchWorkspace(project.id).catch((err: unknown) => {
        console.error('Failed to switch workspace:', err);
      });
    }

    if (project.agents.length > 0) {
      selectAgent(project.agents[0].name);
      setCurrentChannel(project.agents[0].name);
    }
    closeSidebarOnMobile();
  }, [selectAgent, setCurrentChannel, closeSidebarOnMobile, orchestratorWorkspaces.length, addRecentRepo, setViewMode, setSelectedChannelId, setCurrentProject, cwSwitchWorkspace]);

  const handleHumanSelect = useCallback((human: Agent) => {
    setViewMode('local');
    setSelectedChannelId(undefined);
    setCurrentChannel(human.name);
    markDmSeen(human.name);
    navigateToDm(human.name);
    closeSidebarOnMobile();
  }, [closeSidebarOnMobile, markDmSeen, setCurrentChannel, navigateToDm, setViewMode, setSelectedChannelId]);

  const handleSpawnClick = useCallback(() => {
    setSpawnError(null);
    setIsSpawnModalOpen(true);
  }, [setSpawnError, setIsSpawnModalOpen]);

  const handleSettingsClick = useCallback(() => {
    setSettingsInitialTab('dashboard');
    setIsFullSettingsOpen(true);
    navigateToSettings('dashboard');
  }, [navigateToSettings]);

  const handleWorkspaceSettingsClick = useCallback(() => {
    setSettingsInitialTab('workspace');
    setIsFullSettingsOpen(true);
    navigateToSettings('workspace');
  }, [navigateToSettings]);

  const handleBillingClick = useCallback(() => {
    setSettingsInitialTab('billing');
    setIsFullSettingsOpen(true);
    navigateToSettings('billing');
  }, [navigateToSettings]);

  const handleLogsClick = useCallback((agent: Agent) => {
    setLogViewerAgent(agent);
  }, [setLogViewerAgent]);

  const handleChannelMemberClick = useCallback((memberId: string, entityType: 'user' | 'agent') => {
    if (memberId === currentUser?.displayName) return;
    setViewMode('local');
    setSelectedChannelId(undefined);
    if (entityType === 'agent') {
      selectAgent(memberId);
      setCurrentChannel(memberId);
    } else {
      setCurrentChannel(memberId);
    }
    closeSidebarOnMobile();
  }, [currentUser?.displayName, selectAgent, setCurrentChannel, closeSidebarOnMobile, setViewMode, setSelectedChannelId]);

  const handleNewConversationSend = useCallback(async (to: string, content: string): Promise<boolean> => {
    const success = await sendMessage(to, content);
    if (success) {
      const targetAgent = agents.find((a) => a.name === to);
      if (targetAgent) {
        selectAgent(targetAgent.name);
        setCurrentChannel(targetAgent.name);
      } else {
        setCurrentChannel(to);
      }
    }
    return success;
  }, [sendMessage, selectAgent, setCurrentChannel, agents]);

  const handleAddWorkspace = useCallback(async (path: string, name?: string) => {
    setIsAddingWorkspace(true);
    setAddWorkspaceError(null);
    try {
      await cwAddWorkspace(path, name);
      setIsAddWorkspaceOpen(false);
    } catch (err) {
      setAddWorkspaceError(err instanceof Error ? err.message : 'Failed to add workspace');
      throw err;
    } finally {
      setIsAddingWorkspace(false);
    }
  }, [cwAddWorkspace]);

  // Auth revocation detection
  useEffect(() => {
    if (!data?.messages) return;
    for (const msg of data.messages) {
      if (msg.content?.includes('auth_revoked') || msg.content?.includes('authentication_error')) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.type === 'auth_revoked' && parsed.agent) {
            const agentName = parsed.agent;
            if (!authRevokedAgents.has(agentName)) {
              setAuthRevokedAgents(prev => new Set([...prev, agentName]));
              addToast({
                type: 'error',
                title: 'Authentication Expired',
                message: `${agentName}'s API credentials have expired. Please reconnect.`,
                agentName,
                duration: 0,
                action: {
                  label: 'Reconnect',
                  onClick: () => { window.location.href = '/providers'; },
                },
              });
            }
          }
        } catch {
          if (msg.content?.includes('OAuth token') && msg.content?.includes('expired')) {
            const agentName = msg.from;
            if (agentName && !authRevokedAgents.has(agentName)) {
              setAuthRevokedAgents(prev => new Set([...prev, agentName]));
              addToast({
                type: 'error',
                title: 'Authentication Expired',
                message: `${agentName}'s API credentials have expired. Please reconnect.`,
                agentName,
                duration: 0,
                action: {
                  label: 'Reconnect',
                  onClick: () => { window.location.href = '/providers'; },
                },
              });
            }
          }
        }
      }
    }
  }, [data?.messages, authRevokedAgents, addToast]);

  // Mark DM as seen when viewing a human channel
  useEffect(() => {
    if (!currentUser || !currentChannel) return;
    const humanNameSet = new Set(
      combinedAgents.filter((a) => a.isHuman).map((a) => a.name.toLowerCase())
    );
    if (humanNameSet.has(currentChannel.toLowerCase())) {
      markDmSeen(currentChannel);
    }
  }, [combinedAgents, currentChannel, currentUser, markDmSeen]);

  // DM invite commands for command palette
  const dmInviteCommands = useMemo(() => {
    if (!currentHuman) return [];
    return agents
      .filter((a) => !a.isHuman)
      .map((agent) => {
        const isSelected = (dmSelectedAgentsByHuman[currentHuman.name] ?? []).includes(agent.name);
        return {
          id: `dm-toggle-${currentHuman.name}-${agent.name}`,
          label: `${isSelected ? 'Remove' : 'Invite'} ${agent.name} in DM`,
          description: `DM with ${currentHuman.name}`,
          category: 'actions' as const,
          action: () => handleDmAgentToggle(agent.name),
        };
      });
  }, [agents, currentHuman, dmSelectedAgentsByHuman, handleDmAgentToggle]);

  // Channel commands for command palette
  const channelCommands = useMemo(() => {
    const commands: Array<{
      id: string; label: string; description?: string;
      category: 'channels'; shortcut?: string; action: () => void;
    }> = [];
    commands.push({
      id: 'channels-view', label: 'Go to Channels',
      description: 'Switch to channel messaging view', category: 'channels',
      shortcut: 'Cmd+Shift+C', action: () => setViewMode('channels'),
    });
    commands.push({
      id: 'channels-create', label: 'Create Channel',
      description: 'Create a new messaging channel', category: 'channels',
      action: () => { setViewMode('channels'); handleCreateChannel(); },
    });
    channelsList.forEach((channel) => {
      const unreadBadge = channel.unreadCount > 0 ? ` (${channel.unreadCount} unread)` : '';
      commands.push({
        id: `channel-switch-${channel.id}`,
        label: channel.isDm ? `@${channel.name}` : `#${channel.name}`,
        description: channel.description || `Switch to ${channel.isDm ? 'DM' : 'channel'}${unreadBadge}`,
        category: 'channels',
        action: () => { setViewMode('channels'); setSelectedChannelId(channel.id); },
      });
    });
    return commands;
  }, [channelsList, handleCreateChannel, setViewMode, setSelectedChannelId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 's') {
        e.preventDefault();
        handleSpawnClick();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        setViewMode('channels');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setIsNewConversationOpen(true);
      }
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
        setIsSpawnModalOpen(false);
        setIsNewConversationOpen(false);
        setIsTrajectoryOpen(false);
        if (isFullSettingsOpen) {
          setIsFullSettingsOpen(false);
          urlCloseSettings();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSpawnClick, isFullSettingsOpen, urlCloseSettings, setIsSpawnModalOpen, setViewMode]);

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="flex h-screen bg-bg-deep font-sans text-text-primary">
      {/* Mobile Sidebar Overlay */}
      <div
        className={`
          fixed inset-0 bg-black/60 backdrop-blur-sm z-[999] transition-opacity duration-200
          md:hidden
          ${isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        `}
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sidebar */}
      <div className={`
        flex flex-col w-[280px] max-md:w-[85vw] max-md:max-w-[280px] h-screen bg-bg-primary border-r border-border-subtle
        fixed left-0 top-0 z-[1000] transition-transform duration-200
        md:relative md:translate-x-0 md:flex-shrink-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-3 border-b border-sidebar-border">
          <WorkspaceSelector
            workspaces={effectiveWorkspaces}
            activeWorkspaceId={effectiveActiveWorkspaceId ?? undefined}
            onSelect={handleEffectiveWorkspaceSelect}
            onAddWorkspace={() => {
              if (features.workspaces) {
                localStorage.removeItem('agentrelay_workspace_id');
                window.location.href = '/app?select=true';
              } else {
                setIsAddWorkspaceOpen(true);
              }
            }}
            onWorkspaceSettings={canOpenWorkspaceSettings ? handleWorkspaceSettingsClick : undefined}
            isLoading={effectiveIsLoading}
          />
        </div>
        <Sidebar
          agents={localAgentsForSidebar}
          bridgeAgents={bridgeAgents}
          projects={mergedProjects}
          currentUserName={currentUser?.displayName}
          humanUnreadCounts={humanUnreadCounts}
          currentProject={currentProject}
          selectedAgent={selectedAgent?.name}
          viewMode={viewMode}
          isFleetAvailable={isFleetAvailable}
          isConnected={isConnected || isOrchestratorConnected}
          isOpen={isSidebarOpen}
          activeThreads={activeThreads}
          currentThread={currentThread}
          totalUnreadThreadCount={totalUnreadThreadCount}
          channels={channelsList
            .filter(c => !c.isDm && !c.id.startsWith('dm:'))
            .map(c => ({ id: c.id, name: c.name, unreadCount: c.unreadCount, hasMentions: c.hasMentions }))}
          archivedChannels={archivedChannelsList
            .filter(c => !c.isDm && !c.id.startsWith('dm:'))
            .map(c => ({ id: c.id, name: c.name, unreadCount: c.unreadCount ?? 0, hasMentions: c.hasMentions }))}
          selectedChannelId={selectedChannelId}
          isActivitySelected={selectedChannelId === ACTIVITY_FEED_ID}
          activityUnreadCount={0}
          onActivitySelect={() => {
            setSelectedChannelId(ACTIVITY_FEED_ID);
            selectAgent(null);
            setViewMode('channels');
            navigateToActivity();
          }}
          onChannelSelect={(channel) => {
            const fullChannel =
              channelsList.find(c => c.id === channel.id) ||
              archivedChannelsList.find(c => c.id === channel.id);
            if (fullChannel) {
              handleSelectChannel(fullChannel);
              setViewMode('channels');
            }
          }}
          onCreateChannel={handleCreateChannel}
          onInviteToChannel={(channel) => {
            const fullChannel = channelsList.find(c => c.id === channel.id);
            if (fullChannel) handleInviteToChannel(fullChannel);
          }}
          onArchiveChannel={(channel) => {
            const fullChannel = channelsList.find(c => c.id === channel.id);
            if (fullChannel) handleArchiveChannel(fullChannel);
          }}
          onUnarchiveChannel={(channel) => {
            const fullChannel =
              archivedChannelsList.find(c => c.id === channel.id) ||
              channelsList.find(c => c.id === channel.id);
            if (fullChannel) handleUnarchiveChannel(fullChannel);
          }}
          onAgentSelect={handleAgentSelect}
          onHumanSelect={handleHumanSelect}
          onProjectSelect={handleProjectSelect}
          onViewModeChange={setViewMode}
          onSpawnClick={handleSpawnClick}
          onReleaseClick={handleReleaseAgent}
          onLogsClick={handleLogsClick}
          onProfileClick={setSelectedAgentProfile}
          onThreadSelect={setCurrentThread}
          onClose={() => setIsSidebarOpen(false)}
          onSettingsClick={handleSettingsClick}
          onTrajectoryClick={() => setIsTrajectoryOpen(true)}
          hasActiveTrajectory={trajectoryStatus?.active}
          onFleetClick={() => setIsFleetViewActive(!isFleetViewActive)}
          isFleetViewActive={isFleetViewActive}
        />
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-bg-secondary/50 overflow-hidden">
        <div className="fixed top-0 left-0 right-0 z-50 md:sticky md:top-0 md:left-auto md:right-auto bg-bg-secondary">
          <Header
            currentChannel={currentChannel}
            selectedAgent={selectedAgent}
            projects={mergedProjects}
            currentProject={mergedProjects.find(p => p.id === currentProject) || null}
            recentProjects={getRecentProjects(mergedProjects)}
            viewMode={viewMode}
            selectedChannelName={selectedChannel?.name}
            onProjectChange={handleProjectSelect}
            onCommandPaletteOpen={() => setIsCommandPaletteOpen(true)}
            onSettingsClick={canOpenHeaderSettings ? handleSettingsClick : undefined}
            onHistoryClick={() => setIsHistoryOpen(true)}
            onNewConversationClick={() => setIsNewConversationOpen(true)}
            onFleetClick={() => setIsFleetViewActive(!isFleetViewActive)}
            isFleetViewActive={isFleetViewActive}
            onTrajectoryClick={() => setIsTrajectoryOpen(true)}
            hasActiveTrajectory={trajectoryStatus?.active}
            onMenuClick={() => setIsSidebarOpen(true)}
            hasUnreadNotifications={hasUnreadMessages}
          />
          <UsageBanner onUpgradeClick={handleBillingClick} />
        </div>
        <div className="h-[52px] flex-shrink-0 md:hidden" />
        {currentUser && onlineUsers.length > 0 && (
          <div className="flex items-center justify-end px-4 py-1 bg-bg-tertiary/80 border-b border-border-subtle flex-shrink-0">
            <OnlineUsersIndicator onlineUsers={onlineUsers} onUserClick={setSelectedUserProfile} />
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className={`flex-1 min-h-0 overflow-y-auto ${currentThread ? 'hidden md:block md:flex-[2]' : ''}`}>
            {currentHuman && (
              <div className="px-4 py-2 border-b border-border-subtle bg-bg-secondary flex flex-col gap-2 sticky top-0 z-10">
                <div className="text-xs text-text-muted">
                  DM with <span className="font-semibold text-text-primary">{currentHuman.name}</span>. Invite agents:
                </div>
                <div className="flex flex-wrap gap-2">
                  {agents
                    .filter((a) => !a.isHuman)
                    .map((agent) => {
                      const isSelected = (dmSelectedAgentsByHuman[currentHuman.name] ?? []).includes(agent.name);
                      return (
                        <button
                          key={agent.name}
                          onClick={() => handleDmAgentToggle(agent.name)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            isSelected
                              ? 'bg-accent-cyan text-bg-deep'
                              : 'bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/80'
                          }`}
                          title={agent.name}
                        >
                          {isSelected ? 'v ' : ''}{agent.name}
                        </button>
                      );
                    })}
                  {agents.filter((a) => !a.isHuman).length === 0 && (
                    <span className="text-xs text-text-muted">No agents available</span>
                  )}
                </div>
              </div>
            )}
            {wsError && !data && restFallbackFailed ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted text-center px-4">
                <ErrorIcon />
                <h2 className="m-0 mb-2 font-display text-text-primary">Connection Error</h2>
                <p className="text-text-secondary">{wsError.message}</p>
                <button
                  className="mt-6 py-3 px-6 bg-gradient-to-r from-accent-cyan to-[#00b8d9] text-bg-deep font-semibold border-none rounded-xl cursor-pointer transition-all duration-150 hover:shadow-glow-cyan hover:-translate-y-0.5"
                  onClick={() => window.location.reload()}
                >
                  Retry Connection
                </button>
              </div>
            ) : !data ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted text-center">
                <LoadingSpinner />
                <p className="font-display text-text-secondary">Connecting to dashboard...</p>
              </div>
            ) : isFleetViewActive ? (
              <div className="p-4 h-full overflow-y-auto">
                <FleetOverview
                  servers={fleetServers}
                  agents={agents}
                  selectedServerId={selectedServerId}
                  onServerSelect={setSelectedServerId}
                  onServerReconnect={handleServerReconnect}
                  isLoading={!data}
                />
              </div>
            ) : selectedChannelId === ACTIVITY_FEED_ID ? (
              <ActivityFeed events={activityEvents} maxEvents={100} />
            ) : viewMode === 'channels' && selectedChannel ? (
              <ChannelViewV1
                channel={selectedChannel}
                messages={effectiveChannelMessages}
                currentUser={currentUser?.displayName || 'Anonymous'}
                currentUserInfo={currentUser ? { displayName: currentUser.displayName, avatarUrl: currentUser.avatarUrl } : undefined}
                onlineUsers={onlineUsers}
                agents={agents}
                humanUsers={humanUsers}
                isLoadingMore={false}
                hasMoreMessages={hasMoreMessages && !!effectiveActiveWorkspaceId}
                unreadState={channelUnreadState}
                onSendMessage={(content, attachmentIds) => handleSendChannelMessage(content, undefined, attachmentIds)}
                onLoadMore={handleLoadMoreMessages}
                onThreadClick={(messageId) => setCurrentThread(messageId)}
                onShowMembers={handleShowMembers}
                onMemberClick={handleChannelMemberClick}
                onReaction={enableReactions ? handleReaction : undefined}
              />
            ) : viewMode === 'channels' ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted text-center px-4">
                <HashIconLarge />
                <h2 className="m-0 mb-2 font-display text-text-primary">Select a channel</h2>
                <p className="text-text-secondary">Choose a channel from the sidebar to start messaging</p>
              </div>
            ) : (
              <MessageList
                messages={dedupedVisibleMessages}
                currentChannel={currentChannel}
                currentThread={currentThread}
                onThreadClick={(messageId) => setCurrentThread(messageId)}
                highlightedMessageId={currentThread ?? undefined}
                agents={combinedAgents}
                currentUser={currentUser}
                skipChannelFilter={currentHuman !== null}
                showTimestamps={settings.display.showTimestamps}
                autoScrollDefault={settings.messages.autoScroll}
                compactMode={settings.display.compactMode}
                onAgentClick={setSelectedAgentProfile}
                onUserClick={setSelectedUserProfile}
                onLogsClick={handleLogsClick}
                onlineUsers={onlineUsers}
                onReaction={enableReactions ? handleReaction : undefined}
              />
            )}
          </div>

          {/* Thread Panel */}
          {currentThread && (() => {
            const isChannelView = viewMode === 'channels';

            const convertChannelMessage = (cm: ChannelApiMessage): Message => ({
              id: cm.id, from: cm.from, to: cm.channelId, content: cm.content,
              timestamp: cm.timestamp, thread: cm.threadId, isRead: cm.isRead,
              replyCount: cm.threadSummary?.replyCount, threadSummary: cm.threadSummary,
            });

            let originalMessage: Message | null = null;
            let replies: Message[] = [];
            let isTopicThread = false;
            let threadIsLoading = false;
            let threadHasMore = false;
            let threadLoadMore: (() => void) | undefined;
            const preferApiThreadDataInChannel = isChannelView && (thread.isLoading || Boolean(thread.parentMessage));

            if (preferApiThreadDataInChannel) {
              originalMessage = thread.parentMessage;
              replies = thread.replies;
              isTopicThread = !originalMessage;
              threadIsLoading = thread.isLoading;
              threadHasMore = thread.hasMore;
              threadLoadMore = thread.loadMore;
            } else if (isChannelView) {
              const channelMsg = effectiveChannelMessages.find((m) => m.id === currentThread);
              if (channelMsg) {
                originalMessage = convertChannelMessage(channelMsg);
              } else {
                isTopicThread = true;
                const threadMsgs = effectiveChannelMessages
                  .filter((m) => m.threadId === currentThread)
                  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                if (threadMsgs[0]) originalMessage = convertChannelMessage(threadMsgs[0]);
              }
              replies = effectiveChannelMessages
                .filter((m) => m.threadId === currentThread)
                .map(convertChannelMessage);
            } else {
              originalMessage = thread.parentMessage;
              replies = thread.replies;
              isTopicThread = !originalMessage;
              threadIsLoading = thread.isLoading;
              threadHasMore = thread.hasMore;
              threadLoadMore = thread.loadMore;
            }

            return (
              <div className="w-full md:w-[400px] md:min-w-[320px] md:max-w-[500px] flex-shrink-0 h-full overflow-hidden">
                <ThreadPanel
                  originalMessage={originalMessage}
                  replies={replies}
                  onClose={() => setCurrentThread(null)}
                  showTimestamps={settings.display.showTimestamps}
                  isLoading={threadIsLoading}
                  hasMore={threadHasMore}
                  onLoadMore={threadLoadMore}
                  onReply={async (content) => {
                    if (isChannelView && selectedChannel) {
                      return handleSendChannelMessage(content, currentThread);
                    }
                    let recipient = '*';
                    if (!isTopicThread && originalMessage) {
                      const isFromCurrentUser = originalMessage.from === 'Dashboard' ||
                        (currentUser && originalMessage.from === currentUser.displayName);
                      recipient = isFromCurrentUser ? originalMessage.to : originalMessage.from;
                    }
                    return sendMessage(recipient, content, currentThread);
                  }}
                  isSending={isSending}
                  currentUser={currentUser}
                />
              </div>
            );
          })()}
        </div>

        {typingUsers.length > 0 && (
          <div className="px-4 bg-bg-tertiary border-t border-border-subtle">
            <TypingIndicator typingUsers={typingUsers} />
          </div>
        )}

        {viewMode !== 'channels' && (
          <div className="p-2 sm:p-4 bg-bg-tertiary border-t border-border-subtle">
            <MessageComposer
              agents={agents}
              humanUsers={humanUsers}
              onSend={handleMainComposerSend}
              onTyping={sendTyping}
              isSending={isSending}
              error={sendError}
              insertMention={pendingMention}
              onMentionInserted={() => setPendingMention(undefined)}
              enableFileAutocomplete
              placeholder={`Message @${currentChannel}...`}
            />
          </div>
        )}
      </main>

      {/* Modals & Overlays */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        agents={agents}
        projects={mergedProjects}
        currentProject={currentProject}
        onAgentSelect={handleAgentSelect}
        onProjectSelect={handleProjectSelect}
        onSpawnClick={handleSpawnClick}
        onTaskCreate={handleTaskCreate}
        onGeneralClick={() => {
          selectAgent(null);
          setSelectedChannelId('#general');
          setViewMode('channels');
        }}
        customCommands={[...dmInviteCommands, ...channelCommands]}
      />

      <SpawnModal
        isOpen={isSpawnModalOpen}
        onClose={() => setIsSpawnModalOpen(false)}
        onSpawn={handleSpawn}
        existingAgents={agents.map((a) => a.name)}
        isSpawning={isSpawning}
        error={spawnError}
        workspaceId={effectiveActiveWorkspaceId ?? undefined}
        agentDefaults={settings.agentDefaults}
        repos={workspaceRepos}
        activeRepoId={workspaceRepos.find(r => r.id === currentProject)?.id ?? workspaceRepos[0]?.id}
        connectedProviders={cloudUser?.connectedProviders?.map(p => {
          const BACKEND_TO_FRONTEND_MAP: Record<string, string> = { openai: 'codex' };
          return BACKEND_TO_FRONTEND_MAP[p.provider] ?? p.provider;
        })}
      />

      <AddWorkspaceModal
        isOpen={isAddWorkspaceOpen}
        onClose={() => { setIsAddWorkspaceOpen(false); setAddWorkspaceError(null); }}
        onAdd={handleAddWorkspace}
        isAdding={isAddingWorkspace}
        error={addWorkspaceError}
      />

      <CreateChannelModal
        isOpen={isCreateChannelOpen}
        onClose={() => setIsCreateChannelOpen(false)}
        onCreate={handleCreateChannelSubmit}
        isLoading={isCreatingChannel}
        existingChannels={channelsList.map(c => c.name)}
        availableMembers={agents.map(a => a.name)}
        workspaceId={effectiveActiveWorkspaceId ?? undefined}
      />

      <InviteToChannelModal
        isOpen={isInviteChannelOpen}
        channelName={inviteChannelTarget?.name || ''}
        onClose={() => { setIsInviteChannelOpen(false); setInviteChannelTarget(null); }}
        onInvite={handleInviteSubmit}
        isLoading={isInvitingToChannel}
        availableMembers={agents.map(a => a.name)}
      />

      {selectedChannel && (
        <MemberManagementPanel
          channel={selectedChannel}
          members={channelMembers}
          isOpen={showMemberPanel}
          onClose={() => setShowMemberPanel(false)}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onUpdateRole={() => {}}
          currentUserId={currentUser?.displayName}
          availableAgents={agents.map(a => ({ name: a.name }))}
          workspaceId={effectiveActiveWorkspaceId ?? undefined}
        />
      )}

      <ConversationHistory isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />

      <NewConversationModal
        isOpen={isNewConversationOpen}
        onClose={() => setIsNewConversationOpen(false)}
        onSend={handleNewConversationSend}
        agents={agents}
        isSending={isSending}
        error={sendError}
      />

      {logViewerAgent && (
        <LogViewerPanel
          agent={logViewerAgent}
          isOpen={true}
          onClose={() => setLogViewerAgent(null)}
          availableAgents={agents}
          onAgentChange={setLogViewerAgent}
        />
      )}

      {/* Trajectory Panel */}
      {isTrajectoryOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-black/50 backdrop-blur-sm"
          onClick={() => setIsTrajectoryOpen(false)}
        >
          <div
            className="ml-auto w-full max-w-3xl h-full bg-bg-primary shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-accent-cyan/20 flex items-center justify-center border border-blue-500/30">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-500">
                    <path d="M3 12h4l3 9 4-18 3 9h4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-text-primary m-0">Trajectory Viewer</h2>
                  <p className="text-xs text-text-muted m-0">
                    {trajectoryStatus?.active ? `Active: ${trajectoryStatus.task || 'Working...'}` : 'Browse past trajectories'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTrajectoryOpen(false)}
                className="w-10 h-10 rounded-lg bg-bg-tertiary border border-border-subtle flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover hover:border-blue-500/50 transition-all"
                title="Close (Esc)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-6">
              <TrajectoryViewer
                agentName={selectedTrajectoryTitle?.slice(0, 30) || trajectoryStatus?.task?.slice(0, 30) || 'Trajectories'}
                steps={trajectorySteps}
                history={trajectoryHistory}
                selectedTrajectoryId={selectedTrajectoryId}
                onSelectTrajectory={selectTrajectory}
                isLoading={isTrajectoryLoading}
              />
            </div>
          </div>
        </div>
      )}

      {/* Decision Queue */}
      {isDecisionQueueOpen && (
        <div className="fixed left-4 bottom-4 w-[400px] max-h-[500px] z-50 shadow-modal">
          <div className="relative">
            <button
              onClick={() => setIsDecisionQueueOpen(false)}
              className="absolute -top-2 -right-2 w-6 h-6 bg-bg-elevated border border-border rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover z-10"
              title="Close decisions"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <DecisionQueue
              decisions={decisions}
              onApprove={handleDecisionApprove}
              onReject={handleDecisionReject}
              onDismiss={handleDecisionDismiss}
              isProcessing={decisionProcessing}
            />
          </div>
        </div>
      )}

      {!isDecisionQueueOpen && decisions.length > 0 && (
        <button
          onClick={() => setIsDecisionQueueOpen(true)}
          className="fixed left-4 bottom-4 w-12 h-12 bg-warning text-bg-deep rounded-full shadow-[0_0_20px_rgba(255,107,53,0.4)] flex items-center justify-center hover:scale-105 transition-transform z-50"
          title={`${decisions.length} pending decision${decisions.length > 1 ? 's' : ''}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {decisions.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {decisions.length}
            </span>
          )}
        </button>
      )}

      <UserProfilePanel
        user={selectedUserProfile}
        onClose={() => setSelectedUserProfile(null)}
        onMention={(username) => { setPendingMention(username); setSelectedUserProfile(null); }}
        onSendMessage={(user) => { setCurrentChannel(user.username); markDmSeen(user.username); setSelectedUserProfile(null); }}
      />

      <AgentProfilePanel
        agent={selectedAgentProfile}
        onClose={() => setSelectedAgentProfile(null)}
        onMessage={(agent) => { selectAgent(agent.name); setCurrentChannel(agent.name); setSelectedAgentProfile(null); }}
        onLogs={handleLogsClick}
        onRelease={handleReleaseAgent}
        summary={selectedAgentProfile ? agentSummariesMap.get(selectedAgentProfile.name.toLowerCase()) : null}
      />

      <CoordinatorPanel
        isOpen={isCoordinatorOpen}
        onClose={() => setIsCoordinatorOpen(false)}
        projects={mergedProjects}
        hasArchitect={bridgeAgents.some(a => a.name.toLowerCase() === 'architect')}
        onArchitectSpawned={() => setIsCoordinatorOpen(false)}
      />

      {isFullSettingsOpen && (
        <SettingsPage
          currentUserId={cloudUser?.id}
          initialTab={settingsInitialTab}
          onClose={() => { setIsFullSettingsOpen(false); urlCloseSettings(); }}
          settings={settings}
          onUpdateSettings={updateSettings}
          activeWorkspaceId={effectiveActiveWorkspaceId}
          onReposChanged={refetchWorkspaceRepos}
        />
      )}

      <NotificationToast toasts={toasts} onDismiss={dismissToast} position="top-right" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentation components
// ---------------------------------------------------------------------------

function LoadingSpinner() {
  return (
    <svg className="animate-spin mb-4 text-accent-cyan" width="28" height="28" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="32" strokeLinecap="round" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="text-error mb-4" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function HashIconLarge() {
  return (
    <svg className="text-text-muted mb-4" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

/**
 * Legacy CSS styles export - kept for backwards compatibility
 * @deprecated Use Tailwind classes directly instead
 */
export const appStyles = '';
