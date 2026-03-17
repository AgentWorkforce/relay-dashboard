import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
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

