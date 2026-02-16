/**
 * Mock API Routes
 *
 * Provides mock API endpoints that return fixture data.
 * Used when running the dashboard in standalone/demo mode.
 */

import type { Express, Request, Response } from 'express';
import type { Message } from './types.js';
import {
  mockAgents,
  mockMessages,
  mockSessions,
  mockChannels,
  mockDecisions,
  mockTasks,
  mockFleetStats,
  mockFleetServers,
  mockMetrics,
  mockHistorySessions,
  mockHistoryStats,
  mockSpawnedAgents,
  mockFiles,
  mockConversations,
  mockBillingPlans,
  mockSubscription,
  mockInvoices,
  mockWorkspaces,
  mockUser,
  mockRepos,
  mockProviders,
} from './fixtures.js';

/**
 * Register mock API routes on the Express app
 */
export function registerMockRoutes(app: Express, verbose: boolean): void {
  const log = (msg: string) => {
    if (verbose) {
      console.log(`[mock] ${msg}`);
    }
  };

  // ===== Core Dashboard Data =====

  app.get('/api/data', (_req: Request, res: Response) => {
    log('GET /api/data');
    res.json({
      agents: mockAgents,
      messages: mockMessages,
      sessions: mockSessions,
    });
  });

  app.get('/api/bridge', (_req: Request, res: Response) => {
    log('GET /api/bridge');
    res.json({
      projects: [
        {
          id: 'project-1',
          name: 'webapp',
          path: '/Users/dev/projects/webapp',
          agents: mockAgents.slice(0, 2),
        },
        {
          id: 'project-2',
          name: 'api-service',
          path: '/Users/dev/projects/api-service',
          agents: mockAgents.slice(2),
        },
      ],
    });
  });

  // ===== Agent Management =====

  app.get('/api/spawned', (_req: Request, res: Response) => {
    log('GET /api/spawned');
    res.json({
      success: true,
      agents: mockSpawnedAgents,
    });
  });

  app.post('/api/spawn', (req: Request, res: Response) => {
    const { name, cli = 'claude-code', task } = req.body || {};
    log(`POST /api/spawn - ${name}`);

    if (!name) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    res.json({
      success: true,
      name,
      cli,
      task,
      message: `Agent ${name} spawned successfully (mock)`,
    });
  });

  app.delete('/api/spawned/:name', (req: Request, res: Response) => {
    const { name } = req.params;
    log(`DELETE /api/spawned/${name}`);
    res.json({
      success: true,
      message: `Agent ${name} released (mock)`,
    });
  });

  app.get('/api/agents/:name/online', (req: Request, res: Response) => {
    const { name } = req.params;
    const agent = mockAgents.find(a => a.name === name);
    log(`GET /api/agents/${name}/online`);
    res.json({
      online: agent ? agent.status !== 'offline' : false,
    });
  });

  app.post('/api/agents/by-name/:name/interrupt', (req: Request, res: Response) => {
    const { name } = req.params;
    log(`POST /api/agents/by-name/${name}/interrupt`);
    res.json({
      success: true,
      message: `Interrupt signal sent to ${name} (mock)`,
    });
  });

  // ===== Messaging =====

  app.post('/api/send', (req: Request, res: Response) => {
    const { to, message, from, thread, attachments } = req.body || {};
    log(`POST /api/send - to: ${to}, from: ${from || 'user'}`);

    if (!to || !message) {
      res.status(400).json({ success: false, error: 'Missing to or message' });
      return;
    }

    // Create a new message and add it to mockMessages for persistence
    const newMessage = {
      id: `mock-msg-${Date.now()}`,
      from: from || 'user',
      to,
      content: message,
      timestamp: new Date().toISOString(),
      thread,
      attachments,
      isBroadcast: to === '*',
    };

    // Add to the beginning of mockMessages so it appears in the UI
    mockMessages.unshift(newMessage);

    res.json({
      success: true,
      messageId: newMessage.id,
    });
  });

  app.post('/api/upload', (req: Request, res: Response) => {
    const { filename, mimeType } = req.body || {};
    log(`POST /api/upload - ${filename}`);
    res.json({
      success: true,
      attachment: {
        id: `attachment-${Date.now()}`,
        filename: filename || 'unknown',
        mimeType: mimeType || 'application/octet-stream',
        size: 1024,
        url: `/api/attachment/attachment-${Date.now()}`,
      },
    });
  });

  app.get('/api/attachment/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/attachment/${id}`);
    res.status(404).json({ error: 'Attachment not found (mock)' });
  });

  // ===== Channels =====

  // Track archived channels in memory for mock mode
  const archivedChannelsList: typeof mockChannels = [];

  app.get('/api/channels', (_req: Request, res: Response) => {
    log('GET /api/channels');
    // Transform mock channels to match the Channel interface expected by frontend
    const channels = mockChannels.map(ch => ({
      id: ch.id.startsWith('#') ? ch.id : `#${ch.id}`,
      name: ch.name,
      description: ch.description || '',
      visibility: ch.isPrivate ? 'private' : 'public',
      status: 'active',
      createdAt: ch.createdAt,
      createdBy: 'system',
      memberCount: ch.memberCount || 1,
      unreadCount: 0,
      hasMentions: false,
      isDm: false,
    }));
    // Transform archived channels the same way
    const archivedChannels = archivedChannelsList.map(ch => ({
      id: ch.id.startsWith('#') ? ch.id : `#${ch.id}`,
      name: ch.name,
      description: ch.description || '',
      visibility: ch.isPrivate ? 'private' : 'public',
      status: 'archived',
      createdAt: ch.createdAt,
      createdBy: 'system',
      memberCount: ch.memberCount || 1,
      unreadCount: 0,
      hasMentions: false,
      isDm: false,
    }));
    res.json({
      success: true,
      channels,
      archivedChannels,
    });
  });

  app.post('/api/channels', (req: Request, res: Response) => {
    const { name, description, isPrivate } = req.body || {};
    log(`POST /api/channels - ${name}`);

    if (!name) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    const channelName = name.startsWith('#') ? name.slice(1) : name;
    const channelId = channelName.toLowerCase().replace(/\s+/g, '-');
    const createdAt = new Date().toISOString();

    // Add to mockChannels so it persists in the mock session
    const newChannel = {
      id: channelId,
      name: channelName,
      description: description || '',
      memberCount: 1,
      isPrivate: isPrivate || false,
      createdAt,
    };
    mockChannels.push(newChannel);

    res.json({
      success: true,
      channel: {
        id: channelId,
        name: channelName,
        description: description || '',
        visibility: isPrivate ? 'private' : 'public',
        status: 'active',
        createdAt,
        createdBy: 'Dashboard',
        memberCount: 1,
      },
    });
  });

  app.get('/api/channels/available-members', (_req: Request, res: Response) => {
    log('GET /api/channels/available-members');
    // Return mock agents as available members for channel invites
    const agents = mockAgents.map(a => ({
      id: a.name,
      displayName: a.name,
      entityType: 'agent' as const,
      status: a.status || 'online',
    }));
    res.json({
      success: true,
      members: [], // No human users in mock mode
      agents,
    });
  });

  app.get('/api/channels/:channel/messages', (req: Request, res: Response) => {
    const { channel } = req.params;
    log(`GET /api/channels/${channel}/messages`);
    res.json({
      success: true,
      messages: mockMessages.filter(m =>
        m.to === channel || m.from === channel || m.isBroadcast
      ),
    });
  });

  app.get('/api/channels/:channel/members', (req: Request, res: Response) => {
    const { channel } = req.params;
    log(`GET /api/channels/${channel}/members`);
    res.json({
      success: true,
      members: mockAgents.map(a => ({
        id: a.name,
        name: a.name,
        role: a.name === 'architect' ? 'admin' : 'member',
        joinedAt: new Date(Date.now() - 86400000).toISOString(),
      })),
      total: mockAgents.length,
      page: 1,
      pageSize: 20,
    });
  });

  app.post('/api/channels/message', (req: Request, res: Response) => {
    const { channel, content } = req.body || {};
    log(`POST /api/channels/message - ${channel}`);
    res.json({
      success: true,
      messageId: `mock-channel-msg-${Date.now()}`,
    });
  });

  app.post('/api/channels/:channel/join', (req: Request, res: Response) => {
    const { channel } = req.params;
    log(`POST /api/channels/${channel}/join`);
    res.json({ success: true });
  });

  // Channel join with body params (used by frontend)
  app.post('/api/channels/join', (req: Request, res: Response) => {
    const { channel, username } = req.body || {};
    log(`POST /api/channels/join - ${channel} by ${username}`);
    res.json({ success: true });
  });

  app.post('/api/channels/:channel/leave', (req: Request, res: Response) => {
    const { channel } = req.params;
    log(`POST /api/channels/${channel}/leave`);
    res.json({ success: true });
  });

  // Channel leave with body params (used by frontend)
  app.post('/api/channels/leave', (req: Request, res: Response) => {
    const { channel, username } = req.body || {};
    log(`POST /api/channels/leave - ${channel} by ${username}`);
    res.json({ success: true });
  });

  // Archive a channel
  app.post('/api/channels/archive', (req: Request, res: Response) => {
    const { channel: channelId } = req.body || {};
    log(`POST /api/channels/archive - ${channelId}`);

    if (!channelId) {
      res.status(400).json({ success: false, error: 'Channel ID is required' });
      return;
    }

    // Find the channel in mockChannels
    const channelName = channelId.startsWith('#') ? channelId.slice(1) : channelId;
    const channelIndex = mockChannels.findIndex(
      ch => ch.id === channelName || ch.id === channelId || ch.name === channelName
    );

    if (channelIndex !== -1) {
      // Move from active to archived
      const [channel] = mockChannels.splice(channelIndex, 1);
      archivedChannelsList.push(channel);
    }

    res.json({
      success: true,
      channel: {
        id: channelId,
        name: channelName,
        visibility: 'public',
        status: 'archived',
        createdAt: new Date().toISOString(),
        createdBy: 'system',
        memberCount: 1,
        unreadCount: 0,
        hasMentions: false,
      },
    });
  });

  // Unarchive a channel
  app.post('/api/channels/unarchive', (req: Request, res: Response) => {
    const { channel: channelId } = req.body || {};
    log(`POST /api/channels/unarchive - ${channelId}`);

    if (!channelId) {
      res.status(400).json({ success: false, error: 'Channel ID is required' });
      return;
    }

    // Find the channel in archivedChannelsList
    const channelName = channelId.startsWith('#') ? channelId.slice(1) : channelId;
    const channelIndex = archivedChannelsList.findIndex(
      ch => ch.id === channelName || ch.id === channelId || ch.name === channelName
    );

    if (channelIndex !== -1) {
      // Move from archived back to active
      const [channel] = archivedChannelsList.splice(channelIndex, 1);
      mockChannels.push(channel);
    }

    res.json({
      success: true,
      channel: {
        id: channelId,
        name: channelName,
        visibility: 'public',
        status: 'active',
        createdAt: new Date().toISOString(),
        createdBy: 'system',
        memberCount: 1,
        unreadCount: 0,
        hasMentions: false,
      },
    });
  });

  // ===== Decisions =====

  app.get('/api/decisions', (_req: Request, res: Response) => {
    log('GET /api/decisions');
    res.json({
      success: true,
      decisions: mockDecisions,
    });
  });

  app.post('/api/decisions/:id/approve', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`POST /api/decisions/${id}/approve`);
    res.json({
      success: true,
      message: `Decision ${id} approved (mock)`,
    });
  });

  app.post('/api/decisions/:id/reject', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`POST /api/decisions/${id}/reject`);
    res.json({
      success: true,
      message: `Decision ${id} rejected (mock)`,
    });
  });

  app.delete('/api/decisions/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`DELETE /api/decisions/${id}`);
    res.json({
      success: true,
      message: `Decision ${id} dismissed (mock)`,
    });
  });

  // ===== Tasks =====

  app.get('/api/tasks', (_req: Request, res: Response) => {
    log('GET /api/tasks');
    res.json({
      success: true,
      tasks: mockTasks,
    });
  });

  app.post('/api/tasks', (req: Request, res: Response) => {
    const { agentName, title, description, priority } = req.body || {};
    log(`POST /api/tasks - ${title}`);

    if (!agentName || !title) {
      res.status(400).json({ success: false, error: 'Agent name and title required' });
      return;
    }

    res.json({
      success: true,
      task: {
        id: `task-${Date.now()}`,
        agentName,
        title,
        description,
        priority: priority || 'medium',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    });
  });

  app.patch('/api/tasks/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const updates = req.body || {};
    log(`PATCH /api/tasks/${id}`);
    res.json({
      success: true,
      task: {
        id,
        ...updates,
      },
    });
  });

  app.delete('/api/tasks/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`DELETE /api/tasks/${id}`);
    res.json({ success: true });
  });

  // ===== Fleet =====

  app.get('/api/fleet/stats', (_req: Request, res: Response) => {
    log('GET /api/fleet/stats');
    res.json({
      success: true,
      stats: mockFleetStats,
    });
  });

  app.get('/api/fleet/servers', (_req: Request, res: Response) => {
    log('GET /api/fleet/servers');
    res.json({
      success: true,
      servers: mockFleetServers,
    });
  });

  // ===== Metrics =====

  app.get('/api/metrics', (_req: Request, res: Response) => {
    log('GET /api/metrics');
    res.json(mockMetrics);
  });

  app.get('/api/metrics/agents', (_req: Request, res: Response) => {
    log('GET /api/metrics/agents');
    res.json({
      success: true,
      agents: mockMetrics.agents,
    });
  });

  app.get('/api/metrics/health', (_req: Request, res: Response) => {
    log('GET /api/metrics/health');
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  });

  app.get('/metrics', (_req: Request, res: Response) => {
    log('GET /metrics (prometheus)');
    const lines = [
      '# HELP dashboard_agents_total Total number of agents',
      '# TYPE dashboard_agents_total gauge',
      `dashboard_agents_total ${mockAgents.length}`,
      '',
      '# HELP dashboard_agents_online Number of online agents',
      '# TYPE dashboard_agents_online gauge',
      `dashboard_agents_online ${mockAgents.filter(a => a.status !== 'offline').length}`,
      '',
      '# HELP dashboard_messages_total Total number of messages',
      '# TYPE dashboard_messages_total counter',
      `dashboard_messages_total ${mockMessages.length}`,
    ];
    res.type('text/plain').send(lines.join('\n'));
  });

  // ===== History =====

  app.get('/api/history/sessions', (req: Request, res: Response) => {
    log('GET /api/history/sessions');
    const { agent, limit = '50' } = req.query;
    let sessions = mockHistorySessions;

    if (agent) {
      sessions = sessions.filter(s => s.agentName === agent);
    }

    res.json({
      sessions: sessions.slice(0, parseInt(limit as string, 10)),
    });
  });

  app.get('/api/history/messages', (req: Request, res: Response) => {
    log('GET /api/history/messages');
    const { from, to, limit = '100', order = 'desc' } = req.query;
    let messages = [...mockMessages];

    if (from) {
      messages = messages.filter(m => m.from === from);
    }
    if (to) {
      messages = messages.filter(m => m.to === to);
    }

    if (order === 'asc') {
      messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } else {
      messages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    res.json({
      messages: messages.slice(0, parseInt(limit as string, 10)),
    });
  });

  app.get('/api/history/conversations', (_req: Request, res: Response) => {
    log('GET /api/history/conversations');
    res.json({
      conversations: mockConversations,
    });
  });

  app.get('/api/history/message/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/history/message/${id}`);
    const message = mockMessages.find(m => m.id === id);

    if (message) {
      res.json(message);
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  });

  app.get('/api/history/stats', (_req: Request, res: Response) => {
    log('GET /api/history/stats');
    res.json(mockHistoryStats);
  });

  // ===== Files =====

  app.get('/api/files', (req: Request, res: Response) => {
    const { q: query, limit = '50' } = req.query;
    log(`GET /api/files - query: ${query}`);

    let files = mockFiles;
    if (query) {
      const searchTerm = (query as string).toLowerCase();
      files = files.filter(f =>
        f.name.toLowerCase().includes(searchTerm) ||
        f.path.toLowerCase().includes(searchTerm)
      );
    }

    res.json({
      files: files.slice(0, parseInt(limit as string, 10)),
      query: query || '',
      searchRoot: '/Users/dev/projects/webapp',
    });
  });

  // ===== Reactions =====

  app.post('/api/messages/:id/reactions', (req: Request, res: Response) => {
    const { id } = req.params;
    const { emoji } = req.body || {};
    log(`POST /api/messages/${id}/reactions - ${emoji}`);

    const message = mockMessages.find(m => m.id === id);
    if (!message) {
      res.status(404).json({ ok: false, error: { code: 'message_not_found', message: 'Message not found' } });
      return;
    }

    const agentName = req.body.from || mockUser.displayName;
    if (!message.reactions) message.reactions = [];
    const existing = message.reactions.find(r => r.emoji === emoji);
    if (existing) {
      if (!existing.agents.includes(agentName)) {
        existing.agents.push(agentName);
        existing.count++;
      }
    } else {
      message.reactions.push({ emoji, count: 1, agents: [agentName] });
    }

    res.status(201).json({
      ok: true,
      data: { id: `reaction-${Date.now()}`, message_id: id, emoji, agent_name: agentName, created_at: new Date().toISOString() },
    });
  });

  app.delete('/api/messages/:id/reactions/:emoji', (req: Request, res: Response) => {
    const { id, emoji } = req.params;
    log(`DELETE /api/messages/${id}/reactions/${emoji}`);

    const message = mockMessages.find(m => m.id === id);
    if (!message) {
      res.status(404).json({ ok: false, error: { code: 'message_not_found', message: 'Message not found' } });
      return;
    }

    if (message.reactions) {
      const existing = message.reactions.find(r => r.emoji === emoji);
      if (existing) {
        const agentToRemove = (req.body && req.body.from) || mockUser.displayName;
      existing.agents = existing.agents.filter(a => a !== agentToRemove);
        existing.count = existing.agents.length;
        if (existing.count === 0) {
          message.reactions = message.reactions.filter(r => r.emoji !== emoji);
        }
      }
    }

    res.status(204).end();
  });

  app.get('/api/messages/:id/reactions', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/messages/${id}/reactions`);

    const message = mockMessages.find(m => m.id === id);
    if (!message) {
      res.status(404).json({ ok: false, error: { code: 'message_not_found', message: 'Message not found' } });
      return;
    }

    res.json({ ok: true, data: message.reactions || [] });
  });

  // ===== Thread Replies =====

  app.get('/api/messages/:id/replies', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/messages/${id}/replies`);

    const parent = mockMessages.find(m => m.id === id);
    if (!parent) {
      res.status(404).json({ ok: false, error: { code: 'message_not_found', message: 'Message not found' } });
      return;
    }

    const replies = mockMessages
      .filter(m => m.thread === id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    res.json({
      ok: true,
      data: {
        parent: { ...parent, reply_count: replies.length },
        replies,
      },
    });
  });

  app.post('/api/messages/:id/replies', (req: Request, res: Response) => {
    const { id } = req.params;
    const { text } = req.body || {};
    log(`POST /api/messages/${id}/replies`);

    const parent = mockMessages.find(m => m.id === id);
    if (!parent) {
      res.status(404).json({ ok: false, error: { code: 'message_not_found', message: 'Message not found' } });
      return;
    }

    const replyFrom = req.body.from || mockUser.displayName;
    const reply: Message = {
      id: `msg-reply-${Date.now()}`,
      from: replyFrom,
      to: parent.from === replyFrom ? parent.to : parent.from,
      content: text,
      timestamp: new Date().toISOString(),
      thread: id,
    };

    mockMessages.push(reply);

    // Update parent reply count
    if (parent.replyCount !== undefined) {
      parent.replyCount++;
    } else {
      parent.replyCount = mockMessages.filter(m => m.thread === id).length;
    }

    res.status(201).json({ ok: true, data: reply });
  });

  // ===== Relay Message =====

  app.post('/api/relay/send', (req: Request, res: Response) => {
    const { to, content } = req.body || {};
    log(`POST /api/relay/send - to: ${to}`);
    res.json({
      success: true,
      messageId: `relay-msg-${Date.now()}`,
    });
  });

  // ===== Beads =====

  app.post('/api/beads', (req: Request, res: Response) => {
    const { title, assignee, priority, type } = req.body || {};
    log(`POST /api/beads - ${title}`);
    res.json({
      success: true,
      bead: {
        id: `bead-${Date.now()}`,
        title,
        assignee,
        priority,
        type,
      },
    });
  });

  // ===== Settings =====

  app.get('/api/settings', (_req: Request, res: Response) => {
    log('GET /api/settings');
    res.json({
      trajectory: { enabled: true, maxSteps: 100 },
      notifications: { enabled: true },
    });
  });

  app.get('/api/settings/trajectory', (_req: Request, res: Response) => {
    log('GET /api/settings/trajectory');
    res.json({
      enabled: true,
      maxSteps: 100,
      autoSave: true,
    });
  });

  app.put('/api/settings/trajectory', (req: Request, res: Response) => {
    const settings = req.body || {};
    log('PUT /api/settings/trajectory');
    res.json({
      success: true,
      ...settings,
    });
  });

  // ===== Trajectory =====

  app.get('/api/trajectory', (_req: Request, res: Response) => {
    log('GET /api/trajectory');
    res.json({
      steps: [],
      metadata: {
        agentName: 'claude-1',
        startedAt: new Date().toISOString(),
      },
    });
  });

  app.get('/api/trajectory/steps', (_req: Request, res: Response) => {
    log('GET /api/trajectory/steps');
    res.json({ steps: [] });
  });

  app.get('/api/trajectory/history', (_req: Request, res: Response) => {
    log('GET /api/trajectory/history');
    res.json({ trajectories: [] });
  });

  // ===== Logs =====

  app.get('/api/logs', (_req: Request, res: Response) => {
    log('GET /api/logs');
    res.json({
      agents: mockAgents.map(a => a.name),
    });
  });

  app.get('/api/logs/:name', (req: Request, res: Response) => {
    const { name } = req.params;
    log(`GET /api/logs/${name}`);
    res.json({
      logs: [
        `[${new Date().toISOString()}] Agent ${name} started`,
        `[${new Date().toISOString()}] Processing task...`,
        `[${new Date().toISOString()}] Task completed successfully`,
      ],
    });
  });

  // ===== Cloud Auth (cloud-native paths) =====

  app.get('/api/auth/session', (_req: Request, res: Response) => {
    log('GET /api/auth/session');
    res.set('X-CSRF-Token', 'mock-csrf-token');
    res.json({
      authenticated: true,
      user: {
        id: mockUser.id,
        githubUsername: mockUser.githubUsername,
        email: mockUser.email,
        avatarUrl: mockUser.avatarUrl,
        plan: mockUser.plan,
      },
      connectedProviders: mockUser.connectedProviders,
    });
  });

  app.get('/api/auth/me', (_req: Request, res: Response) => {
    log('GET /api/auth/me');
    res.json(mockUser);
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    log('POST /api/auth/logout');
    res.json({ success: true });
  });

  // Nango auth stubs (return plausible data for UI flow)
  app.get('/api/auth/nango/login-session', (_req: Request, res: Response) => {
    log('GET /api/auth/nango/login-session');
    res.json({ sessionToken: 'mock-nango-session', tempUserId: 'mock-temp-user' });
  });

  app.get('/api/auth/nango/login-status/:connectionId', (_req: Request, res: Response) => {
    log('GET /api/auth/nango/login-status');
    res.json({ ready: true, user: { id: mockUser.id, githubUsername: mockUser.githubUsername, email: mockUser.email, plan: mockUser.plan } });
  });

  app.get('/api/auth/nango/repo-session', (_req: Request, res: Response) => {
    log('GET /api/auth/nango/repo-session');
    res.json({ sessionToken: 'mock-nango-repo-session' });
  });

  app.get('/api/auth/nango/repo-status/:connectionId', (_req: Request, res: Response) => {
    log('GET /api/auth/nango/repo-status');
    res.json({ ready: true, repos: mockRepos });
  });

  // ===== Workspaces (cloud-native paths) =====

  app.get('/api/workspaces/accessible', (_req: Request, res: Response) => {
    log('GET /api/workspaces/accessible');
    res.json({
      workspaces: mockWorkspaces,
      summary: {
        owned: mockWorkspaces.length,
        member: 0,
        contributor: 0,
        total: mockWorkspaces.length,
      },
    });
  });

  app.get('/api/workspaces/summary', (_req: Request, res: Response) => {
    log('GET /api/workspaces/summary');
    const running = mockWorkspaces.filter(w => w.status === 'running').length;
    const stopped = mockWorkspaces.filter(w => w.status === 'stopped').length;
    res.json({
      workspaces: mockWorkspaces.map(ws => ({
        id: ws.id,
        name: ws.name,
        status: ws.status,
        publicUrl: ws.publicUrl,
        isStopped: ws.status === 'stopped',
        isRunning: ws.status === 'running',
        isProvisioning: ws.status === 'provisioning',
        hasError: ws.status === 'error',
      })),
      summary: { total: mockWorkspaces.length, running, stopped, provisioning: 0, error: 0 },
      overallStatus: running > 0 ? 'ready' : 'stopped',
    });
  });

  app.get('/api/workspaces/primary', (_req: Request, res: Response) => {
    log('GET /api/workspaces/primary');
    const primary = mockWorkspaces[0];
    res.json({
      exists: true,
      workspace: {
        id: primary.id,
        name: primary.name,
        status: primary.status,
        publicUrl: primary.publicUrl,
        isStopped: primary.status === 'stopped',
        isRunning: primary.status === 'running',
        isProvisioning: false,
        hasError: false,
        config: { providers: primary.providers || [], repositories: primary.repositories || [] },
      },
      statusMessage: primary.status === 'running' ? 'Workspace is running' : 'Workspace is stopped',
    });
  });

  app.post('/api/workspaces/quick', (req: Request, res: Response) => {
    const { repositoryFullName } = req.body || {};
    log(`POST /api/workspaces/quick - ${repositoryFullName}`);
    res.json({
      workspaceId: `ws_new_${Date.now()}`,
      name: repositoryFullName || 'New Workspace',
    });
  });

  app.post('/api/workspaces', (req: Request, res: Response) => {
    const { name } = req.body || {};
    log(`POST /api/workspaces - ${name}`);
    res.json({ id: `ws_new_${Date.now()}`, name: name || 'New Workspace', slug: (name || 'new-workspace').toLowerCase().replace(/\s+/g, '-') });
  });

  app.get('/api/workspaces/:id/status', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/workspaces/${id}/status`);
    const workspace = mockWorkspaces.find(ws => ws.id === id);
    res.json({ status: workspace?.status || 'running' });
  });

  app.get('/api/workspaces/:id/members', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/workspaces/${id}/members`);
    res.json({
      members: [{
        id: 'member_1',
        userId: mockUser.id,
        role: 'owner',
        isPending: false,
        user: { githubUsername: mockUser.githubUsername, email: mockUser.email, avatarUrl: mockUser.avatarUrl },
      }],
    });
  });

  app.get('/api/workspaces/:id/repo-collaborators', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/workspaces/${id}/repo-collaborators`);
    res.json({ collaborators: [], totalRepos: mockRepos.length });
  });

  app.post('/api/workspaces/:id/members', (req: Request, res: Response) => {
    const { id } = req.params;
    const { githubUsername, role } = req.body || {};
    log(`POST /api/workspaces/${id}/members - ${githubUsername}`);
    res.json({ success: true, member: { id: `member_${Date.now()}`, userId: `user_${Date.now()}`, role: role || 'member', isPending: true } });
  });

  app.patch('/api/workspaces/:id/members/:memberId', (req: Request, res: Response) => {
    const { id, memberId } = req.params;
    const { role } = req.body || {};
    log(`PATCH /api/workspaces/${id}/members/${memberId}`);
    res.json({ success: true, role });
  });

  app.delete('/api/workspaces/:id/members/:memberId', (req: Request, res: Response) => {
    const { id, memberId } = req.params;
    log(`DELETE /api/workspaces/${id}/members/${memberId}`);
    res.json({ success: true });
  });

  app.post('/api/workspaces/:id/wakeup', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`POST /api/workspaces/${id}/wakeup`);
    res.json({ status: 'running', wasRestarted: true, message: 'Workspace started (mock)' });
  });

  app.post('/api/workspaces/:id/restart', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`POST /api/workspaces/${id}/restart`);
    res.json({ success: true, message: 'Workspace restarted (mock)' });
  });

  app.post('/api/workspaces/:id/stop', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`POST /api/workspaces/${id}/stop`);
    res.json({ success: true, message: 'Workspace stopped (mock)' });
  });

  app.delete('/api/workspaces/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`DELETE /api/workspaces/${id}`);
    res.json({ success: true, message: 'Workspace deleted (mock)' });
  });

  app.post('/api/workspaces/:id/repos', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`POST /api/workspaces/${id}/repos`);
    res.json({ success: true, message: 'Repos added (mock)' });
  });

  app.post('/api/workspaces/:id/domain', (req: Request, res: Response) => {
    const { id } = req.params;
    const { domain } = req.body || {};
    log(`POST /api/workspaces/${id}/domain - ${domain}`);
    res.json({ success: true, domain, status: 'pending', instructions: { type: 'CNAME', name: domain, value: 'proxy.agentrelay.dev', ttl: 300 }, verifyEndpoint: `/api/workspaces/${id}/domain/verify`, message: 'Add DNS record' });
  });

  app.post('/api/workspaces/:id/domain/verify', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`POST /api/workspaces/${id}/domain/verify`);
    res.json({ success: true, status: 'verified' });
  });

  app.delete('/api/workspaces/:id/domain', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`DELETE /api/workspaces/${id}/domain`);
    res.json({ success: true, message: 'Domain removed (mock)' });
  });

  // Workspace details - must come after specific sub-routes to avoid matching them
  app.get('/api/workspaces/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/workspaces/${id}`);
    const workspace = mockWorkspaces.find(ws => ws.id === id);
    if (workspace) {
      res.json({
        ...workspace,
        computeProvider: 'mock',
        config: { providers: workspace.providers || [], repositories: workspace.repositories || [] },
        repositories: (workspace.repositories || []).map((r, i) => ({
          id: `repo_${i}`,
          fullName: r,
          syncStatus: 'synced',
          lastSyncedAt: new Date(Date.now() - 3600000).toISOString(),
        })),
        updatedAt: new Date().toISOString(),
      });
    } else {
      res.status(404).json({ error: 'Workspace not found' });
    }
  });

  // ===== Providers (cloud-native) =====

  app.get('/api/providers', (_req: Request, res: Response) => {
    log('GET /api/providers');
    res.json({ providers: mockProviders });
  });

  app.delete('/api/providers/:provider', (req: Request, res: Response) => {
    const { provider } = req.params;
    log(`DELETE /api/providers/${provider}`);
    res.json({ success: true });
  });

  // ===== GitHub App (cloud-native) =====

  app.get('/api/github-app/repos', (_req: Request, res: Response) => {
    log('GET /api/github-app/repos');
    res.json({ repositories: mockRepos });
  });

  app.post('/api/repos/:repoId/sync', (req: Request, res: Response) => {
    const { repoId } = req.params;
    log(`POST /api/repos/${repoId}/sync`);
    res.json({ message: 'Sync started (mock)', syncStatus: 'syncing' });
  });

  // ===== Invites =====

  app.get('/api/invites', (_req: Request, res: Response) => {
    log('GET /api/invites');
    res.json({ invites: [] });
  });

  app.post('/api/invites/:inviteId/accept', (req: Request, res: Response) => {
    const { inviteId } = req.params;
    log(`POST /api/invites/${inviteId}/accept`);
    res.json({ success: true, workspaceId: mockWorkspaces[0].id });
  });

  app.post('/api/invites/:inviteId/decline', (req: Request, res: Response) => {
    const { inviteId } = req.params;
    log(`POST /api/invites/${inviteId}/decline`);
    res.json({ success: true });
  });

  // ===== Billing (cloud-native) =====

  app.get('/api/billing/plans', (_req: Request, res: Response) => {
    log('GET /api/billing/plans');
    res.json({ plans: mockBillingPlans, publishableKey: 'pk_mock_key' });
  });

  app.get('/api/billing/subscription', (_req: Request, res: Response) => {
    log('GET /api/billing/subscription');
    res.json({
      tier: mockSubscription.tier,
      subscription: mockSubscription,
      customer: {
        id: 'cus_mock1',
        email: mockUser.email,
        name: mockUser.displayName,
        paymentMethods: [{ id: 'pm_mock1', type: 'card', last4: '4242', brand: 'visa', isDefault: true }],
        invoices: mockInvoices,
      },
    });
  });

  app.get('/api/billing/invoices', (_req: Request, res: Response) => {
    log('GET /api/billing/invoices');
    res.json({ invoices: mockInvoices });
  });

  app.post('/api/billing/checkout', (req: Request, res: Response) => {
    const { tier, interval } = req.body || {};
    log(`POST /api/billing/checkout - ${tier} (${interval})`);
    res.json({ sessionId: 'cs_mock1', checkoutUrl: '#mock-checkout' });
  });

  app.post('/api/billing/portal', (_req: Request, res: Response) => {
    log('POST /api/billing/portal');
    res.json({ sessionId: 'bps_mock1', portalUrl: '#mock-portal' });
  });

  app.post('/api/billing/change', (req: Request, res: Response) => {
    const { tier } = req.body || {};
    log(`POST /api/billing/change - ${tier}`);
    res.json({ subscription: { tier, status: 'active' } });
  });

  app.post('/api/billing/cancel', (_req: Request, res: Response) => {
    log('POST /api/billing/cancel');
    res.json({
      subscription: { cancelAtPeriodEnd: true, currentPeriodEnd: mockSubscription.currentPeriodEnd },
      message: 'Subscription will be canceled at the end of the billing period',
    });
  });

  app.post('/api/billing/resume', (_req: Request, res: Response) => {
    log('POST /api/billing/resume');
    res.json({
      subscription: { cancelAtPeriodEnd: false },
      message: 'Subscription has been resumed',
    });
  });

  // ===== Legacy Cloud paths (keep for backwards compat) =====

  app.get('/api/cloud/session', (_req: Request, res: Response) => {
    log('GET /api/cloud/session');
    res.json({ authenticated: true, user: mockUser });
  });

  app.get('/api/cloud/workspaces', (_req: Request, res: Response) => {
    log('GET /api/cloud/workspaces');
    res.json({ workspaces: mockWorkspaces });
  });

  app.get('/api/cloud/workspaces/summary', (_req: Request, res: Response) => {
    log('GET /api/cloud/workspaces/summary');
    res.json({ workspaces: mockWorkspaces.map(ws => ({ id: ws.id, name: ws.name, status: ws.status })) });
  });

  app.get('/api/cloud/workspaces/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/cloud/workspaces/${id}`);
    const workspace = mockWorkspaces.find(ws => ws.id === id);
    if (workspace) { res.json(workspace); } else { res.status(404).json({ error: 'Workspace not found' }); }
  });

  app.get('/api/cloud/workspaces/:id/settings', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/cloud/workspaces/${id}/settings`);
    res.json({ workspace: mockWorkspaces.find(ws => ws.id === id) || mockWorkspaces[0], repos: mockRepos, providers: mockProviders, domains: [] });
  });

  app.get('/api/cloud/workspaces/:id/team', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/cloud/workspaces/${id}/team`);
    res.json({ members: [{ id: mockUser.id, email: mockUser.email, displayName: mockUser.displayName, role: 'owner', joinedAt: mockUser.createdAt }], invitations: [] });
  });

  app.get('/api/cloud/billing/plans', (_req: Request, res: Response) => {
    log('GET /api/cloud/billing/plans');
    res.json({ plans: mockBillingPlans });
  });

  app.get('/api/cloud/billing/subscription', (_req: Request, res: Response) => {
    log('GET /api/cloud/billing/subscription');
    res.json({ tier: mockSubscription.tier, subscription: mockSubscription });
  });

  app.get('/api/cloud/billing/invoices', (_req: Request, res: Response) => {
    log('GET /api/cloud/billing/invoices');
    res.json({ invoices: mockInvoices });
  });

  // ===== Usage =====

  app.get('/api/usage', (_req: Request, res: Response) => {
    log('GET /api/usage');
    res.json({
      success: true,
      usage: {
        apiCalls: 1250,
        tokens: 450000,
        storage: 256000000,
        period: {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString(),
        },
      },
    });
  });

  // ===== Workspace Proxy (cloud mode) =====
  // In cloud mode, non-cloud-native API requests are routed through
  // /api/workspaces/:id/proxy/<path> — re-route them to mock handlers.

  app.all('/api/workspaces/:workspaceId/proxy/{*proxyPath}', (req: Request, res: Response) => {
    const proxyPath = (req.params as Record<string, string>).proxyPath || (req.params as Record<string, string>)['0'] || '';
    const mockPath = `/api/${proxyPath}`;
    log(`PROXY ${req.method} ${req.originalUrl} -> ${mockPath}`);

    // Re-write the URL and re-dispatch through Express router
    req.url = mockPath;
    (app as unknown as { handle(req: Request, res: Response, next: () => void): void }).handle(req, res, () => {
      // If no route matched, return 404
      res.status(404).json({ error: `Mock proxy: no handler for ${req.method} ${mockPath}` });
    });
  });

  // ===== Relaycast compatibility (v1 API) =====

  app.get('/v1/workspace', (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    log(`GET /v1/workspace - auth: ${auth ? 'present' : 'missing'}`);
    if (!auth?.startsWith('Bearer rk_live_')) {
      res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } });
      return;
    }
    res.json({
      ok: true,
      data: {
        id: mockWorkspaces[0].id,
        name: mockWorkspaces[0].name,
        status: 'active',
      },
    });
  });

  console.log('[mock] Mock API routes registered');
}
