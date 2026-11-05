import { isRecord } from "../model/replay-model";

/** Provider metadata, never prompt text, identifies an internal approval review. */
export function isCodexAutoReview(value: unknown): boolean {
  if (!isRecord(value) || value.source !== "codex") return false;
  const catalog = isRecord(value.catalog) ? value.catalog : {};
  return [value.model, ...(Array.isArray(value.models) ? value.models : []),
    ...(Array.isArray(catalog.models) ? catalog.models : [])].includes("codex-auto-review");
}

/** A review marker in a merged replay applies only to Codex messages. */
export function isCodexReviewMessage(
  event: { source?: string; model?: string | null } | undefined,
  source: string,
  autoReview = false,
): boolean {
  return (event?.source || source) === "codex" && (autoReview || isCodexAutoReview(event));
}

export function isAutoReviewRelationship(value: unknown): boolean {
  return isRecord(value) && (value.childModel === "codex-auto-review" || value.childAgentName === "guardian" || value.childAgentType === "guardian");
}

