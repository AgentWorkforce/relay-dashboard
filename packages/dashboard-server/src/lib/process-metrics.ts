import fs from 'fs';
import { execSync } from 'child_process';

export type ProcessUsage = {
  rssBytes: number;
  cpuPercent: number;
};

type ProcessNode = {
  ppid: number;
  rssBytes: number;
  cpuPercent: number;
};

/**
 * Build process-tree metrics helpers with internal sampling caches.
 */
export function createProcessMetrics() {
  const isCloudMetricsEnabled = process.env.RELAY_CLOUD_ENABLED === 'true';
  const isLinux = process.platform === 'linux';
  const clockTicksPerSecond = (() => {
    try {
      const output = execSync('getconf CLK_TCK', { encoding: 'utf8' });
      const ticks = parseInt(output.trim(), 10);
      return Number.isFinite(ticks) && ticks > 0 ? ticks : 100;
    } catch {
      return 100;
    }
  })();

  const procTreeCpuSamples = new Map<number, { timestampMs: number; totalJiffies: number }>();
  const psTreeSnapshotCache = {
    timestampMs: 0,
    processByPid: new Map<number, ProcessNode>(),
    childrenByPid: new Map<number, number[]>(),
  };
  const psTreeCacheTtlMs = 1000;

  const getProcStatusRssBytes = (pid: number): number => {
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const rssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
      if (rssMatch) {
        return parseInt(rssMatch[1], 10) * 1024;
      }
    } catch {
      return 0;
    }
    return 0;
  };

  const getProcStatJiffies = (pid: number): number => {
    try {
      const statText = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const closeParen = statText.lastIndexOf(')');
      if (closeParen < 0) return 0;

      const parts = statText.slice(closeParen + 1).trim().split(/\s+/);
      const utime = parseInt(parts[11] ?? '0', 10);
      const stime = parseInt(parts[12] ?? '0', 10);
      const utimeValue = Number.isFinite(utime) ? utime : 0;
      const stimeValue = Number.isFinite(stime) ? stime : 0;

      return utimeValue + stimeValue;
    } catch {
      return 0;
    }
  };

  const getProcTreePids = (rootPid: number): number[] => {
    const toProcess = [rootPid];
    const seen = new Set<number>();
    const result: number[] = [];

    while (toProcess.length > 0) {
      const pid = toProcess.shift();
      if (pid === undefined || seen.has(pid)) continue;

      const procPath = `/proc/${pid}`;
      if (!fs.existsSync(procPath)) continue;

      seen.add(pid);
      result.push(pid);

      const childrenPath = `/proc/${pid}/task/${pid}/children`;
      if (fs.existsSync(childrenPath)) {
        const childrenText = fs.readFileSync(childrenPath, 'utf8').trim();
        if (childrenText) {
          for (const child of childrenText.split(/\s+/)) {
            const childPid = parseInt(child, 10);
            if (Number.isFinite(childPid) && childPid > 0) {
              toProcess.push(childPid);
            }
          }
        }
      }
    }

    return result;
  };

  const getPsTreeSnapshot = () => {
    const nowMs = Date.now();
    if (nowMs - psTreeSnapshotCache.timestampMs <= psTreeCacheTtlMs) {
      return {
        processByPid: psTreeSnapshotCache.processByPid,
        childrenByPid: psTreeSnapshotCache.childrenByPid,
      };
    }

    try {
      const output = execSync('ps -axo pid=,ppid=,rss=,pcpu=', {
        encoding: 'utf8',
        timeout: 3000,
      }).trim();
      if (!output) {
        return {
          processByPid: new Map<number, ProcessNode>(),
          childrenByPid: new Map<number, number[]>(),
        };
      }

      const processByPid = new Map<number, ProcessNode>();
      const childrenByPid = new Map<number, number[]>();

      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;

        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        const rssBytes = parseInt(parts[2], 10) * 1024;
        const cpuPercent = parseFloat(parts[3]);

        if (!Number.isFinite(pid) || pid <= 0) continue;

        processByPid.set(pid, {
          ppid: Number.isFinite(ppid) ? ppid : 0,
          rssBytes: Number.isFinite(rssBytes) ? rssBytes : 0,
          cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
        });

        const parentPid = Number.isFinite(ppid) ? ppid : 0;
        const children = childrenByPid.get(parentPid) || [];
        children.push(pid);
        childrenByPid.set(parentPid, children);
      }

      psTreeSnapshotCache.timestampMs = nowMs;
      psTreeSnapshotCache.processByPid = processByPid;
      psTreeSnapshotCache.childrenByPid = childrenByPid;

      return { processByPid, childrenByPid };
    } catch {
      return {
        processByPid: new Map<number, ProcessNode>(),
        childrenByPid: new Map<number, number[]>(),
      };
    }
  };

  const getPsTreeUsage = (rootPid: number): ProcessUsage => {
    try {
      const { processByPid, childrenByPid } = getPsTreeSnapshot();
      if (processByPid.size === 0) {
        return { rssBytes: 0, cpuPercent: 0 };
      }

      const queue = [rootPid];
      const seen = new Set<number>();
      let totalRssBytes = 0;
      let totalCpuPercent = 0;

      while (queue.length > 0) {
        const pid = queue.shift();
        if (pid === undefined || seen.has(pid)) continue;

        const node = processByPid.get(pid);
        if (!node) continue;
        seen.add(pid);

        totalRssBytes += node.rssBytes;
        totalCpuPercent += node.cpuPercent;

        const children = childrenByPid.get(pid);
        if (children) {
          queue.push(...children);
        }
      }

      return { rssBytes: totalRssBytes, cpuPercent: totalCpuPercent };
    } catch {
      return { rssBytes: 0, cpuPercent: 0 };
    }
  };

  const getLegacyProcUsage = (rootPid: number): ProcessUsage => {
    let rssBytes = 0;
    let cpuPercent = 0;

    try {
      const statusPath = `/proc/${rootPid}/status`;
      if (fs.existsSync(statusPath)) {
        const status = fs.readFileSync(statusPath, 'utf8');
        const rssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
        if (rssMatch) {
          rssBytes = parseInt(rssMatch[1], 10) * 1024;
        }
      } else if (process.platform === 'darwin') {
        const psOutput = execSync(`ps -o rss=,pcpu= -p ${rootPid}`, { encoding: 'utf8', timeout: 3000 }).trim();
        if (psOutput) {
          const [rssStr, cpuStr] = psOutput.split(/\s+/);
          if (rssStr) rssBytes = parseInt(rssStr, 10) * 1024;
          if (cpuStr) cpuPercent = parseFloat(cpuStr);
        }
      }
    } catch {
      // Process may have exited or command failed.
    }

    return {
      rssBytes,
      cpuPercent,
    };
  };

  const getCloudProcTreeUsage = (rootPid: number): ProcessUsage => {
    if (!Number.isFinite(rootPid) || rootPid <= 0) {
      return { rssBytes: 0, cpuPercent: 0 };
    }

    try {
      const statusPath = `/proc/${rootPid}/status`;
      if (!fs.existsSync(statusPath)) {
        procTreeCpuSamples.delete(rootPid);
        return getPsTreeUsage(rootPid);
      }

      const pids = getProcTreePids(rootPid);
      if (pids.length === 0) {
        procTreeCpuSamples.delete(rootPid);
        return { rssBytes: 0, cpuPercent: 0 };
      }

      let totalRssBytes = 0;
      let totalJiffies = 0;

      for (const pid of pids) {
        totalRssBytes += getProcStatusRssBytes(pid);
        totalJiffies += getProcStatJiffies(pid);
      }

      const nowMs = Date.now();
      const previous = procTreeCpuSamples.get(rootPid);
      procTreeCpuSamples.set(rootPid, { timestampMs: nowMs, totalJiffies });

      if (!previous || nowMs <= previous.timestampMs) {
        return { rssBytes: totalRssBytes, cpuPercent: 0 };
      }

      const elapsedMs = nowMs - previous.timestampMs;
      const elapsedJiffies = totalJiffies - previous.totalJiffies;
      if (elapsedJiffies <= 0 || elapsedMs <= 0) {
        return { rssBytes: totalRssBytes, cpuPercent: 0 };
      }

      const cpuPercent = Math.max(0, (elapsedJiffies / clockTicksPerSecond / (elapsedMs / 1000)) * 100);

      return {
        rssBytes: totalRssBytes,
        cpuPercent,
      };
    } catch {
      return { rssBytes: 0, cpuPercent: 0 };
    }
  };

  const getProcTreeUsage = (rootPid: number): ProcessUsage => {
    if (!isCloudMetricsEnabled) {
      return getLegacyProcUsage(rootPid);
    }

    if (!isLinux) {
      return getPsTreeUsage(rootPid);
    }

    return getCloudProcTreeUsage(rootPid);
  };

  return { getProcTreeUsage };
}
