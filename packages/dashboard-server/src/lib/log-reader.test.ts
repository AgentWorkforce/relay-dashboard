import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  sanitizeLogAgentName,
  listStandaloneLogAgents,
  readRecentLogLines,
  getWorkerLogsDir,
} from './log-reader.js';

describe('sanitizeLogAgentName', () => {
  it('returns trimmed name for valid input', () => {
    expect(sanitizeLogAgentName('WorkerA')).toBe('WorkerA');
    expect(sanitizeLogAgentName('  Agent1  ')).toBe('Agent1');
  });

  it('rejects path traversal', () => {
    expect(sanitizeLogAgentName('../etc/passwd')).toBeNull();
    expect(sanitizeLogAgentName('foo/bar')).toBeNull();
    expect(sanitizeLogAgentName('foo\\bar')).toBeNull();
  });

  it('rejects null bytes', () => {
    expect(sanitizeLogAgentName('agent\0name')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(sanitizeLogAgentName('')).toBeNull();
    expect(sanitizeLogAgentName('  ')).toBeNull();
  });
});

describe('getWorkerLogsDir', () => {
  it('returns correct path', () => {
    expect(getWorkerLogsDir('/data')).toBe(path.join('/data', 'team', 'worker-logs'));
  });
});

describe('listStandaloneLogAgents', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-reader-test-'));
    const logsDir = path.join(tmpDir, 'team', 'worker-logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'Alpha.log'), 'log content');
    fs.writeFileSync(path.join(logsDir, 'Beta.log'), 'log content');
    fs.writeFileSync(path.join(logsDir, 'not-a-log.txt'), 'ignored');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists .log file agents sorted', () => {
    const agents = listStandaloneLogAgents(tmpDir);
    expect(agents).toEqual(['Alpha', 'Beta']);
  });

  it('returns empty for non-existent dir', () => {
    expect(listStandaloneLogAgents('/nonexistent')).toEqual([]);
  });
});

describe('readRecentLogLines', () => {
  let tmpFile: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-lines-test-'));
    tmpFile = path.join(tmpDir, 'test.log');
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i + 1}`);
    fs.writeFileSync(tmpFile, lines.join('\n') + '\n');
  });

  it('returns last N lines', () => {
    const lines = readRecentLogLines(tmpFile, 10);
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe('line-291');
    expect(lines[9]).toBe('line-300');
  });

  it('returns all lines when fewer than limit', () => {
    const lines = readRecentLogLines(tmpFile, 500);
    expect(lines).toHaveLength(300);
  });

  it('returns empty for non-existent file', () => {
    expect(readRecentLogLines('/nonexistent/file.log')).toEqual([]);
  });
});
