/**
 * Channel route handlers: list, create, join, leave, messages, archive, etc.
 */

import path from 'path';
import type { Express, Request, Response } from 'express';
import {
  fetchChannelMembers,
  fetchChannelMessages,
  inviteToChannel,
  joinChannel,
  leaveChannel,
  setChannelArchived,
  createChannel,
} from '../relaycast-provider.js';
import type { RouteContext } from '../lib/types.js';
import {
  normalizeChannelTarget,
  normalizeChannelName,
  parseInviteMembers,
} from '../lib/utils.js';

export function registerChannelRoutes(app: Express, ctx: RouteContext): void {
  app.get('/api/channels', async (_req: Request, res: Response) => {
    try {
      const channels = await ctx.getRelaycastChannels();
      res.json({
        success: true,
        ...channels,
      });
    } catch (err) {
      console.error('[dashboard] Failed to fetch Relaycast channels:', err);
      res.status(500).json({ error: 'Failed to load channels' });
    }
  });

  app.get('/api/channels/available-members', async (_req: Request, res: Response) => {
    try {
      const snapshot = await ctx.getRelaycastSnapshot();
      const agents = snapshot.agents.map((agent) => ({
        id: agent.name,
        displayName: agent.name,
        entityType: 'agent' as const,
        status: (agent.status ?? 'online').toLowerCase() === 'online' ? 'online' : 'offline',
      }));

      res.json({
        success: true,
        members: [],
        agents,
      });
    } catch (err) {
      console.error('[dashboard] Failed to build available members:', err);
      res.status(500).json({ error: 'Failed to load members' });
    }
  });

  app.get('/api/channels/:channel/members', async (req: Request, res: Response) => {
    const channelParamRaw = Array.isArray(req.params.channel) ? req.params.channel[0] : req.params.channel;
    const channelParam = decodeURIComponent(channelParamRaw ?? '');
    const channelName = channelParam.startsWith('#') ? channelParam.slice(1) : channelParam;

    if (!channelName) {
      res.status(400).json({ error: 'Channel is required' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.json({ members: [] });
      return;
    }

    try {
      const [members, spawnedAgentNames, localAgentNames] = await Promise.all([
        fetchChannelMembers(config, channelName),
        ctx.brokerProxyEnabled ? ctx.getSpawnedAgents().then((spawned) => spawned.names) : Promise.resolve(null),
        ctx.brokerProxyEnabled ? Promise.resolve(null) : Promise.resolve(ctx.getLocalAgentNames()),
      ]);

      const filteredMembers = ctx.filterPhantomAgents(members, spawnedAgentNames, localAgentNames);
      res.json({
        members: filteredMembers.map((agent) => ({
          id: agent.name,
          displayName: agent.name,
          entityType: 'agent' as const,
          role: 'member' as const,
          status: (agent.status ?? 'online').toLowerCase() === 'online' ? 'online' : 'offline',
          joinedAt: agent.lastSeen ?? new Date().toISOString(),
        })),
      });
    } catch (err) {
      console.error('[dashboard] Failed to fetch channel members:', err);
      res.status(500).json({ error: 'Failed to load channel members' });
    }
  });

  app.get('/api/channels/:channel/messages', async (req: Request, res: Response) => {
    const channelParamRaw = Array.isArray(req.params.channel) ? req.params.channel[0] : req.params.channel;
    const channelParam = decodeURIComponent(channelParamRaw ?? '');
    const channelName = channelParam.startsWith('#') ? channelParam.slice(1) : channelParam;
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
    const beforeRaw = req.query.before ? parseInt(req.query.before as string, 10) : NaN;
    const beforeTs = Number.isFinite(beforeRaw) ? beforeRaw : null;

    if (!channelName) {
      res.status(400).json({ error: 'Channel is required' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.json({ messages: [], hasMore: false });
      return;
    }

    try {
      const requestedLimit = beforeTs ? Math.min(limit * 2, 500) : limit;
      const messages = await fetchChannelMessages(config, channelName, {
        limit: requestedLimit,
        before: beforeTs === null ? undefined : beforeTs,
      });

      const trimmed = messages.slice(-limit);
      const hasMore = messages.length > limit;

      res.json({
        messages: trimmed.map((message) => ({
          id: message.id,
          channelId: channelParam.startsWith('#') ? channelParam : `#${channelName}`,
          from: message.agent_name,
          fromEntityType: 'agent' as const,
          content: message.text,
          timestamp: message.created_at,
          threadId: message.thread_id,
          threadSummary: typeof message.reply_count === 'number' && message.reply_count > 0 ? {
            threadId: message.id,
            replyCount: message.reply_count,
            lastReplyAt: message.created_at,
          } : undefined,
          isRead: true,
        })),
        hasMore,
      });
    } catch (err) {
      console.error('[dashboard] Failed to fetch Relaycast channel messages:', err);
      res.status(500).json({ error: 'Failed to load channel messages' });
    }
  });

  const handleRelaycastSend = async (req: Request, res: Response): Promise<void> => {
    const { to, from } = req.body ?? {};
    const messageValue = req.body?.message ?? req.body?.text ?? req.body?.body ?? req.body?.content;
    const message = typeof messageValue === 'string' ? messageValue.trim() : '';

    if (typeof to !== 'string' || !to.trim() || !message) {
      res.status(400).json({ success: false, error: 'Missing required fields: to, message' });
      return;
    }

    const result = await ctx.sendRelaycastMessage({
      to: to.trim(),
      message,
      from: typeof from === 'string' ? from : undefined,
    });

    if (!result.success) {
      res.status(result.status).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({
      success: true,
      messageId: result.messageId,
    });
  };

  app.post('/api/send', handleRelaycastSend);
  app.post('/api/dm', handleRelaycastSend);
  app.post('/api/relay/send', handleRelaycastSend);

  app.post('/api/channels', async (req: Request, res: Response) => {
    const { name, description, topic, isPrivate, visibility, invites } = req.body ?? {};
    const username = typeof req.body?.username === 'string' && req.body.username.trim()
      ? req.body.username.trim()
      : 'Dashboard';
    const rawName = typeof name === 'string' ? name : '';
    const channelName = normalizeChannelName(rawName);

    if (!channelName || channelName.startsWith('dm:')) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({
        success: false,
        error: `Relaycast credentials not found in ${path.join(ctx.dataDir, 'relaycast.json')}`,
      });
      return;
    }

    try {
      await createChannel(config, {
        name: channelName,
        description: typeof description === 'string' ? description : (typeof topic === 'string' ? topic : undefined),
        visibility: visibility === 'private' || isPrivate === true ? 'private' : 'public',
        creator: username,
        dataDir: ctx.dataDir,
      });
      await joinChannel(config, { channel: channelName, username, dataDir: ctx.dataDir }).catch(() => {});

      const inviteMembers = parseInviteMembers(invites);
      const inviteResult = inviteMembers.length > 0
        ? await inviteToChannel(config, {
            channel: channelName,
            members: inviteMembers,
            invitedBy: username,
            dataDir: ctx.dataDir,
          })
        : { invited: [] };

      res.json({
        success: true,
        channel: {
          id: `#${channelName}`,
          name: channelName,
          description: typeof description === 'string' ? description : undefined,
          topic: typeof topic === 'string' ? topic : undefined,
          visibility: visibility === 'private' || isPrivate === true ? 'private' : 'public',
          status: 'active',
          createdAt: new Date().toISOString(),
          createdBy: username,
          memberCount: Math.max(1, inviteResult.invited.filter((member) => member.success).length + 1),
          unreadCount: 0,
          hasMentions: false,
          isDm: false,
        },
        invited: inviteResult.invited,
      });
    } catch (err) {
      console.error('[dashboard] Failed to create Relaycast channel:', err);
      res.status(500).json({ error: (err as Error).message || 'Failed to create channel' });
    }
  });

  app.post('/api/channels/invite', async (req: Request, res: Response) => {
    const { channel, invites, invitedBy } = req.body ?? {};
    const channelName = typeof channel === 'string' ? normalizeChannelName(channel) : '';
    const inviteMembers = parseInviteMembers(invites);

    if (!channelName || inviteMembers.length === 0 || channelName.startsWith('dm:')) {
      res.status(400).json({ error: 'channel and invites are required' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({
        success: false,
        error: `Relaycast credentials not found in ${path.join(ctx.dataDir, 'relaycast.json')}`,
      });
      return;
    }

    const inviteResult = await inviteToChannel(config, {
      channel: channelName,
      members: inviteMembers,
      invitedBy: typeof invitedBy === 'string' && invitedBy.trim() ? invitedBy.trim() : 'Dashboard',
      dataDir: ctx.dataDir,
    });

    res.json({
      channel: normalizeChannelTarget(channelName),
      invited: inviteResult.invited,
    });
  });

  app.get('/api/channels/users', (_req: Request, res: Response) => {
    res.json({ users: [] });
  });

  app.post('/api/channels/join', async (req: Request, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const channel = typeof req.body?.channel === 'string' ? req.body.channel : '';
    const channelName = normalizeChannelName(channel);
    const channelTarget = normalizeChannelTarget(channel);

    if (!username || !channelName) {
      res.status(400).json({ error: 'username and channel required' });
      return;
    }

    if (channelName.startsWith('dm:')) {
      res.json({ success: true, channel: channelTarget });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({
        success: false,
        error: `Relaycast credentials not found in ${path.join(ctx.dataDir, 'relaycast.json')}`,
      });
      return;
    }

    try {
      await joinChannel(config, { channel: channelName, username, dataDir: ctx.dataDir });
    } catch (err) {
      console.error('[dashboard] Failed to join Relaycast channel:', err);
      res.status(500).json({ error: (err as Error).message || 'Failed to join channel' });
      return;
    }

    res.json({ success: true, channel: channelTarget });
  });

  app.post('/api/channels/leave', async (req: Request, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const channel = typeof req.body?.channel === 'string' ? normalizeChannelTarget(req.body.channel) : '';
    if (!username || !channel) {
      res.status(400).json({ error: 'username and channel required' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (config) {
      try {
        await leaveChannel(config, { channel, username });
      } catch (err) {
        if (ctx.verbose) {
          console.warn('[dashboard] Leave channel fallback failed:', (err as Error).message);
        }
      }
    }

    res.json({ success: true, channel });
  });

  app.post('/api/channels/admin-join', async (req: Request, res: Response) => {
    const channel = typeof req.body?.channel === 'string' ? normalizeChannelName(req.body.channel) : '';
    const member = typeof req.body?.member === 'string' ? req.body.member.trim() : '';

    if (!channel || !member || channel.startsWith('dm:')) {
      res.status(400).json({ error: 'channel and member required' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({
        success: false,
        error: `Relaycast credentials not found in ${path.join(ctx.dataDir, 'relaycast.json')}`,
      });
      return;
    }

    try {
      await inviteToChannel(config, {
        channel,
        members: [{ id: member, type: 'agent' }],
        invitedBy: 'Dashboard',
        dataDir: ctx.dataDir,
      });
      res.json({ success: true, channel: normalizeChannelTarget(channel), member });
    } catch (err) {
      console.error('[dashboard] Failed to admin-join channel member:', err);
      res.status(500).json({ error: (err as Error).message || 'Failed to add member' });
    }
  });

  app.post('/api/channels/admin-remove', (req: Request, res: Response) => {
    const channel = typeof req.body?.channel === 'string' ? normalizeChannelTarget(req.body.channel) : '';
    const member = typeof req.body?.member === 'string' ? req.body.member.trim() : '';
    if (!channel || !member) {
      res.status(400).json({ error: 'channel and member required' });
      return;
    }
    res.json({ success: true, channel, member });
  });

  app.post('/api/channels/subscribe', async (req: Request, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const channelsRaw: unknown[] = Array.isArray(req.body?.channels) ? req.body.channels : ['#general'];
    const channelNames = channelsRaw
      .filter((entry: unknown): entry is string => typeof entry === 'string')
      .map((entry: string) => normalizeChannelName(entry))
      .filter(Boolean);

    if (!username) {
      res.status(400).json({ error: 'username required' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (!config) {
      res.status(503).json({
        success: false,
        error: `Relaycast credentials not found in ${path.join(ctx.dataDir, 'relaycast.json')}`,
      });
      return;
    }

    const joinedChannels: string[] = [];

    for (const channelName of channelNames) {
      if (channelName.startsWith('dm:')) {
        joinedChannels.push(channelName);
        continue;
      }

      try {
        await joinChannel(config, { channel: channelName, username, dataDir: ctx.dataDir });
        joinedChannels.push(normalizeChannelTarget(channelName));
      } catch (err) {
        if (ctx.verbose) {
          console.warn(`[dashboard] Failed to subscribe ${username} to ${channelName}:`, (err as Error).message);
        }
      }
    }

    res.json({
      success: true,
      channels: joinedChannels,
    });
  });

  app.post('/api/channels/message', async (req: Request, res: Response) => {
    const username = typeof req.body?.username === 'string' && req.body.username.trim()
      ? req.body.username.trim()
      : 'Dashboard';
    const channel = typeof req.body?.channel === 'string' ? req.body.channel : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';

    if (!channel || !body) {
      res.status(400).json({ error: 'username, channel, and body required' });
      return;
    }

    const result = await ctx.sendRelaycastMessage({
      to: normalizeChannelTarget(channel),
      message: body,
      from: username,
    });

    if (!result.success) {
      res.status(result.status).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({ success: true, messageId: result.messageId });
  });

  app.post('/api/channels/archive', async (req: Request, res: Response) => {
    const channel = typeof req.body?.channel === 'string' ? normalizeChannelTarget(req.body.channel) : '';
    if (!channel) {
      res.status(400).json({ error: 'channel required' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (config) {
      try {
        await setChannelArchived(config, { channel, archived: true, updatedBy: 'Dashboard' });
      } catch (err) {
        if (ctx.verbose) {
          console.warn('[dashboard] Archive channel fallback failed:', (err as Error).message);
        }
      }
    }

    res.json({ success: true, channel });
  });

  app.post('/api/channels/unarchive', async (req: Request, res: Response) => {
    const channel = typeof req.body?.channel === 'string' ? normalizeChannelTarget(req.body.channel) : '';
    if (!channel) {
      res.status(400).json({ error: 'channel required' });
      return;
    }

    const config = ctx.resolveRelaycastConfig();
    if (config) {
      try {
        await setChannelArchived(config, { channel, archived: false, updatedBy: 'Dashboard' });
      } catch (err) {
        if (ctx.verbose) {
          console.warn('[dashboard] Unarchive channel fallback failed:', (err as Error).message);
        }
      }
    }

    res.json({ success: true, channel });
  });
}
