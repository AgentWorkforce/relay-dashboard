/**
 * Standalone log WebSocket handler — tails local worker log files.
 */

import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { normalizeAgentName } from '../lib/utils.js';
import {
  getWorkerLogsDir,
  sanitizeLogAgentName,
  listStandaloneLogAgents,
  readRecentLogLines,
  readLogDelta,
  STANDALONE_LOG_POLL_MS,
} from '../lib/log-reader.js';

export function handleStandaloneLogWebSocket(
  ws: WebSocket,
  pathname: string,
  dataDir: string,
  getLocalAgentNames: () => Set<string> | null,
  verbose: boolean,
): void {
  const segments = pathname.split('/').filter(Boolean);
  const encodedAgentName = segments.length >= 3 ? segments[segments.length - 1] : '';
  const agentName = sanitizeLogAgentName(decodeURIComponent(encodedAgentName));

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
  const normalizedName = normalizeAgentName(agentName);

  const knownLocalAgents = getLocalAgentNames();
  const isKnownLocalAgent = knownLocalAgents !== null && knownLocalAgents.has(normalizedName);

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
    const lines = readRecentLogLines(logFile);
    ws.send(JSON.stringify({ type: 'subscribed', agent: agentName }));
    ws.send(JSON.stringify({ type: 'history', agent: agentName, lines }));
    syncOffsetToEnd();
  };

  if (!fs.existsSync(logFile) && !isKnownLocalAgent) {
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
      ws.send(JSON.stringify({
        type: 'log',
        agent: agentName,
        content: delta.content,
      }));
    }
  }, STANDALONE_LOG_POLL_MS);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as { type?: string };
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (message.type === 'subscribe' || message.type === 'replay' || message.type === 'refresh') {
        sendHistory();
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
