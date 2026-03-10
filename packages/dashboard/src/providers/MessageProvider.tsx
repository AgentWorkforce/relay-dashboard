/**
 * Message Provider
 *
 * Manages core message state, threads, DM conversations, presence,
 * notifications, and WebSocket event handling. Composes ChannelProvider
 * and SendProvider as children for channel CRUD and send operations.
 *
 * All values from the sub-providers are re-exported through useMessageContext
 * for backward compatibility.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Message } from '../types';
import type { HumanUser } from '../components/MentionAutocomplete';
import {
  useDMs as useRelayDMs,
} from '@relaycast/react';
import { useMessages as useMessagesHook } from '../components/hooks/useMessages';
import { useThread } from '../components/hooks/useThread';
import { usePresence, type UserPresence } from '../components/hooks/usePresence';
import { useDirectMessage } from '../components/hooks/useDirectMessage';
import { useCloudWorkspace } from './CloudWorkspaceProvider';
import { useAgentContext } from './AgentProvider';
import { useRelayConfigStatus } from './RelayConfigProvider';
import { isDashboardVariant } from '../lib/identity';
import {
  normalizeRelayDmMessageTargets,
  getRelayDmParticipantName,
} from '../lib/relaycastMessageAdapters';
import { playNotificationSound } from './SettingsProvider';
import { useSettings } from './SettingsProvider';
import {
  type Channel,
  type ChannelMember,
  type ChannelMessage as ChannelApiMessage,
  type UnreadState,
  type CreateChannelRequest,
} from '../components/channels';
import type { DashboardData } from '../components/hooks/useWebSocket';
import { ChannelProvider, useChannelContext } from './ChannelProvider';
import { SendProvider, useSendContext } from './SendProvider';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Special ID for the Activity feed (broadcasts) */
export const ACTIVITY_FEED_ID = '__activity__';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function isHumanSender(sender: string, agentNames: Set<string>, projectIdentity?: string | null): boolean {
  return !isDashboardVariant(sender) &&
    (projectIdentity ? sender !== projectIdentity : true) &&
    sender !== '*' &&
    !agentNames.has(sender.toLowerCase());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MessageContextValue {
  // Core message state
  messages: Message[];
  threadMessages: (threadId: string) => Message[];
  currentChannel: string;
  setCurrentChannel: (ch: string) => void;
  currentThread: string | null;
  setCurrentThread: (t: string | null) => void;
  activeThreads: ReturnType<typeof useMessagesHook>['activeThreads'];
  totalUnreadThreadCount: number;
  sendMessage: (to: string, content: string, thread?: string, attachmentIds?: string[]) => Promise<boolean>;
  isSending: boolean;
  sendError: string | null;

  // Thread hook (API-backed)
  thread: ReturnType<typeof useThread>;

  // Channel state (from ChannelProvider)
  viewMode: 'local' | 'fleet' | 'channels';
  setViewMode: React.Dispatch<React.SetStateAction<'local' | 'fleet' | 'channels'>>;
  channelsList: Channel[];
  archivedChannelsList: Channel[];
  channelMessages: ChannelApiMessage[];
  selectedChannelId: string | undefined;
  setSelectedChannelId: React.Dispatch<React.SetStateAction<string | undefined>>;
  selectedChannel: Channel | undefined;
  hasMoreMessages: boolean;
  channelUnreadState: UnreadState | undefined;
  isChannelsLoading: boolean;
  effectiveChannelMessages: ChannelApiMessage[];

  // Channel handlers (from ChannelProvider)
  handleSelectChannel: (channel: Channel) => Promise<void>;
  handleCreateChannel: () => void;
  handleCreateChannelSubmit: (request: CreateChannelRequest) => Promise<void>;
  handleInviteToChannel: (channel: Channel) => void;
  handleInviteSubmit: (members: string[]) => Promise<void>;
  handleJoinChannel: (channelId: string) => Promise<void>;
  handleLeaveChannel: (channel: Channel) => Promise<void>;
  handleShowMembers: () => Promise<void>;
  handleRemoveMember: (memberId: string, memberType: 'user' | 'agent') => Promise<void>;
  handleAddMember: (memberId: string, memberType: 'user' | 'agent', role: 'admin' | 'member' | 'read_only') => Promise<void>;
  handleArchiveChannel: (channel: Channel) => Promise<void>;
  handleUnarchiveChannel: (channel: Channel) => Promise<void>;
  handleSendChannelMessage: (content: string, threadId?: string, attachmentIds?: string[]) => Promise<boolean>;
  handleLoadMoreMessages: () => Promise<void>;
  handleMarkChannelRead: (channelId: string) => void;

  // Channel modals (from ChannelProvider)
  isCreateChannelOpen: boolean;
  setIsCreateChannelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isCreatingChannel: boolean;
  isInviteChannelOpen: boolean;
  setIsInviteChannelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  inviteChannelTarget: Channel | null;
  setInviteChannelTarget: React.Dispatch<React.SetStateAction<Channel | null>>;
  isInvitingToChannel: boolean;
  showMemberPanel: boolean;
  setShowMemberPanel: React.Dispatch<React.SetStateAction<boolean>>;
  channelMembers: ChannelMember[];

  // DM state
  currentHuman: import('../types').Agent | null;
  selectedDmAgents: string[];
  removedDmAgents: string[];
  dedupedVisibleMessages: Message[];
  dmParticipantAgents: string[];
  dmSelectedAgentsByHuman: Record<string, string[]>;
  handleDmAgentToggle: (agentName: string) => void;
  handleDmSend: (content: string, attachmentIds?: string[]) => Promise<boolean>;
  handleMainComposerSend: (content: string, attachmentIds?: string[]) => Promise<boolean>;

  // Presence
  onlineUsers: UserPresence[];
  typingUsers: ReturnType<typeof usePresence>['typingUsers'];
  sendTyping: ReturnType<typeof usePresence>['sendTyping'];
  isPresenceConnected: boolean;

  // Human users
  humanUsers: HumanUser[];
  humanUnreadCounts: Record<string, number>;

  // Reactions (from SendProvider)
  handleReaction: (messageId: string, emoji: string, hasReacted: boolean) => Promise<void>;

  // DM tracking
  markDmSeen: (username: string) => void;

  // User profile
  selectedUserProfile: UserPresence | null;
  setSelectedUserProfile: React.Dispatch<React.SetStateAction<UserPresence | null>>;
  pendingMention: string | undefined;
  setPendingMention: React.Dispatch<React.SetStateAction<string | undefined>>;

  // Notification state
  hasUnreadMessages: boolean;

  // WebSocket event handler ref (for passing to parent hooks)
  handlePresenceEvent: (event: unknown) => void;

  // Channel message map setter for external channel updates
  setChannelsList: React.Dispatch<React.SetStateAction<Channel[]>>;
  appendChannelMessage: (channelId: string, message: ChannelApiMessage, options?: { incrementUnread?: boolean }) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const MessageContext = createContext<MessageContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider Props
// ---------------------------------------------------------------------------

export interface MessageProviderProps {
  children: React.ReactNode;
  data: DashboardData | null;
  rawData: DashboardData | null;
  enableReactions?: boolean;
}

// ---------------------------------------------------------------------------
// Inner component that reads from ChannelProvider and SendProvider
// ---------------------------------------------------------------------------

interface MessageProviderInnerProps {
  children: React.ReactNode;
  data: DashboardData | null;
  rawData: DashboardData | null;
  enableReactions?: boolean;
}

function MessageProviderInner({ children, data, rawData: _rawData, enableReactions = false }: MessageProviderInnerProps) {
  const { currentUser, effectiveActiveWorkspaceId, isWorkspaceFeaturesEnabled } = useCloudWorkspace();
  const { agents, combinedAgents, addActivityEvent } = useAgentContext();
  const { configured: relayConfigured, agentName: relayAgentName } = useRelayConfigStatus();
  const { settings } = useSettings();

  // Sub-provider contexts
  const channelCtx = useChannelContext();
  const sendCtx = useSendContext();

  // In local mode, fetch the project name from the health endpoint so we never show "Dashboard".
  const [localUsername, setLocalUsername] = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('relay_username') : null
  );
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('relay_username') : null;
    if (stored && stored !== localUsername) {
      setLocalUsername(stored);
      return;
    }
    if (!localUsername) {
      fetch('/api/health')
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.projectName) {
            localStorage.setItem('relay_username', data.projectName);
            setLocalUsername(data.projectName);
          }
        })
        .catch(() => {});
    }
  });

  // View mode
  const [viewMode, setViewMode] = useState<'local' | 'fleet' | 'channels'>(
    isWorkspaceFeaturesEnabled ? 'local' : 'channels'
  );

  // DM state
  const [dmSelectedAgentsByHuman, setDmSelectedAgentsByHuman] = useState<Record<string, string[]>>({});
  const [dmRemovedAgentsByHuman, setDmRemovedAgentsByHuman] = useState<Record<string, string[]>>({});
  const [dmSeenAt, setDmSeenAt] = useState<Map<string, number>>(new Map());

  // User profile panel state
  const [selectedUserProfile, setSelectedUserProfile] = useState<UserPresence | null>(null);
  const [pendingMention, setPendingMention] = useState<string | undefined>();

  // Mobile unread tracking
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const lastSeenMessageCountRef = useRef<number>(0);
  const lastNotifiedMessageIdRef = useRef<string | null>(null);
  const relayRealtimeEnabledRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Presence event handler (used by usePresence and the WebSocket onEvent)
  // ---------------------------------------------------------------------------

  const handlePresenceEvent = useCallback((event: any) => {
    if (event?.type === 'presence_join' && event.user) {
      const user = event.user;
      if (user.username !== currentUser?.displayName) {
        addActivityEvent({
          type: 'user_joined',
          actor: user.username,
          actorAvatarUrl: user.avatarUrl,
          actorType: 'user',
          title: 'came online',
        });
      }
    } else if (event?.type === 'presence_leave' && event.username) {
      if (event.username !== currentUser?.displayName) {
        addActivityEvent({
          type: 'user_left',
          actor: event.username,
          actorType: 'user',
          title: 'went offline',
        });
      }
    } else if (event?.type === 'agent_spawned' && event.agent) {
      addActivityEvent({
        type: 'agent_spawned',
        actor: event.agent.name || event.agent,
        actorType: 'agent',
        title: 'was spawned',
        description: event.task,
        metadata: { cli: event.cli, task: event.task, spawnedBy: event.spawnedBy },
      });
    } else if (event?.type === 'agent_released' && event.agent) {
      addActivityEvent({
        type: 'agent_released',
        actor: event.agent.name || event.agent,
        actorType: 'agent',
        title: 'was released',
        metadata: { releasedBy: event.releasedBy },
      });
    } else if (event?.type === 'channel_created') {
      const newChannel = event.channel;
      if (!newChannel || !newChannel.id) return;

      channelCtx.setChannelsList(prev => {
        if (prev.some(c => c.id === newChannel.id)) return prev;

        const channel: Channel = {
          id: newChannel.id,
          name: newChannel.name || newChannel.id,
          description: newChannel.description,
          visibility: newChannel.visibility || 'public',
          status: newChannel.status || 'active',
          createdAt: newChannel.createdAt || new Date().toISOString(),
          createdBy: newChannel.createdBy || 'unknown',
          memberCount: newChannel.memberCount || 1,
          unreadCount: newChannel.unreadCount || 0,
          hasMentions: newChannel.hasMentions || false,
          isDm: newChannel.isDm || false,
        };
        console.log('[MessageProvider] Channel created via WebSocket:', channel.id);
        return [...prev, channel];
      });
    } else if (event?.type === 'channel_message') {
      if (relayRealtimeEnabledRef.current) return;
      const channelId = event.channel as string | undefined;
      if (!channelId) return;
      const sender = event.from || 'unknown';
      const fromEntityType = event.fromEntityType || (currentUser?.displayName && sender === currentUser.displayName ? 'user' : 'agent');
      const msg: ChannelApiMessage = {
        id: event.id ?? `ws-${Date.now()}`,
        channelId,
        from: sender,
        fromEntityType,
        fromAvatarUrl: event.fromAvatarUrl,
        content: event.body ?? '',
        timestamp: event.timestamp || new Date().toISOString(),
        threadId: event.thread,
        isRead: channelCtx.selectedChannelId === channelId,
      };
      sendCtx.appendChannelMessage(channelId, msg, { incrementUnread: channelCtx.selectedChannelId !== channelId });
    } else if (event?.type === 'direct_message') {
      if (relayRealtimeEnabledRef.current) return;
      const sender = event.from || 'unknown';
      const recipient = currentUser?.displayName || event.targetUser || relayAgentName || 'Dashboard';

      const participants = [sender, recipient].sort();
      const dmChannelId = `dm:${participants.join(':')}`;

      const fromEntityType = event.fromEntityType || 'agent';
      const msg: ChannelApiMessage = {
        id: event.id ?? `dm-${Date.now()}`,
        channelId: dmChannelId,
        from: sender,
        fromEntityType,
        fromAvatarUrl: event.fromAvatarUrl,
        content: event.body ?? '',
        timestamp: event.timestamp || new Date().toISOString(),
        threadId: event.thread,
        isRead: channelCtx.selectedChannelId === dmChannelId,
      };
      sendCtx.appendChannelMessage(dmChannelId, msg, { incrementUnread: channelCtx.selectedChannelId !== dmChannelId });
    }
  }, [addActivityEvent, sendCtx.appendChannelMessage, currentUser?.displayName, channelCtx.selectedChannelId, channelCtx.setChannelsList, relayAgentName]);

  // ---------------------------------------------------------------------------
  // Presence
  // ---------------------------------------------------------------------------

  const presenceUser = useMemo(() =>
    currentUser
      ? { username: currentUser.displayName, avatarUrl: currentUser.avatarUrl }
      : undefined,
    [currentUser?.displayName, currentUser?.avatarUrl]
  );

  const { onlineUsers: allOnlineUsers, typingUsers, sendTyping, isConnected: isPresenceConnected } = usePresence({
    currentUser: presenceUser,
    onEvent: handlePresenceEvent,
    workspaceId: effectiveActiveWorkspaceId ?? undefined,
  });

  const onlineUsers = allOnlineUsers;

  // ---------------------------------------------------------------------------
  // Relay DMs and message normalization
  // ---------------------------------------------------------------------------

  const relayDMsState = useRelayDMs();
  const normalizedRelayMessages = useMemo(() => {
    const sourceMessages = data?.messages ?? [];
    if (!relayConfigured || relayDMsState.conversations.length === 0) {
      return sourceMessages;
    }
    return normalizeRelayDmMessageTargets(sourceMessages, relayDMsState.conversations);
  }, [data?.messages, relayConfigured, relayDMsState.conversations]);

  // ---------------------------------------------------------------------------
  // Core message hook
  // ---------------------------------------------------------------------------

  const {
    messages,
    threadMessages,
    currentChannel,
    setCurrentChannel,
    currentThread,
    setCurrentThread,
    activeThreads,
    totalUnreadThreadCount,
    sendMessage,
    isSending,
    sendError,
  } = useMessagesHook({
    messages: normalizedRelayMessages,
    senderName: currentUser?.displayName || localUsername || undefined,
  });

  // ---------------------------------------------------------------------------
  // Thread data
  // ---------------------------------------------------------------------------

  const thread = useThread({
    threadId: viewMode === 'channels'
      ? (relayConfigured ? currentThread : null)
      : currentThread,
    fallbackMessages: messages,
  });

  // ---------------------------------------------------------------------------
  // DM state
  // ---------------------------------------------------------------------------

  const currentHuman = useMemo(() => {
    if (!currentChannel) return null;
    return combinedAgents.find(
      (a) => a.isHuman && a.name.toLowerCase() === currentChannel.toLowerCase()
    ) || null;
  }, [combinedAgents, currentChannel]);

  const selectedDmAgents = useMemo(
    () => (currentHuman ? dmSelectedAgentsByHuman[currentHuman.name] ?? [] : []),
    [currentHuman, dmSelectedAgentsByHuman]
  );
  const removedDmAgents = useMemo(
    () => (currentHuman ? dmRemovedAgentsByHuman[currentHuman.name] ?? [] : []),
    [currentHuman, dmRemovedAgentsByHuman]
  );

  const { visibleMessages: dedupedVisibleMessages, participantAgents: dmParticipantAgents } = useDirectMessage({
    currentHuman,
    currentUserName: currentUser?.displayName ?? null,
    messages: currentHuman ? normalizedRelayMessages : messages,
    agents,
    selectedDmAgents,
    removedDmAgents,
  });

  useEffect(() => {
    relayRealtimeEnabledRef.current = relayConfigured;
  }, [relayConfigured]);

  // ---------------------------------------------------------------------------
  // Human users extraction
  // ---------------------------------------------------------------------------

  const humanUsers = useMemo((): HumanUser[] => {
    const agentNames = new Set(agents.filter((a) => !a.isHuman).map((a) => a.name.toLowerCase()));
    const seenUsers = new Map<string, HumanUser>();

    if (currentUser) {
      seenUsers.set(currentUser.displayName.toLowerCase(), {
        username: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl,
      });
    }

    if (relayConfigured && relayDMsState.conversations.length > 0) {
      const currentUserName = currentUser?.displayName.toLowerCase();
      for (const conversation of relayDMsState.conversations) {
        for (const participant of conversation.participants) {
          const name = getRelayDmParticipantName(participant);
          if (!name) continue;
          const lowered = name.toLowerCase();
          if (currentUserName && lowered === currentUserName) continue;
          if (agentNames.has(lowered)) continue;
          if (!seenUsers.has(lowered)) {
            seenUsers.set(lowered, { username: name });
          }
        }
      }
    }

    for (const msg of normalizedRelayMessages) {
      const sender = msg.from;
      if (sender && isHumanSender(sender, agentNames, relayAgentName) && !seenUsers.has(sender.toLowerCase())) {
        seenUsers.set(sender.toLowerCase(), { username: sender });
      }
    }

    return Array.from(seenUsers.values());
  }, [normalizedRelayMessages, agents, currentUser, relayDMsState.conversations, relayConfigured, relayAgentName]);

  // ---------------------------------------------------------------------------
  // Human unread counts
  // ---------------------------------------------------------------------------

  const humanUnreadCounts = useMemo(() => {
    if (!currentUser) return {};

    if (relayConfigured && relayDMsState.conversations.length > 0) {
      const counts: Record<string, number> = {};
      const currentUserName = currentUser.displayName.toLowerCase();
      const agentNames = new Set(agents.filter((a) => !a.isHuman).map((a) => a.name.toLowerCase()));

      for (const conversation of relayDMsState.conversations) {
        if (!conversation.unreadCount) continue;

        const match = conversation.participants.find((p) => {
          const name = getRelayDmParticipantName(p);
          if (!name) return false;
          const lowered = name.toLowerCase();
          return lowered !== currentUserName && !agentNames.has(lowered);
        });
        const participantName = match ? getRelayDmParticipantName(match) : null;

        if (participantName) {
          counts[participantName] = (counts[participantName] || 0) + conversation.unreadCount;
        }
      }

      return counts;
    }

    const counts: Record<string, number> = {};
    const humanNameSet = new Set(
      combinedAgents.filter((a) => a.isHuman).map((a) => a.name.toLowerCase())
    );

    for (const msg of normalizedRelayMessages) {
      const sender = msg.from;
      const recipient = msg.to;
      if (!sender || !recipient) continue;

      const isToCurrentUser = recipient === currentUser.displayName;
      const senderIsHuman = humanNameSet.has(sender.toLowerCase());
      if (!isToCurrentUser || !senderIsHuman) continue;

      const seenAt = dmSeenAt.get(sender.toLowerCase()) ?? 0;
      const ts = new Date(msg.timestamp).getTime();
      if (ts > seenAt) {
        counts[sender] = (counts[sender] || 0) + 1;
      }
    }

    return counts;
  }, [combinedAgents, currentUser, normalizedRelayMessages, dmSeenAt, relayDMsState.conversations, agents, relayConfigured]);

  const markDmSeen = useCallback((username: string) => {
    setDmSeenAt((prev) => {
      const next = new Map(prev);
      next.set(username.toLowerCase(), Date.now());
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // DM handlers
  // ---------------------------------------------------------------------------

  const handleDmAgentToggle = useCallback((agentName: string) => {
    if (!currentHuman) return;
    const humanName = currentHuman.name;
    const isSelected = (dmSelectedAgentsByHuman[humanName] ?? []).includes(agentName);

    setDmSelectedAgentsByHuman((prev) => {
      const currentList = prev[humanName] ?? [];
      const nextList = isSelected
        ? currentList.filter((a) => a !== agentName)
        : [...currentList, agentName];
      return { ...prev, [humanName]: nextList };
    });

    setDmRemovedAgentsByHuman((prev) => {
      const currentList = prev[humanName] ?? [];
      if (isSelected) {
        return currentList.includes(agentName)
          ? prev
          : { ...prev, [humanName]: [...currentList, agentName] };
      }
      return { ...prev, [humanName]: currentList.filter((a) => a !== agentName) };
    });
  }, [currentHuman, dmSelectedAgentsByHuman]);

  const handleDmSend = useCallback(async (content: string, attachmentIds?: string[]): Promise<boolean> => {
    if (!currentHuman) return false;
    const humanName = currentHuman.name;

    await sendMessage(humanName, content, undefined, attachmentIds);

    if (selectedDmAgents.length > 0) {
      for (const agent of selectedDmAgents) {
        await sendMessage(agent, content, undefined, attachmentIds);
      }
    }

    return true;
  }, [currentHuman, selectedDmAgents, sendMessage]);

  const handleMainComposerSend = useCallback(
    async (content: string, attachmentIds?: string[]) => {
      if (currentHuman) {
        return handleDmSend(content, attachmentIds);
      }
      return sendMessage(currentChannel, content, undefined, attachmentIds);
    },
    [currentChannel, currentHuman, handleDmSend, sendMessage]
  );

  // ---------------------------------------------------------------------------
  // Browser notifications and sounds
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const msgs = normalizedRelayMessages;
    if (!msgs || msgs.length === 0) {
      lastNotifiedMessageIdRef.current = null;
      return;
    }

    const latestMessage = msgs[msgs.length - 1];

    if (!settings.notifications.enabled) {
      lastNotifiedMessageIdRef.current = latestMessage?.id ?? null;
      return;
    }

    if (!lastNotifiedMessageIdRef.current) {
      lastNotifiedMessageIdRef.current = latestMessage.id;
      return;
    }

    const lastNotifiedIndex = msgs.findIndex((message) => (
      message.id === lastNotifiedMessageIdRef.current
    ));

    if (lastNotifiedIndex === -1) {
      lastNotifiedMessageIdRef.current = latestMessage.id;
      return;
    }

    const newMessages = msgs.slice(lastNotifiedIndex + 1);
    if (newMessages.length === 0) return;

    lastNotifiedMessageIdRef.current = latestMessage.id;

    const isFromCurrentUser = (message: Message) =>
      message.from === 'Dashboard' ||
      message.from === relayAgentName ||
      (currentUser && message.from === currentUser.displayName);

    const isMessageInCurrentChannel = (message: Message) => {
      return message.from === currentChannel || message.to === currentChannel;
    };

    const shouldNotifyForMessage = (message: Message) => {
      if (isFromCurrentUser(message)) return false;
      if (settings.notifications.mentionsOnly && currentUser?.displayName) {
        if (!message.content.includes(`@${currentUser.displayName}`)) return false;
      }
      const isActive = typeof document !== 'undefined' ? !document.hidden : false;
      if (isActive && isMessageInCurrentChannel(message)) return false;
      return true;
    };

    let shouldPlaySound = false;

    for (const message of newMessages) {
      if (!shouldNotifyForMessage(message)) continue;

      if (settings.notifications.desktop && typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          const channelLabel = message.to;
          const body = message.content.split('\n')[0].slice(0, 160);
          const notification = new Notification(`${message.from} -> ${channelLabel}`, { body });
          notification.onclick = () => {
            window.focus();
            setCurrentChannel(message.from);
            notification.close();
          };
        }
      }

      if (settings.notifications.sound) {
        shouldPlaySound = true;
      }
    }

    if (shouldPlaySound) {
      playNotificationSound();
    }
  }, [normalizedRelayMessages, settings.notifications, currentChannel, currentUser, setCurrentChannel, relayAgentName]);

  // Mobile unread tracking
  useEffect(() => {
    lastSeenMessageCountRef.current = messages.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Compose context value (merging sub-provider values for backward compat)
  // ---------------------------------------------------------------------------

  const value = useMemo<MessageContextValue>(() => ({
    // Core message state
    messages, threadMessages, currentChannel, setCurrentChannel,
    currentThread, setCurrentThread, activeThreads, totalUnreadThreadCount,
    sendMessage, isSending, sendError, thread,

    // View mode
    viewMode, setViewMode,

    // Channel state (from ChannelProvider)
    channelsList: channelCtx.channelsList,
    archivedChannelsList: channelCtx.archivedChannelsList,
    selectedChannelId: channelCtx.selectedChannelId,
    setSelectedChannelId: channelCtx.setSelectedChannelId,
    selectedChannel: channelCtx.selectedChannel,
    isChannelsLoading: channelCtx.isChannelsLoading,

    // Channel message state (from SendProvider)
    channelMessages: sendCtx.channelMessages,
    hasMoreMessages: sendCtx.hasMoreMessages,
    channelUnreadState: sendCtx.channelUnreadState,
    effectiveChannelMessages: sendCtx.effectiveChannelMessages,

    // Channel handlers (from ChannelProvider)
    handleSelectChannel: channelCtx.handleSelectChannel,
    handleCreateChannel: channelCtx.handleCreateChannel,
    handleCreateChannelSubmit: channelCtx.handleCreateChannelSubmit,
    handleInviteToChannel: channelCtx.handleInviteToChannel,
    handleInviteSubmit: channelCtx.handleInviteSubmit,
    handleJoinChannel: channelCtx.handleJoinChannel,
    handleLeaveChannel: channelCtx.handleLeaveChannel,
    handleShowMembers: channelCtx.handleShowMembers,
    handleRemoveMember: channelCtx.handleRemoveMember,
    handleAddMember: channelCtx.handleAddMember,
    handleArchiveChannel: channelCtx.handleArchiveChannel,
    handleUnarchiveChannel: channelCtx.handleUnarchiveChannel,

    // Send handlers (from SendProvider)
    handleSendChannelMessage: sendCtx.handleSendChannelMessage,
    handleLoadMoreMessages: sendCtx.handleLoadMoreMessages,
    handleMarkChannelRead: sendCtx.handleMarkChannelRead,
    handleReaction: sendCtx.handleReaction,

    // Channel modals (from ChannelProvider)
    isCreateChannelOpen: channelCtx.isCreateChannelOpen,
    setIsCreateChannelOpen: channelCtx.setIsCreateChannelOpen,
    isCreatingChannel: channelCtx.isCreatingChannel,
    isInviteChannelOpen: channelCtx.isInviteChannelOpen,
    setIsInviteChannelOpen: channelCtx.setIsInviteChannelOpen,
    inviteChannelTarget: channelCtx.inviteChannelTarget,
    setInviteChannelTarget: channelCtx.setInviteChannelTarget,
    isInvitingToChannel: channelCtx.isInvitingToChannel,
    showMemberPanel: channelCtx.showMemberPanel,
    setShowMemberPanel: channelCtx.setShowMemberPanel,
    channelMembers: channelCtx.channelMembers,

    // DM state
    currentHuman, selectedDmAgents, removedDmAgents,
    dedupedVisibleMessages, dmParticipantAgents,
    dmSelectedAgentsByHuman, handleDmAgentToggle,
    handleDmSend, handleMainComposerSend,

    // Presence
    onlineUsers, typingUsers, sendTyping, isPresenceConnected,

    // Human users
    humanUsers, humanUnreadCounts,

    // DM tracking
    markDmSeen,

    // User profile
    selectedUserProfile, setSelectedUserProfile,
    pendingMention, setPendingMention,

    // Notification state
    hasUnreadMessages,

    // WebSocket event handler
    handlePresenceEvent,

    // External channel updates
    setChannelsList: channelCtx.setChannelsList,
    appendChannelMessage: sendCtx.appendChannelMessage,
  }), [
    messages, threadMessages, currentChannel, setCurrentChannel,
    currentThread, setCurrentThread, activeThreads, totalUnreadThreadCount,
    sendMessage, isSending, sendError, thread,
    viewMode,
    channelCtx,
    sendCtx,
    currentHuman, selectedDmAgents, removedDmAgents,
    dedupedVisibleMessages, dmParticipantAgents,
    dmSelectedAgentsByHuman, handleDmAgentToggle,
    handleDmSend, handleMainComposerSend,
    onlineUsers, typingUsers, sendTyping, isPresenceConnected,
    humanUsers, humanUnreadCounts,
    markDmSeen,
    selectedUserProfile,
    pendingMention,
    hasUnreadMessages, handlePresenceEvent,
  ]);

  return (
    <MessageContext.Provider value={value}>
      {children}
    </MessageContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Outer Provider (composes ChannelProvider + SendProvider + MessageProviderInner)
// ---------------------------------------------------------------------------

export function MessageProvider({ children, data, rawData, enableReactions = false }: MessageProviderProps) {
  return (
    <ChannelProvider>
      <MessageProviderInnerWithSend data={data} rawData={rawData} enableReactions={enableReactions}>
        {children}
      </MessageProviderInnerWithSend>
    </ChannelProvider>
  );
}

/**
 * Intermediate wrapper that creates the SendProvider with the local messages
 * that MessageProviderInner will compute. Since SendProvider needs messages
 * from the useMessagesHook (which lives inside MessageProviderInner), we pass
 * them as empty and let SendProvider handle its own message loading.
 */
function MessageProviderInnerWithSend({ children, data, rawData, enableReactions }: MessageProviderInnerProps) {
  // We need to pass localMessages to SendProvider for the local channel message fallback.
  // However, the normalized messages are computed inside MessageProviderInner.
  // Since SendProvider only needs them for local (non-cloud) channel message rendering,
  // we derive them here at this level too.
  const { configured: relayConfigured } = useRelayConfigStatus();
  const relayDMsState = useRelayDMs();
  const { currentUser } = useCloudWorkspace();

  const normalizedRelayMessages = useMemo(() => {
    const sourceMessages = data?.messages ?? [];
    if (!relayConfigured || relayDMsState.conversations.length === 0) {
      return sourceMessages;
    }
    return normalizeRelayDmMessageTargets(sourceMessages, relayDMsState.conversations);
  }, [data?.messages, relayConfigured, relayDMsState.conversations]);

  const [localUsername] = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('relay_username') : null
  );

  return (
    <SendProvider localMessages={normalizedRelayMessages} localUsername={localUsername}>
      <MessageProviderInner data={data} rawData={rawData} enableReactions={enableReactions}>
        {children}
      </MessageProviderInner>
    </SendProvider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMessageContext(): MessageContextValue {
  const ctx = useContext(MessageContext);
  if (!ctx) {
    throw new Error('useMessageContext must be used within a MessageProvider');
  }
  return ctx;
}
