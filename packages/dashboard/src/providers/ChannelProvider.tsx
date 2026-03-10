/**
 * Channel Provider
 *
 * Manages channel CRUD operations, channel list state, channel selection,
 * and channel modal state. Extracted from the monolithic MessageProvider
 * to keep channel management concerns focused in one place.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  useChannels as useRelayChannels,
  useDMs as useRelayDMs,
} from '@relaycast/react';
import { useCloudWorkspace } from './CloudWorkspaceProvider';
import { useRelayConfigStatus } from './RelayConfigProvider';
import { getCsrfToken } from '../lib/api';
import { getRelayDmParticipantName } from '../lib/relaycastMessageAdapters';
import {
  listChannels,
  getChannelMembers,
  removeMember as removeChannelMember,
  createChannel,
  type Channel,
  type ChannelMember,
  type CreateChannelRequest,
} from '../components/channels';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RelaycastChannel = ReturnType<typeof useRelayChannels>['channels'][number];

function mapRelayChannelToDashboard(channel: RelaycastChannel): Channel {
  const channelName = channel.name;
  return {
    id: `#${channelName}`,
    name: channelName,
    description: channel.topic ?? undefined,
    topic: channel.topic ?? undefined,
    visibility: 'public',
    status: channel.isArchived ? 'archived' : 'active',
    createdAt: channel.createdAt ?? new Date().toISOString(),
    createdBy: 'relay',
    memberCount: channel.memberCount ?? 0,
    unreadCount: 0,
    hasMentions: false,
    isDm: false,
  };
}

type RelayDmConversation = ReturnType<typeof useRelayDMs>['conversations'][number];

function mapRelayDmConversationToDashboard(
  conversation: RelayDmConversation,
  currentUserName?: string,
): Channel | null {
  const participantNames: string[] = [];
  for (const p of conversation.participants) {
    const name = getRelayDmParticipantName(p);
    if (name) participantNames.push(name);
  }
  if (participantNames.length < 2) return null;

  const sorted = [...participantNames].sort((a, b) => a.localeCompare(b));
  const channelId = `dm:${sorted.join(':')}`;

  // Display name = other participant(s), excluding the current user
  const currentLower = currentUserName?.toLowerCase();
  const others = participantNames.filter(n => n.toLowerCase() !== currentLower);
  const displayName = others.length > 0 ? others.join(', ') : participantNames.join(', ');

  return {
    id: channelId,
    name: displayName,
    visibility: 'private',
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy: 'relay',
    memberCount: participantNames.length,
    unreadCount: conversation.unreadCount ?? 0,
    hasMentions: false,
    isDm: true,
  };
}

export interface ChannelContextValue {
  // Channel list state
  channelsList: Channel[];
  archivedChannelsList: Channel[];
  isChannelsLoading: boolean;
  selectedChannelId: string | undefined;
  setSelectedChannelId: React.Dispatch<React.SetStateAction<string | undefined>>;
  selectedChannel: Channel | undefined;

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

  // Setters exposed for external updates (e.g. WebSocket events)
  setChannelsList: React.Dispatch<React.SetStateAction<Channel[]>>;

  // Relay mapped channels (needed by MessageProvider for messages)
  relayMappedChannels: Channel[];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ChannelContext = createContext<ChannelContextValue | null>(null);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Special ID for the Activity feed (broadcasts) */
const ACTIVITY_FEED_ID = '__activity__';
const DEFAULT_CHANNEL_IDS = ['#general', '#engineering'];

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ChannelProviderProps {
  children: React.ReactNode;
}

export function ChannelProvider({ children }: ChannelProviderProps) {
  const { effectiveActiveWorkspaceId, isWorkspaceFeaturesEnabled, currentUser } = useCloudWorkspace();
  const { configured: relayConfigured } = useRelayConfigStatus();

  // Relay channel state
  const relayChannelsState = useRelayChannels();
  const relayDMsState = useRelayDMs();
  const relayChannelsLoading = relayChannelsState.loading;
  const relayChannelsRaw = relayChannelsState.channels;

  // Stabilize the mapped channels array — only recompute when the serialized
  // channel list actually changes (avoids infinite re-render loops from new
  // array references returned by the relay hook on every render).
  const relayChannelsKey = useMemo(
    () => JSON.stringify(relayChannelsRaw.map(c => c.name + ':' + (c.topic ?? '') + ':' + (c.isArchived ?? false) + ':' + (c.memberCount ?? 0))),
    [relayChannelsRaw],
  );
  const relayMappedChannels = useMemo(
    () => relayChannelsRaw.map(mapRelayChannelToDashboard),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relayChannelsKey],
  );

  // DM channels synthesized from relay DM conversations
  const relayDmChannelsKey = useMemo(
    () => JSON.stringify(relayDMsState.conversations.map(c => c.id + ':' + (c.unreadCount ?? 0))),
    [relayDMsState.conversations],
  );
  const relayDmChannels = useMemo(() => {
    if (!relayConfigured || relayDMsState.conversations.length === 0) return [];
    return relayDMsState.conversations
      .map(c => mapRelayDmConversationToDashboard(c, currentUser?.displayName))
      .filter((c): c is Channel => c !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayDmChannelsKey, relayConfigured, currentUser?.displayName]);

  // Channel list state
  const [channelsList, setChannelsList] = useState<Channel[]>([]);
  const [archivedChannelsList, setArchivedChannelsList] = useState<Channel[]>([]);
  const [isChannelsLoading, setIsChannelsLoading] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | undefined>(
    isWorkspaceFeaturesEnabled ? ACTIVITY_FEED_ID : '#general'
  );

  // Channel modals
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [isInviteChannelOpen, setIsInviteChannelOpen] = useState(false);
  const [inviteChannelTarget, setInviteChannelTarget] = useState<Channel | null>(null);
  const [isInvitingToChannel, setIsInvitingToChannel] = useState(false);
  const [showMemberPanel, setShowMemberPanel] = useState(false);
  const [channelMembers, setChannelMembers] = useState<ChannelMember[]>([]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Reset channel state when switching workspaces
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setSelectedChannelId(undefined);
  }, [effectiveActiveWorkspaceId]);

  // ---------------------------------------------------------------------------
  // Load channels on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (relayConfigured) {
      const activeChannels = relayMappedChannels.filter((channel) => channel.status !== 'archived');
      const archivedChannels = relayMappedChannels.filter((channel) => channel.status === 'archived');
      setChannelListsFromResponse({ channels: activeChannels, archivedChannels });
      // Merge DM channels into the list (deduplicating by id)
      if (relayDmChannels.length > 0) {
        setChannelsList(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const newDms = relayDmChannels.filter(dm => !existingIds.has(dm.id));
          // Also update unread counts for existing DM channels
          const updatedPrev = prev.map(c => {
            if (!c.isDm) return c;
            const freshDm = relayDmChannels.find(dm => dm.id === c.id);
            return freshDm ? { ...c, unreadCount: freshDm.unreadCount } : c;
          });
          return newDms.length > 0 ? [...updatedPrev, ...newDms] : updatedPrev;
        });
      }
      setIsChannelsLoading(relayChannelsLoading);
      return;
    }

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
  }, [
    relayConfigured,
    relayChannelsLoading,
    relayMappedChannels,
    relayDmChannels,
    effectiveActiveWorkspaceId,
    isWorkspaceFeaturesEnabled,
    defaultChannels,
    setChannelListsFromResponse,
  ]);

  // ---------------------------------------------------------------------------
  // Channel handlers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const value = useMemo<ChannelContextValue>(() => ({
    channelsList,
    archivedChannelsList,
    isChannelsLoading,
    selectedChannelId,
    setSelectedChannelId,
    selectedChannel,
    handleSelectChannel,
    handleCreateChannel,
    handleCreateChannelSubmit,
    handleInviteToChannel,
    handleInviteSubmit,
    handleJoinChannel,
    handleLeaveChannel,
    handleShowMembers,
    handleRemoveMember,
    handleAddMember,
    handleArchiveChannel,
    handleUnarchiveChannel,
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
    setChannelsList,
    relayMappedChannels,
  }), [
    channelsList,
    archivedChannelsList,
    isChannelsLoading,
    selectedChannelId,
    selectedChannel,
    handleSelectChannel,
    handleCreateChannel,
    handleCreateChannelSubmit,
    handleInviteToChannel,
    handleInviteSubmit,
    handleJoinChannel,
    handleLeaveChannel,
    handleShowMembers,
    handleRemoveMember,
    handleAddMember,
    handleArchiveChannel,
    handleUnarchiveChannel,
    isCreateChannelOpen,
    isCreatingChannel,
    isInviteChannelOpen,
    inviteChannelTarget,
    isInvitingToChannel,
    showMemberPanel,
    channelMembers,
    relayMappedChannels,
  ]);

  return (
    <ChannelContext.Provider value={value}>
      {children}
    </ChannelContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChannelContext(): ChannelContextValue {
  const ctx = useContext(ChannelContext);
  if (!ctx) {
    throw new Error('useChannelContext must be used within a ChannelProvider');
  }
  return ctx;
}
