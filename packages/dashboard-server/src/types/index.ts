/**
 * Dashboard Server Types
 *
 * Core interfaces and types for the dashboard server.
 */

import type { Express } from 'express';
import type { Server } from 'http';
import type { WebSocketServer } from 'ws';

/**
 * Options for the proxy/mock server (simpler mode)
 */
export interface ProxyServerOptions {
  /** Port to listen on (default: 3888) */
  port?: number;
  /** Relay broker URL to proxy to (default: http://localhost:3889) */
  relayUrl?: string;
  /** Path to static files directory (default: ../out) */
  staticDir?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Run in mock mode (no relay broker required) */
  mock?: boolean;
  /** CORS allowed origins (comma-separated, or '*' for all) */
  corsOrigins?: string;
  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout?: number;
}

/**
 * Dashboard server instance (returned by proxy server)
 */
export interface DashboardServer {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
  mode: 'proxy' | 'standalone' | 'mock';
}

/**
 * Agent state tracking
 */
export interface AgentState {
  name: string;
  status: 'idle' | 'working' | 'waiting' | 'error';
  lastSeen: string;
  lastUpdated: string;
  currentTask?: string;
  completedTasks?: string[];
  context?: string;
}

/**
 * Channel record for tracking channel state
 */
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

/**
 * Thread metadata for conversation threading
 */
export interface ThreadMetadata {
  threadId: string;
  parentId?: string;
  replyCount?: number;
  lastReplyAt?: string;
  participants?: string[];
}

