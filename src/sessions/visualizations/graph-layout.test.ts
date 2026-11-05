import { expect, it } from "vitest";
import { buildSessionWorkGraph, sessionGraphKey } from "./session-graph-data";
import { layoutSessionGraph } from "./graph-layout";
import type { SessionRow } from "./session-data";

function row(id: string, parents: string[] = [], extra: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: id,
    source: "codex",
    summary: id,
    parentSessionIds: parents,
    createdAt: "2026-10-22T00:00:00Z",
    lastTs: "2026-10-22T00:00:00Z",
    eventCount: 0,
    userIds: [],
    pullRequest: null,
    projectId: null,
    ...extra,
  };
}

const key = (id: string) => sessionGraphKey("codex", id);

it("bounds a large family while preserving the selected child's recorded parent link", () => {
  const rows = [
    row("parent"),
    ...Array.from({ length: 40 }, (_, index) =>
      row(`child-${index}`, ["parent"]),
    ),
  ];
  const graph = buildSessionWorkGraph(rows);
  const focusId = sessionGraphKey("codex", "child-39");
  const first = layoutSessionGraph(graph, { focusId });
  expect(first.groups).toHaveLength(1);
  expect(first.groups[0].nodes).toHaveLength(24);
  expect(first.groups[0].hiddenNodes).toBe(17);
  expect(first.groups[0].totalEdges).toBe(40);
  expect(first.groups[0].hiddenEdges).toBe(17);
  expect(first.groups[0].nodes.map((node) => node.id)).toContain(focusId);
  expect(first.groups[0].nodes.map((node) => node.id)).toContain(
    sessionGraphKey("codex", "parent"),
  );
  expect(
    first.groups[0].edges.some(
      (edge) =>
        edge.from === sessionGraphKey("codex", "parent") && edge.to === focusId,
    ),
  ).toBe(true);
  const all = layoutSessionGraph(graph, {
    expandedIds: new Set([first.groups[0].id]),
  });
  expect(all.groups[0].nodes).toHaveLength(41);
  expect(all.groups[0].hiddenNodes).toBe(0);
});

it("names a group from its directed root and counts its recorded work", () => {
  const root = row("root", [], {
    summary: "Ship the billing migration",
    workState: { status: "active", updatedAt: "2026-10-22T00:00:00Z" },
    pullRequest: { url: "https://github.com/o/r/pull/9", number: "9" },
  });
  const child = row("child", ["root"], {
    pullRequest: { url: "https://github.com/o/r/pull/9", number: "9" },
  });
  const first = layoutSessionGraph(buildSessionWorkGraph([child, root], [], { now: Date.parse("2026-10-22T00:01:00Z") })).groups[0];
  const reversed = layoutSessionGraph(buildSessionWorkGraph([root, child], [], { now: Date.parse("2026-10-22T00:01:00Z") })).groups[0];
  expect(first.rootIds).toEqual([key("root")]);
  expect(first.rootId).toBe(key("root"));
  expect(first.title).toBe("Ship the billing migration");
  expect([first.presentCount, first.activeCount, first.pullRequestCount]).toEqual([2, 1, 1]);
  expect([reversed.id, reversed.rootId, reversed.title]).toEqual([first.id, first.rootId, first.title]);
});

it("uses a recorded root assignment when the list title is generic", () => {
  const graph = buildSessionWorkGraph([row("root", [], { summary: "Session · root" }), row("child", ["root"])]);
  graph.nodes = graph.nodes.map((node) => node.sessionId === "root"
    ? { ...node, assignment: "Coordinate the release", initialRequest: "Please ship the release." }
    : node);
  expect(layoutSessionGraph(graph).groups[0].title).toBe("Coordinate the release");
  graph.nodes = graph.nodes.map((node) => node.sessionId === "root"
    ? { ...node, assignment: null }
    : node);
  expect(layoutSessionGraph(graph).groups[0].title).toBe("Please ship the release.");
});

it("keeps the root and first branch at the top through multiple levels", () => {
  const graph = buildSessionWorkGraph([
    row("root"), row("a", ["root"]), row("b", ["root"]),
    row("leaf-a", ["a"]), row("leaf-b", ["b"]),
  ]);
  const group = layoutSessionGraph(graph).groups[0];
  const positions = new Map(group.nodes.map((node) => [node.id, node]));
  expect(positions.get(key("root"))!.x).toBeLessThan(positions.get(key("a"))!.x);
  expect(positions.get(key("a"))!.x).toBeLessThan(positions.get(key("leaf-a"))!.x);
  expect(positions.get(key("root"))!.y).toBe(32);
  expect(positions.get(key("a"))!.y).toBe(32);
  expect(positions.get(key("b"))!.y).toBe(32 + 126 + 50);
  expect(positions.get(key("leaf-a"))!.y).toBe(32);
  expect(group.width).toBeGreaterThan(3 * 248);
});

it("keeps a lone root visible beside the first of six review children", () => {
  const rows = [
    row("Expand Desktop Telemetry and Stabilize PR463"),
    ...Array.from({ length: 6 }, (_, index) =>
      row("review-" + index, ["Expand Desktop Telemetry and Stabilize PR463"])),
  ];
  const group = layoutSessionGraph(buildSessionWorkGraph(rows)).groups[0];
  const root = group.nodes.find((node) => node.sessionId.startsWith("Expand Desktop"))!;
  const firstChild = group.nodes
    .filter((node) => node.sessionId.startsWith("review-"))
    .sort((a, b) => a.y - b.y)[0]!;
  expect(root.y).toBe(32);
  expect(firstChild.y).toBe(32);
  expect(root.x).toBeLessThan(firstChild.x);
  expect(group.edges).toHaveLength(6);
});

it("stacks a fanout root and first child inside a narrow canvas", () => {
  const rows = [
    row("root"),
    ...Array.from({ length: 6 }, (_, index) => row(`review-${index}`, ["root"])),
  ];
  const group = layoutSessionGraph(buildSessionWorkGraph(rows), { orientation: "vertical" }).groups[0];
  const root = group.nodes.find((node) => node.id === key("root"))!;
  const children = group.nodes.filter((node) => node.id !== key("root"));
  expect(group.orientation).toBe("vertical");
  expect(group.width).toBe(384);
  expect(root).toMatchObject({ x: 32, y: 32 });
  expect(children[0]).toMatchObject({ x: 32, y: 230 });
  expect(children.every((node) => node.x === root.x && node.y > root.y)).toBe(true);
  expect(group.edges).toHaveLength(6);
  expect(Math.max(...group.nodes.map((node) => node.x + 248))).toBeLessThan(group.width);
});

it("keeps vertical shared children below both parents without widening for depth", () => {
  const graph = buildSessionWorkGraph([
    row("left"), row("right"), row("join", ["left", "right"]),
    row("leaf", ["join"]),
  ]);
  const group = layoutSessionGraph(graph, { orientation: "vertical" }).groups[0];
  const positions = new Map(group.nodes.map((node) => [node.id, node]));
  expect(positions.get(key("join"))!.y).toBeGreaterThan(positions.get(key("left"))!.y);
  expect(positions.get(key("join"))!.y).toBeGreaterThan(positions.get(key("right"))!.y);
  expect(positions.get(key("leaf"))!.y).toBeGreaterThan(positions.get(key("join"))!.y);
  expect(new Set(group.nodes.map((node) => node.x))).toEqual(new Set([32]));
  expect(group.width).toBe(384);
  expect(group.edges).toHaveLength(3);
});

it("reserves a right route lane for vertical message peers and cycles", () => {
  const graph = {
    ...buildSessionWorkGraph([row("a", ["b"]), row("b", ["a"])]),
    handoffs: [{ id: "message", from: key("a"), to: key("b"), text: "status", ts: null, evidenceEventId: "event" }],
  };
  const group = layoutSessionGraph(graph, { orientation: "vertical" }).groups[0];
  expect(group.hasCycle).toBe(true);
  expect(group.edges).toHaveLength(2);
  expect(group.handoffs).toHaveLength(1);
  expect(group.nodes[0]!.y).toBeLessThan(group.nodes[1]!.y);
  expect(group.width - (group.nodes[0]!.x + 248)).toBe(104);
});

it("places a shared child after both parents and keeps every structural edge", () => {
  const graph = buildSessionWorkGraph([
    row("left"), row("right"), row("join", ["left", "right"]),
    row("leaf", ["join"]),
  ]);
  const group = layoutSessionGraph(graph).groups[0];
  const positions = new Map(group.nodes.map((node) => [node.id, node]));
  expect(group.rootIds).toEqual([key("left"), key("right")]);
  expect(positions.get(key("join"))!.x).toBeGreaterThan(positions.get(key("left"))!.x);
  expect(positions.get(key("join"))!.x).toBeGreaterThan(positions.get(key("right"))!.x);
  expect(positions.get(key("leaf"))!.x).toBeGreaterThan(positions.get(key("join"))!.x);
  expect(group.edges).toHaveLength(3);
});

it("uses the longest directed depth when a shortcut and a longer parent path meet", () => {
  const graph = buildSessionWorkGraph([
    row("root"), row("middle", ["root"]), row("join", ["root", "middle"]),
  ]);
  const group = layoutSessionGraph(graph).groups[0];
  const positions = new Map(group.nodes.map((node) => [node.id, node]));
  expect(positions.get(key("join"))!.x - positions.get(key("root"))!.x).toBe(2 * (248 + 104));
  expect(group.edges).toHaveLength(3);
});

it("keeps a cycle finite without inventing a directed root or hierarchy within it", () => {
  const graph = buildSessionWorkGraph([
    row("a", ["c"]), row("b", ["a"]), row("c", ["b"]),
  ]);
  const group = layoutSessionGraph(graph).groups[0];
  expect(group.hasCycle).toBe(true);
  expect(group.rootIds).toEqual([key("a")]);
  expect(new Set(group.nodes.map((node) => node.x)).size).toBe(1);
  expect(group.edges).toHaveLength(3);
});

it("groups exact message peers without turning them into delegated children", () => {
  const graph = {
    ...buildSessionWorkGraph([row("parent"), row("child", ["parent"]), row("unrelated")]),
    handoffs: [{ id: "message", from: key("child"), to: key("unrelated"), text: "status", ts: null, evidenceEventId: "event" }],
  };
  const layout = layoutSessionGraph(graph);
  expect(layout.groups).toHaveLength(1);
  const group = layout.groups[0];
  const positions = new Map(group.nodes.map((node) => [node.id, node]));
  expect(group.nodes.map((node) => node.id).sort()).toEqual([key("child"), key("parent"), key("unrelated")].sort());
  expect(group.rootIds).toEqual([key("parent"), key("unrelated")]);
  expect(group.rootId).toBe(key("parent"));
  expect(group.edges).toHaveLength(1);
  expect(group.handoffs.map((handoff) => handoff.id)).toEqual(["message"]);
  expect([group.totalHandoffs, group.hiddenHandoffs]).toEqual([1, 0]);
  expect(positions.get(key("unrelated"))!.x).toBe(positions.get(key("parent"))!.x);
  expect(positions.get(key("child"))!.x).toBeGreaterThan(positions.get(key("parent"))!.x);
  expect(layout.unlinked).toEqual([]);
});

it("keeps message-only peers at the same level with no claimed orchestrator", () => {
  const graph = {
    ...buildSessionWorkGraph([row("agent-a"), row("agent-b")]),
    handoffs: [{ id: "message", from: key("agent-a"), to: key("agent-b"), text: "handoff", ts: null, evidenceEventId: "event" }],
  };
  const group = layoutSessionGraph(graph).groups[0];
  expect(group.hasStructuralEdges).toBe(false);
  expect(group.rootIds).toEqual([key("agent-a"), key("agent-b")]);
  expect(new Set(group.nodes.map((node) => node.x)).size).toBe(1);
  expect(group.edges).toEqual([]);
  expect(group.handoffs).toHaveLength(1);
  const rightmostCard = Math.max(...group.nodes.map((node) => node.x + 248));
  expect(group.width - rightmostCard).toBeGreaterThanOrEqual(88);
});

it("keeps an unresolved delegation as a visible singleton group without a fake child", () => {
  const graph = {
    ...buildSessionWorkGraph([row("parent")]),
    unresolved: [{
      id: "unlinked", parent: key("parent"), relationship: "delegated" as const,
      childAgentName: "worker", childAgentType: "agent", spawnedAt: null,
      reason: "child_identity_unlinked" as const, task: "Review code",
    }],
  };
  const layout = layoutSessionGraph(graph);
  expect(layout.unlinked).toEqual([]);
  expect(layout.groups).toHaveLength(1);
  expect(layout.groups[0]).toMatchObject({
    rootId: key("parent"), totalNodes: 1, edges: [], handoffs: [],
    unresolved: [expect.objectContaining({ task: "Review code" })],
  });
});
