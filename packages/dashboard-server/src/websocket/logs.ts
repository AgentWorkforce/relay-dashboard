import fs from 'fs';
import path from 'path';
import { WebSocket, type WebSocketServer } from 'ws';
import type { MessageBuffer } from '../messageBuffer.js';
import { normalizeName } from '../lib/utils.js';
import {
  getWorkerLogsDir,
  sanitizeLogAgentName,
  listStandaloneLogAgents,
  readLogDelta,
  STANDALONE_LOG_POLL_MS,
} from '../lib/log-reader.js';

const LOG_HISTORY_MAX_BYTES = 64 * 1024;

function takeTail(content: string, maxChars = LOG_HISTORY_MAX_BYTES): string {
  if (content.length <= maxChars) {
    return content;
  }
  return content.slice(content.length - maxChars);
}

function readLogTailContent(filePath: string, maxBytes = LOG_HISTORY_MAX_BYTES): string {
  if (!fs.existsSync(filePath)) return '';

  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);
    const start = Math.max(0, stats.size - maxBytes);
    const length = Math.max(0, stats.size - start);
    if (length === 0) return '';

    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString('utf-8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best-effort close.
      }
    }
  }
}

/**
 * Standalone log WebSocket handler — tails local worker log files.
 */
export function handleStandaloneLogWebSocket(
  ws: WebSocket,
  pathname: string,
  dataDir: string,
  getLocalAgentNames: () => Set<string> | null,
  verbose: boolean,
): void {
  const segments = pathname.split('/').filter(Boolean);
  const encodedAgentName = segments.length >= 3 ? segments[segments.length - 1] : '';
  let agentName: string | null;
  try {
    agentName = sanitizeLogAgentName(decodeURIComponent(encodedAgentName));
  } catch {
    ws.send(JSON.stringify({ type: 'error', error: 'Invalid agent name encoding' }));
    ws.close(4400, 'Invalid agent name encoding');
    return;
  }

  if (!agentName) {
    ws.send(JSON.stringify({ type: 'error', error: 'Agent name is required' }));
    ws.close(4404, 'Agent name is required');
    return;
  }

  if (verbose) {
    console.log(`[dashboard] Standalone log WebSocket connected for ${agentName}`);
  }

  const logsDir = getWorkerLogsDir(dataDir);
  const logFile = path.join(logsDir, `${agentName}.log`);
  const availableAgents = (): string[] => listStandaloneLogAgents(dataDir);
  const normalizedName = normalizeName(agentName);

  const knownLocalAgents = getLocalAgentNames();
  const isKnownLocalAgent = knownLocalAgents !== null && knownLocalAgents.has(normalizedName);
  let sequenceId = 0;

  let offset = 0;
  const syncOffsetToEnd = (): void => {
    try {
      const stats = fs.statSync(logFile);
      offset = stats.size;
    } catch {
      offset = 0;
    }
  };

  const sendHistory = (): void => {
    const content = readLogTailContent(logFile);
    ws.send(JSON.stringify({ type: 'subscribed', agent: agentName }));
    ws.send(JSON.stringify({ type: 'sync', serverTimestamp: Date.now(), sequenceId }));
    ws.send(JSON.stringify({
      type: 'history',
      agent: agentName,
      lines: content ? [content] : [],
    }));
    syncOffsetToEnd();
  };

  if (!fs.existsSync(logFile) && knownLocalAgents !== null && !isKnownLocalAgent) {
    ws.send(JSON.stringify({
      type: 'error',
      agent: agentName,
      error: `No local logs for '${agentName}'.`,
      availableAgents: availableAgents(),
    }));
    ws.close(4404, 'Agent logs not found');
    return;
  }

  if (fs.existsSync(logFile)) {
    sendHistory();
  } else {
    ws.send(JSON.stringify({ type: 'subscribed', agent: agentName }));
    ws.send(JSON.stringify({ type: 'sync', serverTimestamp: Date.now(), sequenceId }));
    ws.send(JSON.stringify({ type: 'history', agent: agentName, lines: [] }));
  }

  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!fs.existsSync(logFile)) {
      return;
    }

    const delta = readLogDelta(logFile, offset);
    offset = delta.nextOffset;
    if (delta.content) {
      sequenceId += 1;
      ws.send(JSON.stringify({
        type: 'log',
        agent: agentName,
        content: delta.content,
        data: delta.content,
        timestamp: new Date().toISOString(),
        seq: sequenceId,
      }));
    }
  }, STANDALONE_LOG_POLL_MS);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as { type?: string };
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (message.type === 'subscribe' || message.type === 'refresh') {
        sendHistory();
      } else if (message.type === 'replay') {
        // Standalone file-tail mode doesn't maintain a replay ring buffer yet.
        // Return a single replay message with the current tail as a fallback.
        const content = readLogTailContent(logFile);
        ws.send(JSON.stringify({
          type: 'replay',
          agent: agentName,
          messages: content ? [{
            type: 'log',
            agent: agentName,
            content,
            data: content,
            timestamp: new Date().toISOString(),
            seq: sequenceId,
          }] : [],
          entries: content ? [{
            content,
            timestamp: Date.now(),
          }] : [],
        }));
      }
    } catch {
      // Ignore parse errors.
    }
  });

  ws.on('close', () => {
    if (verbose) {
      console.log(`[dashboard] Standalone log WebSocket disconnected for ${agentName}`);
    }
    clearInterval(interval);
  });

  ws.on('error', (err) => {
    if (verbose) {
      console.warn(`[dashboard] Standalone log WebSocket error for ${agentName}:`, err.message);
    }
    clearInterval(interval);
  });
}

interface WorkerMeta {
  name: string;
  cli: string;
  task: string;
  spawnedAt: number;
  pid?: number;
  logFile?: string;
}

interface SpawnReaderLike {
  hasWorker: (name: string) => boolean;
  getWorkerOutput: (name: string, maxLines?: number) => string[] | undefined;
  getWorkerRawOutput?: (name: string) => string | undefined;
  sendWorkerInput: (name: string, input: string) => Promise<boolean>;
}

export interface LogsWebSocketDeps {
  wssLogs: WebSocketServer;
  teamDir: string;
  debug: (message: string) => void;
  logSubscriptions: Map<string, Set<WebSocket>>;
  fileWatchers: Map<string, fs.FSWatcher>;
  fileLastSize: Map<string, number>;
  agentLogBuffers: Map<string, MessageBuffer>;
  getAgentLogBuffer: (agentName: string) => MessageBuffer;
  spawnReader?: SpawnReaderLike;
}

/**
 * Logs WebSocket handler for live output streaming and replay.
 */
export function setupLogsWebSocket(deps: LogsWebSocketDeps): void {
  const {
    wssLogs,
    teamDir,
    debug,
    logSubscriptions,
    fileWatchers,
    fileLastSize,
    agentLogBuffers,
    getAgentLogBuffer,
    spawnReader,
  } = deps;

  // Track alive status for ping/pong keepalive on log connections.
  const logClientAlive = new WeakMap<WebSocket, boolean>();

  // Ping interval for log WebSocket connections (15 seconds).
  // Reduced from 30s to detect disconnects faster and minimize message loss window.
  const LOG_PING_INTERVAL_MS = 15000;
  const logPingInterval = setInterval(() => {
    wssLogs.clients.forEach((ws) => {
      if (logClientAlive.get(ws) === false) {
        // Client didn't respond to last ping - close gracefully.
        debug('[dashboard] Logs WebSocket client unresponsive, closing gracefully');
        ws.close(1000, 'unresponsive');
        return;
      }
      // Mark as not alive until we get a pong.
      logClientAlive.set(ws, false);
      ws.ping();
    });
  }, LOG_PING_INTERVAL_MS);

  // Clean up ping interval on server close.
  wssLogs.on('close', () => {
    clearInterval(logPingInterval);
  });

  // Handle logs WebSocket connections for live log streaming.
  wssLogs.on('connection', (ws, req) => {
    debug('[dashboard] Logs WebSocket client connected');
    const clientSubscriptions = new Set<string>();

    // Mark client as alive initially.
    logClientAlive.set(ws, true);

    // Handle pong responses (keep connection alive).
    ws.on('pong', () => {
      logClientAlive.set(ws, true);
    });

    // Send sync message with current server timestamp so client can track its position.
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sync', serverTimestamp: Date.now(), sequenceId: 0 }));
    }

    // Helper to check if agent is daemon-connected (from agents.json).
    const isDaemonConnected = (agentName: string): boolean => {
      const agentsPath = path.join(teamDir, 'agents.json');
      if (!fs.existsSync(agentsPath)) return false;
      try {
        const data = JSON.parse(fs.readFileSync(agentsPath, 'utf-8')) as { agents?: Array<{ name: string }> };
        return data.agents?.some((a) => a.name === agentName) ?? false;
      } catch {
        return false;
      }
    };

    // Helper to get worker info from workers.json (for externally-spawned workers).
    const getExternalWorkerInfo = (agentName: string): WorkerMeta | null => {
      const workersPath = path.join(teamDir, 'workers.json');
      if (!fs.existsSync(workersPath)) return null;
      try {
        const data = JSON.parse(fs.readFileSync(workersPath, 'utf-8')) as { workers?: WorkerMeta[] };
        const worker = data.workers?.find((w) => w.name === agentName);
        return worker ?? null;
      } catch {
        return null;
      }
    };

    // Helper to read raw log tail for externally-spawned workers.
    const readLogFileTail = (logFile: string, maxBytes = LOG_HISTORY_MAX_BYTES): string => {
      return readLogTailContent(logFile, maxBytes);
    };

    const buildLogPayload = (
      agentName: string,
      content: string,
      messageType: 'output' | 'log' = 'output',
    ): string => {
      const base = {
        type: messageType,
        agent: agentName,
        data: content,
        content,
        timestamp: new Date().toISOString(),
      };
      const serializedBase = JSON.stringify(base);
      const seq = getAgentLogBuffer(agentName).push(messageType, serializedBase);
      return JSON.stringify({ ...base, seq });
    };

    // Helper to start watching a log file for live updates.
    const watchLogFile = (agentName: string, logFile: string) => {
      if (fileWatchers.has(agentName)) return; // Already watching.
      if (!fs.existsSync(logFile)) return;

      try {
        // Track current file size for incremental reads.
        const stats = fs.statSync(logFile);
        fileLastSize.set(agentName, stats.size);

        const watcher = fs.watch(logFile, (eventType) => {
          if (eventType !== 'change') return;

          const clients = logSubscriptions.get(agentName);
          if (!clients || clients.size === 0) {
            // No subscribers, stop watching.
            watcher.close();
            fileWatchers.delete(agentName);
            fileLastSize.delete(agentName);
            return;
          }

          try {
            const newStats = fs.statSync(logFile);
            const lastSize = fileLastSize.get(agentName) || 0;

            if (newStats.size > lastSize) {
              // Read only the new content.
              const fd = fs.openSync(logFile, 'r');
              const buffer = Buffer.alloc(newStats.size - lastSize);
              fs.readSync(fd, buffer, 0, buffer.length, lastSize);
              fs.closeSync(fd);

              const newContent = buffer.toString('utf-8');
              fileLastSize.set(agentName, newStats.size);

              if (!newContent) {
                return;
              }

              const payload = buildLogPayload(agentName, newContent, 'output');

              for (const client of clients) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(payload);
                }
              }
            }
          } catch (err) {
            console.error(`[dashboard] Error reading log file updates for ${agentName}:`, err);
          }
        });

        fileWatchers.set(agentName, watcher);
      } catch (err) {
        console.error(`[dashboard] Failed to watch log file for ${agentName}:`, err);
      }
    };

    const cleanupAgentSubscription = (agentName: string): void => {
      const remainingClients = logSubscriptions.get(agentName);
      if (!remainingClients || remainingClients.size === 0) {
        const watcher = fileWatchers.get(agentName);
        if (watcher) {
          watcher.close();
          fileWatchers.delete(agentName);
          fileLastSize.delete(agentName);
        }
      }
    };

    // Helper to subscribe to an agent (async to handle spawn timing).
    const subscribeToAgent = async (agentName: string) => {
      let isSpawned = spawnReader?.hasWorker(agentName) ?? false;
      const isDaemon = isDaemonConnected(agentName);

      // Check if agent exists (either spawned or daemon-connected).
      if (!isSpawned && !isDaemon) {
        ws.send(JSON.stringify({
          type: 'error',
          agent: agentName,
          error: `Agent ${agentName} not found`,
        }));
        // Close with custom code 4404 to signal "agent not found" - client should not reconnect.
        ws.close(4404, 'Agent not found');
        return false;
      }

      // If agent is daemon-connected but not yet in spawner's activeWorkers, poll for registration.
      if (!isSpawned && isDaemon && spawnReader) {
        const isSetupAgent = agentName.startsWith('__setup__');
        const maxWaitMs = isSetupAgent ? 90000 : 5000; // 90s for setup agents (CLI auth can be slow), 5s otherwise.
        const pollIntervalMs = 100;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          isSpawned = spawnReader.hasWorker(agentName);
          if (isSpawned) {
            console.log(`[dashboard] Agent ${agentName} appeared in spawner after ${Date.now() - startTime}ms`);
            break;
          }
          // Check if WebSocket was closed during wait.
          if (ws.readyState !== WebSocket.OPEN) {
            return false;
          }
        }
      }

      // Add to subscriptions.
      clientSubscriptions.add(agentName);
      if (!logSubscriptions.has(agentName)) {
        logSubscriptions.set(agentName, new Set());
      }
      logSubscriptions.get(agentName)!.add(ws);

      debug(`[dashboard] Client subscribed to logs for: ${agentName} (spawned: ${isSpawned}, daemon: ${isDaemon})`);

      if (isSpawned && spawnReader) {
        const rawHistory =
          spawnReader.getWorkerRawOutput?.(agentName)
          ?? (spawnReader.getWorkerOutput(agentName, 5000) || []).join('\n');
        const historyTail = takeTail(rawHistory, LOG_HISTORY_MAX_BYTES);
        ws.send(JSON.stringify({
          type: 'history',
          agent: agentName,
          lines: historyTail ? [historyTail] : [],
        }));
      } else {
        // Check if this is an externally-spawned worker with a log file.
        const externalWorker = getExternalWorkerInfo(agentName);
        let logFile = externalWorker?.logFile;

        // If no explicit logFile in workers.json, try conventional path.
        if (!logFile) {
          const conventionalPath = path.join(teamDir, 'worker-logs', `${agentName}.log`);
          if (fs.existsSync(conventionalPath)) {
            logFile = conventionalPath;
          }
        }

        if (logFile && fs.existsSync(logFile)) {
          // Read logs from the external worker's log file.
          const historyContent = readLogFileTail(logFile, LOG_HISTORY_MAX_BYTES);
          ws.send(JSON.stringify({
            type: 'history',
            agent: agentName,
            lines: historyContent ? [historyContent] : [],
          }));
          // Start watching the log file for live updates.
          watchLogFile(agentName, logFile);
        } else {
          // For daemon-connected agents without log files, explain PTY output limitations.
          ws.send(JSON.stringify({
            type: 'history',
            agent: agentName,
            lines: [`[${agentName} is a daemon-connected agent - PTY output not available. Showing relay messages only.]`],
          }));
        }
      }

      ws.send(JSON.stringify({
        type: 'sync',
        serverTimestamp: Date.now(),
        sequenceId: getAgentLogBuffer(agentName).currentId(),
      }));

      ws.send(JSON.stringify({
        type: 'subscribed',
        agent: agentName,
      }));

      return true;
    };

    // Check if agent name is in URL path: /ws/logs/:agentName.
    const pathname = new URL(req.url || '', `http://${req.headers.host}`).pathname;
    const pathMatch = pathname.match(/^\/ws\/logs\/(.+)$/);
    if (pathMatch) {
      let agentName: string;
      try {
        agentName = decodeURIComponent(pathMatch[1]);
      } catch {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid log stream path encoding',
        }));
        ws.close(1003, 'invalid-path');
        return;
      }
      subscribeToAgent(agentName).catch((err) => {
        console.error(`[dashboard] Error subscribing to ${agentName}:`, err);
      });
    }

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Subscribe to agent logs.
        if (msg.subscribe && typeof msg.subscribe === 'string') {
          subscribeToAgent(msg.subscribe).catch((err) => {
            console.error(`[dashboard] Error subscribing to ${msg.subscribe}:`, err);
          });
        }

        // Unsubscribe from agent logs.
        if (msg.unsubscribe && typeof msg.unsubscribe === 'string') {
          const agentName = msg.unsubscribe;
          clientSubscriptions.delete(agentName);
          logSubscriptions.get(agentName)?.delete(ws);
          cleanupAgentSubscription(agentName);

          debug(`[dashboard] Client unsubscribed from logs for: ${agentName}`);

          ws.send(JSON.stringify({
            type: 'unsubscribed',
            agent: agentName,
          }));
        }

        // Handle interactive terminal input.
        if (msg.type === 'input' && typeof msg.data === 'string') {
          // Get agent name from message or use first subscribed agent.
          const agentName = msg.agent || [...clientSubscriptions][0];

          if (!agentName) {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'No agent subscribed for input',
            }));
            return;
          }

          // Check if this is a spawned agent (we can only send input to spawned agents).
          if (spawnReader?.hasWorker(agentName)) {
            const success = await spawnReader.sendWorkerInput(agentName, msg.data);
            if (!success) {
              console.warn(`[dashboard] Failed to send input to agent ${agentName}`);
            }
          } else {
            // Daemon-connected agents don't support direct input.
            ws.send(JSON.stringify({
              type: 'error',
              agent: agentName,
              error: 'Interactive input not supported for daemon-connected agents',
            }));
          }
        }

        // Handle replay request:
        // { type: "replay", agent: "name", lastSequenceId: N } (preferred)
        // { type: "replay", agent: "name", lastTimestamp: N } (legacy fallback)
        if (msg.type === 'replay' && typeof msg.agent === 'string') {
          const logBuffer = agentLogBuffers.get(msg.agent);
          if (!logBuffer || ws.readyState !== WebSocket.OPEN) {
            return;
          }

          try {
            const missed = typeof msg.lastSequenceId === 'number'
              ? logBuffer.getAfter(msg.lastSequenceId)
              : typeof msg.lastTimestamp === 'number'
                ? logBuffer.getAfterTimestamp(msg.lastTimestamp)
                : [];

            const messages = missed.map((m) => {
              try {
                const parsed = JSON.parse(m.payload);
                if (parsed && typeof parsed === 'object') {
                  return { ...(parsed as Record<string, unknown>), seq: m.id };
                }
              } catch {
                // Fallback to raw payload.
              }

              return {
                type: 'output',
                agent: msg.agent,
                data: m.payload,
                content: m.payload,
                timestamp: new Date(m.timestamp).toISOString(),
                seq: m.id,
              };
            });

            const entries = messages.map((message) => {
              const typed = message as { content?: unknown; data?: unknown; timestamp?: unknown };
              const content = typeof typed.content === 'string'
                ? typed.content
                : typeof typed.data === 'string'
                  ? typed.data
                  : '';
              const timestamp = typeof typed.timestamp === 'string'
                ? Date.parse(typed.timestamp)
                : NaN;
              return {
                content,
                timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
              };
            });

            ws.send(JSON.stringify({
              type: 'replay',
              agent: msg.agent,
              messages,
              entries,
            }));
          } catch (err) {
            console.error('[dashboard] Failed to replay log messages:', err);
          }
        }
      } catch (err) {
        console.error('[dashboard] Invalid logs WebSocket message:', err);
      }
    });

    ws.on('error', (err) => {
      console.error('[dashboard] Logs WebSocket client error:', err);
    });

    ws.on('close', (code, reason) => {
      // Clean up subscriptions on disconnect.
      for (const agentName of clientSubscriptions) {
        logSubscriptions.get(agentName)?.delete(ws);
        const remainingClients = logSubscriptions.get(agentName);
        if (!remainingClients || remainingClients.size === 0) {
          const watcher = fileWatchers.get(agentName);
          if (watcher) {
            watcher.close();
            fileWatchers.delete(agentName);
            fileLastSize.delete(agentName);
            agentLogBuffers.delete(agentName);
            console.log(`[dashboard] Stopped watching log file for: ${agentName}`);
          }
        }
      }
      const reasonStr = reason?.toString() || 'no reason';
      console.log(`[dashboard] Logs WebSocket client disconnected (code: ${code}, reason: ${reasonStr})`);
    });
  });
}
