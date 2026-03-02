import crypto from 'crypto';
import type { StorageAdapter } from '@agent-relay/storage/adapter';

export interface ChannelRecord {
  id: string;
  visibility: 'public' | 'private';
  status: 'active' | 'archived';
  createdAt?: number;
  createdBy?: string;
  description?: string;
  lastActivityAt: number;
  lastMessage?: { content: string; from: string; timestamp: string };
  members: Set<string>;
  dmParticipants?: string[];
}

interface ChannelPersistenceOptions {
  storage?: StorageAdapter;
  defaultWorkspaceId?: string;
}

interface PersistMembershipOptions {
  invitedBy?: string;
  workspaceId?: string;
}

export function createChannelPersistence(options: ChannelPersistenceOptions) {
  const { storage, defaultWorkspaceId } = options;

  const loadChannelRecords = async (workspaceId?: string): Promise<Map<string, ChannelRecord>> => {
    const map = new Map<string, ChannelRecord>();
    if (!storage) {
      return map;
    }

    const stored = await storage.getMessages({ order: 'asc' });

    const ensureRecord = (id: string): ChannelRecord => {
      let record = map.get(id);
      if (!record) {
        record = {
          id,
          visibility: 'public',
          status: 'active',
          lastActivityAt: 0,
          members: new Set(),
        };
        if (id.startsWith('dm:')) {
          const participants = id.split(':').slice(1).filter(Boolean);
          if (participants.length > 0) {
            participants.forEach((participant) => record!.members.add(participant));
            record.dmParticipants = participants;
          }
        }
        map.set(id, record);
      }
      return record;
    };

    const addMember = (record: ChannelRecord, member: string) => {
      if (!member) return;
      record.members.add(member);
    };

    for (const msg of stored) {
      const target = msg.to;
      if (!target || (!target.startsWith('#') && !target.startsWith('dm:'))) {
        continue;
      }

      const data = msg.data as Record<string, unknown> | undefined;
      const messageWorkspaceId = typeof data?._workspaceId === 'string' ? data._workspaceId : undefined;
      if (workspaceId && messageWorkspaceId && messageWorkspaceId !== workspaceId) {
        continue;
      }

      const record = ensureRecord(target);
      const timestamp = typeof msg.ts === 'number' ? msg.ts : Date.now();

      const channelCreate = data?._channelCreate as { createdBy?: string; description?: string; isPrivate?: boolean } | undefined;
      if (channelCreate) {
        record.createdAt = record.createdAt ?? timestamp;
        record.createdBy = channelCreate.createdBy ?? record.createdBy;
        if (channelCreate.description) {
          record.description = String(channelCreate.description);
        }
        record.visibility = channelCreate.isPrivate ? 'private' : 'public';
      }

      const stateChange = data?._channelState as string | undefined;
      if (stateChange) {
        record.status = stateChange === 'archived' ? 'archived' : 'active';
        record.lastActivityAt = Math.max(record.lastActivityAt, timestamp);
      }

      const membership = data?._channelMembership as { member?: string; action?: string } | undefined;
      if (membership?.member) {
        if (membership.action === 'leave') {
          record.members.delete(membership.member);
        } else {
          addMember(record, membership.member);
        }
        record.lastActivityAt = Math.max(record.lastActivityAt, timestamp);
      }

      const isChannelMessage = Boolean(data?._isChannelMessage);
      if (isChannelMessage) {
        addMember(record, msg.from);
        record.lastActivityAt = Math.max(record.lastActivityAt, timestamp);
        record.lastMessage = {
          content: msg.body,
          from: msg.from || '__system__',
          timestamp: new Date(timestamp).toISOString(),
        };

        if (target.startsWith('dm:') && !record.dmParticipants) {
          const participants = target.split(':').slice(1).filter(Boolean);
          if (participants.length > 0) {
            participants.forEach((participant) => record.members.add(participant));
            record.dmParticipants = participants;
          }
        }
      }
    }

    return map;
  };

  const loadPersistedChannelsForUser = async (username: string, workspaceId?: string): Promise<string[]> => {
    const channelMap = await loadChannelRecords(workspaceId);
    const result: string[] = [];

    for (const record of channelMap.values()) {
      if (record.status === 'archived') {
        continue;
      }
      if (record.members.has(username)) {
        result.push(record.id);
      }
    }

    if (!result.includes('#general')) {
      result.unshift('#general');
    }

    return result;
  };

  const persistChannelMembershipEvent = async (
    channel: string,
    member: string,
    action: 'join' | 'leave' | 'invite',
    eventOptions?: PersistMembershipOptions,
  ) => {
    if (!storage) return;

    const data: Record<string, unknown> = {
      _channelMembership: {
        member,
        action,
        invitedBy: eventOptions?.invitedBy,
      },
    };

    const workspaceToStore = eventOptions?.workspaceId ?? defaultWorkspaceId;
    if (workspaceToStore) {
      data._workspaceId = workspaceToStore;
    }

    await storage
      .saveMessage({
        id: `channel-membership-${crypto.randomUUID()}`,
        ts: Date.now(),
        from: '__system__',
        to: channel,
        topic: undefined,
        kind: 'state',
        body: `${action}:${member}`,
        data,
        status: 'read',
        is_urgent: false,
        is_broadcast: true,
      })
      .catch((err) => {
        console.error('[channels] Failed to persist membership event', err);
      });
  };

  return {
    loadChannelRecords,
    loadPersistedChannelsForUser,
    persistChannelMembershipEvent,
  };
}
