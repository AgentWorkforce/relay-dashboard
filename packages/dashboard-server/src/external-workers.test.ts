/**
 * External Workers Tests
 *
 * Tests for detecting and serving logs from externally-spawned workers.
 * External workers are agents spawned by processes other than the dashboard's
 * spawner (e.g., agentswarm, SDK, relay-pty direct usage).
 *
 * These workers are tracked in workers.json with logFile paths, but the
 * dashboard's spawner.activeWorkers map doesn't know about them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Helper to create a temp directory structure for testing
function createTempTeamDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
  const teamDir = path.join(tmpDir, 'team');
  const logsDir = path.join(teamDir, 'worker-logs');
  fs.mkdirSync(teamDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  return tmpDir;
}

// Helper to clean up temp directory
function cleanupTempDir(tmpDir: string): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('External Worker Detection', () => {
  let tmpDir: string;
  let teamDir: string;

  beforeEach(() => {
    tmpDir = createTempTeamDir();
    teamDir = path.join(tmpDir, 'team');
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe('workers.json parsing', () => {
    it('should find external worker with log file', () => {
      const logFile = path.join(teamDir, 'worker-logs', 'TestWorker.log');
      fs.writeFileSync(logFile, 'test log content');

      const workersJson = {
        workers: [
          {
            name: 'TestWorker',
            cli: 'claude',
            task: 'Test task',
            spawnedAt: Date.now(),
            pid: 12345,
            logFile,
          },
        ],
      };
      fs.writeFileSync(path.join(teamDir, 'workers.json'), JSON.stringify(workersJson));

      // Simulate the detection logic from server.ts
      const workersData = JSON.parse(fs.readFileSync(path.join(teamDir, 'workers.json'), 'utf-8'));
      const worker = workersData.workers.find((w: { name: string }) => w.name === 'TestWorker');

      expect(worker).toBeDefined();
      expect(worker.logFile).toBe(logFile);
      expect(fs.existsSync(worker.logFile)).toBe(true);
    });

    it('should handle missing workers.json gracefully', () => {
      const workersPath = path.join(teamDir, 'workers.json');
      expect(fs.existsSync(workersPath)).toBe(false);

      // Should not throw
      let workers: any[] = [];
      if (fs.existsSync(workersPath)) {
        const data = JSON.parse(fs.readFileSync(workersPath, 'utf-8'));
        workers = data.workers || [];
      }
      expect(workers).toEqual([]);
    });

    it('should handle worker without log file', () => {
      const workersJson = {
        workers: [
          {
            name: 'WorkerNoLog',
            cli: 'claude',
            task: 'Test task',
            spawnedAt: Date.now(),
            // No logFile field
          },
        ],
      };
      fs.writeFileSync(path.join(teamDir, 'workers.json'), JSON.stringify(workersJson));

      const workersData = JSON.parse(fs.readFileSync(path.join(teamDir, 'workers.json'), 'utf-8'));
      const worker = workersData.workers.find((w: { name: string }) => w.name === 'WorkerNoLog');

      expect(worker).toBeDefined();
      expect(worker.logFile).toBeUndefined();
    });

    it('should handle worker with non-existent log file', () => {
      const logFile = path.join(teamDir, 'worker-logs', 'NonExistent.log');

      const workersJson = {
        workers: [
          {
            name: 'WorkerMissingLog',
            cli: 'claude',
            task: 'Test task',
            spawnedAt: Date.now(),
            logFile, // Points to non-existent file
          },
        ],
      };
      fs.writeFileSync(path.join(teamDir, 'workers.json'), JSON.stringify(workersJson));

      const workersData = JSON.parse(fs.readFileSync(path.join(teamDir, 'workers.json'), 'utf-8'));
      const worker = workersData.workers.find((w: { name: string }) => w.name === 'WorkerMissingLog');

      expect(worker).toBeDefined();
      expect(worker.logFile).toBe(logFile);
      expect(fs.existsSync(worker.logFile)).toBe(false);
    });
  });
});

describe('Log File Reading', () => {
  let tmpDir: string;
  let teamDir: string;

  beforeEach(() => {
    tmpDir = createTempTeamDir();
    teamDir = path.join(tmpDir, 'team');
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe('readLogsFromFile', () => {
    // Simulate the readLogsFromFile helper from server.ts
    const readLogsFromFile = (logFile: string, limit: number = 5000): string[] => {
      if (!fs.existsSync(logFile)) return [];
      try {
        const content = fs.readFileSync(logFile, 'utf-8');
        const lines = content.split('\n');
        return lines.slice(-limit);
      } catch {
        return [];
      }
    };

    it('should read all lines from small log file', () => {
      const logFile = path.join(teamDir, 'worker-logs', 'small.log');
      fs.writeFileSync(logFile, 'line1\nline2\nline3');

      const lines = readLogsFromFile(logFile);
      expect(lines).toEqual(['line1', 'line2', 'line3']);
    });

    it('should limit lines from large log file', () => {
      const logFile = path.join(teamDir, 'worker-logs', 'large.log');
      const manyLines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join('\n');
      fs.writeFileSync(logFile, manyLines);

      const lines = readLogsFromFile(logFile, 10);
      expect(lines.length).toBe(10);
      expect(lines[0]).toBe('line91');
      expect(lines[9]).toBe('line100');
    });

    it('should return empty array for non-existent file', () => {
      const lines = readLogsFromFile('/non/existent/file.log');
      expect(lines).toEqual([]);
    });

    it('should handle empty log file', () => {
      const logFile = path.join(teamDir, 'worker-logs', 'empty.log');
      fs.writeFileSync(logFile, '');

      const lines = readLogsFromFile(logFile);
      expect(lines).toEqual(['']);
    });

    it('should preserve ANSI escape codes in log content', () => {
      const logFile = path.join(teamDir, 'worker-logs', 'ansi.log');
      const ansiContent = '\x1b[31mError:\x1b[0m Something went wrong';
      fs.writeFileSync(logFile, ansiContent);

      const lines = readLogsFromFile(logFile);
      expect(lines[0]).toBe(ansiContent);
    });
  });
});

describe('isSpawned Flag for External Workers', () => {
  let tmpDir: string;
  let teamDir: string;

  beforeEach(() => {
    tmpDir = createTempTeamDir();
    teamDir = path.join(tmpDir, 'team');
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('should mark agent as spawned when found in workers.json with valid log file', () => {
    const logFile = path.join(teamDir, 'worker-logs', 'ExternalAgent.log');
    fs.writeFileSync(logFile, 'log content');

    const workersJson = {
      workers: [{ name: 'ExternalAgent', cli: 'claude', task: 'Task', spawnedAt: Date.now(), logFile }],
    };
    fs.writeFileSync(path.join(teamDir, 'workers.json'), JSON.stringify(workersJson));

    // Simulate agent detection logic
    const agentsMap = new Map<string, { name: string; isSpawned?: boolean }>();
    agentsMap.set('ExternalAgent', { name: 'ExternalAgent', isSpawned: false });

    // Check workers.json for external workers
    const workersData = JSON.parse(fs.readFileSync(path.join(teamDir, 'workers.json'), 'utf-8'));
    for (const worker of workersData.workers || []) {
      const agent = agentsMap.get(worker.name);
      if (agent && !agent.isSpawned && worker.logFile && fs.existsSync(worker.logFile)) {
        agent.isSpawned = true;
      }
    }

    expect(agentsMap.get('ExternalAgent')?.isSpawned).toBe(true);
  });

  it('should NOT mark agent as spawned when log file does not exist', () => {
    const workersJson = {
      workers: [{ name: 'NoLogAgent', cli: 'claude', task: 'Task', spawnedAt: Date.now(), logFile: '/nonexistent.log' }],
    };
    fs.writeFileSync(path.join(teamDir, 'workers.json'), JSON.stringify(workersJson));

    const agentsMap = new Map<string, { name: string; isSpawned?: boolean }>();
    agentsMap.set('NoLogAgent', { name: 'NoLogAgent', isSpawned: false });

    const workersData = JSON.parse(fs.readFileSync(path.join(teamDir, 'workers.json'), 'utf-8'));
    for (const worker of workersData.workers || []) {
      const agent = agentsMap.get(worker.name);
      if (agent && !agent.isSpawned && worker.logFile && fs.existsSync(worker.logFile)) {
        agent.isSpawned = true;
      }
    }

    expect(agentsMap.get('NoLogAgent')?.isSpawned).toBe(false);
  });

  it('should NOT override isSpawned if already true (from dashboard spawner)', () => {
    const logFile = path.join(teamDir, 'worker-logs', 'DashboardAgent.log');
    fs.writeFileSync(logFile, 'log content');

    const workersJson = {
      workers: [{ name: 'DashboardAgent', cli: 'claude', task: 'Task', spawnedAt: Date.now(), logFile }],
    };
    fs.writeFileSync(path.join(teamDir, 'workers.json'), JSON.stringify(workersJson));

    const agentsMap = new Map<string, { name: string; isSpawned?: boolean }>();
    agentsMap.set('DashboardAgent', { name: 'DashboardAgent', isSpawned: true }); // Already spawned by dashboard

    const workersData = JSON.parse(fs.readFileSync(path.join(teamDir, 'workers.json'), 'utf-8'));
    for (const worker of workersData.workers || []) {
      const agent = agentsMap.get(worker.name);
      if (agent && !agent.isSpawned && worker.logFile && fs.existsSync(worker.logFile)) {
        agent.isSpawned = true;
      }
    }

    // Should still be true, not overwritten
    expect(agentsMap.get('DashboardAgent')?.isSpawned).toBe(true);
  });
});
