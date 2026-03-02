import express, { type Application } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { StorageAdapter } from '@agent-relay/storage/adapter';
import type { ChannelRecord } from '../lib/channel-state.js';

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  filePath?: string;
  width?: number;
  height?: number;
  data?: string;
}

interface ThreadSummary {
  threadId: string;
  replyCount: number;
  participants: string[];
  lastReplyAt?: number;
}

interface RelayClientLike {
  state: string;
  joinChannel: (channel: string, displayName?: string) => boolean;
  sendChannelMessage: (
    channel: string,
    body: string,
    options?: { thread?: string; data?: Record<string, unknown>; attachments?: unknown[] }
  ) => boolean;
}

interface UserBridgeLike {
  getUserChannels(username: string): string[];
  getRegisteredUsers(): string[];
  isUserRegistered(username: string): boolean;
  joinChannel(username: string, channel: string): Promise<boolean>;
  leaveChannel(username: string, channel: string): Promise<boolean>;
  adminJoinChannel(channel: string, member: string): Promise<boolean>;
  adminRemoveMember(channel: string, member: string): Promise<boolean>;
  sendChannelMessage(
    username: string,
    channel: string,
    body: string,
    options?: { thread?: string; data?: Record<string, unknown>; attachments?: unknown[] }
  ): Promise<boolean>;
  sendDirectMessage(from: string, to: string, body: string, options?: { thread?: string }): Promise<boolean>;
}

interface SpawnReaderLike {
  getActiveWorkers(): Array<{ name: string }>;
}

interface PresenceLike {
  info: {
    avatarUrl?: string;
  };
}

export interface ChannelsIntegratedRouteDeps {
  storage?: StorageAdapter;
  teamDir: string;
  attachmentRegistry: Map<string, Attachment>;
  onlineUsers: Map<string, PresenceLike>;
  userBridge?: UserBridgeLike;
  spawnReader?: SpawnReaderLike;
  resolveWorkspaceId: (req: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  }) => string | undefined;
  loadChannelRecords: (workspaceId?: string) => Promise<Map<string, ChannelRecord>>;
  persistChannelMembershipEvent: (
    channel: string,
    member: string,
    action: 'join' | 'leave' | 'invite',
    options?: { invitedBy?: string; workspaceId?: string }
  ) => Promise<void>;
  getRelayClient: (senderName?: string, entityType?: 'agent' | 'user') => Promise<RelayClientLike>;
  buildThreadSummaryMap: (messages: any[]) => Map<string, ThreadSummary>;
  isInternalAgent: (name: string) => boolean;
  getAllData: () => Promise<unknown>;
}

/**
 * Integrated channel + DM routes (separate from proxy-mode routes/channels.ts).
 */
export function registerChannelsIntegratedRoutes(app: Application, deps: ChannelsIntegratedRouteDeps): void {
  const {
    storage,
    teamDir,
    attachmentRegistry,
    onlineUsers,
    userBridge,
    spawnReader,
    resolveWorkspaceId,
    loadChannelRecords,
    persistChannelMembershipEvent,
    getRelayClient,
    buildThreadSummaryMap,
    isInternalAgent,
    getAllData,
  } = deps;

  app.get('/api/data', (req, res) => {
    getAllData().then((data) => {
      const safeData = data ?? { agents: [], users: [], messages: [], activity: [], sessions: [], summaries: [] };
      res.json(safeData);
    }).catch((err) => {
      console.error('Failed to fetch dashboard data', err);
      res.status(500).json({ error: 'Failed to load data' });
    });
  });

  app.get('/api/channels', async (req, res) => {
    const username = req.query.username as string | undefined;
    const workspaceId = resolveWorkspaceId(req);

    if (!storage) {
      if (!username) {
        return res.status(400).json({ error: 'username query param required' });
      }
      const channels = userBridge?.getUserChannels(username) ?? [];
      return res.json({
        channels: channels.map((id: string) => ({
          id,
          name: id.startsWith('#') ? id.slice(1) : id,
          visibility: 'public',
          status: 'active',
          createdAt: new Date().toISOString(),
          createdBy: username,
          memberCount: 0,
          unreadCount: 0,
          hasMentions: false,
          isDm: id.startsWith('dm:'),
        })),
        archivedChannels: [],
      });
    }

    try {
      const channelMap = await loadChannelRecords(workspaceId);
      type ChannelResponse = {
        id: string;
        name: string;
        description?: string;
        visibility: string;
        status: string;
        createdAt: string;
        createdBy: string;
        lastActivityAt?: string;
        memberCount: number;
        unreadCount: number;
        hasMentions: boolean;
        lastMessage?: { content: string; from: string; timestamp: string };
        isDm: boolean;
        dmParticipants?: string[];
      };
      const activeChannels: ChannelResponse[] = [];
      const archivedChannels: ChannelResponse[] = [];

      for (const record of channelMap.values()) {
        const isMember = !username || record.members.has(username) || record.id === '#general';
        if (!isMember) {
          continue;
        }

        const channel = {
          id: record.id,
          name: record.id.startsWith('#') ? record.id.slice(1) : record.id,
          description: record.description,
          visibility: record.visibility,
          status: record.status,
          createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : new Date(record.lastActivityAt || Date.now()).toISOString(),
          createdBy: record.createdBy || '__system__',
          lastActivityAt: record.lastActivityAt ? new Date(record.lastActivityAt).toISOString() : undefined,
          memberCount: record.members.size,
          unreadCount: 0,
          hasMentions: false,
          lastMessage: record.lastMessage,
          isDm: record.id.startsWith('dm:'),
          dmParticipants: record.dmParticipants,
        };

        if (record.status === 'archived') {
          archivedChannels.push(channel);
        } else {
          activeChannels.push(channel);
        }
      }

      return res.json({
        channels: activeChannels,
        archivedChannels,
      });
    } catch (err) {
      console.error('[channels] Failed to load channels', err);
      return res.status(500).json({ error: 'Failed to load channels' });
    }
  });

  app.get('/api/channels/available-members', async (_req, res) => {
    try {
      const availableAgents: Array<{ id: string; displayName: string; entityType: 'agent'; status: string }> = [];

      if (spawnReader) {
        const activeWorkers = spawnReader.getActiveWorkers();
        for (const worker of activeWorkers) {
          availableAgents.push({
            id: worker.name,
            displayName: worker.name,
            entityType: 'agent',
            status: 'online',
          });
        }
      }

      if (userBridge) {
        const registeredUsers = userBridge.getRegisteredUsers();
        for (const username of registeredUsers) {
          if (!availableAgents.some((a) => a.id === username) && username !== 'Dashboard') {
            availableAgents.push({
              id: username,
              displayName: username,
              entityType: 'agent',
              status: 'online',
            });
          }
        }
      }

      return res.json({
        success: true,
        members: [],
        agents: availableAgents,
      });
    } catch (err) {
      console.error('[channels] Failed to get available members:', err);
      return res.status(500).json({ error: 'Failed to get available members' });
    }
  });

  app.post('/api/channels', express.json(), async (req, res) => {
    const { name, description, isPrivate, invites } = req.body as {
      name: string;
      description?: string;
      isPrivate?: boolean;
      invites?: string;
      username?: string;
    };
    const workspaceId = resolveWorkspaceId(req);
    const username = (req.query.username as string) || req.body.username || 'Dashboard';

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const channelId = name.startsWith('#') ? name : `#${name}`;

    try {
      await userBridge?.joinChannel(username, channelId);
      await persistChannelMembershipEvent(channelId, username, 'join', { workspaceId });

      if (invites) {
        const inviteList = invites.split(',').map((s) => s.trim()).filter(Boolean);
        for (const invitee of inviteList) {
          await userBridge?.joinChannel(invitee, channelId);
          await persistChannelMembershipEvent(channelId, invitee, 'invite', { invitedBy: username, workspaceId });
        }
      }

      if (storage) {
        await storage.saveMessage({
          id: `channel-create-${crypto.randomUUID()}`,
          ts: Date.now(),
          from: '__system__',
          to: channelId,
          topic: undefined,
          kind: 'state',
          body: `Channel created by ${username}`,
          data: {
            _channelCreate: {
              createdBy: username,
              description,
              isPrivate: isPrivate ?? false,
            },
            ...(workspaceId ? { _workspaceId: workspaceId } : {}),
          },
          status: 'read',
          is_urgent: false,
          is_broadcast: true,
        });
      }

      return res.json({
        success: true,
        channel: {
          id: channelId,
          name: name.startsWith('#') ? name.slice(1) : name,
          description,
          visibility: isPrivate ? 'private' : 'public',
          status: 'active',
          createdAt: new Date().toISOString(),
          createdBy: username,
          memberCount: 1,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create channel';
      console.error('[channels] Failed to create channel:', err);
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/channels/invite', express.json(), async (req, res) => {
    const { channel, invites, invitedBy } = req.body as {
      channel: string;
      invites: string | string[] | Array<{ id: string; type?: 'user' | 'agent' }>;
      invitedBy?: string;
    };
    const workspaceId = resolveWorkspaceId(req);

    if (!channel || !invites) {
      return res.status(400).json({ error: 'channel and invites are required' });
    }

    const channelId = channel.startsWith('dm:')
      ? channel
      : (channel.startsWith('#') ? channel : `#${channel}`);

    type InviteItem = { id: string; type: 'user' | 'agent' };
    let inviteList: InviteItem[];

    if (typeof invites === 'string') {
      inviteList = invites.split(',').map((s: string) => s.trim()).filter(Boolean)
        .map((id) => ({ id, type: 'agent' as const }));
    } else if (Array.isArray(invites)) {
      inviteList = invites.map((item) => {
        if (typeof item === 'string') {
          return { id: item, type: 'agent' as const };
        }
        return { id: item.id, type: item.type || 'agent' };
      });
    } else {
      return res.status(400).json({ error: 'invites must be a string or array' });
    }

    try {
      const results: Array<{ id: string; type: string; success: boolean; reason?: string }> = [];
      for (const invitee of inviteList) {
        let success = false;
        let reason: string | undefined;
        if (userBridge?.isUserRegistered(invitee.id)) {
          success = await userBridge.joinChannel(invitee.id, channelId);
          if (!success) {
            reason = 'join_failed';
          }
        } else {
          success = true;
          reason = 'pending';
        }

        await persistChannelMembershipEvent(channelId, invitee.id, 'invite', {
          invitedBy,
          workspaceId,
        });

        results.push({ id: invitee.id, type: invitee.type, success, reason });
      }

      return res.json({ channel: channelId, invited: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to invite members';
      console.error('[channels] Failed to invite to channel:', err);
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/channels/users', (_req, res) => {
    const users = userBridge?.getRegisteredUsers() ?? [];
    res.json({ users });
  });

  app.post('/api/channels/join', express.json(), async (req, res) => {
    const { username, channel } = req.body;
    if (!username || !channel) {
      return res.status(400).json({ error: 'username and channel required' });
    }
    const workspaceId = resolveWorkspaceId(req);
    const channelId = channel.startsWith('dm:')
      ? channel
      : (channel.startsWith('#') ? channel : `#${channel}`);

    let success = false;
    const isLocalUser = userBridge?.isUserRegistered(username);
    if (isLocalUser) {
      success = await userBridge?.joinChannel(username, channelId) ?? false;
    }

    if (!success) {
      try {
        const client = await getRelayClient(username);
        if (client && client.state === 'READY') {
          success = client.joinChannel(channelId, username);
        }
      } catch {
        // Ignore fallback errors.
      }
    }

    if (success) {
      await persistChannelMembershipEvent(channelId, username, 'join', { workspaceId });
    }

    return res.json({ success, channel: channelId });
  });

  app.post('/api/channels/leave', express.json(), async (req, res) => {
    const { username, channel } = req.body;
    if (!username || !channel) {
      return res.status(400).json({ error: 'username and channel required' });
    }
    const workspaceId = resolveWorkspaceId(req);
    try {
      const success = await userBridge?.leaveChannel(username, channel);
      if (success) {
        await persistChannelMembershipEvent(channel, username, 'leave', { workspaceId });
      }
      return res.json({ success, channel });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Leave failed';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/channels/admin-join', express.json(), async (req, res) => {
    const { channel, member } = req.body;
    if (!channel || !member) {
      return res.status(400).json({ error: 'channel and member required' });
    }
    const workspaceId = resolveWorkspaceId(req);
    try {
      const success = await userBridge?.adminJoinChannel(channel, member);
      if (success) {
        await persistChannelMembershipEvent(channel, member, 'join', { workspaceId });
      }

      let warning: string | undefined;
      const connectedAgentsPath = path.join(teamDir, 'connected-agents.json');
      try {
        if (fs.existsSync(connectedAgentsPath)) {
          const data = JSON.parse(fs.readFileSync(connectedAgentsPath, 'utf-8'));
          const connectedAgents: string[] = data.agents || [];
          const connectedUsers: string[] = data.users || [];
          const allConnected = [...connectedAgents, ...connectedUsers];
          const isConnected = allConnected.some(
            (name) => name.toLowerCase() === member.toLowerCase()
          );
          if (!isConnected) {
            warning = `Member "${member}" is not currently connected to the daemon. Messages sent to this channel will not be delivered until the agent connects.`;
          }
        }
      } catch {
        // Ignore parse errors.
      }

      return res.json({ success, channel, member, warning });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Admin join failed';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/channels/admin-remove', express.json(), async (req, res) => {
    const { channel, member } = req.body;
    if (!channel || !member) {
      return res.status(400).json({ error: 'channel and member required' });
    }
    const workspaceId = resolveWorkspaceId(req);
    try {
      const success = await userBridge?.adminRemoveMember(channel, member);
      if (success) {
        await persistChannelMembershipEvent(channel, member, 'leave', { workspaceId });
      }
      return res.json({ success, channel, member });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Admin remove failed';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/channels/:channel/members', async (req, res) => {
    const channelId = req.params.channel.startsWith('#') ? req.params.channel : `#${req.params.channel}`;
    const workspaceId = resolveWorkspaceId(req);

    try {
      const channelMap = await loadChannelRecords(workspaceId);
      const record = channelMap.get(channelId);

      const agentsPath = path.join(teamDir, 'agents.json');
      const onlineAgents: string[] = [];
      const thirtySecondsAgo = Date.now() - 30 * 1000;
      if (fs.existsSync(agentsPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
          for (const agent of (data.agents || [])) {
            if (agent.lastSeen && new Date(agent.lastSeen).getTime() > thirtySecondsAgo) {
              onlineAgents.push(agent.name);
            }
          }
        } catch {
          // Ignore parse errors.
        }
      }

      const connectedUsers = userBridge?.getRegisteredUsers() ?? [];
      const memberSet = new Set<string>();

      if (record?.members) {
        for (const member of record.members) {
          memberSet.add(member);
        }
      }

      if (channelId === '#general') {
        for (const agent of onlineAgents) {
          memberSet.add(agent);
        }
        for (const user of connectedUsers) {
          memberSet.add(user);
        }
      }

      const members = Array.from(memberSet).map((name) => {
        const isOnlineAgent = onlineAgents.includes(name);
        const isOnlineUser = connectedUsers.includes(name);
        return {
          id: name,
          displayName: name,
          entityType: isOnlineUser ? 'user' : 'agent',
          role: 'member',
          status: isOnlineAgent || isOnlineUser ? 'online' : 'offline',
          joinedAt: new Date().toISOString(),
        };
      });

      return res.json({ members });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get channel members';
      console.error('[channels] Failed to get channel members:', err);
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/channels/:channel/messages', async (req, res) => {
    if (!storage) {
      return res.status(503).json({ error: 'Storage not configured' });
    }

    const channelId = req.params.channel;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
    const beforeTs = req.query.before ? parseInt(req.query.before as string, 10) : undefined;
    const workspaceId = resolveWorkspaceId(req);

    try {
      const query: Record<string, unknown> = {
        to: channelId,
        limit,
        order: 'desc',
      };
      if (beforeTs) {
        query.sinceTs = beforeTs;
      }
      let messages = await storage.getMessages(query as any);
      messages = messages.filter((m) => {
        const data = m.data as Record<string, unknown> | undefined;
        if (workspaceId && data?._workspaceId && data._workspaceId !== workspaceId) {
          return false;
        }
        if (isInternalAgent(m.from)) return false;
        return Boolean(data?._isChannelMessage) || (m.to && m.to.startsWith('#'));
      });

      messages.sort((a, b) => a.ts - b.ts);
      const threadSummaries = buildThreadSummaryMap(messages);

      return res.json({
        messages: messages.map((m) => {
          const senderPresence = onlineUsers.get(m.from);
          const fromAvatarUrl = senderPresence?.info.avatarUrl;
          const fromEntityType: 'user' | 'agent' = senderPresence ? 'user' : 'agent';
          const summaryFromReplies = threadSummaries.get(m.id);
          const threadSummary = summaryFromReplies ?? (m.replyCount && m.replyCount > 0
            ? {
              threadId: m.id,
              replyCount: m.replyCount,
              participants: [],
              lastReplyAt: m.ts,
            }
            : undefined);
          return {
            id: m.id,
            channelId,
            from: m.from,
            fromEntityType,
            fromAvatarUrl,
            content: m.body,
            timestamp: new Date(m.ts).toISOString(),
            threadId: m.thread || undefined,
            threadSummary,
            isRead: true,
          };
        }),
        hasMore: messages.length === limit,
      });
    } catch (err) {
      console.error('[channels] Failed to fetch channel messages', err);
      return res.status(500).json({ error: 'Failed to fetch channel messages' });
    }
  });

  app.post('/api/channels/subscribe', express.json(), async (req, res) => {
    const { username, channels } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'username required' });
    }

    try {
      const joinedChannels: string[] = [];
      const channelList = channels || ['#general'];

      let regAttempts = 0;
      const maxRegAttempts = 20;
      while (!userBridge?.isUserRegistered(username) && regAttempts < maxRegAttempts) {
        await new Promise((r) => setTimeout(r, 100));
        regAttempts++;
      }

      if (userBridge?.isUserRegistered(username)) {
        for (const channel of channelList) {
          const channelId = channel.startsWith('dm:')
            ? channel
            : (channel.startsWith('#') ? channel : `#${channel}`);
          const joined = await userBridge.joinChannel(username, channelId);
          if (joined) {
            joinedChannels.push(channelId);
          }
        }
        return res.json({ success: true, channels: joinedChannels });
      }

      const client = await getRelayClient(username);
      if (!client) {
        return res.status(503).json({ error: 'Could not acquire relay adapter client' });
      }

      let attempts = 0;
      while (client.state !== 'READY' && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }

      if (client.state !== 'READY') {
        return res.status(503).json({ error: 'Relay client not ready' });
      }

      for (const channel of channelList) {
        const channelId = channel.startsWith('dm:')
          ? channel
          : (channel.startsWith('#') ? channel : `#${channel}`);
        const joined = client.joinChannel(channelId, username);
        if (joined) {
          joinedChannels.push(channelId);
        }
      }

      return res.json({ success: true, channels: joinedChannels });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Subscribe failed';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/channels/message', express.json(), async (req, res) => {
    const { username, channel, body, thread, attachmentIds } = req.body;

    if (!username || !channel || !body) {
      return res.status(400).json({ error: 'username, channel, and body required' });
    }

    let attachments: Attachment[] | undefined;
    if (attachmentIds && Array.isArray(attachmentIds) && attachmentIds.length > 0) {
      attachments = [];
      for (const id of attachmentIds) {
        const attachment = attachmentRegistry.get(id);
        if (attachment) {
          attachments.push(attachment);
        }
      }
    }

    const workspaceId = resolveWorkspaceId(req);
    const channelId = channel.startsWith('dm:')
      ? channel
      : (channel.startsWith('#') ? channel : `#${channel}`);

    let success = false;

    const isLocalUser = userBridge?.isUserRegistered(username);
    if (isLocalUser) {
      success = await userBridge?.sendChannelMessage(username, channelId, body, {
        thread,
        data: workspaceId ? { _workspaceId: workspaceId } : undefined,
        attachments,
      }) ?? false;
    }

    if (!success) {
      try {
        const client = await getRelayClient(username);
        if (client && client.state === 'READY') {
          client.joinChannel(channelId, username);
          success = client.sendChannelMessage(channelId, body, {
            thread,
            data: workspaceId ? { _workspaceId: workspaceId } : undefined,
            attachments,
          });
        }
      } catch {
        // Ignore fallback errors.
      }
    }

    return res.json({ success });
  });

  app.post('/api/channels/archive', express.json(), async (req, res) => {
    if (!storage) {
      return res.status(503).json({ error: 'Storage not configured' });
    }
    const { channel } = req.body;
    if (!channel) {
      return res.status(400).json({ error: 'channel required' });
    }
    const workspaceId = resolveWorkspaceId(req);
    try {
      await storage.saveMessage({
        id: `state-${Date.now()}`,
        ts: Date.now(),
        from: '__system__',
        to: channel,
        topic: undefined,
        kind: 'message',
        body: 'STATE:archived',
        data: {
          _channelState: 'archived',
          ...(workspaceId ? { _workspaceId: workspaceId } : {}),
        },
        status: 'read',
        is_urgent: false,
        is_broadcast: true,
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('[channels] Failed to archive channel', err);
      return res.status(500).json({ error: 'Failed to archive channel' });
    }
  });

  app.post('/api/channels/unarchive', express.json(), async (req, res) => {
    if (!storage) {
      return res.status(503).json({ error: 'Storage not configured' });
    }
    const { channel } = req.body;
    if (!channel) {
      return res.status(400).json({ error: 'channel required' });
    }
    const workspaceId = resolveWorkspaceId(req);
    try {
      await storage.saveMessage({
        id: `state-${Date.now()}`,
        ts: Date.now(),
        from: '__system__',
        to: channel,
        topic: undefined,
        kind: 'message',
        body: 'STATE:active',
        data: {
          _channelState: 'active',
          ...(workspaceId ? { _workspaceId: workspaceId } : {}),
        },
        status: 'read',
        is_urgent: false,
        is_broadcast: true,
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('[channels] Failed to unarchive channel', err);
      return res.status(500).json({ error: 'Failed to unarchive channel' });
    }
  });

  app.post('/api/dm', express.json(), async (req, res) => {
    const { from, to, body, thread } = req.body;
    if (!from || !to || !body) {
      return res.status(400).json({ error: 'from, to, and body required' });
    }
    try {
      const success = await userBridge?.sendDirectMessage(from, to, body, { thread });
      return res.json({ success });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'DM failed';
      return res.status(500).json({ error: message });
    }
  });
}
