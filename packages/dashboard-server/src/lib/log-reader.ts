/**
 * Log file reading utilities for standalone worker logs.
 */

import fs from 'fs';
import path from 'path';

export const STANDALONE_LOG_POLL_MS = 1000;
export const STANDALONE_LOG_HISTORY_LINES = 200;

export function getWorkerLogsDir(dataDir: string): string {
  return path.join(dataDir, 'team', 'worker-logs');
}

export function sanitizeLogAgentName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return null;
  }
  return trimmed;
}

export function listStandaloneLogAgents(dataDir: string): string[] {
  const logsDir = getWorkerLogsDir(dataDir);
  if (!fs.existsSync(logsDir)) {
    return [];
  }

  try {
    return fs
      .readdirSync(logsDir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => name.slice(0, -4))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function readRecentLogLines(filePath: string, lineLimit = STANDALONE_LOG_HISTORY_LINES): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines.slice(-lineLimit);
  } catch {
    return [];
  }
}

export function readLogDelta(
  filePath: string,
  offset: number,
): { nextOffset: number; content: string } {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);
    const start = stats.size < offset ? 0 : offset;
    if (stats.size <= start) {
      return { nextOffset: start, content: '' };
    }

    const length = stats.size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return {
      nextOffset: stats.size,
      content: buffer.toString('utf-8'),
    };
  } catch {
    return { nextOffset: offset, content: '' };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failures.
      }
    }
  }
}
