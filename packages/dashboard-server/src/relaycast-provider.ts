/**
 * Relaycast data provider for dashboard-server.
 *
 * When the broker writes credentials to `.agent-relay/relaycast.json`,
 * the dashboard can fetch agent and message data directly from the
 * Relaycast API instead of reading team.json / agents.json / inbox files.
 *
 * Uses @agent-relay/sdk's WorkspaceReader — the dashboard is a pure
 * presentation layer and delegates all data access to the SDK.
 */

import fs from 'fs';
import path from 'path';
import { createWorkspaceReader, type WorkspaceReader } from '@agent-relay/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelaycastConfig {
  apiKey: string;
  baseUrl: string;
}

/** Dashboard AgentStatus (matches server.ts interface) */
export interface AgentStatus {
  name: string;
  role: string;
  cli: string;
  messageCount: number;
  status?: string;
  lastActive?: string;
  lastSeen?: string;
  needsAttention?: boolean;
  isProcessing?: boolean;
  processingStartedAt?: number;
  isSpawned?: boolean;
  team?: string;
  avatarUrl?: string;
  model?: string;
  cwd?: string;
}

/** Dashboard Message (matches server.ts interface) */
export interface Message {
  from: string;
  to: string;
  content: string;
  timestamp: string;
  id: string;
  thread?: string;
  isBroadcast?: boolean;
  status?: string;
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

/**
 * Try to load Relaycast credentials from `<dataDir>/relaycast.json`.
 * Returns null if the file doesn't exist or is invalid.
 */
export function loadRelaycastConfig(dataDir: string): RelaycastConfig | null {
  const credPath = path.join(dataDir, 'relaycast.json');
  if (!fs.existsSync(credPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    const apiKey = raw.api_key as string | undefined;
    if (!apiKey) return null;

    // Align with relay-cloud: env override → default production URL
    const baseUrl = process.env.RELAYCAST_API_URL || 'https://api.relaycast.dev';

    return { apiKey, baseUrl };
  } catch {
    return null;
  }
}

/**
 * Create a WorkspaceReader from config.
 */
export function createReader(config: RelaycastConfig): WorkspaceReader {
  return createWorkspaceReader({ apiKey: config.apiKey, baseUrl: config.baseUrl });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all agents from the Relaycast workspace and map them to dashboard AgentStatus[].
 * Same pattern as relay-cloud's /api/data endpoint.
 */
export async function fetchAgents(config: RelaycastConfig): Promise<AgentStatus[]> {
  try {
    const reader = createReader(config);
    const agents = await reader.listAgents();

    return agents
      .filter((a) => a.type !== 'human')
      .map((a) => {
        const meta = a.metadata || {};
        return {
          name: a.name,
          role: (meta.role as string) || 'Agent',
          cli: (meta.cli as string) || 'unknown',
          messageCount: 0,
          status: a.status === 'online' ? 'online' : 'offline',
          lastSeen: a.last_seen ?? undefined,
          lastActive: a.last_seen ?? undefined,
          team: (meta.team as string) || undefined,
          needsAttention: false,
        };
      });
  } catch (err) {
    console.warn('[relaycast-provider] Failed to fetch agents:', (err as Error).message);
    return [];
  }
}

/**
 * Fetch messages from a single channel, mapped to dashboard Message[].
 */
async function fetchChannelMessages(
  reader: WorkspaceReader,
  channelName: string,
): Promise<Message[]> {
  try {
    const msgs = await reader.listMessages(channelName, { limit: 100 });

    return msgs.map((m) => ({
      from: m.agent_name,
      to: `#${channelName}`,
      content: m.text,
      timestamp: m.created_at,
      id: m.id,
      thread: undefined,
    }));
  } catch (err) {
    console.warn(`[relaycast-provider] Failed to fetch messages for #${channelName}:`, (err as Error).message);
    return [];
  }
}

/**
 * Fetch messages from ALL channels, merged and sorted oldest-first.
 */
export async function fetchAllMessages(config: RelaycastConfig): Promise<Message[]> {
  try {
    const reader = createReader(config);
    const channels = await reader.listChannels();
    if (channels.length === 0) return [];

    // Fetch in parallel
    const results = await Promise.all(
      channels.map((ch) => fetchChannelMessages(reader, ch.name)),
    );

    const all = results.flat();
    // Sort oldest first (dashboard convention)
    all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return all;
  } catch (err) {
    console.warn('[relaycast-provider] Failed to fetch messages:', (err as Error).message);
    return [];
  }
}
