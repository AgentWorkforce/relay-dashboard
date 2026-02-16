/**
 * Mock Data Fixtures
 *
 * Provides realistic mock data for standalone dashboard testing.
 * Enables the dashboard to run without a relay daemon connection.
 */

import type { Agent, Message, Session } from './types.js';

// ===== Agents =====

export const mockAgents: Agent[] = [
  {
    name: 'claude-1',
    status: 'online',
    cli: 'claude-code',
    currentTask: 'Implementing user authentication',
    lastActive: new Date(Date.now() - 60000).toISOString(),
    messageCount: 42,
    projectPath: '/Users/dev/projects/webapp',
  },
  {
    name: 'architect',
    status: 'busy',
    cli: 'claude-code',
    currentTask: 'Designing API schema',
    lastActive: new Date(Date.now() - 30000).toISOString(),
    messageCount: 28,
    projectPath: '/Users/dev/projects/api-service',
  },
  {
    name: 'reviewer',
    status: 'online',
    cli: 'claude-code',
    currentTask: 'Reviewing pull requests',
    lastActive: new Date(Date.now() - 120000).toISOString(),
    messageCount: 15,
    projectPath: '/Users/dev/projects/webapp',
  },
  {
    name: 'tester',
    status: 'offline',
    cli: 'claude-code',
    lastActive: new Date(Date.now() - 3600000).toISOString(),
    messageCount: 8,
    projectPath: '/Users/dev/projects/webapp',
  },
];

// ===== Messages =====

export const mockMessages: Message[] = [
  {
    id: 'msg-001',
    from: 'user',
    to: 'claude-1',
    content: 'Please implement user authentication with JWT tokens',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    reactions: [
      { emoji: '👍', count: 2, agents: ['claude-1', 'architect'] },
      { emoji: '🚀', count: 1, agents: ['reviewer'] },
    ],
  },
  {
    id: 'msg-002',
    from: 'claude-1',
    to: 'user',
    content: 'I\'ll implement JWT authentication. Let me start by creating the auth middleware.',
    timestamp: new Date(Date.now() - 295000).toISOString(),
    thread: 'msg-001',
    reactions: [
      { emoji: '✅', count: 1, agents: ['user'] },
    ],
  },
  {
    id: 'msg-003',
    from: 'claude-1',
    to: 'architect',
    content: 'What\'s the preferred token expiration time for the JWT implementation?',
    timestamp: new Date(Date.now() - 290000).toISOString(),
    replyCount: 2,
  },
  {
    id: 'msg-004',
    from: 'architect',
    to: 'claude-1',
    content: 'Use 15 minutes for access tokens and 7 days for refresh tokens.',
    timestamp: new Date(Date.now() - 280000).toISOString(),
    thread: 'msg-003',
  },
  {
    id: 'msg-004b',
    from: 'claude-1',
    to: 'architect',
    content: 'Got it, implementing with those values. Will add refresh token rotation too.',
    timestamp: new Date(Date.now() - 270000).toISOString(),
    thread: 'msg-003',
    reactions: [
      { emoji: '👍', count: 1, agents: ['architect'] },
    ],
  },
  {
    id: 'msg-005',
    from: 'reviewer',
    to: '*',
    content: 'PR #42 has been reviewed. Ready for merge.',
    timestamp: new Date(Date.now() - 200000).toISOString(),
    isBroadcast: true,
    reactions: [
      { emoji: '🎉', count: 3, agents: ['user', 'claude-1', 'architect'] },
      { emoji: '👏', count: 1, agents: ['user'] },
    ],
  },
];

// ===== Sessions =====

export const mockSessions: Session[] = [
  {
    id: 'session-001',
    agentName: 'claude-1',
    cli: 'claude-code',
    startedAt: new Date(Date.now() - 7200000).toISOString(),
    messageCount: 42,
    isActive: true,
  },
  {
    id: 'session-002',
    agentName: 'architect',
    cli: 'claude-code',
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    messageCount: 28,
    isActive: true,
  },
  {
    id: 'session-003',
    agentName: 'reviewer',
    cli: 'claude-code',
    startedAt: new Date(Date.now() - 1800000).toISOString(),
    messageCount: 15,
    isActive: true,
  },
  {
    id: 'session-004',
    agentName: 'tester',
    cli: 'claude-code',
    startedAt: new Date(Date.now() - 86400000).toISOString(),
    endedAt: new Date(Date.now() - 82800000).toISOString(),
    messageCount: 8,
    isActive: false,
    closedBy: 'agent',
  },
];

// ===== Channels =====

export const mockChannels = [
  {
    id: 'general',
    name: 'general',
    description: 'General discussion channel',
    memberCount: 4,
    isPrivate: false,
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
  {
    id: 'development',
    name: 'development',
    description: 'Development updates and discussions',
    memberCount: 3,
    isPrivate: false,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 'reviews',
    name: 'reviews',
    description: 'Code review discussions',
    memberCount: 2,
    isPrivate: false,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
];

// ===== Decisions =====

export const mockDecisions = [
  {
    id: 'decision-001',
    agentName: 'claude-1',
    title: 'Database Migration Approval',
    description: 'Ready to run database migration that adds user_preferences table.',
    options: [
      { id: 'approve', label: 'Approve', description: 'Run the migration' },
      { id: 'reject', label: 'Reject', description: 'Cancel the migration' },
    ],
    urgency: 'medium' as const,
    category: 'approval' as const,
    createdAt: new Date(Date.now() - 60000).toISOString(),
  },
  {
    id: 'decision-002',
    agentName: 'architect',
    title: 'API Design Choice',
    description: 'Which authentication method should we use for the new API?',
    options: [
      { id: 'jwt', label: 'JWT', description: 'Stateless token-based auth' },
      { id: 'session', label: 'Session', description: 'Server-side session storage' },
      { id: 'oauth', label: 'OAuth 2.0', description: 'Delegated authentication' },
    ],
    urgency: 'high' as const,
    category: 'choice' as const,
    createdAt: new Date(Date.now() - 120000).toISOString(),
  },
];

// ===== Tasks =====

export const mockTasks = [
  {
    id: 'task-001',
    agentName: 'claude-1',
    title: 'Implement user authentication',
    description: 'Add JWT-based authentication to the API',
    priority: 'high' as const,
    status: 'in_progress' as const,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    assignedAt: new Date(Date.now() - 3500000).toISOString(),
  },
  {
    id: 'task-002',
    agentName: 'reviewer',
    title: 'Review PR #42',
    description: 'Code review for authentication feature',
    priority: 'medium' as const,
    status: 'completed' as const,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    assignedAt: new Date(Date.now() - 7100000).toISOString(),
    completedAt: new Date(Date.now() - 200000).toISOString(),
    result: 'Approved with minor suggestions',
  },
  {
    id: 'task-003',
    agentName: 'tester',
    title: 'Write integration tests',
    description: 'Create integration tests for auth endpoints',
    priority: 'medium' as const,
    status: 'pending' as const,
    createdAt: new Date(Date.now() - 1800000).toISOString(),
  },
];

// ===== Fleet =====

export const mockFleetStats = {
  totalAgents: 4,
  onlineAgents: 3,
  busyAgents: 1,
  pendingDecisions: 2,
  activeTasks: 2,
};

export const mockFleetServers = [
  {
    id: 'server-1',
    name: 'local',
    status: 'healthy' as const,
    agents: mockAgents.slice(0, 2).map(a => ({ name: a.name, status: a.status })),
    cpuUsage: 45,
    memoryUsage: 62,
    activeConnections: 3,
    uptime: 86400,
    lastHeartbeat: new Date().toISOString(),
  },
];

// ===== Metrics =====

const onlineAgentCount = mockAgents.filter(a => a.status !== 'offline').length;
const offlineAgentCount = mockAgents.filter(a => a.status === 'offline').length;

export const mockMetrics = {
  // Top-level metrics expected by metrics page
  timestamp: new Date().toISOString(),
  totalAgents: mockAgents.length,
  onlineAgents: onlineAgentCount,
  offlineAgents: offlineAgentCount,
  totalMessages: 1247,
  throughput: {
    messagesLastMinute: 3,
    messagesLastHour: 87,
    messagesLast24Hours: 1247,
    avgMessagesPerMinute: 0.87,
  },
  // Agent-level metrics
  agents: mockAgents.map(a => ({
    name: a.name,
    isOnline: a.status !== 'offline',
    messagesSent: Math.floor(Math.random() * 100),
    messagesReceived: Math.floor(Math.random() * 100),
    firstSeen: new Date(Date.now() - 86400000 * 7).toISOString(),
    lastSeen: a.lastActive || new Date().toISOString(),
    uptimeSeconds: Math.floor(Math.random() * 86400),
  })),
  // Session metrics
  sessions: {
    totalSessions: mockSessions.length,
    activeSessions: mockSessions.filter(s => s.isActive).length,
    closedByAgent: 1,
    closedByDisconnect: 0,
    closedByError: 0,
    errorRate: 0,
    recentSessions: mockSessions.slice(0, 5).map(s => ({
      agentName: s.agentName,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      messageCount: s.messageCount,
      closedBy: s.closedBy,
    })),
  },
  // Legacy structure for compatibility
  system: {
    totalAgents: mockAgents.length,
    onlineAgents: onlineAgentCount,
    totalMessages: 1247,
    totalSessions: mockSessions.length,
    activeSessions: mockSessions.filter(s => s.isActive).length,
  },
};

// ===== History =====

export const mockHistorySessions = mockSessions.map(s => ({
  ...s,
  duration: s.endedAt
    ? `${Math.floor((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)}m`
    : `${Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 60000)}m`,
  summary: `Session for ${s.agentName}`,
}));

export const mockHistoryStats = {
  messageCount: mockMessages.length,
  sessionCount: mockSessions.length,
  activeSessions: mockSessions.filter(s => s.isActive).length,
  uniqueAgents: new Set(mockAgents.map(a => a.name)).size,
  oldestMessageDate: mockMessages.length > 0
    ? mockMessages.reduce((oldest, m) =>
        new Date(m.timestamp) < new Date(oldest.timestamp) ? m : oldest
      ).timestamp
    : null,
};

// ===== Spawned Agents =====

export const mockSpawnedAgents = [
  {
    name: 'claude-1',
    cli: 'claude-code',
    startedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    name: 'architect',
    cli: 'claude-code',
    startedAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

// ===== Files =====

export const mockFiles = [
  { path: '/src/index.ts', name: 'index.ts', isDirectory: false },
  { path: '/src/app.ts', name: 'app.ts', isDirectory: false },
  { path: '/src/components', name: 'components', isDirectory: true },
  { path: '/src/components/App.tsx', name: 'App.tsx', isDirectory: false },
  { path: '/src/lib', name: 'lib', isDirectory: true },
  { path: '/src/lib/api.ts', name: 'api.ts', isDirectory: false },
  { path: '/package.json', name: 'package.json', isDirectory: false },
  { path: '/tsconfig.json', name: 'tsconfig.json', isDirectory: false },
];

// ===== Conversations =====

export const mockConversations = [
  {
    participants: ['user', 'claude-1'],
    lastMessage: 'I\'ll implement JWT authentication. Let me start by creating the auth middleware.',
    lastTimestamp: new Date(Date.now() - 295000).toISOString(),
    messageCount: 2,
  },
  {
    participants: ['claude-1', 'architect'],
    lastMessage: 'Use 15 minutes for access tokens and 7 days for refresh tokens.',
    lastTimestamp: new Date(Date.now() - 280000).toISOString(),
    messageCount: 2,
  },
];

// ===== Billing =====

export const mockBillingPlans = [
  {
    tier: 'free',
    name: 'Free',
    description: 'Get started with basic features',
    price: { monthly: 0, yearly: 0 },
    features: [
      '1 workspace',
      '2 agents',
      'Basic messaging',
      'Community support',
    ],
    limits: { workspaces: 1, agents: 2, messagesPerDay: 100 },
  },
  {
    tier: 'pro',
    name: 'Pro',
    description: 'For individual developers and small teams',
    price: { monthly: 29, yearly: 278 },
    features: [
      '5 workspaces',
      '10 agents',
      'Unlimited messaging',
      'Priority support',
      'Advanced analytics',
    ],
    limits: { workspaces: 5, agents: 10, messagesPerDay: -1 },
    recommended: true,
  },
  {
    tier: 'team',
    name: 'Team',
    description: 'For growing teams with collaboration needs',
    price: { monthly: 79, yearly: 758 },
    features: [
      'Unlimited workspaces',
      '50 agents',
      'Unlimited messaging',
      'Team management',
      'SSO integration',
      'Dedicated support',
    ],
    limits: { workspaces: -1, agents: 50, messagesPerDay: -1 },
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    description: 'Custom solutions for large organizations',
    price: { monthly: 0, yearly: 0 },
    features: [
      'Unlimited everything',
      'Custom integrations',
      'SLA guarantee',
      'Dedicated account manager',
      'On-premise deployment',
    ],
    limits: { workspaces: -1, agents: -1, messagesPerDay: -1 },
  },
];

export const mockSubscription = {
  id: 'sub_mock123',
  tier: 'pro',
  status: 'active',
  currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
  currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
  cancelAtPeriodEnd: false,
  interval: 'month' as const,
};

export const mockInvoices = [
  {
    id: 'inv_001',
    number: 'INV-2024-001',
    amount: 2900,
    status: 'paid',
    date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    pdfUrl: '#',
  },
  {
    id: 'inv_002',
    number: 'INV-2024-002',
    amount: 2900,
    status: 'paid',
    date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    pdfUrl: '#',
  },
  {
    id: 'inv_003',
    number: 'INV-2024-003',
    amount: 2900,
    status: 'paid',
    date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    pdfUrl: '#',
  },
];

// ===== Cloud/Workspace =====

export const mockWorkspaces = [
  {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'Development',
    status: 'running',
    publicUrl: 'http://localhost:3889',
    providers: ['anthropic', 'codex'],
    repositories: ['demo-user/webapp', 'demo-user/api-service'],
    accessType: 'owner' as const,
    permission: 'admin' as const,
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    name: 'Production',
    status: 'stopped',
    providers: ['anthropic'],
    repositories: ['demo-user/webapp'],
    accessType: 'owner' as const,
    permission: 'admin' as const,
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export const mockUser = {
  id: 'user_mock1',
  githubUsername: 'demo-user',
  email: 'demo@agent-relay.com',
  displayName: 'Demo User',
  avatarUrl: null,
  plan: 'pro',
  connectedProviders: [
    { provider: 'anthropic', email: 'demo@agent-relay.com', connectedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() },
  ],
  pendingInvites: 0,
  onboardingCompleted: true,
  createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
};

// ===== GitHub Repos =====

export const mockRepos = [
  {
    id: 'repo_1',
    fullName: 'demo-user/webapp',
    isPrivate: false,
    defaultBranch: 'main',
    syncStatus: 'synced',
    hasNangoConnection: true,
    lastSyncedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'repo_2',
    fullName: 'demo-user/api-service',
    isPrivate: true,
    defaultBranch: 'main',
    syncStatus: 'synced',
    hasNangoConnection: true,
    lastSyncedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'repo_3',
    fullName: 'demo-user/docs',
    isPrivate: false,
    defaultBranch: 'main',
    syncStatus: 'pending',
    hasNangoConnection: true,
  },
];

// ===== Providers =====

export const mockProviders = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    displayName: 'Claude',
    description: 'Claude AI by Anthropic',
    color: '#D97757',
    authStrategy: 'api_key',
    cliCommand: 'claude',
    isConnected: true,
    connectedAs: 'demo@agent-relay.com',
    connectedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'codex',
    name: 'OpenAI',
    displayName: 'Codex',
    description: 'Codex CLI by OpenAI',
    color: '#10A37F',
    authStrategy: 'device_flow',
    cliCommand: 'codex login',
    isConnected: false,
  },
  {
    id: 'google',
    name: 'Google',
    displayName: 'Gemini',
    description: 'Gemini by Google',
    color: '#4285F4',
    authStrategy: 'oauth',
    cliCommand: 'gemini',
    isConnected: false,
  },
];
