import { expect, it } from "vitest";
import { buildDecisionTree } from "./decision-tree-model";
import { toReplayEvent } from "../model/replay-model";
const event = (id: string, seconds: number, kind: string, extra = {}) => toReplayEvent({ eventId: id, ts: new Date(1792670400000 + seconds * 1000).toISOString(), kind, source: "codex", ...extra })!;
const ask = event("ask", 1, "tool_call", { toolUseId: "choice", content: 'functions.request_user_input {"questions":[{"id":"deploy","question":"How should we ship?","options":[{"label":"Wait for tests (Recommended)","description":"Validate before shipping"},{"label":"Ship now","description":"Release immediately"}]}]}' });
const request = event("request", 0, "prompt", { content: "Ship the fix" });
const answer = event("answer", 2, "tool_result", { toolUseId: "choice", content: '{"answers":{"deploy":{"answers":["Wait for tests (Recommended)"]}}}' });
it("uses recorded options, consequences and an exact recorded choice", () => {
  const card = buildDecisionTree([request, ask, answer]).cards[0]!;
  expect(card.kind).toBe("choice");
  expect(card.question).toBe("How should we ship?");
  expect(card.branches).toMatchObject([
    { label: "Wait for tests", effects: ["Validate before shipping"], recommended: true, chosen: true },
    { label: "Ship now", chosen: false, recommended: false },
  ]);
});

it("does not infer a user's choice from an unstructured result", () => {
  const card = buildDecisionTree([request, ask, { ...answer, content: "The agent recommends Wait for tests" }]).cards[0]!;
  expect(card.branches.some((branch) => branch.chosen)).toBe(false);
});

it("supports Claude questions and custom answers without marking an unchosen option", () => {
  const question = event("claude", 1, "tool_call", { source: "claude", toolUseId: "question", content: 'AskUserQuestion {"questions":[{"question":"Which version?","options":[{"label":"14","description":"Raise the target"},{"label":"13","description":"Keep the target"}]}]}' });
  const result = event("result", 2, "tool_result", { toolUseId: "question", content: '{"answers":{"Which version?":"Use 15 instead"}}' });
  const card = buildDecisionTree([request, question, result]).cards[0]!;
  expect(card.kind).toBe("choice");
  expect(card.branches.every((branch) => !branch.chosen && !branch.recommended)).toBe(true);
});

it("labels ordinary work as recorded activity and retains raw details only as evidence", () => {
  const call = event("call", 1, "tool_call", { toolUseId: "tests", content: 'exec_command {"cmd":"npm test"}' });
  const result = event("result", 2, "tool_result", { toolUseId: "tests", content: "43 tests passed" });
  const card = buildDecisionTree([request, call, result]).cards[0]!;
  expect(card.kind).toBe("activity");
  expect(card.branches[0]).toMatchObject({ label: "Checks & tools", effects: ["Run tests"] });
  expect(card.branches[0]?.steps[0]).toMatchObject({ detail: call.content, output: result.content });
  expect(card.branches.some((branch) => branch.chosen || branch.recommended)).toBe(false);
});

it("preserves the tools and replies recorded after a choice", () => {
  const tree = buildDecisionTree([request, ask, answer,
    event("tests", 3, "tool_call", { toolUseId: "run", content: 'exec_command {"cmd":"npm test"}' }),
    event("test-result", 4, "tool_result", { toolUseId: "run", content: "Passed" }),
    event("done", 5, "assistant", { content: "Ready to ship" }),
  ]);
  expect(tree.cards.some((card) => card.kind === "choice")).toBe(true);
  expect(tree.cards.filter((card) => card.kind === "activity").flatMap((card) => card.branches.flatMap((branch) => branch.steps.map((step) => step.id)))).toEqual(["tests", "done"]);
});

it.each(["structured", "native-copy"])("retains recorded choices from %s question arguments", (shape) => {
  const args = JSON.parse(ask.content!.slice(ask.content!.indexOf("{")));
  const native = event("native", 1, "tool_call", { toolUseId: "choice", messageId: "question-message", toolName: "functions.request_user_input",
    ...(shape === "structured" ? { toolCalls: [{ name: "request_user_input", arguments: args }] } : {}),
  });
  const copy = event("copy", 1, "session_event", { type: "assistant", actorRole: "assistant", messageId: "question-message", content: ask.content });
  const cards = buildDecisionTree([request, native, ...(shape === "native-copy" ? [copy] : []), answer]).cards;
  expect(cards[0]).toMatchObject({ kind: "choice", question: "How should we ship?" });
  expect(cards[0]!.branches[0]).toMatchObject({ chosen: true, steps: [expect.objectContaining({ id: "native" })] });
});
