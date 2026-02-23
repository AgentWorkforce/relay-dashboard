/**
 * Message Provider
 *
 * Manages messages, channels, threads, DM conversations, send operations,
 * and optimistic updates. Centralizes all messaging state that was previously
 * spread across the monolithic App component.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Agent, Message, Reaction } from '../types';
import type { HumanUser } from '../components/MentionAutocomplete';
import type { CurrentUser } from '../components/MessageList';
import { useMessages as useMessagesHook } from '../components/hooks/useMessages';
import { useThread } from '../components/hooks/useThread';
import { usePresence, type UserPresence } from '../components/hooks/usePresence';
import { useDirectMessage } from '../components/hooks/useDirectMessage';
import { useCloudWorkspace } from './CloudWorkspaceProvider';
import { useAgentContext } from './AgentProvider';
import { api, getCsrfToken } from '../lib/api';
import { playNotificationSound } from './SettingsProvider';
import { useSettings } from './SettingsProvider';
import {
  listChannels,
  getMessages,
  getChannelMembers,
  removeMember as removeChannelMember,
  sendMessage as sendChannelApiMessage,
  markRead,
  createChannel,
  type Channel,
  type ChannelMember,
  type ChannelMessage as ChannelApiMessage,
  type UnreadState,
  type CreateChannelRequest,
} from '../components/channels';
import type { DashboardData } from '../components/hooks/useWebSocket';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Special ID for the Activity feed (broadcasts) */
export const ACTIVITY_FEED_ID = '__activity__';

const REACTION_OVERRIDE_TTL = 5000;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function isHumanSender(sender: string, agentNames: Set<string>): boolean {
  return sender !== 'Dashboard' &&
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

  // Channel state
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

  // Channel handlers
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
  handleSendChannelMessage: (content: string, threadId?: string) => Promise<void>;
  handleLoadMoreMessages: () => Promise<void>;
  handleMarkChannelRead: (channelId: string) => void;

  // Channel modals
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
  currentHuman: Agent | null;
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

  // Reactions
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
// Provider
// ---------------------------------------------------------------------------

export interface MessageProviderProps {
  children: React.ReactNode;
  data: DashboardData | null;
  rawData: DashboardData | null;
  enableReactions?: boolean;
}

export function MessageProvider({ children, data, rawData, enableReactions = false }: MessageProviderProps) {
  const { currentUser, effectiveActiveWorkspaceId, isWorkspaceFeaturesEnabled } = useCloudWorkspace();
  const { agents, combinedAgents, addActivityEvent } = useAgentContext();
  const { settings } = useSettings();

  // Local reaction overrides for optimistic UI updates
  const [reactionOverrides, setReactionOverrides] = useState<Map<string, { reactions: Reaction[]; timestamp: number }>>(new Map());
  const rawDataRef = useRef(rawData);
  rawDataRef.current = rawData;

  // Expire stale reaction overrides
  useEffect(() => {
    if (rawData && reactionOverrides.size > 0) {
      const now = Date.now();
      setReactionOverrides((prev) => {
        const next = new Map<string, { reactions: Reaction[]; timestamp: number }>();
        for (const [id, entry] of prev) {
          if (now - entry.timestamp < REACTION_OVERRIDE_TTL) next.set(id, entry);
        }
        return next.size === prev.size ? prev : next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawData]);

  // View mode
  const [viewMode, setViewMode] = useState<'local' | 'fleet' | 'channels'>(
    isWorkspaceFeaturesEnabled ? 'local' : 'channels'
  );

  // Channel state
  const [selectedChannelId, setSelectedChannelId] = useState<string | undefined>(
    isWorkspaceFeaturesEnabled ? ACTIVITY_FEED_ID : '#general'
  );
  const [channelsList, setChannelsList] = useState<Channel[]>([]);
  const [archivedChannelsList, setArchivedChannelsList] = useState<Channel[]>([]);
  const [channelMessages, setChannelMessages] = useState<ChannelApiMessage[]>([]);
  const [channelMessageMap, setChannelMessageMap] = useState<Record<string, ChannelApiMessage[]>>({});
  const fetchedChannelsRef = useRef<Set<string>>(new Set());
  const [isChannelsLoading, setIsChannelsLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [channelUnreadState, setChannelUnreadState] = useState<UnreadState | undefined>();

  // Channel modals
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [isInviteChannelOpen, setIsInviteChannelOpen] = useState(false);
  const [inviteChannelTarget, setInviteChannelTarget] = useState<Channel | null>(null);
  const [isInvitingToChannel, setIsInvitingToChannel] = useState(false);
  const [showMemberPanel, setShowMemberPanel] = useState(false);
  const [channelMembers, setChannelMembers] = useState<ChannelMember[]>([]);

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

  // Default channels
  const DEFAULT_CHANNEL_IDS = ['#general', '#engineering'];

  const setChannelListsFromResponse = useCallback((response: { channels: Channel[]; archivedChannels?: Channel[] }) => {
    const archived = [
      ...(response.archivedChannels || []),
      ...response.channels.filter(c => c.status === 'archived'),
    ];
    const apiActive = response.channels.filter(c => c.status !== 'archived');

    const apiChannelIds = new Set(apiActive.map(c => c.id));
    const defaultChannelsToAdd: Channel[] = DEFAULT_CHANNEL_IDS
      .filter(id => !apiChannelIds.has(id))
      .map(id => ({
        id,
        name: id.replace('#', ''),
        description: id === '#general' ? 'General discussion for all agents' : 'Engineering discussion',
        visibility: 'public' as const,
        memberCount: 0,
        unreadCount: 0,
        hasMentions: false,
        createdAt: new Date().toISOString(),
        status: 'active' as const,
        createdBy: 'system',
        isDm: false,
      }));

    setChannelsList([...defaultChannelsToAdd, ...apiActive]);
    setArchivedChannelsList(archived);
  }, []);

  const selectedChannel = useMemo(() => {
    if (!selectedChannelId) return undefined;
    return channelsList.find(c => c.id === selectedChannelId) ||
           archivedChannelsList.find(c => c.id === selectedChannelId);
  }, [selectedChannelId, channelsList, archivedChannelsList]);

  // Duplicate detection
  const isDuplicateMessage = useCallback((existing: ChannelApiMessage[], message: ChannelApiMessage) => {
    return existing.some((m) => {
      if (m.id === message.id) return true;
      if (m.from !== message.from) return false;
      if (m.content !== message.content) return false;
      if (m.threadId !== message.threadId) return false;
      const timeDiff = Math.abs(new Date(m.timestamp).getTime() - new Date(message.timestamp).getTime());
      return timeDiff < 2000;
    });
  }, []);

  const appendChannelMessage = useCallback((channelId: string, message: ChannelApiMessage, options?: { incrementUnread?: boolean }) => {
    const incrementUnread = options?.incrementUnread ?? true;

    setChannelMessageMap(prev => {
      const list = prev[channelId] ?? [];
      if (isDuplicateMessage(list, message)) return prev;
      const updated = [...list, message].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      return { ...prev, [channelId]: updated };
    });

    if (selectedChannelId === channelId) {
      setChannelMessages(prev => {
        if (isDuplicateMessage(prev, message)) return prev;
        const updated = [...prev, message].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        return updated;
      });
      setChannelUnreadState(undefined);
    } else if (incrementUnread) {
      setChannelsList(prev => {
        const existing = prev.find(c => c.id === channelId);
        if (existing) {
          return prev.map(c =>
            c.id === channelId
              ? { ...c, unreadCount: (c.unreadCount ?? 0) + 1 }
              : c
          );
        }

        const newChannel: Channel = {
          id: channelId,
          name: channelId.startsWith('#') ? channelId.slice(1) : channelId,
          visibility: 'public',
          status: 'active',
          createdAt: new Date().toISOString(),
          createdBy: currentUser?.displayName || 'Dashboard',
          memberCount: 1,
          unreadCount: 1,
          hasMentions: false,
          isDm: channelId.startsWith('dm:'),
        };

        return [...prev, newChannel];
      });
    }
  }, [currentUser?.displayName, selectedChannelId, isDuplicateMessage]);

  // Presence event handler (used by usePresence and the WebSocket onEvent)
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

      setChannelsList(prev => {
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
        isRead: selectedChannelId === channelId,
      };
      appendChannelMessage(channelId, msg, { incrementUnread: selectedChannelId !== channelId });
    } else if (event?.type === 'direct_message') {
      const sender = event.from || 'unknown';
      const recipient = currentUser?.displayName || event.targetUser || 'Dashboard';

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
        isRead: selectedChannelId === dmChannelId,
      };
      appendChannelMessage(dmChannelId, msg, { incrementUnread: selectedChannelId !== dmChannelId });
    }
  }, [addActivityEvent, appendChannelMessage, currentUser?.displayName, selectedChannelId]);

  // Presence
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

  // Core message hook
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
    messages: data?.messages ?? [],
    senderName: currentUser?.displayName,
  });

  // Merge optimistic reaction overrides into messages for local/DM view
  const mergedMessages = useMemo(() => {
    if (reactionOverrides.size === 0) return messages;
    return messages.map(m => {
      const override = reactionOverrides.get(m.id);
      if (!override) return m;
      return { ...m, reactions: override.reactions };
    });
  }, [messages, reactionOverrides]);

  // Thread data
  const thread = useThread({
    threadId: viewMode === 'channels' ? null : currentThread,
    fallbackMessages: mergedMessages,
  });

  // DM state
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
    messages: mergedMessages,
    agents,
    selectedDmAgents,
    removedDmAgents,
  });

  // Local channel messages (relay messages -> channel format)
  const localChannelMessages = useMemo((): ChannelApiMessage[] => {
    if (effectiveActiveWorkspaceId || !selectedChannelId) return [];

    const filtered = messages.filter(m => {
      if (selectedChannelId === ACTIVITY_FEED_ID) return false;
      if (m.to === selectedChannelId) return true;
      if (m.channel === selectedChannelId) return true;
      if (m.thread === selectedChannelId) return true;
      return false;
    });

    return filtered.map(m => ({
      id: m.id,
      channelId: selectedChannelId,
      from: m.from,
      fromEntityType: (m.from === 'Dashboard' || m.from === currentUser?.displayName) ? 'user' : 'agent' as const,
      content: m.content,
      timestamp: m.timestamp,
      isRead: m.isRead ?? true,
      threadId: m.thread !== selectedChannelId ? m.thread : undefined,
    }));
  }, [messages, selectedChannelId, effectiveActiveWorkspaceId, currentUser?.displayName]);

  const effectiveChannelMessages = channelMessages.length > 0 ? channelMessages : localChannelMessages;

  // Human users extraction
  const humanUsers = useMemo((): HumanUser[] => {
    const agentNames = new Set(agents.map((a) => a.name.toLowerCase()));
    const seenUsers = new Map<string, HumanUser>();

    if (currentUser) {
      seenUsers.set(currentUser.displayName.toLowerCase(), {
        username: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl,
      });
    }

    for (const msg of data?.messages ?? []) {
      const sender = msg.from;
      if (sender && isHumanSender(sender, agentNames) && !seenUsers.has(sender.toLowerCase())) {
        seenUsers.set(sender.toLowerCase(), { username: sender });
      }
    }

    return Array.from(seenUsers.values());
  }, [data?.messages, agents, currentUser]);

  // Human unread counts
  const humanUnreadCounts = useMemo(() => {
    if (!currentUser) return {};

    const counts: Record<string, number> = {};
    const humanNameSet = new Set(
      combinedAgents.filter((a) => a.isHuman).map((a) => a.name.toLowerCase())
    );

    for (const msg of data?.messages ?? []) {
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
  }, [combinedAgents, currentUser, data?.messages, dmSeenAt]);

  const markDmSeen = useCallback((username: string) => {
    setDmSeenAt((prev) => {
      const next = new Map(prev);
      next.set(username.toLowerCase(), Date.now());
      return next;
    });
  }, []);

  // Reset channel state when switching workspaces
  useEffect(() => {
    setChannelMessageMap({});
    setChannelMessages([]);
    setSelectedChannelId(undefined);
    fetchedChannelsRef.current.clear();
  }, [effectiveActiveWorkspaceId]);

  // Default channels for non-cloud mode
  const defaultChannels = useMemo<Channel[]>(() => [
    {
      id: '#general',
      name: 'general',
      description: 'General discussion for all agents',
      visibility: 'public',
      memberCount: 0,
      unreadCount: 0,
      hasMentions: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      status: 'active',
      createdBy: 'system',
      isDm: false,
    },
    {
      id: '#engineering',
      name: 'engineering',
      description: 'Engineering discussion',
      visibility: 'public',
      memberCount: 0,
      unreadCount: 0,
      hasMentions: false,
      createdAt: '2024-01-01T00:00:00.000Z',
      status: 'active',
      createdBy: 'system',
      isDm: false,
    },
  ], []);

  // Load channels on mount
  useEffect(() => {
    if (!isWorkspaceFeaturesEnabled || !effectiveActiveWorkspaceId) {
      setChannelsList(defaultChannels);
      setArchivedChannelsList([]);
      return;
    }

    setChannelsList(defaultChannels);
    setArchivedChannelsList([]);
    setIsChannelsLoading(true);

    const fetchChannels = async () => {
      try {
        const response = await listChannels(effectiveActiveWorkspaceId);
        setChannelListsFromResponse(response);
      } catch (err) {
        console.error('Failed to fetch channels:', err);
      } finally {
        setIsChannelsLoading(false);
      }
    };

    fetchChannels();
  }, [effectiveActiveWorkspaceId, isWorkspaceFeaturesEnabled, defaultChannels, setChannelListsFromResponse]);

  // Load messages when a channel is selected
  useEffect(() => {
    if (!selectedChannelId || viewMode !== 'channels') return;
    if (selectedChannelId === ACTIVITY_FEED_ID) return;
    if (isWorkspaceFeaturesEnabled && !effectiveActiveWorkspaceId) return;

    const existing = channelMessageMap[selectedChannelId] ?? [];
    if (existing.length > 0) {
      setChannelMessages(existing);
      setHasMoreMessages(false);
    } else if (!fetchedChannelsRef.current.has(selectedChannelId)) {
      const channelToFetch = selectedChannelId;
      fetchedChannelsRef.current.add(channelToFetch);
      (async () => {
        try {
          const response = await getMessages(effectiveActiveWorkspaceId || 'local', channelToFetch, { limit: 200 });
          setChannelMessageMap(prev => ({ ...prev, [channelToFetch]: response.messages }));
          setChannelMessages(response.messages);
          setHasMoreMessages(response.hasMore);
        } catch (err) {
          console.error('Failed to fetch channel messages:', err);
          fetchedChannelsRef.current.delete(channelToFetch);
          setChannelMessages([]);
          setHasMoreMessages(false);
        }
      })();
    } else {
      setChannelMessages([]);
      setHasMoreMessages(false);
    }

    setChannelUnreadState(undefined);
    setChannelsList(prev =>
      prev.map(c =>
        c.id === selectedChannelId ? { ...c, unreadCount: 0, hasMentions: false } : c
      )
    );
  }, [selectedChannelId, viewMode, effectiveActiveWorkspaceId]);

  // Channel handlers
  const handleSelectChannel = useCallback(async (channel: Channel) => {
    setSelectedChannelId(channel.id);

    try {
      const { joinChannel: joinChannelApi } = await import('../components/channels');
      await joinChannelApi(effectiveActiveWorkspaceId || 'local', channel.id);
    } catch (err) {
      console.error('Failed to join channel:', err);
    }
  }, [effectiveActiveWorkspaceId]);

  const handleCreateChannel = useCallback(() => {
    setIsCreateChannelOpen(true);
  }, []);

  const handleCreateChannelSubmit = useCallback(async (request: CreateChannelRequest) => {
    if (!effectiveActiveWorkspaceId) return;
    setIsCreatingChannel(true);
    try {
      const result = await createChannel(effectiveActiveWorkspaceId, request);
      const response = await listChannels(effectiveActiveWorkspaceId);
      setChannelListsFromResponse(response);
      if (result.channel?.id) {
        setSelectedChannelId(result.channel.id);
      }
      setIsCreateChannelOpen(false);
    } catch (err) {
      console.error('Failed to create channel:', err);
    } finally {
      setIsCreatingChannel(false);
    }
  }, [effectiveActiveWorkspaceId, setChannelListsFromResponse]);

  const handleInviteToChannel = useCallback((channel: Channel) => {
    setInviteChannelTarget(channel);
    setIsInviteChannelOpen(true);
  }, []);

  const handleInviteSubmit = useCallback(async (members: string[]) => {
    if (!inviteChannelTarget) return;
    setIsInvitingToChannel(true);
    try {
      const csrfToken = getCsrfToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const invites = members.map(name => ({ id: name, type: 'agent' as const }));

      const response = await fetch('/api/channels/invite', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          channel: inviteChannelTarget.name,
          invites,
          workspaceId: effectiveActiveWorkspaceId,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to invite members');
      }
      setIsInviteChannelOpen(false);
      setInviteChannelTarget(null);
    } catch (err) {
      console.error('Failed to invite to channel:', err);
    } finally {
      setIsInvitingToChannel(false);
    }
  }, [inviteChannelTarget, effectiveActiveWorkspaceId]);

  const handleJoinChannel = useCallback(async (channelId: string) => {
    if (!effectiveActiveWorkspaceId) return;
    try {
      const { joinChannel } = await import('../components/channels');
      await joinChannel(effectiveActiveWorkspaceId, channelId);
      const response = await listChannels(effectiveActiveWorkspaceId);
      setChannelListsFromResponse(response);
    } catch (err) {
      console.error('Failed to join channel:', err);
    }
  }, [effectiveActiveWorkspaceId, setChannelListsFromResponse]);

  const handleLeaveChannel = useCallback(async (channel: Channel) => {
    if (!effectiveActiveWorkspaceId) return;
    try {
      const { leaveChannel } = await import('../components/channels');
      await leaveChannel(effectiveActiveWorkspaceId, channel.id);
      if (selectedChannelId === channel.id) {
        setSelectedChannelId(undefined);
      }
      const response = await listChannels(effectiveActiveWorkspaceId);
      setChannelListsFromResponse(response);
    } catch (err) {
      console.error('Failed to leave channel:', err);
    }
  }, [effectiveActiveWorkspaceId, selectedChannelId, setChannelListsFromResponse]);

  const handleShowMembers = useCallback(async () => {
    if (!selectedChannel || !effectiveActiveWorkspaceId) return;
    try {
      const members = await getChannelMembers(effectiveActiveWorkspaceId, selectedChannel.id);
      setChannelMembers(members);
      setShowMemberPanel(true);
    } catch (err) {
      console.error('Failed to load channel members:', err);
    }
  }, [selectedChannel, effectiveActiveWorkspaceId]);

  const handleRemoveMember = useCallback(async (memberId: string, memberType: 'user' | 'agent') => {
    if (!selectedChannel || !effectiveActiveWorkspaceId) return;
    try {
      await removeChannelMember(effectiveActiveWorkspaceId, selectedChannel.id, memberId, memberType);
      const members = await getChannelMembers(effectiveActiveWorkspaceId, selectedChannel.id);
      setChannelMembers(members);
    } catch (err) {
      console.error('Failed to remove member:', err);
    }
  }, [selectedChannel, effectiveActiveWorkspaceId]);

  const handleAddMember = useCallback(async (memberId: string, memberType: 'user' | 'agent', _role: 'admin' | 'member' | 'read_only') => {
    if (!selectedChannel || !effectiveActiveWorkspaceId) return;
    try {
      const csrfToken = getCsrfToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch('/api/channels/invite', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          channel: selectedChannel.name,
          invites: [{ id: memberId, type: memberType }],
          workspaceId: effectiveActiveWorkspaceId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to add member');
      }

      const members = await getChannelMembers(effectiveActiveWorkspaceId, selectedChannel.id);
      setChannelMembers(members);
    } catch (err) {
      console.error('Failed to add member:', err);
    }
  }, [selectedChannel, effectiveActiveWorkspaceId]);

  const handleArchiveChannel = useCallback(async (channel: Channel) => {
    if (!effectiveActiveWorkspaceId) return;
    try {
      const { archiveChannel } = await import('../components/channels');
      await archiveChannel(effectiveActiveWorkspaceId, channel.id);
      if (selectedChannelId === channel.id) {
        setSelectedChannelId(undefined);
      }
      const response = await listChannels(effectiveActiveWorkspaceId);
      setChannelListsFromResponse(response);
    } catch (err) {
      console.error('Failed to archive channel:', err);
    }
  }, [effectiveActiveWorkspaceId, selectedChannelId, setChannelListsFromResponse]);

  const handleUnarchiveChannel = useCallback(async (channel: Channel) => {
    if (!effectiveActiveWorkspaceId) return;
    try {
      const { unarchiveChannel } = await import('../components/channels');
      await unarchiveChannel(effectiveActiveWorkspaceId, channel.id);
      const response = await listChannels(effectiveActiveWorkspaceId);
      setChannelListsFromResponse(response);
    } catch (err) {
      console.error('Failed to unarchive channel:', err);
    }
  }, [effectiveActiveWorkspaceId, setChannelListsFromResponse]);

  const handleSendChannelMessage = useCallback(async (content: string, threadId?: string) => {
    if (!selectedChannelId) return;

    const senderName = currentUser?.displayName || 'Dashboard';
    const optimisticMessage: ChannelApiMessage = {
      id: `local-${Date.now()}`,
      channelId: selectedChannelId,
      from: senderName,
      fromEntityType: 'user',
      content,
      timestamp: new Date().toISOString(),
      threadId,
      isRead: true,
    };

    appendChannelMessage(selectedChannelId, optimisticMessage, { incrementUnread: false });

    try {
      await sendChannelApiMessage(
        effectiveActiveWorkspaceId || 'local',
        selectedChannelId,
        { content, threadId }
      );
    } catch (err) {
      console.error('Failed to send channel message:', err);
    }
  }, [effectiveActiveWorkspaceId, selectedChannelId, currentUser?.displayName, appendChannelMessage]);

  const handleLoadMoreMessages = useCallback(async () => {
    return;
  }, []);

  // Mark channel as read (debounced)
  const markReadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleMarkChannelRead = useCallback((channelId: string) => {
    if (!effectiveActiveWorkspaceId) return;

    if (markReadTimeoutRef.current) {
      clearTimeout(markReadTimeoutRef.current);
    }

    markReadTimeoutRef.current = setTimeout(async () => {
      try {
        await markRead(effectiveActiveWorkspaceId, channelId);
        setChannelUnreadState(undefined);
        setChannelsList(prev => prev.map(c =>
          c.id === channelId ? { ...c, unreadCount: 0, hasMentions: false } : c
        ));
      } catch (err) {
        console.error('Failed to mark channel as read:', err);
      }
    }, 500);
  }, [effectiveActiveWorkspaceId]);

  useEffect(() => {
    if (!selectedChannelId || !channelUnreadState || channelUnreadState.count === 0) return;
    if (viewMode !== 'channels') return;
    handleMarkChannelRead(selectedChannelId);
  }, [selectedChannelId, channelUnreadState, viewMode, handleMarkChannelRead]);

  useEffect(() => {
    return () => {
      if (markReadTimeoutRef.current) {
        clearTimeout(markReadTimeoutRef.current);
      }
    };
  }, []);

  // DM handlers
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

  // Reactions
  const handleReaction = useCallback(async (messageId: string, emoji: string, hasReacted: boolean) => {
    const userName = currentUser?.displayName || 'user';
    setReactionOverrides((prev) => {
      const next = new Map(prev);
      const msg = rawDataRef.current?.messages.find((m: Message) => m.id === messageId);
      const prevEntry = prev.get(messageId);
      const current = prevEntry?.reactions || msg?.reactions || [];
      let updated: Reaction[];

      if (hasReacted) {
        updated = current
          .map((r: Reaction) =>
            r.emoji === emoji
              ? { ...r, count: r.count - 1, agents: r.agents.filter((a: string) => a !== userName) }
              : r
          )
          .filter((r: Reaction) => r.count > 0);
      } else {
        const existing = current.find((r: Reaction) => r.emoji === emoji);
        if (existing) {
          updated = current.map((r: Reaction) =>
            r.emoji === emoji
              ? { ...r, count: r.count + 1, agents: [...r.agents, userName] }
              : r
          );
        } else {
          updated = [...current, { emoji, count: 1, agents: [userName] }];
        }
      }

      next.set(messageId, { reactions: updated, timestamp: Date.now() });
      return next;
    });

    // Optimistic update for channel messages (Record<string, string[]> format)
    const updateChannelReactions = (msgs: ChannelApiMessage[]): ChannelApiMessage[] => {
      return msgs.map(m => {
        if (m.id !== messageId) return m;
        const reactions = { ...(m.reactions || {}) };
        const agents = reactions[emoji] ? [...reactions[emoji]] : [];
        if (hasReacted) {
          reactions[emoji] = agents.filter(a => a !== userName);
          if (reactions[emoji].length === 0) delete reactions[emoji];
        } else {
          if (!agents.includes(userName)) agents.push(userName);
          reactions[emoji] = agents;
        }
        return { ...m, reactions };
      });
    };
    setChannelMessages(prev => updateChannelReactions(prev));
    setChannelMessageMap(prev => {
      if (!selectedChannelId || !prev[selectedChannelId]) return prev;
      return { ...prev, [selectedChannelId]: updateChannelReactions(prev[selectedChannelId]) };
    });

    if (hasReacted) {
      api.removeReaction(messageId, emoji).catch(() => undefined);
    } else {
      api.addReaction(messageId, emoji).catch(() => undefined);
    }
  }, [currentUser?.displayName, selectedChannelId]);

  // Browser notifications and sounds
  useEffect(() => {
    const msgs = data?.messages;
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
  }, [data?.messages, settings.notifications, currentChannel, currentUser, setCurrentChannel]);

  // Mobile unread tracking
  useEffect(() => {
    lastSeenMessageCountRef.current = messages.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<MessageContextValue>(() => ({
    messages: mergedMessages, threadMessages, currentChannel, setCurrentChannel,
    currentThread, setCurrentThread, activeThreads, totalUnreadThreadCount,
    sendMessage, isSending, sendError, thread,
    viewMode, setViewMode,
    channelsList, archivedChannelsList, channelMessages,
    selectedChannelId, setSelectedChannelId, selectedChannel,
    hasMoreMessages, channelUnreadState, isChannelsLoading,
    effectiveChannelMessages,
    handleSelectChannel, handleCreateChannel, handleCreateChannelSubmit,
    handleInviteToChannel, handleInviteSubmit,
    handleJoinChannel, handleLeaveChannel,
    handleShowMembers, handleRemoveMember, handleAddMember,
    handleArchiveChannel, handleUnarchiveChannel,
    handleSendChannelMessage, handleLoadMoreMessages, handleMarkChannelRead,
    isCreateChannelOpen, setIsCreateChannelOpen, isCreatingChannel,
    isInviteChannelOpen, setIsInviteChannelOpen,
    inviteChannelTarget, setInviteChannelTarget, isInvitingToChannel,
    showMemberPanel, setShowMemberPanel, channelMembers,
    currentHuman, selectedDmAgents, removedDmAgents,
    dedupedVisibleMessages, dmParticipantAgents,
    dmSelectedAgentsByHuman, handleDmAgentToggle,
    handleDmSend, handleMainComposerSend,
    onlineUsers, typingUsers, sendTyping, isPresenceConnected,
    humanUsers, humanUnreadCounts,
    handleReaction, markDmSeen,
    selectedUserProfile, setSelectedUserProfile,
    pendingMention, setPendingMention,
    hasUnreadMessages, handlePresenceEvent,
    setChannelsList, appendChannelMessage,
  }), [
    mergedMessages, threadMessages, currentChannel, setCurrentChannel,
    currentThread, setCurrentThread, activeThreads, totalUnreadThreadCount,
    sendMessage, isSending, sendError, thread,
    viewMode,
    channelsList, archivedChannelsList, channelMessages,
    selectedChannelId, selectedChannel,
    hasMoreMessages, channelUnreadState, isChannelsLoading,
    effectiveChannelMessages,
    handleSelectChannel, handleCreateChannel, handleCreateChannelSubmit,
    handleInviteToChannel, handleInviteSubmit,
    handleJoinChannel, handleLeaveChannel,
    handleShowMembers, handleRemoveMember, handleAddMember,
    handleArchiveChannel, handleUnarchiveChannel,
    handleSendChannelMessage, handleLoadMoreMessages, handleMarkChannelRead,
    isCreateChannelOpen, isCreatingChannel,
    isInviteChannelOpen,
    inviteChannelTarget, isInvitingToChannel,
    showMemberPanel, channelMembers,
    currentHuman, selectedDmAgents, removedDmAgents,
    dedupedVisibleMessages, dmParticipantAgents,
    dmSelectedAgentsByHuman, handleDmAgentToggle,
    handleDmSend, handleMainComposerSend,
    onlineUsers, typingUsers, sendTyping, isPresenceConnected,
    humanUsers, humanUnreadCounts,
    handleReaction, markDmSeen,
    selectedUserProfile,
    pendingMention,
    hasUnreadMessages, handlePresenceEvent,
    appendChannelMessage,
  ]);

  return (
    <MessageContext.Provider value={value}>
      {children}
    </MessageContext.Provider>
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
