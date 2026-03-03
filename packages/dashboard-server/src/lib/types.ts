/**
 * Shared types for the dashboard server.
 */

import type { Express } from 'express';
import type { Server } from 'http';
import type { WebSocketServer } from 'ws';
import type { AgentStatus, Message, RelaycastConfig } from '../relaycast-provider.js';

export type DashboardMode = 'proxy' | 'standalone' | 'mock';

export interface DashboardSnapshot {
  agents: AgentStatus[];
  users: AgentStatus[];
  messages: Message[];
  activity: Message[];
  sessions: Array<Record<string, unknown>>;
  summaries: Array<Record<string, unknown>>;
}

export interface DashboardChannel {
  id: string;
  name: string;
  description?: string;
  topic?: string;
  visibility: 'public' | 'private';
  status: 'active' | 'archived';
  createdAt: string;
  createdBy: string;
  memberCount: number;
  unreadCount: number;
  hasMentions: boolean;
  isDm: boolean;
}

export interface FileSearchResult {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface SpawnedAgentSummary {
  name: string;
  cli: string;
  model?: string;
  cwd?: string;
  pid?: number;
  online?: boolean;
}

export interface SpawnedAgentNamesResult {
  names: Set<string>;
  agents: SpawnedAgentSummary[];
  hasSpawnedList: boolean;
}

export interface LocalStateAgentSummary {
  name: string;
  cli: string;
  startedAt: string;
  online: boolean;
  pid?: number;
  cwd?: string;
}

export const EMPTY_DASHBOARD_SNAPSHOT: DashboardSnapshot = {
  agents: [],
  users: [],
  messages: [],
  activity: [],
  sessions: [],
  summaries: [],
};

export interface DashboardServerOptions {
  /** Port to listen on (default: 3888) */
  port?: number;
  /** Relay broker URL for proxy mode */
  relayUrl?: string;
  /** Path to static files directory (default: ../out) */
  staticDir?: string;
  /** Data directory containing relaycast.json credentials */
  dataDir?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Run in mock mode (no relay broker required) */
  mock?: boolean;
  /** CORS allowed origins (comma-separated, or '*' for all) */
  corsOrigins?: string;
  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout?: number;
}

export interface DashboardServer {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
  mode: DashboardMode;
}

/**
 * Shared context passed to route registration functions.
 */
export interface RouteContext {
  mode: DashboardMode;
  dataDir: string;
  staticDir: string;
  verbose: boolean;
  relayUrl: string | undefined;
  brokerProxyEnabled: boolean;
  resolveRelaycastConfig: () => RelaycastConfig | null;
  getRelaycastSnapshot: () => Promise<DashboardSnapshot>;
  getRelaycastChannels: () => Promise<{ channels: DashboardChannel[]; archivedChannels: DashboardChannel[] }>;
  sendRelaycastMessage: (params: { to: string; message: string; from?: string; thread?: string }) => Promise<
    { success: true; messageId: string } | { success: false; status: number; error: string }
  >;
  getSpawnedAgents: () => Promise<{ names: Set<string> | null; agents: SpawnedAgentSummary[] | null }>;
  getLocalAgentNames: () => Set<string> | null;
  filterPhantomAgents: (
    agents: AgentStatus[],
    spawnedAgentNames: Set<string> | null,
    localAgentNames: Set<string> | null,
  ) => AgentStatus[];
}
