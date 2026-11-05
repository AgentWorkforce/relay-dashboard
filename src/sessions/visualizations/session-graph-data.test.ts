import { describe, expect, it } from "vitest";
import {
  toReplayEvent,
  type ReplayEvent,
  type ReplayState,
} from "../model/replay-model";
import type { SessionRow } from "./session-data";
import { buildSessionWorkGraph, sessionGraphKey } from "./session-graph-data";

const now = Date.parse("2026-10-22T12:00:00Z");
const row = (
  sessionId: string,
  extra: Partial<SessionRow> = {},
): SessionRow => ({
  source: "codex",
  sessionId,
  summary: sessionId,
  projectId: "same-project",
  lastTs: "2026-10-22T11:00:00Z",
  eventCount: 3,
  userIds: [],
  pullRequest: { url: "https://github.com/org/repo/pull/42", number: "42" },
  ...extra,
});
const catalog = (
  sessionId: string,
  parents: unknown[] = [],
  children: unknown[] = [],
  extra: Record<string, unknown> = {},
) => ({
  source: "codex",
  sessionId,
  workspaceId: "workspace",
  catalog: null,
  parents,
  children,
  truncated: false,
  ...extra,
});
const relation = (
  parentSessionId: string,
  childSessionId: string | null,
  relationship = "delegated",
  uid = "rel",
) => ({
  relationshipUid: uid,
  parentSessionId,
  childSessionId,
  relationship,
  identityStatus: childSessionId ? "observed" : "unlinked",
  childAgentName: "worker",
  childAgentType: "agent",
  spawnedAt: "2026-10-22T10:00:00Z",
});
const event = (
  eventId: string,
  kind: string,
  extra: Record<string, unknown> = {},
): ReplayEvent =>
  toReplayEvent({
    eventId,
    kind,
    ts: "2026-10-22T11:00:00Z",
    source: "codex",
    ...extra,
  })!;
const replay = (
  events: ReplayEvent[],
  source = "codex",
  nextCursor: string | null = null,
): ReplayState => ({
  source,
  events,
  nextCursor,
  turnsNextCursor: null,
  error: null,
});

describe("session work graph evidence", () => {
  it("uses recorded list parent identities immediately without guessing the relationship type", () => {
    const graph = buildSessionWorkGraph(
      [row("child", { parentSessionIds: ["parent"] }), row("unrelated")],
      [],
      { listHasMore: true, now },
    );
    expect(graph.edges).toEqual([
      expect.objectContaining({
        from: sessionGraphKey("codex", "parent"),
        to: sessionGraphKey("codex", "child"),
        provenance: "catalog_summary",
        relationship: "unknown",
      }),
    ]);
    expect(
      graph.nodes.find((node) => node.sessionId === "parent"),
    ).toMatchObject({ present: false, status: "unknown" });
    expect(graph.nodes.filter((node) => node.present)).toHaveLength(2);
    expect(graph.coverage).toMatchObject({
      listHasMore: true,
      catalog: "not_loaded",
    });
  });

  it("upgrades a summary hint to the exact catalog relationship and keeps an unidentified child unresolved", () => {
    const observed = relation("parent", "child");
    const unlinked = relation("parent", null, "delegated", "unlinked");
    const graph = buildSessionWorkGraph(
      [row("parent"), row("child", { parentSessionIds: ["parent"] })],
      [
        {
          source: "codex",
          sessionId: "parent",
          catalog: catalog("parent", [], [observed, unlinked]),
        },
        {
          source: "codex",
          sessionId: "child",
          catalog: catalog("child", [observed]),
        },
      ],
      { now, workspaceId: "workspace" },
    );
    expect(graph.edges).toEqual([
      expect.objectContaining({
        relationship: "delegated",
        provenance: "catalog_detail",
        childAgentName: "worker",
      }),
    ]);
    expect(graph.unresolved).toEqual([
      expect.objectContaining({
        parent: sessionGraphKey("codex", "parent"),
        reason: "child_identity_unlinked",
      }),
    ]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.coverage.catalog).toBe("loaded");
  });

  it("rejects a catalog from another workspace even when the session identity matches", () => {
    const graph = buildSessionWorkGraph(
      [row("child")],
      [
        {
          source: "codex",
          sessionId: "child",
          catalog: catalog("child", [relation("private", "child")], [], {
            workspaceId: "other",
          }),
        },
      ],
      { now, workspaceId: "workspace" },
    );
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.catalogStatus).toBe("unavailable");
  });

  it("enriches an off-page child placeholder from exact catalog and replay evidence", () => {
    const graph = buildSessionWorkGraph([row("parent")], [{source: "codex", sessionId: "child", catalog: catalog("child", [relation("parent", "child")], [], {
      catalog: {title: "Review parser", firstPrompt: "Check failure cases"},
    }), replay: replay([event("child-tool", "tool_call", {type: "tool_call", toolName: "Read", toolUseId: "read-1", content: "Read parser.ts"})])}], {now, workspaceId: "workspace"});
    expect(graph.edges).toEqual([expect.objectContaining({from: sessionGraphKey("codex", "parent"), to: sessionGraphKey("codex", "child")})]);
    expect(graph.nodes.find((node) => node.sessionId === "child")).toMatchObject({present: false, title: "Review parser", initialRequest: "Check failure cases", agentName: "worker", catalogStatus: "loaded", replayStatus: "loaded", tools: [expect.objectContaining({toolUseId: "read-1"})]});
    expect(graph.nodes.filter((node) => node.present)).toHaveLength(1);
  });

  it("does not construct an off-page node from a mismatched tenant/source", () => {
    const graph = buildSessionWorkGraph([row("parent")], [{source: "codex", sessionId: "other", catalog: catalog("other", [], [], {workspaceId: "wrong"}), replay: replay([], "claude")}], {now, workspaceId: "workspace"});
    expect(graph.nodes.map((node) => node.sessionId)).toEqual(["parent"]);
  });

  it("does not construct an off-page node from an empty successful replay", () => {
    const graph = buildSessionWorkGraph([row("parent")], [{source: "codex", sessionId: "unknown", catalog: null, replay: replay([])}], {now, workspaceId: "workspace"});
    expect(graph.nodes.map((node) => node.sessionId)).toEqual(["parent"]);
  });

  it("does not infer causal edges from the same project, PR, or adjacent timestamps", () => {
    const graph = buildSessionWorkGraph([row("a"), row("b")], [], { now });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([]);
    expect(graph.nodes.map((node) => node.pullRequests)).toEqual([
      [{ url: "https://github.com/org/repo/pull/42", number: "42" }],
      [{ url: "https://github.com/org/repo/pull/42", number: "42" }],
    ]);
  });

  it("shows all selected-session PR evidence while rejecting unsafe and duplicate URLs", () => {
    const graph = buildSessionWorkGraph(
      [row("a")],
      [
        {
          source: "codex",
          sessionId: "a",
          pullRequests: [
            { url: "https://github.com/org/repo/pull/42/" },
            { url: "https://github.com/org/repo/pull/43" },
            { url: "https://github.com.evil.test/org/repo/pull/44" },
            { url: "http://github.com/org/repo/pull/45" },
          ],
        },
      ],
      { now },
    );
    expect(graph.nodes[0]?.pullRequests.map((pr) => pr.number)).toEqual([
      "42",
      "43",
    ]);
  });

  it("does not use a mismatched catalog or replay as evidence for a node", () => {
    const graph = buildSessionWorkGraph(
      [row("child", { parentSessionIds: ["parent"] })],
      [
        {
          source: "codex",
          sessionId: "child",
          catalog: catalog("other", [relation("wrong", "child")]),
          replay: replay(
            [
              event("private", "assistant", {
                source: "claude",
                content: "secret",
              }),
            ],
            "claude",
          ),
        },
      ],
      { now },
    );
    expect(graph.edges).toEqual([
      expect.objectContaining({ provenance: "catalog_summary" }),
    ]);
    expect(
      graph.nodes.find((node) => node.sessionId === "wrong"),
    ).toBeUndefined();
    expect(
      graph.nodes.find((node) => node.sessionId === "child"),
    ).toMatchObject({
      catalogStatus: "unavailable",
      replayStatus: "unavailable",
      messages: [],
    });
  });

  it("retains a list parent when the selected child catalog is truncated", () => {
    const graph = buildSessionWorkGraph(
      [row("child", { parentSessionIds: ["outside"] })],
      [
        {
          source: "codex",
          sessionId: "child",
          catalog: catalog("child", [], [], { truncated: true }),
        },
      ],
      { now },
    );
    expect(graph.edges).toEqual([
      expect.objectContaining({
        from: sessionGraphKey("codex", "outside"),
        provenance: "catalog_summary",
      }),
    ]);
    expect(
      graph.nodes.find((node) => node.sessionId === "outside")?.present,
    ).toBe(false);
    expect(
      graph.nodes.find((node) => node.sessionId === "child")?.catalogStatus,
    ).toBe("partial");
  });

  it("uses the catalog's first prompt for the initial request, never a later replay page", () => {
    const graph = buildSessionWorkGraph(
      [row("one")],
      [
        {
          source: "codex",
          sessionId: "one",
          catalog: catalog("one", [], [], {
            catalog: { firstPrompt: "Build the work graph" },
          }),
          replay: replay(
            [event("late", "prompt", { content: "Can you fix the colors?" })],
            "codex",
            "older",
          ),
        },
      ],
      { now },
    );
    expect(graph.nodes[0]?.initialRequest).toBe("Build the work graph");
    expect(graph.nodes[0]?.messages.map((message) => message.text)).toEqual([
      "Can you fix the colors?",
    ]);
  });

  it("lists only recorded messages and tool calls, with unknown outcome absent explicit status", () => {
    const recorded = replay(
      [
        event("message", "assistant", {
          type: "text",
          content: "Finished work",
        }),
        event("call", "tool_call", {
          ts: "2026-10-22T11:01:00Z",
          type: "tool_call",
          toolName: "exec",
          toolUseId: "tool-1",
          content: 'exec {"input":"npm test"}',
        }),
        event("result", "tool_result", {
          ts: "2026-10-22T11:02:00Z",
          type: "tool_result",
          toolUseId: "tool-1",
          content: "done",
        }),
        event("reasoning", "assistant", {
          ts: "2026-10-22T11:03:00Z",
          type: "reasoning",
          content: "private reasoning",
        }),
        event("other-source", "assistant", {
          ts: "2026-10-22T11:04:00Z",
          source: "claude",
          type: "text",
          content: "another session",
        }),
      ],
      "codex",
      "next",
    );
    const graph = buildSessionWorkGraph(
      [row("one")],
      [{ source: "codex", sessionId: "one", replay: recorded }],
      { now },
    );
    const node = graph.nodes[0]!;
    expect(node.messages).toEqual([
      {
        id: "message",
        role: "assistant",
        ts: "2026-10-22T11:00:00Z",
        text: "Finished work",
        truncated: false,
      },
    ]);
    expect(node.tools).toEqual([
      {
        id: "call",
        ts: "2026-10-22T11:01:00Z",
        name: "exec · npm test",
        status: "unknown",
        hasResult: true,
        toolUseId: "tool-1",
      },
    ]);
    expect(node.replayStatus).toBe("partial");
  });

  it("counts raw tool calls once and retains the exact ID linking PR evidence", () => {
    const call = event("raw-call", "tool_call", {type: "tool_call", toolName: "exec_command", toolUseId: "pr-tool", content: 'exec_command {"cmd":"gh pr edit 463"}'});
    const result = event("raw-result", "tool_result", {type: "tool_result", toolUseId: "pr-tool", content: "updated"});
    const orphan = event("orphan-result", "tool_result", {type: "tool_result", toolUseId: "another-tool", content: "unmatched"});
    const turnCopy = event("turn-copy", "assistant", {type: "tool_call", toolName: "exec_command", content: 'exec_command {"cmd":"gh pr edit 463"}'});
    const recorded: ReplayState = {...replay([call, result, orphan, turnCopy]), streams: {events: [call, result, orphan], turns: [turnCopy]}};
    const graph = buildSessionWorkGraph([row("parent")], [{source: "codex", sessionId: "parent", replay: recorded, pullRequests: [{url: "https://github.com/org/repo/pull/463", role: "contributor", evidence: "gh_pr_edit", toolUseId: "pr-tool"}]}], {now});
    const node = graph.nodes[0]!;
    expect(node.tools).toHaveLength(1);
    expect(node.tools[0]).toMatchObject({id: "raw-call", toolUseId: "pr-tool", hasResult: true});
    expect(node.pullRequests.find((pr) => pr.number === "463")?.toolUseId).toBe(node.tools[0]?.toolUseId);
  });

  it("deduplicates delivered copies by tool ID while keeping distinct simultaneous calls", () => {
    const raw = [
      event("copy-without-result", "tool_call", {type: "tool_call", toolName: "exec_command", toolUseId: "same-id", content: 'exec_command {"cmd":"one"}'}),
      event("copy-with-result", "tool_call", {type: "tool_call", toolName: "exec_command", toolUseId: "same-id", content: 'exec_command {"cmd":"one"}'}),
      event("matched-result", "tool_result", {type: "tool_result", toolUseId: "same-id", content: "done"}),
      event("other-id", "tool_call", {type: "tool_call", toolName: "Read", toolUseId: "other-id", content: "Read file"}),
      event("idless-one", "tool_call", {type: "tool_call", toolName: "Read", content: "Read a"}),
      event("idless-two", "tool_call", {type: "tool_call", toolName: "Read", content: "Read b"}),
    ];
    const graph = buildSessionWorkGraph([row("parent")], [{source: "codex", sessionId: "parent", replay: {...replay(raw), streams: {events: raw, turns: []}}}], {now});
    expect(graph.nodes[0]?.tools).toHaveLength(4);
    expect(graph.nodes[0]?.tools.filter((tool) => tool.toolUseId === "same-id")).toEqual([
      expect.objectContaining({id: "copy-without-result", hasResult: true}),
    ]);
    expect(graph.nodes[0]?.tools.filter((tool) => tool.toolUseId === "other-id")).toHaveLength(1);
    expect(graph.nodes[0]?.tools.filter((tool) => !tool.toolUseId)).toHaveLength(2);
  });

  it("counts a native call and its assistant projection once by exact message ID", () => {
    const raw = [
      event("native-1", "tool_call", {type: "tool_call", messageId: "message-1", toolUseId: "call-1", toolName: "exec", content: 'exec {"cmd":"one"}'}),
      event("assistant-copy", "session_event", {type: "assistant", actorRole: "assistant", messageId: "message-1", content: 'exec {"cmd":"one"}'}),
      event("native-result", "session_event", {type: "tool_result", actorRole: "tool_result", toolUseId: "call-1", content: "done"}),
      event("legacy-only", "session_event", {type: "assistant", actorRole: "assistant", messageId: "message-2", content: 'exec {"cmd":"legacy"}'}),
      event("different-message", "session_event", {type: "assistant", actorRole: "assistant", messageId: "message-3", content: 'exec {"cmd":"same time"}'}),
    ];
    const graph = buildSessionWorkGraph([row("parent")], [{source: "codex", sessionId: "parent", replay: {...replay(raw), streams: {events: raw, turns: []}}}], {now});
    expect(graph.nodes[0]?.tools.map((tool) => tool.id)).toEqual(["native-1", "legacy-only", "different-message"]);
    expect(graph.nodes[0]?.tools[0]).toMatchObject({toolUseId: "call-1", hasResult: true});
  });

  it("names raw Codex and Claude calls from their recorded invocation content", () => {
    const codex = buildSessionWorkGraph(
      [row("codex-session")],
      [
        {
          source: "codex",
          sessionId: "codex-session",
          replay: replay([
            event("codex-call", "assistant", {
              type: "tool_call",
              content: 'exec_command {"cmd":"npm test"}',
            }),
          ]),
        },
      ],
      { now },
    );
    const claude = buildSessionWorkGraph(
      [row("claude-session", { source: "claude" })],
      [
        {
          source: "claude",
          sessionId: "claude-session",
          replay: replay(
            [
              event("claude-call", "session_event", {
                source: "claude",
                type: "tool_use",
                content: "Bash npm test",
              }),
            ],
            "claude",
          ),
        },
      ],
      { now },
    );
    expect(codex.nodes[0]?.tools.map((tool) => tool.name)).toEqual([
      "exec_command · npm test",
    ]);
    expect(claude.nodes[0]?.tools.map((tool) => tool.name)).toEqual([
      "Bash · npm test",
    ]);
  });

  it("does not promote generic event kinds to tool names", () => {
    const graph = buildSessionWorkGraph(
      [row("one")],
      [
        {
          source: "codex",
          sessionId: "one",
          replay: replay([
            event("generic", "assistant", {
              type: "tool_call",
              content: "assistant",
            }),
            event("metadata", "tool_call", {
              content: "tool_call",
              toolCalls: [{ name: "Read" }],
            }),
          ]),
        },
      ],
      { now },
    );
    expect(graph.nodes[0]?.tools.map((tool) => tool.name)).toEqual([
      "Unnamed tool",
      "Read",
    ]);
  });

  it("expires stale active work and keeps absent work state unknown", () => {
    const graph = buildSessionWorkGraph(
      [
        row("stale", {
          workState: { status: "active", updatedAt: "2026-10-22T11:00:00Z" },
        }),
        row("missing"),
      ],
      [],
      { now },
    );
    expect(graph.nodes.map((node) => [node.sessionId, node.status])).toEqual([
      ["stale", "idle"],
      ["missing", "unknown"],
    ]);
  });

  it("keeps the recorded auto-review classification on a session node", () => {
    const graph = buildSessionWorkGraph([row("review", {autoReview: true}), row("worker")], [], {now});
    expect(graph.nodes.find((node) => node.sessionId === "review")?.autoReview).toBe(true);
    expect(graph.nodes.find((node) => node.sessionId === "worker")?.autoReview).toBe(false);
  });

  it("links only an exact spawn result and exact message recipient, retaining recorded evidence", () => {
    const graph = buildSessionWorkGraph(
      [row("parent"), row("child"), row("other")],
      [{source: "codex", sessionId: "parent", catalog: catalog("parent"), replay: replay([
        event("spawn-call", "tool_call", {type: "tool_call", toolName: "spawn_agent", toolUseId: "spawn-1", content: 'spawn_agent {"name":"worker","message":"Implement parser"}'}),
        event("spawn-result", "tool_result", {type: "tool_result", toolUseId: "spawn-1", content: '{"threadId":"child"}'}),
        event("send-call", "tool_call", {type: "tool_call", toolName: "send_message", toolUseId: "send-1", content: 'send_message {"receiverThreadIds":["child","missing"],"message":"Please review"}'}),
        event("send-result", "tool_result", {type: "tool_result", toolUseId: "send-1", content: "delivered"}),
        event("pr-call", "tool_call", {type: "tool_call", toolName: "exec_command", toolUseId: "pr-tool", content: 'exec_command {"cmd":"gh pr create"}'}),
        event("pr-result", "tool_result", {type: "tool_result", toolUseId: "pr-tool", content: "created"}),
        event("bad-spawn", "tool_call", {type: "tool_call", toolName: "spawn_agent", content: 'spawn_agent {"name":"other"}'}),
      ]), pullRequests: [{url: "https://github.com/org/repo/pull/43", role: "creator", evidence: "gh_pr_create", toolUseId: "pr-tool", detectedAt: "2026-10-22T11:00:00Z"}]}],
      {now, workspaceId: "workspace"},
    );
    expect(graph.edges).toEqual([expect.objectContaining({from: sessionGraphKey("codex", "parent"), to: sessionGraphKey("codex", "child"), provenance: "replay_spawn_result", evidenceEventId: "spawn-result", task: "Implement parser"})]);
    expect(graph.handoffs).toEqual([expect.objectContaining({from: sessionGraphKey("codex", "parent"), to: sessionGraphKey("codex", "child"), text: "Please review", evidenceEventId: "send-call", status: "sent"})]);
    expect(graph.nodes.find((node) => node.sessionId === "child")).toMatchObject({agentName: "worker", assignment: "Implement parser"});
    expect(graph.nodes.find((node) => node.sessionId === "parent")?.pullRequests[0]).toMatchObject({role: "creator", evidence: "gh_pr_create", toolUseId: "pr-tool"});
    expect(graph.nodes.find((node) => node.sessionId === "parent")?.tools).toContainEqual(expect.objectContaining({toolUseId: "pr-tool"}));
  });

  it("does not turn a spawn alias, unmatched result, or message alias into an edge", () => {
    const graph = buildSessionWorkGraph([row("parent"), row("child")], [{source: "codex", sessionId: "parent", replay: replay([
      event("spawn", "tool_call", {type: "tool_call", toolName: "spawn_agent", toolUseId: "s", content: 'spawn_agent {"name":"child","message":"work"}'}),
      event("wrong", "tool_result", {type: "tool_result", toolUseId: "different", content: '{"threadId":"child"}'}),
      event("send", "tool_call", {type: "tool_call", toolName: "send_message", content: 'send_message {"target":"child","message":"hello"}'}),
    ])}], {now});
    expect(graph.edges).toEqual([]);
    expect(graph.handoffs).toEqual([]);
  });

  it("uses native agent_id and sendInput id from raw event stream only", () => {
    const raw = [
      event("spawn", "tool_call", {type: "tool_call", toolName: "functions.collaboration.spawn_agent", toolUseId: "spawn-tool", toolCalls: [{name: "spawn_agent", arguments: {message: "Implement parser", name: "worker"}}]}),
      event("result", "tool_result", {type: "tool_result", toolUseId: "spawn-tool", content: '{"agent_id":"child","nickname":"worker"}'}),
      event("send", "tool_call", {type: "tool_call", toolName: "sendInput", toolUseId: "send-tool", toolCalls: [{arguments: {id: "child", message: "Review now"}}]}),
    ];
    const recorded = {...replay([...raw, event("turn-only", "tool_call", {type: "tool_call", toolName: "spawn_agent", toolUseId: "turn-tool", content: 'spawn_agent {"name":"fake"}'})]), streams: {events: raw, turns: []}};
    const graph = buildSessionWorkGraph([row("parent"), row("child")], [{source: "codex", sessionId: "parent", replay: recorded}], {now});
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({to: sessionGraphKey("codex", "child"), evidenceEventId: "result"});
    expect(graph.handoffs).toEqual([expect.objectContaining({to: sessionGraphKey("codex", "child"), text: "Review now"})]);
  });

  it("does not promote failed tool results or failed sends", () => {
    const graph = buildSessionWorkGraph([row("parent"), row("child")], [{source: "codex", sessionId: "parent", replay: replay([
      event("failed-spawn", "tool_call", {type: "tool_call", toolName: "spawn_agent", toolUseId: "failed", content: 'spawn_agent {"message":"work"}'}),
      event("failed-result", "tool_result", {type: "tool_result", toolUseId: "failed", toolStatus: "failed", content: '{"threadId":"child"}'}),
      event("failed-send", "tool_call", {type: "tool_call", toolName: "sendInput", toolUseId: "send", content: 'sendInput {"id":"child","message":"hello"}'}),
      event("failed-send-result", "tool_result", {type: "tool_result", toolUseId: "send", content: '{"success":false}'}),
    ])}], {now});
    expect(graph.edges).toEqual([]);
    expect(graph.handoffs).toEqual([]);
    expect(graph.nodes).toHaveLength(2);
  });

  it("treats Codex native agent_id as an exact child thread id, including outside the loaded page", () => {
    const events = [
      event("call", "tool_call", {type: "tool_call", toolName: "spawnAgent", toolUseId: "spawn", content: 'spawnAgent {"message":"Review"}'}),
      event("result", "tool_result", {type: "tool_result", toolUseId: "spawn", content: '{"agent_id":"child-outside"}'}),
    ];
    const codex = buildSessionWorkGraph([row("parent")], [{source: "codex", sessionId: "parent", replay: replay(events)}], {now});
    expect(codex.edges).toEqual([expect.objectContaining({to: sessionGraphKey("codex", "child-outside"), provenance: "replay_spawn_result"})]);
    expect(codex.nodes.find((node) => node.sessionId === "child-outside")?.present).toBe(false);
    const other = buildSessionWorkGraph([row("parent", {source: "other"})], [{source: "other", sessionId: "parent", replay: replay(events.map((event) => ({...event, source: "other"})), "other")}], {now});
    expect(other.edges).toEqual([]);
  });

  it("connects messages from and to authenticated off-page sessions", () => {
    const graph = buildSessionWorkGraph([row("parent")], [
      {source: "codex", sessionId: "parent", replay: replay([event("to-child", "tool_call", {type: "tool_call", toolName: "sendInput", content: 'sendInput {"id":"child","message":"Review"}'})])},
      {source: "codex", sessionId: "child", catalog: catalog("child", [relation("parent", "child")]), replay: replay([event("to-parent", "tool_call", {type: "tool_call", toolName: "sendInput", content: 'sendInput {"id":"parent","message":"Done"}'})])},
    ], {now, workspaceId: "workspace"});
    expect(graph.nodes.find((node) => node.sessionId === "child")?.present).toBe(false);
    expect(graph.handoffs.map((handoff) => [handoff.from, handoff.to])).toEqual([
      [sessionGraphKey("codex", "parent"), sessionGraphKey("codex", "child")],
      [sessionGraphKey("codex", "child"), sessionGraphKey("codex", "parent")],
    ]);
  });

  it("resolves a message to a later discovered spawn independent of evidence order", () => {
    const send = {source: "codex", sessionId: "sender", replay: replay([event("send", "tool_call", {type: "tool_call", toolName: "sendInput", content: 'sendInput {"id":"child","message":"Check result"}'})])};
    const spawn = {source: "codex", sessionId: "parent", replay: replay([
      event("spawn", "tool_call", {type: "tool_call", toolName: "spawn_agent", toolUseId: "spawn", content: 'spawn_agent {"message":"Review"}'}),
      event("result", "tool_result", {type: "tool_result", toolUseId: "spawn", content: '{"agent_id":"child"}'}),
    ])};
    const build = (items: Array<typeof send | typeof spawn>) => buildSessionWorkGraph([row("sender"), row("parent")], items, {now});
    const first = build([send, spawn]);
    const second = build([spawn, send]);
    expect(first.handoffs).toEqual([expect.objectContaining({from: sessionGraphKey("codex", "sender"), to: sessionGraphKey("codex", "child"), text: "Check result"})]);
    expect(second.handoffs).toEqual(first.handoffs);
  });
});

it("pairs result-first tied timestamps before inferring an explicit spawn relationship", () => {
  const events = [
    event("a-result", "tool_result", { type: "tool_result", toolUseId: "spawn", content: '{"agent_id":"child"}' }),
    event("z-call", "tool_call", { type: "tool_call", toolUseId: "spawn", toolName: "spawn_agent", content: 'spawn_agent {"message":"Review"}' }),
  ];
  const graph = buildSessionWorkGraph([row("parent")], [{ source: "codex", sessionId: "parent", replay: replay(events) }], { now });
  expect(graph.edges).toEqual([expect.objectContaining({ from: sessionGraphKey("codex", "parent"), to: sessionGraphKey("codex", "child"), provenance: "replay_spawn_result" })]);
});

it.each(["sendInput", "send_input"])("keeps a recorded %s handoff to an exact known recipient", (toolName) => {
  const graph = buildSessionWorkGraph([row("parent"), row("child")], [{ source: "codex", sessionId: "parent", replay: replay([
    event("send", "tool_call", { type: "tool_call", toolName, content: `${toolName} {"id":"child","message":"Review"}` }),
  ]) }], { now });
  expect(graph.handoffs).toHaveLength(1);
  expect(graph.handoffs[0]).toMatchObject({ from: sessionGraphKey("codex", "parent"), to: sessionGraphKey("codex", "child") });
});

it.each([true, false])("reconciles a native handoff with display arguments and its recorded result (success=%s)", (success) => {
  const events = [
    event("native-send", "tool_call", { type: "tool_call", messageId: "send-message", toolUseId: "send-tool", toolName: "send_input", content: null }),
    event("display-send", "session_event", { type: "assistant", actorRole: "assistant", messageId: "send-message", content: 'send_input {"id":"child","message":"Review"}' }),
    event("send-result", "tool_result", { type: "tool_result", toolUseId: "send-tool", toolStatus: success ? "completed" : "failed", content: JSON.stringify({ success, delivered: success }) }),
  ];
  const graph = buildSessionWorkGraph([row("parent"), row("child")], [{ source: "codex", sessionId: "parent", replay: replay(events) }], { now });
  expect(graph.handoffs).toHaveLength(success ? 1 : 0);
  if (success) expect(graph.handoffs[0]).toMatchObject({ evidenceEventId: "native-send", status: "delivered", text: "Review" });
});
it("accepts explicitly correlated spawn IDs recorded in structured call and result metadata", () => {
  const events = [
    event("nested-spawn", "tool_call", { type: "tool_call", toolName: "spawn_agent", toolCalls: [{ id: "nested-id", arguments: { message: "Review", name: "worker" } }] }),
    event("nested-result", "tool_result", { type: "tool_result", content: '{"call_id":"nested-id","agent_id":"child"}' }),
  ];
  const graph = buildSessionWorkGraph([row("parent")], [{ source: "codex", sessionId: "parent", replay: replay(events) }], { now });
  expect(graph.edges).toEqual([expect.objectContaining({ from: sessionGraphKey("codex", "parent"), to: sessionGraphKey("codex", "child"), evidenceEventId: "nested-result", task: "Review" })]);
});

it("does not assign ambiguous display arguments to multiple native calls in one message", () => {
  const events = [
    event("native-a", "tool_call", { type: "tool_call", messageId: "shared", toolUseId: "a", toolName: "send_input" }),
    event("native-b", "tool_call", { type: "tool_call", messageId: "shared", toolUseId: "b", toolName: "send_input" }),
    event("display", "session_event", { type: "assistant", actorRole: "assistant", messageId: "shared", content: 'send_input {"id":"child","message":"Ambiguous"}' }),
  ];
  const graph = buildSessionWorkGraph([row("parent"), row("child")], [{ source: "codex", sessionId: "parent", replay: replay(events) }], { now });
  expect(graph.handoffs).toEqual([]);
  expect(graph.nodes.find((node) => node.sessionId === "parent")?.tools).toHaveLength(2);
});
