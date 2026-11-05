// Ported from Cloud session visualizations, head55bfc58fb.
import { isRecord, type ReplayEvent } from "../model/replay-model";
import { buildTraceWaterfall, type TraceStep } from "./trace-waterfall-model";
import { parseToolCall, type TranscriptCell } from "../model/transcript-cells";

export type DecisionBranch = {
  id: string;
  label: string;
  effects: string[];
  recommended?: boolean;
  chosen?: boolean;
  steps: TraceStep[];
};
export type DecisionCard = {
  id: string;
  question: string;
  kind: "choice" | "activity";
  source?: string;
  prompt?: TraceStep;
  branches: DecisionBranch[];
};

const cleanOption = (text: string) => text.replace(/\s*\(recommended\)\s*$/i, "").trim();

function recordedAnswers(output: string | null | undefined, id: string, question: string): string[] {
  try {
    const parsed: unknown = JSON.parse(output ?? "");
    if (!isRecord(parsed) || !isRecord(parsed.answers)) return [];
    const answer = parsed.answers[id] ?? parsed.answers[question];
    const values: unknown = isRecord(answer) ? answer.answers : answer;
    return (Array.isArray(values) ? values : [values]).filter((value): value is string => typeof value === "string");
  } catch { return []; }
}

/** Only structured question tools establish alternatives, recommendations and
 * choices. Ordinary transcript activity is shown as a recorded path instead. */
export function buildDecisionTree(events: ReplayEvent[], transcript?: TranscriptCell[]) {
  const trace = buildTraceWaterfall(events, transcript);
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const cards: DecisionCard[] = [];
  for (const exchange of trace.exchanges) {
    const prompt = exchange.prompt;
    const decisions: DecisionCard[] = [];
    const decisionSteps = new Set<string>();
    for (const step of exchange.steps) {
      const event = eventById.get(step.id);
      if (step.kind !== "tool" || !event) continue;
      const { name, args } = step.toolCall ?? parseToolCall(event);
      if (!/(?:^|[._])(?:request_user_input(?:_async)?|AskUserQuestion)$/i.test(name) || !Array.isArray(args?.questions)) continue;
      args.questions.forEach((question: unknown, index) => {
        if (!isRecord(question)) return;
        const text = typeof question.question === "string" ? question.question : typeof question.title === "string" ? question.title : null;
        if (!text || !Array.isArray(question.options) || question.options.length < 2) return;
        const id = typeof question.id === "string" ? question.id : text;
        const answers = recordedAnswers(step.output, id, text).map(cleanOption);
        const branches = question.options.flatMap((option: unknown, optionIndex): DecisionBranch[] => {
          const label = typeof option === "string" ? option : isRecord(option) && typeof option.label === "string" ? option.label : null;
          if (!label) return [];
          const description = isRecord(option) && typeof option.description === "string" ? option.description : null;
          return [{ id: `${step.id}:${index}:${optionIndex}`, label: cleanOption(label), effects: description ? [description] : [],
            recommended: /\(recommended\)\s*$/i.test(label), chosen: answers.includes(cleanOption(label)), steps: [step] }];
        });
        if (branches.length >= 2) {
          decisions.push({ id: `${step.id}:${index}`, kind: "choice", question: text, source: event.source, prompt: step, branches });
          decisionSteps.add(step.id);
        }
      });
    }
    cards.push(...decisions);
    const activitySteps = exchange.steps.filter((step) => step.kind !== "prompt" && !decisionSteps.has(step.id));
    if (decisions.length && activitySteps.length === 0) continue;
    // Native event and turn streams sometimes both deliver a prompt. Keep its
    // empty duplicate out of the request navigator when the reply follows it.
    const next = trace.exchanges[trace.exchanges.indexOf(exchange) + 1];
    if (exchange.steps.every((step) => step.kind === "prompt") && next?.label === exchange.label) continue;
    const groups = new Map<string, TraceStep[]>();
    for (const step of activitySteps) {
      const group = step.kind === "reply" ? "Updates & response"
        : /^(Read|Search|Inspect|Explore)/i.test(step.label) ? "Explore"
        : /^(Edit|Write|Create|Commit|Push|Apply)/i.test(step.label) ? "Make changes"
        : "Checks & tools";
      groups.set(group, [...(groups.get(group) ?? []), step]);
    }
    cards.push({ id: exchange.id, kind: "activity", question: exchange.label, prompt,
      source: eventById.get(exchange.id)?.source,
      branches: [...groups].map(([label, steps]) => ({ id: `${exchange.id}:${label}`, label,
        effects: [...new Set(steps.map((step) => step.label))].slice(-3), steps })) });
  }
  return { cards, partial: trace.omittedExchanges > 0 || trace.omittedSteps > 0 };
}
