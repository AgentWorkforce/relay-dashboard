/**
 * Pure utility functions and constants extracted from proxy-server.ts.
 */

import fs from 'fs';
import os from 'node:os';
import path from 'path';
import type { Response } from 'express';
import { loadTeamsConfig } from '@agent-relay/config';
import type { DashboardChannel } from './types.js';

/**
 * Returns the current OS username, falling back to `fallback` if os.userInfo()
 * throws (e.g. in containers where the UID has no /etc/passwd entry).
 */
export function safeUsername(fallback = 'Dashboard'): string {
  try {
    const name = os.userInfo().username;
    if (name) return name;
  } catch {
    // no-op — fall through to fallback
  }
  return fallback;
}

export const PHANTOM_OFFLINE_MAX_AGE_MS = 5 * 60 * 1000;
export const SPAWNED_CACHE_TTL_MS = 3000;
export const STANDALONE_WS_POLL_MS = 3000;

export const WORKFLOW_BOOTSTRAP_TASK =
  'You are connected to Agent Relay. Wait for relay messages and respond using Relaycast MCP tools.';
export const WORKFLOW_CONVENTIONS = [
  'Messaging requirements:',
  '- When you receive `Relay message from <sender> ...`, reply using `relay_send(to: "<sender>", message: "...")`.',
  '- Send `ACK: ...` when you receive a task.',
  '- Send `DONE: ...` when the task is complete.',
  '- Do not reply only in terminal text; send the response via relay_send.',
  '- Use relay_inbox() and relay_who() when context is missing.',
].join('\n');

export function normalizeRelayUrl(relayUrl: string | undefined): string | undefined {
  if (!relayUrl) return undefined;
  const trimmed = relayUrl.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

export function withWorkflowConventions(
  task: string | undefined,
  includeWorkflowConventions: boolean,
): string | undefined {
  const normalized = typeof task === 'string' ? task.trim() : '';

  if (!includeWorkflowConventions) {
    return normalized.length > 0 ? normalized : undefined;
  }

  if (normalized.length === 0) {
    return `${WORKFLOW_BOOTSTRAP_TASK}\n\n${WORKFLOW_CONVENTIONS}`;
  }

  const lower = normalized.toLowerCase();
  const alreadyConfigured =
    lower.includes('relay_send(') || (lower.includes('ack:') && lower.includes('done:'));
  return alreadyConfigured ? normalized : `${normalized}\n\n${WORKFLOW_CONVENTIONS}`;
}

export function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function countOnlineAgents(agents: Array<{ status?: string }>): number {
  return agents.reduce((count, agent) => {
    return (agent.status ?? '').toLowerCase() === 'online' ? count + 1 : count;
  }, 0);
}

export { normalizeName } from './identity.js';

export function isDirectRecipient(target: string): boolean {
  const trimmed = target.trim();
  if (!trimmed) return false;
  return !trimmed.startsWith('#') && !trimmed.startsWith('dm:');
}

export function parseCommandDescriptor(
  rawCli: string | undefined,
  rawArgs?: unknown,
  rawModel?: string,
): { cli: string; args: string[]; model?: string } {
  const cliSource = typeof rawCli === 'string' ? rawCli.trim() : '';
  const cliTokens = cliSource ? cliSource.split(/\s+/) : [];
  const cli = cliTokens[0] ?? 'unknown';
  const inlineArgs = cliTokens.slice(1);

  const extraArgs = Array.isArray(rawArgs)
    ? rawArgs.filter((arg): arg is string => typeof arg === 'string' && arg.trim().length > 0)
    : [];

  const combinedArgs = [...inlineArgs, ...extraArgs];
  const filteredArgs: string[] = [];
  let model = typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim() : undefined;

  for (let index = 0; index < combinedArgs.length; index += 1) {
    const arg = combinedArgs[index];
    if (arg === '--model') {
      const next = combinedArgs[index + 1];
      if (!model && typeof next === 'string' && next.trim()) {
        model = next.trim();
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--model=')) {
      if (!model) {
        const value = arg.slice('--model='.length).trim();
        if (value) {
          model = value;
        }
      }
      continue;
    }
    filteredArgs.push(arg);
  }

  return { cli, args: filteredArgs, model };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeChannelTarget(channel: string): string {
  const trimmed = channel.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('#') || trimmed.startsWith('dm:')) {
    return trimmed;
  }
  return `#${trimmed}`;
}

export function normalizeChannelName(channel: string): string {
  const target = normalizeChannelTarget(channel);
  if (target.startsWith('#')) {
    return target.slice(1);
  }
  return target;
}

export function parseInviteMembers(invites: unknown): Array<{ id: string; type: 'user' | 'agent' }> {
  if (typeof invites === 'string') {
    return invites
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((id) => ({ id, type: 'agent' as const }));
  }

  if (Array.isArray(invites)) {
    return invites
      .map((item) => {
        if (typeof item === 'string') {
          const id = item.trim();
          return id ? { id, type: 'agent' as const } : null;
        }

        if (!isRecord(item) || typeof item.id !== 'string') {
          return null;
        }

        const id = item.id.trim();
        if (!id) {
          return null;
        }

        const type = item.type === 'user' ? 'user' : 'agent';
        return { id, type };
      })
      .filter((item): item is { id: string; type: 'user' | 'agent' } => item !== null);
  }

  return [];
}

export function mapChannelForDashboard(channel: {
  id: string;
  name: string;
  topic: string | null;
  member_count?: number;
  created_at: string;
  is_archived: boolean;
}): DashboardChannel {
  const channelId = channel.name.startsWith('#') ? channel.name : `#${channel.name}`;

  return {
    id: channelId,
    name: channel.name,
    description: channel.topic ?? undefined,
    topic: channel.topic ?? undefined,
    visibility: 'public',
    status: channel.is_archived ? 'archived' : 'active',
    createdAt: channel.created_at,
    createdBy: 'system',
    memberCount: channel.member_count ?? 0,
    unreadCount: 0,
    hasMentions: false,
    isDm: channel.name.startsWith('dm:'),
  };
}

export function sendHtmlFileOrFallback(
  res: Response,
  filePath: string,
  fallbackHtml?: string,
  statusIfMissing = 404,
): void {
  if (fs.existsSync(filePath)) {
    res.sendFile(path.resolve(filePath));
    return;
  }

  if (fallbackHtml) {
    res.type('html').send(fallbackHtml);
    return;
  }

  res.status(statusIfMissing).json({ error: 'Not found' });
}

/**
 * Get the host to bind to.
 * In cloud environments, bind to '::' (IPv6 any) which also accepts IPv4 on dual-stack.
 */
export function getBindHost(): string | undefined {
  if (process.env.BIND_HOST) {
    return process.env.BIND_HOST;
  }
  const isCloudEnvironment =
    process.env.FLY_APP_NAME ||
    process.env.WORKSPACE_ID ||
    process.env.RELAY_WORKSPACE_ID ||
    process.env.RUNNING_IN_DOCKER === 'true';
  return isCloudEnvironment ? '::' : undefined;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function toIsoTimestamp(epochSeconds: unknown): string {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return new Date(0).toISOString();
  }
  return new Date(epochSeconds * 1000).toISOString();
}

export interface TeamWorkerLike {
  name: string;
  team?: string;
}

export interface TeamSpawnReaderLike {
  getActiveWorkers(): TeamWorkerLike[];
}

export interface UserBridgeLike {
  isUserRegistered(username: string): boolean;
}

/**
 * Check if an agent has heartbeated recently in agents.json.
 */
export function isAgentOnline(teamDir: string, agentName: string): boolean {
  if (agentName === '*') return true;

  const agentsPath = path.join(teamDir, 'agents.json');
  if (!fs.existsSync(agentsPath)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
    const agent = data.agents?.find((a: { name: string }) => a.name === agentName);
    if (!agent || !agent.lastSeen) return false;

    const thirtySecondsAgo = Date.now() - 30 * 1000;
    return new Date(agent.lastSeen).getTime() > thirtySecondsAgo;
  } catch {
    return false;
  }
}

export function isRemoteAgent(teamDir: string, agentName: string): boolean {
  const remoteAgentsPath = path.join(teamDir, 'remote-agents.json');
  if (!fs.existsSync(remoteAgentsPath)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(remoteAgentsPath, 'utf-8'));
    if (data.updatedAt && Date.now() - data.updatedAt > 60 * 1000) {
      return false;
    }
    return data.agents?.some((a: { name: string }) => a.name === agentName) ?? false;
  } catch {
    return false;
  }
}

export function isRemoteUser(teamDir: string, username: string): boolean {
  const remoteUsersPath = path.join(teamDir, 'remote-users.json');
  if (!fs.existsSync(remoteUsersPath)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(remoteUsersPath, 'utf-8'));
    if (data.updatedAt && Date.now() - data.updatedAt > 60 * 1000) {
      return false;
    }
    return data.users?.some((u: { name: string }) => u.name === username) ?? false;
  } catch {
    return false;
  }
}

export function isUserOnline(
  teamDir: string,
  username: string,
  onlineUsers: Map<string, unknown>,
  userBridge?: UserBridgeLike,
): boolean {
  if (username === '*') return true;
  return onlineUsers.has(username) || userBridge?.isUserRegistered(username) === true || isRemoteUser(teamDir, username);
}

export function isRecipientOnline(
  teamDir: string,
  name: string,
  onlineUsers: Map<string, unknown>,
  userBridge?: UserBridgeLike,
): boolean {
  return (
    isAgentOnline(teamDir, name) ||
    isRemoteAgent(teamDir, name) ||
    isUserOnline(teamDir, name, onlineUsers, userBridge)
  );
}

/**
 * Resolve team members from teams config, active workers, and agents.json.
 */
export function getTeamMembers(
  teamName: string,
  projectRoot: string | undefined,
  dataDir: string,
  teamDir: string,
  spawnReader?: TeamSpawnReaderLike,
): string[] {
  const members = new Set<string>();

  const teamsConfig = loadTeamsConfig(projectRoot || dataDir);
  if (teamsConfig && teamsConfig.team === teamName) {
    for (const agent of teamsConfig.agents) {
      members.add(agent.name);
    }
  }

  if (spawnReader) {
    const activeWorkers = spawnReader.getActiveWorkers();
    for (const worker of activeWorkers) {
      if (worker.team === teamName) {
        members.add(worker.name);
      }
    }
  }

  const agentsPath = path.join(teamDir, 'agents.json');
  if (fs.existsSync(agentsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
      for (const agent of (data.agents || [])) {
        if (agent.team === teamName) {
          members.add(agent.name);
        }
      }
    } catch {
      // Ignore parse errors.
    }
  }

  return Array.from(members);
}

export function isValidUsername(username: unknown): username is string {
  if (typeof username !== 'string') return false;
  if (username.length === 0 || username.length > 50) return false;
  if (!/^[a-zA-Z0-9]/.test(username) || !/[a-zA-Z0-9]$/.test(username)) return false;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*[a-zA-Z0-9]$/.test(username) && username.length > 1) return false;
  if (username.length === 1 && !/^[a-zA-Z0-9]$/.test(username)) return false;
  if (/  /.test(username)) return false;
  return true;
}

export function isValidAvatarUrl(url: unknown): url is string | undefined {
  if (url === undefined || url === null) return true;
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname === 'avatars.githubusercontent.com' ||
        parsed.hostname === 'github.com' ||
        parsed.hostname.endsWith('.githubusercontent.com')) return true;
    if (parsed.hostname === 'www.gravatar.com' ||
        parsed.hostname === 'gravatar.com' ||
        parsed.hostname === 'secure.gravatar.com') return true;
    if (parsed.hostname === 'ui-avatars.com') return true;
    return false;
  } catch {
    return false;
  }
}
