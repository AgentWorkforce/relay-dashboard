// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { isToolActivity, toolCorrelationId } from "./activity-summary";
import type { ReplayEvent } from "./replay-model";

export type CaptureCluster = {
  survivor: number;
  members: number[];
  lanes: Set<string>;
  rank: number;
  group: string;
  message: string;
  tool: string;
  time: number;
  activity: boolean;
};

type Bucket = { all: Set<CaptureCluster>; available: Map<string, Set<CaptureCluster>> };
const key = (...parts: unknown[]) => JSON.stringify(parts);
const storedIds = (id: string) => [id, null];
const compatibleIds = (id?: string | null) => id ? [id, ""] : [null];

/** Index both known and missing IDs. Wildcard keys let a capture that omitted
 * metadata find a compatible copy without scanning unrelated tool identities.
 * Per-lane pools consume anonymous occurrences once per representation.
 */
export class CaptureIndex {
  private groups = new Map<string, Map<string, Bucket>>();

  private keys(cluster: CaptureCluster): string[] {
    const { message, tool, time, activity } = cluster;
    const keys: string[] = [];
    if (message) for (const id of storedIds(tool)) keys.push(key("message", message, id));
    if (tool) for (const id of storedIds(message)) keys.push(key("tool", tool, id));
    const times: (number | string)[] = time > 0 ? [time] : [];
    if (activity) times.push("undated-tool");
    for (const instant of times) for (const m of storedIds(message)) for (const t of storedIds(tool)) {
      keys.push(key("time", instant, m, t));
    }
    return keys;
  }

  add(cluster: CaptureCluster) {
    let buckets = this.groups.get(cluster.group);
    if (!buckets) { buckets = new Map(); this.groups.set(cluster.group, buckets); }
    for (const entry of this.keys(cluster)) {
      let bucket = buckets.get(entry);
      if (!bucket) { bucket = { all: new Set(), available: new Map() }; buckets.set(entry, bucket); }
      bucket.all.add(cluster);
      for (const [lane, pool] of bucket.available) if (!cluster.lanes.has(lane)) pool.add(cluster);
    }
  }

  remove(cluster: CaptureCluster) {
    const buckets = this.groups.get(cluster.group);
    if (!buckets) return;
    for (const entry of this.keys(cluster)) {
      const bucket = buckets.get(entry);
      if (!bucket) continue;
      bucket.all.delete(cluster);
      for (const pool of bucket.available.values()) pool.delete(cluster);
    }
  }

  find(event: ReplayEvent, group: string, lane?: string, allowUndatedTools = false): CaptureCluster | undefined {
    const message = event.messageId ?? "";
    const tool = toolCorrelationId(event) ?? "";
    const identities: string[] = [];
    if (message) for (const id of compatibleIds(tool)) identities.push(key("message", message, id));
    if (tool) for (const id of compatibleIds(message)) identities.push(key("tool", tool, id));
    const shared = this.first(group, identities);
    if (shared) return shared;
    const time = Date.parse(event.ts);
    // Text alone cannot establish that an undated human turn is a duplicate.
    const instant = time > 0 ? time : allowUndatedTools && isToolActivity(event) ? "undated-tool" : null;
    if (instant === null) return undefined;
    const captures: string[] = [];
    for (const m of compatibleIds(message)) for (const t of compatibleIds(tool)) captures.push(key("time", instant, m, t));
    return this.first(group, captures, lane);
  }

  private first(group: string, keys: string[], lane?: string): CaptureCluster | undefined {
    const buckets = this.groups.get(group);
    if (!buckets) return undefined;
    let first: CaptureCluster | undefined;
    for (const entry of keys) {
      const bucket = buckets.get(entry);
      if (!bucket) continue;
      let pool = bucket.all;
      if (lane !== undefined) {
        let available = bucket.available.get(lane);
        if (!available) {
          available = new Set([...pool].filter(cluster => !cluster.lanes.has(lane)));
          bucket.available.set(lane, available);
        }
        pool = available;
      }
      const candidate = pool.values().next().value;
      if (candidate && (!first || candidate.rank < first.rank)) first = candidate;
    }
    return first;
  }
}

export function captureCluster(event: ReplayEvent, group: string, survivor: number, rank: number, lane?: string): CaptureCluster {
  return {
    survivor, rank, group, members: [survivor], lanes: new Set(lane === undefined ? [] : [lane]),
    message: event.messageId ?? "", tool: toolCorrelationId(event) ?? "",
    time: Date.parse(event.ts), activity: isToolActivity(event),
  };
}
