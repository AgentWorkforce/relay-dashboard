/**
 * Dashboard Server Types
 *
 * Core interfaces and types for the dashboard server.
 */

import type { Express } from 'express';
import type { Server } from 'http';
import type { WebSocketServer } from 'ws';
import type { RelayAdapter } from '@agent-relay/broker-sdk';

/**
 * Interface for spawn manager read operations.
 * When the daemon's SpawnManager is passed in, the dashboard uses it
 * for read operations (logs, worker listing) instead of creating its own AgentSpawner.
 * Spawn/release go through the SDK client → daemon socket.
 */
export interface SpawnManagerLike {
  hasWorker(name: string): boolean;
  getWorkerOutput(name: string, limit?: number): string[] | undefined;
  getWorkerRawOutput(name: string): string | undefined;
  getActiveWorkers(): Array<{
    name: string;
    cli: string;
    task: string;
    team?: string;
    spawnerName?: string;
    spawnedAt: number;
    pid?: number;
  }>;
  sendWorkerInput(name: string, data: string): boolean | Promise<boolean>;
}

/**
 * Options for starting the dashboard server
 */
export interface DashboardOptions {
  /** Port to listen on */
  port: number;
  /** Data directory for storage */
  dataDir: string;
  /** Team directory for configuration */
  teamDir: string;
  /** Path to SQLite database (defaults to dataDir/messages.sqlite - same as daemon) */
  dbPath?: string;
  /** Enable agent spawning API */
  enableSpawner?: boolean;
  /** Project root for spawner (defaults to dataDir) */
  projectRoot?: string;
  /** Tmux session name for workers */
  tmuxSession?: string;
  /** Enable verbose logging (WebSocket connections, broadcasts, etc.) */
  verbose?: boolean;
  /**
   * Callback to mark an agent as spawning (before HELLO completes).
   * Messages sent to this agent will be queued for delivery after registration.
   */
  onMarkSpawning?: (agentName: string) => void;
  /**
   * Callback to clear the spawning flag for an agent.
   * Called when spawn fails or is cancelled.
   */
  onClearSpawning?: (agentName: string) => void;
  /**
   * Daemon's SpawnManager instance for read operations (logs, worker listing).
   * When provided, spawn/release go through the SDK client instead of a local AgentSpawner.
   * This solves relay-pty binary resolution issues in npx/global installs.
   */
  spawnManager?: SpawnManagerLike;
  /**
   * RelayAdapter instance for broker SDK mode.
   * When provided, replaces socket-based RelayClient, AgentSpawner,
   * and MultiProjectClient with the broker binary via stdio.
   */
  relayAdapter?: RelayAdapter;
}

/**
 * Options for the proxy/mock server (simpler mode)
 */
export interface ProxyServerOptions {
  /** Port to listen on (default: 3888) */
  port?: number;
  /** Relay daemon URL to proxy to (default: http://localhost:3889) */
  relayUrl?: string;
  /** Path to static files directory (default: ../out) */
  staticDir?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Run in mock mode (no relay daemon required) */
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
  mode: 'proxy' | 'mock';
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

/**
 * Server context passed to route handlers
 */
export interface ServerContext {
  /** Data directory */
  dataDir: string;
  /** Team directory */
  teamDir: string;
  /** Database path */
  dbPath?: string;
  /** Project root */
  projectRoot?: string;
  /** Default workspace ID */
  defaultWorkspaceId?: string;
  /** Enable spawner */
  enableSpawner?: boolean;
  /** Spawn callbacks */
  onMarkSpawning?: (name: string) => void;
  onClearSpawning?: (name: string) => void;
}
