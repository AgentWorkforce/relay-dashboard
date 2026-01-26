/**
 * Mock API Routes
 *
 * Provides mock API endpoints that return fixture data.
 * Used when running the dashboard in standalone/demo mode.
 */

import type { Express, Request, Response } from 'express';
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
    const { to, content } = req.body || {};
    log(`POST /api/send - to: ${to}`);

    if (!to || !content) {
      res.status(400).json({ success: false, error: 'Missing to or content' });
      return;
    }

    res.json({
      success: true,
      messageId: `mock-msg-${Date.now()}`,
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

  app.get('/api/channels', (_req: Request, res: Response) => {
    log('GET /api/channels');
    res.json({
      success: true,
      channels: mockChannels,
    });
  });

  app.post('/api/channels', (req: Request, res: Response) => {
    const { name, description } = req.body || {};
    log(`POST /api/channels - ${name}`);

    if (!name) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    res.json({
      success: true,
      channel: {
        id: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        description,
        memberCount: 1,
        isPrivate: false,
        createdAt: new Date().toISOString(),
      },
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

  app.post('/api/channels/:channel/leave', (req: Request, res: Response) => {
    const { channel } = req.params;
    log(`POST /api/channels/${channel}/leave`);
    res.json({ success: true });
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

  // ===== Cloud/Auth =====

  app.get('/api/cloud/session', (_req: Request, res: Response) => {
    log('GET /api/cloud/session');
    res.json({
      authenticated: true,
      user: mockUser,
    });
  });

  app.get('/api/cloud/workspaces', (_req: Request, res: Response) => {
    log('GET /api/cloud/workspaces');
    res.json({
      workspaces: mockWorkspaces,
    });
  });

  app.get('/api/cloud/workspaces/summary', (_req: Request, res: Response) => {
    log('GET /api/cloud/workspaces/summary');
    res.json({
      workspaces: mockWorkspaces.map(ws => ({
        id: ws.id,
        name: ws.name,
        status: ws.status,
      })),
    });
  });

  app.get('/api/cloud/workspaces/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/cloud/workspaces/${id}`);
    const workspace = mockWorkspaces.find(ws => ws.id === id);
    if (workspace) {
      res.json(workspace);
    } else {
      res.status(404).json({ error: 'Workspace not found' });
    }
  });

  app.get('/api/cloud/workspaces/:id/settings', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/cloud/workspaces/${id}/settings`);
    res.json({
      workspace: mockWorkspaces.find(ws => ws.id === id) || mockWorkspaces[0],
      repos: [],
      providers: [],
      domains: [],
    });
  });

  app.get('/api/cloud/workspaces/:id/team', (req: Request, res: Response) => {
    const { id } = req.params;
    log(`GET /api/cloud/workspaces/${id}/team`);
    res.json({
      members: [
        {
          id: mockUser.id,
          email: mockUser.email,
          displayName: mockUser.displayName,
          role: 'owner',
          joinedAt: mockUser.createdAt,
        },
      ],
      invitations: [],
    });
  });

  // ===== Billing =====

  app.get('/api/cloud/billing/plans', (_req: Request, res: Response) => {
    log('GET /api/cloud/billing/plans');
    res.json({
      plans: mockBillingPlans,
    });
  });

  app.get('/api/cloud/billing/subscription', (_req: Request, res: Response) => {
    log('GET /api/cloud/billing/subscription');
    res.json({
      tier: mockSubscription.tier,
      subscription: mockSubscription,
    });
  });

  app.get('/api/cloud/billing/invoices', (_req: Request, res: Response) => {
    log('GET /api/cloud/billing/invoices');
    res.json({
      invoices: mockInvoices,
    });
  });

  app.post('/api/cloud/billing/checkout', (req: Request, res: Response) => {
    const { tier, interval } = req.body || {};
    log(`POST /api/cloud/billing/checkout - ${tier} (${interval})`);
    res.json({
      checkoutUrl: '#mock-checkout',
    });
  });

  app.post('/api/cloud/billing/portal', (_req: Request, res: Response) => {
    log('POST /api/cloud/billing/portal');
    res.json({
      portalUrl: '#mock-portal',
    });
  });

  app.post('/api/cloud/billing/cancel', (_req: Request, res: Response) => {
    log('POST /api/cloud/billing/cancel');
    res.json({
      success: true,
      message: 'Subscription will be canceled at the end of the billing period',
    });
  });

  app.post('/api/cloud/billing/resume', (_req: Request, res: Response) => {
    log('POST /api/cloud/billing/resume');
    res.json({
      success: true,
      message: 'Subscription has been resumed',
    });
  });

  console.log('[mock] Mock API routes registered');
}
