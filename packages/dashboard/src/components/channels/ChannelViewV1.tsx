/**
 * ChannelViewV1 Component
 *
 * Composed channel view that combines:
 * - ChannelHeader
 * - ChannelMessageList
 * - MessageComposer
 *
 * This is the main view component for displaying a channel's content.
 */

import React, { useCallback, useMemo } from 'react';
import { ChannelHeader } from './ChannelHeader';
import { ChannelMessageList } from './ChannelMessageList';
import { MessageComposer } from '../MessageComposer';
import type { Agent } from '../../types';
import type { HumanUser } from '../MentionAutocomplete';
import type { UserPresence } from '../hooks/usePresence';
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  UnreadState,
} from './types';

export interface ChannelViewV1Props {
  /** Current channel to display */
  channel: Channel;
  /** Channel members */
  members?: ChannelMember[];
  /** Messages in the channel */
  messages: ChannelMessage[];
  /** Unread state for the channel */
  unreadState?: UnreadState;
  /** Current user's name */
  currentUser: string;
  /** Whether user can edit the channel */
  canEditChannel?: boolean;
  /** Whether loading more messages */
  isLoadingMore?: boolean;
  /** Whether there are more messages to load */
  hasMoreMessages?: boolean;
  /** Agents available for @-mentions */
  agents?: Agent[];
  /** Human users available for @-mentions */
  humanUsers?: HumanUser[];
  /** Current user profile for avatar fallback */
  currentUserInfo?: {
    displayName: string;
    avatarUrl?: string;
  };
  /** Online users for avatar fallback */
  onlineUsers?: UserPresence[];
  /** Callback to load more messages */
  onLoadMore?: () => void;
  /** Callback to send a message */
  onSendMessage: (content: string, attachmentIds?: string[]) => Promise<boolean>;
  /** Callback when editing channel settings */
  onEditChannel?: () => void;
  /** Callback to show member list */
  onShowMembers?: () => void;
  /** Callback to show pinned messages */
  onShowPinned?: () => void;
  /** Callback to search in channel */
  onSearch?: () => void;
  /** Callback when clicking thread button */
  onThreadClick?: (messageId: string) => void;
  /** Callback when typing status changes */
  onTyping?: (isTyping: boolean) => void;
  /** Callback to mark messages as read */
  onMarkRead?: (upToTimestamp: string) => void;
  /** Callback when clicking on a member name (for DM navigation) */
  onMemberClick?: (memberId: string, entityType: 'user' | 'agent') => void;
  /** Callback when toggling a reaction on a message */
  onReaction?: (messageId: string, emoji: string, hasReacted: boolean) => void;
}

export function ChannelViewV1({
  channel,
  members = [],
  messages,
  unreadState,
  currentUser,
  canEditChannel = false,
  isLoadingMore = false,
  hasMoreMessages = false,
  agents = [],
  humanUsers = [],
  currentUserInfo,
  onlineUsers = [],
  onLoadMore,
  onSendMessage,
  onEditChannel,
  onShowMembers,
  onShowPinned,
  onSearch,
  onThreadClick,
  onTyping,
  onMarkRead,
  onMemberClick,
  onReaction,
}: ChannelViewV1Props) {
  // Handle send
  const handleSend = useCallback((content: string, attachmentIds?: string[]) => {
    return onSendMessage(content, attachmentIds);
  }, [onSendMessage]);

  // Get placeholder text based on channel type
  const inputPlaceholder = useMemo(() => {
    if (channel.isDm) {
      return `Message ${channel.name}`;
    }
    return `Message #${channel.name}`;
  }, [channel]);

  // Check if channel is archived (disable input)
  const isArchived = channel.status === 'archived';

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <ChannelHeader
        channel={channel}
        members={members}
        canEdit={canEditChannel}
        onEditChannel={onEditChannel}
        onShowMembers={onShowMembers}
        onShowPinned={onShowPinned}
        onSearch={onSearch}
      />

      {/* Message List */}
      <ChannelMessageList
        messages={messages}
        unreadState={unreadState}
        currentUser={currentUser}
        currentUserInfo={currentUserInfo}
        onlineUsers={onlineUsers}
        agents={agents}
        humanUsers={humanUsers}
        isLoadingMore={isLoadingMore}
        hasMore={hasMoreMessages}
        onLoadMore={onLoadMore}
        onThreadClick={onThreadClick}
        onMemberClick={onMemberClick}
        onReaction={onReaction}
      />

      {/* Message Input */}
      {isArchived ? (
        <div className="px-4 py-3 bg-bg-secondary border-t border-border-subtle text-center">
          <p className="text-sm text-text-muted">
            This channel is archived. Unarchive it to send messages.
          </p>
        </div>
      ) : (
        <MessageComposer
          placeholder={inputPlaceholder}
          onSend={handleSend}
          onTyping={onTyping}
          agents={agents}
          humanUsers={humanUsers}
          enableFileAutocomplete
        />
      )}
    </div>
  );
}

export default ChannelViewV1;
