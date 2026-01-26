/**
 * Server Types
 *
 * Shared types for the dashboard server, matching the protocol types
 * used by the relay daemon.
 */

export interface Agent {
  name: string;
  status: 'online' | 'offline' | 'busy' | 'idle';
  cli?: string;
  currentTask?: string;
  lastActive?: string;
  messageCount?: number;
  projectPath?: string;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  thread?: string;
  isBroadcast?: boolean;
  isUrgent?: boolean;
  status?: string;
  data?: Record<string, unknown>;
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
}

export interface Session {
  id: string;
  agentName: string;
  cli?: string;
  startedAt: string;
  endedAt?: string;
  messageCount: number;
  isActive: boolean;
  closedBy?: 'agent' | 'disconnect' | 'error';
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  isPrivate: boolean;
  createdAt: string;
}

export interface Decision {
  id: string;
  agentName: string;
  title: string;
  description: string;
  options?: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  category: 'approval' | 'choice' | 'input' | 'confirmation';
  createdAt: string;
  expiresAt?: string;
}

export interface Task {
  id: string;
  agentName: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  assignedAt?: string;
  completedAt?: string;
  result?: string;
}

export interface FleetStats {
  totalAgents: number;
  onlineAgents: number;
  busyAgents: number;
  pendingDecisions: number;
  activeTasks: number;
}

export interface FleetServer {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'offline';
  agents: Array<{ name: string; status: string }>;
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: number;
  uptime: number;
  lastHeartbeat: string;
}

export interface DashboardData {
  agents: Agent[];
  messages: Message[];
  sessions?: Session[];
}

export interface HistorySession extends Session {
  duration: string;
  summary?: string;
}

export interface HistoryStats {
  messageCount: number;
  sessionCount: number;
  activeSessions: number;
  uniqueAgents: number;
  oldestMessageDate: string | null;
}

export interface FileSearchResult {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface Conversation {
  participants: string[];
  lastMessage: string;
  lastTimestamp: string;
  messageCount: number;
}
