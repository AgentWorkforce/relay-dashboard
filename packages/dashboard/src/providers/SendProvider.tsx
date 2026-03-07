/**
 * Send Provider
 *
 * Manages send operations for channel messages, DM messages, reactions,
 * and optimistic message creation. Extracted from the monolithic MessageProvider
 * to isolate send concerns.
 */

import React, { createContext, useContext, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  useMessages as useRelayMessages,
  useSendMessage as useRelaySendMessage,
  useReaction as useRelayReaction,
  useAgent as useRelayAgent,
  sortMessagesChronologically,
} from '@relaycast/react';
import { useCloudWorkspace } from './CloudWorkspaceProvider';
import { useRelayConfigStatus } from './RelayConfigProvider';
import { useChannelContext } from './ChannelProvider';
import { api } from '../lib/api';
import {
  sendMessage as sendChannelApiMessage,
  markRead,
  type Channel,
  type ChannelMessage as ChannelApiMessage,
  type UnreadState,
} from '../components/channels';
import {
  mapRelayMessageToChannelApiMessage,
} from '../lib/relaycastMessageAdapters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toChannelMessageTimestampMs(message: ChannelApiMessage): number {
  const parsed = Date.parse(message.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortChannelMessagesChronologically(messages: ChannelApiMessage[]): ChannelApiMessage[] {
  return [...messages].sort((a, b) => {
    const tsDiff = toChannelMessageTimestampMs(a) - toChannelMessageTimestampMs(b);
    if (tsDiff !== 0) return tsDiff;
    return a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendContextValue {
  // Channel message sending
  handleSendChannelMessage: (content: string, threadId?: string, attachmentIds?: string[]) => Promise<boolean>;
  handleLoadMoreMessages: () => Promise<void>;
  handleMarkChannelRead: (channelId: string) => void;

  // Reactions
  handleReaction: (messageId: string, emoji: string, hasReacted: boolean) => Promise<void>;

  // Channel message state (managed here because of optimistic updates)
  channelMessages: ChannelApiMessage[];
  hasMoreMessages: boolean;
  channelUnreadState: UnreadState | undefined;
  effectiveChannelMessages: ChannelApiMessage[];

  // Append channel message (for external WebSocket event updates)
  appendChannelMessage: (channelId: string, message: ChannelApiMessage, options?: { incrementUnread?: boolean }) => void;

  // Relay mapped channel messages (needed for thread reply eligibility checks)
  relayMappedChannelMessages: ChannelApiMessage[];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SendContext = createContext<SendContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface SendProviderProps {
  children: React.ReactNode;
  /** Messages from the local relay (non-channel) for fallback rendering */
  localMessages: import('../types').Message[];
  /** The local username (for sender name in optimistic messages) */
  localUsername: string | null;
}

export function SendProvider({ children, localMessages, localUsername }: SendProviderProps) {
  const { currentUser, effectiveActiveWorkspaceId, isWorkspaceFeaturesEnabled } = useCloudWorkspace();
  const { configured: relayConfigured, agentName: relayAgentName } = useRelayConfigStatus();
  const {
    channelsList,
    setChannelsList,
    selectedChannelId,
  } = useChannelContext();

  // ---------------------------------------------------------------------------
  // Channel message state (owned here for optimistic updates)
  // ---------------------------------------------------------------------------

  const [channelMessages, setChannelMessages] = React.useState<ChannelApiMessage[]>([]);
  const [channelMessageMap, setChannelMessageMap] = React.useState<Record<string, ChannelApiMessage[]>>({});
  const fetchedChannelsRef = useRef<Set<string>>(new Set());
  const [hasMoreMessages, setHasMoreMessages] = React.useState(false);
  const [channelUnreadState, setChannelUnreadState] = React.useState<UnreadState | undefined>();
  const relayRealtimeEnabledRef = useRef(false);

  // Relay hooks
  const relaySelectedChannelName = selectedChannelId?.startsWith('#') ? selectedChannelId.slice(1) : 'general';
  const relayMessagesState = useRelayMessages(relaySelectedChannelName);
  const relaySendMessageState = useRelaySendMessage();
  const relayReactionState = useRelayReaction();
  const relayAgent = useRelayAgent();

  const relayMappedChannelMessages = useMemo(() => {
    if (!relayConfigured || !selectedChannelId?.startsWith('#')) return [];
    return sortMessagesChronologically(relayMessagesState.messages).map((message) =>
      mapRelayMessageToChannelApiMessage(
        selectedChannelId,
        message,
        currentUser?.displayName,
      ),
    );
  }, [selectedChannelId, relayMessagesState.messages, currentUser?.displayName, relayConfigured]);

  const usingRelayChannelMessages = Boolean(relayConfigured && selectedChannelId?.startsWith('#'));

  // Local channel messages (relay messages -> channel format)
  const localChannelMessages = useMemo((): ChannelApiMessage[] => {
    if (effectiveActiveWorkspaceId || !selectedChannelId) return [];
    const ACTIVITY_FEED_ID = '__activity__';

    const filtered = localMessages.filter(m => {
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
      fromEntityType: (m.from === 'Dashboard' || m.from === relayAgentName || m.from === currentUser?.displayName) ? 'user' : 'agent' as const,
      content: m.content,
      timestamp: m.timestamp,
      isRead: m.isRead ?? true,
      threadId: m.thread !== selectedChannelId ? m.thread : undefined,
    }));
  }, [localMessages, selectedChannelId, effectiveActiveWorkspaceId, currentUser?.displayName, relayAgentName]);

  const effectiveChannelMessages = useMemo(() => {
    if (usingRelayChannelMessages) {
      // Prefer relay SDK messages; fall back to server-fetched messages when
      // the relay hook returns empty (e.g. agent hasn't joined the channel yet).
      if (relayMappedChannelMessages.length > 0) {
        return sortChannelMessagesChronologically(relayMappedChannelMessages);
      }
      if (channelMessages.length > 0) {
        return sortChannelMessagesChronologically(channelMessages);
      }
      return [];
    }
    const sourceMessages = channelMessages.length > 0 ? channelMessages : localChannelMessages;
    return sortChannelMessagesChronologically(sourceMessages);
  }, [usingRelayChannelMessages, relayMappedChannelMessages, channelMessages, localChannelMessages]);

  useEffect(() => {
    relayRealtimeEnabledRef.current = relayConfigured;
  }, [relayConfigured]);

  // ---------------------------------------------------------------------------
  // Duplicate detection
  // ---------------------------------------------------------------------------

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
          createdBy: currentUser?.displayName || relayAgentName || 'Dashboard',
          memberCount: 1,
          unreadCount: 1,
          hasMentions: false,
          isDm: channelId.startsWith('dm:'),
        };

        return [...prev, newChannel];
      });
    }
  }, [currentUser?.displayName, selectedChannelId, isDuplicateMessage, setChannelsList, relayAgentName]);

  // ---------------------------------------------------------------------------
  // Reset channel message state when switching workspaces
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setChannelMessageMap({});
    setChannelMessages([]);
    fetchedChannelsRef.current.clear();
  }, [effectiveActiveWorkspaceId]);

  // ---------------------------------------------------------------------------
  // Load messages when a channel is selected
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedChannelId) return;
    const ACTIVITY_FEED_ID = '__activity__';
    if (selectedChannelId === ACTIVITY_FEED_ID) return;
    if (isWorkspaceFeaturesEnabled && !effectiveActiveWorkspaceId) return;

    if (relayConfigured && selectedChannelId.startsWith('#')) {
      // When the relay SDK has messages, use them directly.
      // Otherwise, keep any server-fetched messages we already have — do NOT
      // overwrite them with the empty relay array on every re-render.
      if (relayMappedChannelMessages.length > 0) {
        setChannelMessages(relayMappedChannelMessages);
      }
      setHasMoreMessages(false);
      setChannelUnreadState(undefined);
      setChannelsList(prev =>
        prev.map(c =>
          c.id === selectedChannelId ? { ...c, unreadCount: 0, hasMentions: false } : c
        )
      );

      // Fallback: when the relay SDK hook returns empty (e.g. dashboard agent
      // hasn't joined the channel), fetch from the server API which uses the
      // workspace API key and has full read access to all channels.
      if (relayMappedChannelMessages.length === 0 && !relayMessagesState.loading && !fetchedChannelsRef.current.has(selectedChannelId)) {
        const channelToFetch = selectedChannelId;
        fetchedChannelsRef.current.add(channelToFetch);
        (async () => {
          try {
            const { getMessages } = await import('../components/channels');
            const response = await getMessages(effectiveActiveWorkspaceId || 'local', channelToFetch, { limit: 200 });
            const sortedMessages = sortChannelMessagesChronologically(response.messages);
            setChannelMessageMap(prev => ({ ...prev, [channelToFetch]: sortedMessages }));
            setChannelMessages(sortedMessages);
          } catch (err) {
            console.error('Failed to fetch channel messages fallback:', err);
            fetchedChannelsRef.current.delete(channelToFetch);
          }
        })();
      }
      return;
    }

    const existing = sortChannelMessagesChronologically(channelMessageMap[selectedChannelId] ?? []);
    if (existing.length > 0) {
      setChannelMessages(existing);
      setHasMoreMessages(false);
    } else if (!fetchedChannelsRef.current.has(selectedChannelId)) {
      const channelToFetch = selectedChannelId;
      fetchedChannelsRef.current.add(channelToFetch);
      (async () => {
        try {
          const { getMessages } = await import('../components/channels');
          const response = await getMessages(effectiveActiveWorkspaceId || 'local', channelToFetch, { limit: 200 });
          const sortedMessages = sortChannelMessagesChronologically(response.messages);
          setChannelMessageMap(prev => ({ ...prev, [channelToFetch]: sortedMessages }));
          setChannelMessages(sortedMessages);
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
  }, [
    selectedChannelId,
    effectiveActiveWorkspaceId,
    relayConfigured,
    relayMessagesState,
    relayMappedChannelMessages,
    channelMessageMap,
    isWorkspaceFeaturesEnabled,
    setChannelsList,
  ]);

  // ---------------------------------------------------------------------------
  // Send channel message
  // ---------------------------------------------------------------------------

  const handleSendChannelMessage = useCallback(async (content: string, threadId?: string, attachmentIds?: string[]) => {
    if (!selectedChannelId) return false;

    const senderName = currentUser?.displayName || localUsername || relayAgentName
      || (typeof window !== 'undefined' ? localStorage.getItem('relay_username') : null)
      || 'You';
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
      const relayEligible = relayConfigured && selectedChannelId.startsWith('#');
      const hasAttachments = Boolean(attachmentIds && attachmentIds.length > 0);
      const relayThreadReplyEligible = threadId
        ? relayMappedChannelMessages.some((message) => message.id === threadId)
        : false;

      if (relayEligible && !hasAttachments) {
        if (threadId && relayThreadReplyEligible) {
          await relayAgent.reply(threadId, content);
        } else if (!threadId) {
          await relaySendMessageState.send(selectedChannelId.slice(1), content);
        } else {
          await sendChannelApiMessage(
            effectiveActiveWorkspaceId || 'local',
            selectedChannelId,
            { content, threadId, attachmentIds }
          );
        }
      } else {
        await sendChannelApiMessage(
          effectiveActiveWorkspaceId || 'local',
          selectedChannelId,
          { content, threadId, attachmentIds }
        );
      }
      return true;
    } catch (err) {
      console.error('Failed to send channel message:', err);
      return false;
    }
  }, [
    effectiveActiveWorkspaceId,
    selectedChannelId,
    currentUser?.displayName,
    appendChannelMessage,
    relayConfigured,
    relayMappedChannelMessages,
    relayAgent,
    relaySendMessageState.send,
    localUsername,
    relayAgentName,
  ]);

  // ---------------------------------------------------------------------------
  // Load more messages
  // ---------------------------------------------------------------------------

  const handleLoadMoreMessages = useCallback(async () => {
    if (relayConfigured && selectedChannelId?.startsWith('#')) {
      await relayMessagesState.fetchMore();
      return;
    }
    return;
  }, [relayConfigured, relayMessagesState.fetchMore, selectedChannelId]);

  // ---------------------------------------------------------------------------
  // Mark channel as read (debounced)
  // ---------------------------------------------------------------------------

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
  }, [effectiveActiveWorkspaceId, setChannelsList]);

  useEffect(() => {
    if (!selectedChannelId || !channelUnreadState || channelUnreadState.count === 0) return;
    handleMarkChannelRead(selectedChannelId);
  }, [selectedChannelId, channelUnreadState, handleMarkChannelRead]);

  useEffect(() => {
    return () => {
      if (markReadTimeoutRef.current) {
        clearTimeout(markReadTimeoutRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Reactions
  // ---------------------------------------------------------------------------

  const handleReaction = useCallback(async (messageId: string, emoji: string, hasReacted: boolean) => {
    try {
      if (relayConfigured) {
        if (hasReacted) {
          await relayReactionState.unreact(messageId, emoji);
        } else {
          await relayReactionState.react(messageId, emoji);
        }
        return;
      }

      if (hasReacted) {
        await api.removeReaction(messageId, emoji);
      } else {
        await api.addReaction(messageId, emoji);
      }
    } catch (err) {
      console.error('Failed to update reaction:', err);
    }
  }, [relayConfigured, relayReactionState]);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const value = useMemo<SendContextValue>(() => ({
    handleSendChannelMessage,
    handleLoadMoreMessages,
    handleMarkChannelRead,
    handleReaction,
    channelMessages,
    hasMoreMessages,
    channelUnreadState,
    effectiveChannelMessages,
    appendChannelMessage,
    relayMappedChannelMessages,
  }), [
    handleSendChannelMessage,
    handleLoadMoreMessages,
    handleMarkChannelRead,
    handleReaction,
    channelMessages,
    hasMoreMessages,
    channelUnreadState,
    effectiveChannelMessages,
    appendChannelMessage,
    relayMappedChannelMessages,
  ]);

  return (
    <SendContext.Provider value={value}>
      {children}
    </SendContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSendContext(): SendContextValue {
  const ctx = useContext(SendContext);
  if (!ctx) {
    throw new Error('useSendContext must be used within a SendProvider');
  }
  return ctx;
}
