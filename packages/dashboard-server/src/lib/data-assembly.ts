import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { type StorageAdapter, type StoredMessage } from '@agent-relay/storage/adapter';
import { loadTeamsConfig } from '@agent-relay/config';
import type { ThreadMetadata } from '../types/threading.js';
import { fetchCloudNeedsAttention, parseNeedsAttentionAgents } from '../services/needs-attention.js';

interface AgentStatus {
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

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  filePath?: string;
  width?: number;
  height?: number;
  data?: string;
}

interface Message {
  from: string;
  to: string;
  content: string;
  timestamp: string;
  id: string;
  thread?: string;
  isBroadcast?: boolean;
  status?: string;
  attachments?: Attachment[];
  channel?: string;
  replyCount?: number;
  threadSummary?: ThreadMetadata;
}

interface SessionInfo {
  id: string;
  agentName: string;
  cli?: string;
  startedAt: string;
  endedAt?: string;
  duration?: string;
  messageCount: number;
  summary?: string;
  isActive: boolean;
  closedBy?: 'agent' | 'disconnect' | 'error';
}

interface AgentSummary {
  agentName: string;
  lastUpdated: string;
  currentTask?: string;
  completedTasks?: string[];
  context?: string;
}

interface TeamAgent {
  name: string;
  role: string;
  cli?: string;
  lastSeen?: string;
  lastActive?: string;
  team?: string;
}

interface TeamData {
  agents: TeamAgent[];
}

interface RemoteUserRecord {
  name: string;
  avatarUrl?: string;
  lastSeen?: string;
  connectedAt?: string;
}

interface PresenceInfo {
  avatarUrl?: string;
  lastSeen: string;
}

interface PresenceStateLike {
  info: PresenceInfo;
}

interface ActiveWorkerLike {
  name: string;
  team?: string;
  cli?: string;
  cwd?: string;
}

interface SpawnReaderLike {
  getActiveWorkers: () => ActiveWorkerLike[];
}

interface BridgeLead {
  name: string;
  connected?: boolean;
}

interface BridgeAgent {
  name: string;
  status: string;
  cli?: string;
  lastSeen?: string;
}

interface BridgeProject {
  path?: string;
  lead?: BridgeLead;
  agents?: BridgeAgent[];
}

interface BridgeData {
  projects: BridgeProject[];
  messages: unknown[];
  connected: boolean;
}

export interface DataAssemblyDeps {
  dataDir: string;
  teamDir: string;
  projectRoot?: string;
  defaultWorkspaceId?: string;
  storage?: StorageAdapter;
  spawnReader?: SpawnReaderLike;
  onlineUsers: Map<string, PresenceStateLike>;
  agentCwdMap: Map<string, string>;
  debug?: (message: string) => void;
}

export interface DataAssembly {
  getAllData: () => Promise<{
    agents: Array<AgentStatus & { isHuman: false }>;
    users: Array<AgentStatus & { isHuman: true }>;
    messages: Message[];
    activity: Message[];
    sessions: SessionInfo[];
    summaries: AgentSummary[];
  } | null>;
  getBridgeData: () => Promise<BridgeData>;
  isInternalAgent: (name: string) => boolean;
  remapAgentName: (name: string) => string;
  buildThreadSummaryMap: (rows: StoredMessage[]) => Map<string, ThreadMetadata>;
  formatDuration: (startMs: number, endMs?: number) => string;
}

// Helper to check if an agent name is internal/system (should be hidden from UI).
// Convention: agent names starting with __ are internal (e.g., __spawner__, __DashboardBridge__).
export const isInternalAgent = (name: string): boolean => {
  if (name === '__cli_sender__') return false;
  return name.startsWith('__');
};

// Display-name remapping for CLI sender (used across message and history endpoints).
export const remapAgentName = (name: string): string => {
  if (name === '__cli_sender__') return 'CLI';
  return name;
};

export const buildThreadSummaryMap = (rows: StoredMessage[]): Map<string, ThreadMetadata> => {
  const summaries = new Map<string, ThreadMetadata>();

  for (const row of rows) {
    if (!row.thread) {
      continue;
    }

    const threadId = row.thread;
    const existing = summaries.get(threadId);
    const participants = existing ? new Set(existing.participants) : new Set<string>();
    participants.add(row.from);

    const isNewer = !existing || row.ts >= existing.lastReplyAt;
    summaries.set(threadId, {
      threadId,
      replyCount: existing ? existing.replyCount + 1 : 1,
      participants: Array.from(participants),
      lastReplyAt: isNewer ? row.ts : existing.lastReplyAt,
      lastReplyPreview: isNewer ? row.body : existing.lastReplyPreview,
    });
  }

  return summaries;
};

const mapStoredMessages = (rows: StoredMessage[], threadSummaries?: Map<string, ThreadMetadata>): Message[] => rows
  // Filter out messages from/to internal system agents (e.g., __spawner__).
  .filter((row) => !isInternalAgent(row.from) && !isInternalAgent(row.to))
  // Filter out channel messages - these are shown in the channels view, not the agent messages view.
  .filter((row) => {
    if (row.data && typeof row.data === 'object' && '_isChannelMessage' in row.data) {
      return false;
    }
    return true;
  })
  .map((row) => {
    const summaryFromReplies = threadSummaries?.get(row.id);
    const fallbackSummary = (!summaryFromReplies && row.replyCount && row.replyCount > 0)
      ? {
        threadId: row.id,
        replyCount: row.replyCount,
        participants: Array.from(new Set([row.from, row.to])),
        lastReplyAt: row.ts,
      }
      : undefined;
    const threadSummary = summaryFromReplies ?? fallbackSummary;
    let attachments: Attachment[] | undefined;
    let channel: string | undefined;
    let effectiveFrom = row.from;
    let effectiveTo = row.to;

    if (row.data && typeof row.data === 'object') {
      if ('attachments' in row.data) {
        attachments = (row.data as { attachments: Attachment[] }).attachments;
      }
      if ('channel' in row.data) {
        channel = (row.data as { channel: string }).channel;
      }
      // For dashboard messages sent via Dashboard, use the actual sender name.
      if ('senderName' in row.data && row.from === 'Dashboard') {
        effectiveFrom = (row.data as { senderName: string }).senderName;
      }
    }

    effectiveFrom = remapAgentName(effectiveFrom);
    effectiveTo = remapAgentName(effectiveTo);

    return {
      from: effectiveFrom,
      to: effectiveTo,
      content: row.body,
      timestamp: new Date(row.ts).toISOString(),
      id: row.id,
      thread: row.thread,
      isBroadcast: row.is_broadcast,
      replyCount: threadSummary?.replyCount ?? row.replyCount,
      threadSummary,
      status: row.status,
      attachments,
      channel,
    };
  });

export const formatDuration = (startMs: number, endMs?: number): string => {
  const end = endMs ?? Date.now();
  const durationMs = end - startMs;
  const minutes = Math.floor(durationMs / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
};

export function createDataAssembly(deps: DataAssemblyDeps): DataAssembly {
  const {
    dataDir,
    teamDir,
    projectRoot,
    defaultWorkspaceId,
    storage,
    spawnReader,
    onlineUsers,
    agentCwdMap,
    debug,
  } = deps;

  const getTeamData = (): TeamData | null => {
    // Try team.json first (file-based team mode).
    const teamPath = path.join(teamDir, 'team.json');
    if (fs.existsSync(teamPath)) {
      try {
        return JSON.parse(fs.readFileSync(teamPath, 'utf-8')) as TeamData;
      } catch (e) {
        console.error('Failed to read team.json', e);
      }
    }

    // Fall back to agents.json (daemon mode - live connected agents).
    const agentsPath = path.join(teamDir, 'agents.json');
    if (fs.existsSync(agentsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(agentsPath, 'utf-8')) as { agents: Array<{ name: string; connectedAt?: string; cli?: string; lastSeen?: string; team?: string }> };
        // Convert agents.json format to team.json format.
        return {
          agents: data.agents.map((a) => ({
            name: a.name,
            role: 'Agent',
            cli: a.cli ?? 'Unknown',
            lastSeen: a.lastSeen ?? a.connectedAt,
            lastActive: a.lastSeen ?? a.connectedAt,
            team: a.team,
          })),
        };
      } catch (e) {
        console.error('Failed to read agents.json', e);
      }
    }

    return null;
  };

  const parseInbox = (agentName: string): Message[] => {
    const inboxPath = path.join(dataDir, agentName, 'inbox.md');
    if (!fs.existsSync(inboxPath)) return [];

    try {
      const content = fs.readFileSync(inboxPath, 'utf-8');
      const messages: Message[] = [];

      // Split by "## Message from ".
      const parts = content.split('## Message from ');

      parts.forEach((part, index) => {
        if (!part.trim()) return;

        const firstLineEnd = part.indexOf('\n');
        if (firstLineEnd === -1) return;

        const header = part.substring(0, firstLineEnd).trim();
        const body = part.substring(firstLineEnd).trim();

        let sender = header;
        let timestamp = new Date().toISOString();

        if (header.includes('|')) {
          const split = header.split('|');
          sender = split[0].trim();
          timestamp = split.slice(1).join('|').trim();
        }

        messages.push({
          from: sender,
          to: agentName,
          content: body,
          timestamp,
          id: `${agentName}-${index}-${Date.now()}`,
        });
      });
      return messages;
    } catch (e) {
      console.error(`Failed to read inbox for ${agentName}`, e);
      return [];
    }
  };

  const getMessages = async (agents: TeamAgent[]): Promise<Message[]> => {
    // For local mode: use storage (SQLite) first - faster and avoids daemon query timeouts.
    if (storage) {
      const rows = await storage.getMessages({ limit: 100, order: 'desc' });
      const threadSummaries = buildThreadSummaryMap(rows);
      // Dashboard expects oldest first.
      return mapStoredMessages(rows, threadSummaries).reverse();
    }

    // Final fallback to file-based inbox parsing.
    let allMessages: Message[] = [];
    agents.forEach((a) => {
      const msgs = parseInbox(a.name);
      allMessages = [...allMessages, ...msgs];
    });
    return allMessages;
  };

  const getRecentSessions = async (): Promise<SessionInfo[]> => {
    if (storage && typeof storage.getRecentSessions === 'function') {
      const sessions = await storage.getRecentSessions(20);
      return sessions.map((s) => ({
        id: s.id,
        agentName: s.agentName,
        cli: s.cli,
        startedAt: new Date(s.startedAt).toISOString(),
        endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : undefined,
        duration: formatDuration(s.startedAt, s.endedAt),
        messageCount: s.messageCount,
        summary: s.summary,
        isActive: !s.endedAt,
        closedBy: s.closedBy,
      }));
    }
    return [];
  };

  const getAgentSummaries = async (): Promise<AgentSummary[]> => {
    if (storage && typeof storage.getAllAgentSummaries === 'function') {
      const summaries = await storage.getAllAgentSummaries();
      return summaries.map((s) => ({
        agentName: s.agentName,
        lastUpdated: new Date(s.lastUpdated).toISOString(),
        currentTask: s.currentTask,
        completedTasks: s.completedTasks,
        context: s.context,
      }));
    }
    return [];
  };

  const getAllData = async () => {
    const team = getTeamData();
    if (!team) return null;

    const agentsMap = new Map<string, AgentStatus>();
    const allMessages = await getMessages(team.agents);

    // Initialize agents from config.
    team.agents.forEach((a) => {
      agentsMap.set(a.name, {
        name: a.name,
        role: a.role,
        cli: a.cli ?? 'Unknown',
        messageCount: 0,
        status: 'Idle',
        lastSeen: a.lastSeen,
        lastActive: a.lastActive,
        needsAttention: false,
        team: a.team,
      });
    });

    // Inject online human users (connected via dashboard WebSocket) into agentsMap.
    for (const [username, state] of onlineUsers) {
      const existing = agentsMap.get(username);
      if (existing) {
        existing.cli = 'dashboard';
        existing.status = 'online';
        existing.avatarUrl = state.info.avatarUrl || existing.avatarUrl;
      } else {
        agentsMap.set(username, {
          name: username,
          role: 'User',
          cli: 'dashboard',
          messageCount: 0,
          status: 'online',
          lastSeen: state.info.lastSeen,
          lastActive: state.info.lastSeen,
          needsAttention: false,
          avatarUrl: state.info.avatarUrl,
        });
      }
    }

    // Inject remote users (connected via cloud dashboard) into agentsMap.
    const remoteUsersPath = path.join(teamDir, 'remote-users.json');
    if (fs.existsSync(remoteUsersPath)) {
      try {
        const remoteData = JSON.parse(fs.readFileSync(remoteUsersPath, 'utf-8')) as { updatedAt?: number; users?: RemoteUserRecord[] };
        // Only include if file is fresh (within 60 seconds).
        if (remoteData.updatedAt && Date.now() - remoteData.updatedAt <= 60 * 1000) {
          for (const user of remoteData.users || []) {
            // Don't override local users.
            if (onlineUsers.has(user.name)) continue;

            const existing = agentsMap.get(user.name);
            if (existing) {
              existing.cli = 'dashboard';
              existing.status = 'online';
              if (user.avatarUrl) existing.avatarUrl = user.avatarUrl;
            } else {
              // Use stable timestamps from the user/file data, not new Date().
              const stableTimestamp = user.lastSeen || user.connectedAt || new Date(remoteData.updatedAt).toISOString();
              agentsMap.set(user.name, {
                name: user.name,
                role: 'User',
                cli: 'dashboard',
                messageCount: 0,
                status: 'online',
                lastSeen: stableTimestamp,
                lastActive: stableTimestamp,
                needsAttention: false,
                avatarUrl: user.avatarUrl,
              });
            }
          }
        }
      } catch {
        // Ignore parse errors for remote users file.
      }
    }

    // Update inbox counts if fallback mode; if storage, count messages addressed to agent.
    if (storage) {
      for (const msg of allMessages) {
        const agent = agentsMap.get(msg.to);
        if (agent) {
          agent.messageCount = (agent.messageCount ?? 0) + 1;
        }
      }
    } else {
      // Sort by timestamp.
      allMessages.sort((a, b) => {
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
    }

    // Derive status from messages sent BY agents.
    allMessages.forEach((m) => {
      const agent = agentsMap.get(m.from);
      if (agent) {
        agent.lastActive = m.timestamp;
        // Don't overwrite lastSeen - it comes from registry (heartbeat/connection tracking).
        if (m.content.startsWith('STATUS:')) {
          agent.status = m.content.substring(7).trim();
        }
      }
    });

    // Needs-attention ownership moved to cloud; dashboard now consumes pass-through data.
    try {
      const response = await fetchCloudNeedsAttention({
        request: { workspaceId: defaultWorkspaceId },
      });
      if (response.ok) {
        const payload = await response.json() as Parameters<typeof parseNeedsAttentionAgents>[0];
        const needsAttentionAgents = parseNeedsAttentionAgents(payload);
        needsAttentionAgents.forEach((agentName) => {
          const agent = agentsMap.get(agentName);
          if (agent) {
            agent.needsAttention = true;
          }
        });
      }
    } catch (err) {
      debug?.(`[dashboard] cloud needs-attention proxy failed: ${(err as Error).message}`);
    }

    // Read processing state from daemon.
    const processingStatePath = path.join(teamDir, 'processing-state.json');
    if (fs.existsSync(processingStatePath)) {
      try {
        const processingData = JSON.parse(fs.readFileSync(processingStatePath, 'utf-8')) as { processingAgents?: Record<string, { startedAt: number }> };
        const processingAgents = processingData.processingAgents || {};
        for (const [agentName, state] of Object.entries(processingAgents)) {
          const agent = agentsMap.get(agentName);
          if (agent && state && typeof state === 'object') {
            agent.isProcessing = true;
            agent.processingStartedAt = state.startedAt;
          }
        }
      } catch {
        // Ignore errors reading processing state - it's optional.
      }
    }

    // Mark spawned agents with isSpawned flag, team, model, and cwd.
    if (spawnReader) {
      const activeWorkers = spawnReader.getActiveWorkers();
      for (const worker of activeWorkers) {
        const agent = agentsMap.get(worker.name);
        if (agent) {
          agent.isSpawned = true;
          if (worker.team) {
            agent.team = worker.team;
          }
          const workerCwd = agentCwdMap.get(worker.name) || worker.cwd;
          if (workerCwd) {
            agent.cwd = workerCwd;
          }
          if (worker.cli) {
            const modelMatch = worker.cli.match(/--model[=\s]+(\S+)/);
            if (modelMatch) {
              agent.model = modelMatch[1];
            }
          }
        }
      }
    }

    // Inject cwd from agentCwdMap for agents not in spawner's active workers.
    for (const [name, cwd] of agentCwdMap) {
      const agent = agentsMap.get(name);
      if (agent && !agent.cwd) {
        agent.cwd = cwd;
      }
    }

    // Also check workers.json for externally-spawned workers.
    const workersJsonPath = path.join(teamDir, 'workers.json');
    if (fs.existsSync(workersJsonPath)) {
      try {
        const workersData = JSON.parse(fs.readFileSync(workersJsonPath, 'utf-8')) as { workers?: Array<{ name: string; logFile?: string }> };
        for (const worker of workersData.workers || []) {
          const agent = agentsMap.get(worker.name);
          if (agent && !agent.isSpawned && worker.logFile && fs.existsSync(worker.logFile)) {
            agent.isSpawned = true;
          }
        }
      } catch {
        // Ignore errors reading workers.json.
      }
    }

    // Mark relay-protocol spawned agents by log-file presence.
    if (spawnReader) {
      for (const [name, agent] of agentsMap) {
        if (agent.isSpawned) continue;
        if (onlineUsers.has(name) || name === 'Dashboard') continue;
        const logPath = path.join(teamDir, `${name}.log`);
        if (fs.existsSync(logPath)) {
          agent.isSpawned = true;
        }
      }
    }

    // Set team from teams.json for agents that don't have a team yet.
    const teamsConfig = loadTeamsConfig(projectRoot || dataDir);
    if (teamsConfig) {
      for (const teamAgent of teamsConfig.agents) {
        const agent = agentsMap.get(teamAgent.name);
        if (agent && !agent.team) {
          agent.team = teamsConfig.team;
        }
      }
    }

    // Fetch sessions and summaries in parallel.
    const [sessions, summaries] = await Promise.all([
      getRecentSessions(),
      getAgentSummaries(),
    ]);

    // Filter and separate agents from human users.
    const now = Date.now();
    const OFFLINE_THRESHOLD_MS = 30 * 1000;

    const validEntries = Array.from(agentsMap.values())
      .filter((agent) => {
        if (agent.name === 'Dashboard') return false;
        if (agent.name.startsWith('__')) return false;
        if (agent.name === 'Dashboard') return false;
        if (!agent.cli || agent.cli === 'Unknown') return false;
        if (!agent.lastSeen) return false;
        const lastSeenTime = new Date(agent.lastSeen).getTime();
        if (now - lastSeenTime > OFFLINE_THRESHOLD_MS) return false;
        return true;
      });

    const filteredAgents = validEntries
      .filter((agent) => agent.cli !== 'dashboard')
      .map((agent) => ({
        ...agent,
        isHuman: false as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const humanUsers = validEntries
      .filter((agent) => agent.cli === 'dashboard')
      .map((agent) => ({
        ...agent,
        isHuman: true as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      agents: filteredAgents,
      users: humanUsers,
      messages: allMessages,
      activity: allMessages,
      sessions,
      summaries,
    };
  };

  const getBridgeData = async (): Promise<BridgeData> => {
    const bridgeStatePath = path.join(dataDir, 'bridge-state.json');
    if (fs.existsSync(bridgeStatePath)) {
      try {
        const bridgeState = JSON.parse(fs.readFileSync(bridgeStatePath, 'utf-8')) as BridgeData;

        // Enrich each project with actual agent data from their team directories.
        if (bridgeState.projects && Array.isArray(bridgeState.projects)) {
          for (const project of bridgeState.projects) {
            if (project.path) {
              const projectHash = crypto.createHash('sha256').update(project.path).digest('hex').slice(0, 12);
              const projectDataDir = path.join(path.dirname(dataDir), projectHash);
              const projectTeamDir = path.join(projectDataDir, 'team');
              const agentsPath = path.join(projectTeamDir, 'agents.json');

              if (fs.existsSync(agentsPath)) {
                try {
                  const agentsData = JSON.parse(fs.readFileSync(agentsPath, 'utf-8')) as { agents?: Array<{ name: string; cli?: string; lastSeen?: string }> };
                  if (agentsData.agents && Array.isArray(agentsData.agents)) {
                    // Filter to only show online agents (seen within 30 seconds - aligns with heartbeat timeout).
                    const thirtySecondsAgo = Date.now() - 30 * 1000;
                    project.agents = agentsData.agents
                      .filter((a) => {
                        if (!a.lastSeen) return false;
                        return new Date(a.lastSeen).getTime() > thirtySecondsAgo;
                      })
                      .map((a) => ({
                        name: a.name,
                        status: 'active',
                        cli: a.cli,
                        lastSeen: a.lastSeen,
                      }));

                    // Update lead status based on actual agents.
                    if (project.lead) {
                      const leadAgent = project.agents.find((a) =>
                        a.name.toLowerCase() === project.lead!.name.toLowerCase(),
                      );
                      project.lead.connected = !!leadAgent;
                    }
                  }
                } catch (e) {
                  console.error(`Failed to read agents for ${project.path}:`, e);
                }
              }
            }
          }
        }

        return bridgeState;
      } catch {
        return { projects: [], messages: [], connected: false };
      }
    }
    return { projects: [], messages: [], connected: false };
  };

  return {
    getAllData,
    getBridgeData,
    isInternalAgent,
    remapAgentName,
    buildThreadSummaryMap,
    formatDuration,
  };
}
