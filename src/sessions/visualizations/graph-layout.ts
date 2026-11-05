// Ported from Cloud session visualizations, head55bfc58fb.
import type {
  SessionGraphEdge,
  SessionGraphHandoff,
  SessionGraphNode,
  SessionGraphUnresolved,
  SessionWorkGraph,
} from "./session-graph-data";

export type GraphGroup = {
  orientation: "horizontal" | "vertical";
  /** Stable connected-component identity, independent of row order or focus. */
  id: string;
  /** Representatives of source components in the directed structural graph. */
  rootIds: string[];
  rootId: string;
  title: string;
  hasCycle: boolean;
  hasStructuralEdges: boolean;
  presentCount: number;
  activeCount: number;
  pullRequestCount: number;
  nodes: Array<SessionGraphNode & { x: number; y: number }>;
  /** Communication links are visible evidence, never hierarchy. */
  handoffs: SessionGraphHandoff[];
  totalHandoffs: number;
  hiddenHandoffs: number;
  edges: SessionGraphEdge[];
  totalEdges: number;
  hiddenEdges: number;
  unresolved: SessionGraphUnresolved[];
  hiddenUnresolved: number;
  width: number;
  height: number;
  lastTs: number;
  totalNodes: number;
  hiddenNodes: number;
};

const CARD_WIDTH = 248;
const CARD_HEIGHT = 126;
const COLUMN_GAP = 104;
const ROW_GAP = 50;
const VERTICAL_GAP = 72;
const PAD = 32;
const RIGHT_HANDOFF_LANE = 72;
const DEFAULT_MAX_NODES = 24;

function time(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A strongly connected component is one level: a cycle has no invented root. */
function directedHierarchy(
  ids: ReadonlySet<string>,
  edges: SessionGraphEdge[],
): { roots: string[]; levels: Map<string, number>; hasCycle: boolean } {
  const sortedIds = [...ids].sort();
  const outgoing = new Map(sortedIds.map((id) => [id, new Set<string>()]));
  const incoming = new Map(sortedIds.map((id) => [id, new Set<string>()]));
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    outgoing.get(edge.from)!.add(edge.to);
    incoming.get(edge.to)!.add(edge.from);
  }
  const forward = new Map(sortedIds.map((id) => [id, [...outgoing.get(id)!].sort()]));
  const reverse = new Map(sortedIds.map((id) => [id, [...incoming.get(id)!].sort()]));

  // Iterative Kosaraju avoids stack overflow on long session chains.
  const visited = new Set<string>();
  const finished: string[] = [];
  for (const start of sortedIds) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ id: string; next: number }> = [{ id: start, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const children = forward.get(frame.id)!;
      if (frame.next < children.length) {
        const next = children[frame.next++]!;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ id: next, next: 0 });
        }
      } else {
        finished.push(frame.id);
        stack.pop();
      }
    }
  }

  const componentOf = new Map<string, number>();
  const components: string[][] = [];
  for (const start of finished.reverse()) {
    if (componentOf.has(start)) continue;
    const index = components.length;
    const members: string[] = [];
    const stack = [start];
    componentOf.set(start, index);
    while (stack.length) {
      const id = stack.pop()!;
      members.push(id);
      for (const parent of reverse.get(id)!) {
        if (componentOf.has(parent)) continue;
        componentOf.set(parent, index);
        stack.push(parent);
      }
    }
    members.sort();
    components.push(members);
  }

  const componentOut = components.map(() => new Set<number>());
  const indegree = components.map(() => 0);
  let hasCycle = components.some((members) => members.length > 1);
  for (const edge of edges) {
    const from = componentOf.get(edge.from);
    const to = componentOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (from === to) {
      if (edge.from === edge.to) hasCycle = true;
      continue;
    }
    if (componentOut[from]!.has(to)) continue;
    componentOut[from]!.add(to);
    indegree[to]!++;
  }
  const roots = components
    .filter((_, index) => indegree[index] === 0)
    .map((members) => members[0]!)
    .sort();
  const remaining = [...indegree];
  const depth = components.map(() => 0);
  const compareComponents = (a: number, b: number) =>
    components[a]![0]!.localeCompare(components[b]![0]!);
  const queue = components
    .map((_, index) => index)
    .filter((index) => remaining[index] === 0)
    .sort(compareComponents);
  while (queue.length) {
    const from = queue.shift()!;
    for (const to of [...componentOut[from]!].sort(compareComponents)) {
      depth[to] = Math.max(depth[to]!, depth[from]! + 1);
      remaining[to]!--;
      if (remaining[to] === 0) {
        queue.push(to);
        queue.sort(compareComponents);
      }
    }
  }
  return {
    roots,
    levels: new Map(sortedIds.map((id) => [id, depth[componentOf.get(id)!]!])),
    hasCycle,
  };
}

function connectedNeighborhood(
  ids: ReadonlySet<string>,
  neighbors: Map<string, Set<string>>,
  ordered: string[],
  focusId: string | null | undefined,
  maxNodes: number,
): Set<string> {
  const visible = new Set<string>();
  const pending = [focusId && ids.has(focusId) ? focusId : ordered[0]!];
  const queued = new Set(pending);
  const rank = new Map(ordered.map((id, index) => [id, index]));
  while (pending.length && visible.size < maxNodes) {
    const id = pending.shift()!;
    queued.delete(id);
    if (visible.has(id)) continue;
    visible.add(id);
    for (const next of [...(neighbors.get(id) ?? [])]
      .filter((candidate) => ids.has(candidate))
      .sort((a, b) => rank.get(a)! - rank.get(b)!)) {
      if (!visible.has(next) && !queued.has(next)) {
        pending.push(next);
        queued.add(next);
      }
    }
  }
  return visible;
}

function groupTitle(node: SessionGraphNode): string {
  const title = node.title?.trim();
  const generatedSuffix = " · " + node.sessionId.slice(0, 8);
  const recordedTitle = title && !title.endsWith(generatedSuffix) ? title : null;
  const request = node.initialRequest?.trim().replace(/\s+/gu, " ");
  return node.assignment?.trim()
    || recordedTitle
    || (request ? request.slice(0, 120) : null)
    || "Untitled work";
}

/** Exact-ID relationships and handoffs connect work; only relationships rank it. */
export function layoutSessionGraph(
  graph: SessionWorkGraph,
  options: {
    orientation?: "horizontal" | "vertical";
    expandedIds?: ReadonlySet<string>;
    priorityIds?: ReadonlySet<string>;
    maxNodes?: number;
    focusId?: string | null;
  } = {},
): { groups: GraphGroup[]; unlinked: SessionGraphNode[] } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbors = new Map<string, Set<string>>();
  const structuralEdges = graph.edges.filter((edge) =>
    byId.has(edge.from) && byId.has(edge.to));
  const handoffs = graph.handoffs.filter((handoff) =>
    byId.has(handoff.from) && byId.has(handoff.to));
  const connect = (from: string, to: string) => {
    if (!neighbors.has(from)) neighbors.set(from, new Set());
    if (!neighbors.has(to)) neighbors.set(to, new Set());
    neighbors.get(from)!.add(to);
    neighbors.get(to)!.add(from);
  };
  for (const edge of structuralEdges) connect(edge.from, edge.to);
  for (const handoff of handoffs) connect(handoff.from, handoff.to);
  // A recorded delegation with no stable child identity is still a work
  // group. It must not become a fake child node or a parent arrow.
  for (const item of graph.unresolved) {
    if (byId.has(item.parent) && !neighbors.has(item.parent))
      neighbors.set(item.parent, new Set());
  }
  const unlinked = graph.nodes
    .filter((node) => node.present && !neighbors.has(node.id))
    .sort((a, b) => time(b.lastTs) - time(a.lastTs) || a.id.localeCompare(b.id));
  const groups: GraphGroup[] = [];
  const seen = new Set<string>();
  for (const start of [...neighbors.keys()].sort()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const ids = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (ids.has(id)) continue;
      ids.add(id);
      seen.add(id);
      for (const next of neighbors.get(id) ?? []) stack.push(next);
    }
    const groupId = [...ids].sort()[0]!;
    const allEdges = structuralEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    const allHandoffs = handoffs.filter((handoff) => ids.has(handoff.from) && ids.has(handoff.to));
    const allUnresolved = graph.unresolved
      .filter((item) => ids.has(item.parent))
      .sort((a, b) => time(a.spawnedAt) - time(b.spawnedAt) || a.id.localeCompare(b.id));
    const hierarchy = directedHierarchy(ids, allEdges);
    const structuralParents = new Set(allEdges.map((edge) => edge.from));
    const rootIds = [...hierarchy.roots].sort((a, b) =>
      Number(structuralParents.has(b)) - Number(structuralParents.has(a))
      || a.localeCompare(b));
    const ordered = [...ids].sort((a, b) =>
      Number(options.priorityIds?.has(b) ?? false) - Number(options.priorityIds?.has(a) ?? false)
      || time(byId.get(b)?.lastTs) - time(byId.get(a)?.lastTs)
      || a.localeCompare(b));
    const visible = options.expandedIds?.has(groupId)
      ? new Set(ids)
      : connectedNeighborhood(
        ids, neighbors, ordered, options.focusId,
        Math.max(1, Math.floor(options.maxNodes ?? DEFAULT_MAX_NODES)),
      );
    const edges = allEdges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
    const visibleHandoffs = allHandoffs.filter((handoff) =>
      visible.has(handoff.from) && visible.has(handoff.to));
    const eligibleUnresolved = allUnresolved.filter((item) => visible.has(item.parent));
    const unresolved = options.expandedIds?.has(groupId)
      ? eligibleUnresolved
      : eligibleUnresolved.slice(0, DEFAULT_MAX_NODES);
    const levels = directedHierarchy(visible, edges).levels;
    const columns = new Map<number, SessionGraphNode[]>();
    for (const id of visible) {
      const level = levels.get(id)!;
      if (!columns.has(level)) columns.set(level, []);
      columns.get(level)!.push(byId.get(id)!);
    }
    for (const nodes of columns.values()) {
      nodes.sort((a, b) =>
        time(a.createdAt ?? a.lastTs) - time(b.createdAt ?? b.lastTs)
        || a.id.localeCompare(b.id));
    }
    const maxRows = Math.max(...[...columns.values()].map((nodes) => nodes.length));
    const rowStep = CARD_HEIGHT + ROW_GAP;
    const orientation = options.orientation ?? "horizontal";
    const positioned: GraphGroup["nodes"] = [];
    let verticalIndex = 0;
    for (const [level, nodes] of [...columns].sort((a, b) => a[0] - b[0])) {
      nodes.forEach((node, index) => positioned.push({
        ...node,
        x: orientation === "vertical" ? PAD : PAD + level * (CARD_WIDTH + COLUMN_GAP),
        // Keep the recorded root and first branch in the initial viewport,
        // even when a single parent has many children.
        y: orientation === "vertical"
          ? PAD + verticalIndex++ * (CARD_HEIGHT + VERTICAL_GAP)
          : PAD + index * rowStep,
      }));
    }
    const rootId = rootIds[0]!;
    const groupNodes = [...ids].map((id) => byId.get(id)!);
    const pullRequests = new Set(groupNodes.flatMap((node) =>
      node.pullRequests.map((pr) => pr.url.replace(/\/$/u, "").toLowerCase())));
    const maxLevel = Math.max(...levels.values());
    const needsRightHandoffLane = visibleHandoffs.some((handoff) =>
      levels.get(handoff.from) === maxLevel && levels.get(handoff.to) === maxLevel);
    groups.push({
      orientation,
      id: groupId,
      rootIds,
      rootId,
      title: groupTitle(byId.get(rootId)!),
      hasCycle: hierarchy.hasCycle,
      hasStructuralEdges: allEdges.length > 0,
      presentCount: groupNodes.filter((node) => node.present).length,
      activeCount: groupNodes.filter((node) => node.present && node.status === "active").length,
      pullRequestCount: pullRequests.size,
      nodes: positioned,
      handoffs: visibleHandoffs,
      totalHandoffs: allHandoffs.length,
      hiddenHandoffs: allHandoffs.length - visibleHandoffs.length,
      edges,
      totalEdges: allEdges.length,
      hiddenEdges: allEdges.length - edges.length,
      unresolved,
      hiddenUnresolved: allUnresolved.length - unresolved.length,
      width: orientation === "vertical"
        ? PAD * 2 + CARD_WIDTH + RIGHT_HANDOFF_LANE
        : PAD * 2 + (maxLevel + 1) * CARD_WIDTH + maxLevel * COLUMN_GAP
          + (needsRightHandoffLane ? RIGHT_HANDOFF_LANE : 0),
      height: orientation === "vertical"
        ? PAD * 2 + positioned.length * CARD_HEIGHT + (positioned.length - 1) * VERTICAL_GAP
        : PAD * 2 + maxRows * CARD_HEIGHT + (maxRows - 1) * ROW_GAP,
      lastTs: Math.max(...groupNodes.map((node) => time(node.lastTs))),
      totalNodes: ids.size,
      hiddenNodes: ids.size - visible.size,
    });
  }
  groups.sort((a, b) => b.lastTs - a.lastTs || a.id.localeCompare(b.id));
  return { groups, unlinked };
}

export const GRAPH_CARD_WIDTH = CARD_WIDTH;
export const GRAPH_CARD_HEIGHT = CARD_HEIGHT;
