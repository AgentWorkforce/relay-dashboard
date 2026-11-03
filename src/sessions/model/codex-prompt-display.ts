// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
// Exact upstream preambles, including persisted rollouts from before #32949.
// https://github.com/openai/codex/blob/b019a5577c9a7daecd1d36b863890b96e385d4a2/codex-rs/core/src/context/recommended_plugins_instructions.rs
// Legacy variants: the same file at a397b59887d6b5df7498dd7c52d1000db78b6b4e
// and a34da3b2956bbd4b1e927139903bd3c91c880f84. Never accept arbitrary prose.
const RECOMMENDATION_PREAMBLES = new Set([
  "Here is a list of plugins that are available but not installed.",
  "Here is a list of plugins that are available but not installed. If the user's query would benefit from one of these plugins, use the `request_plugin_install` tool to suggest that they install it. Pass the parenthesized ID as `plugin_id`. For example, suggest the Google Drive plugin if the query could possibly be better answered with access to Google Drive.",
  "Here is a list of plugins that are available but not installed. If the user's query would benefit from one of these plugins, use the `request_plugin_install` tool to suggest that they install it. All entries have `tool_type: plugin`; pass `plugin` as `tool_type` and the parenthesized ID as `tool_id`. For example, suggest the Google Drive plugin if the query could possibly be better answered with access to Google Drive.",
]);

function stripRecommendationPrefix(content: string): string | null {
  const opening = "<recommended_plugins>";
  const closing = "</recommended_plugins>";
  if (!content.startsWith(opening)) return null;
  const end = content.indexOf(closing, opening.length);
  if (end === -1) return null;

  const lines = content.slice(opening.length, end).trim().split(/\r?\n/);
  if (!RECOMMENDATION_PREAMBLES.has(lines.shift() ?? "")) return null;
  const entries = lines.filter((line) => line.trim() !== "");
  if (
    entries.length === 0 ||
    !entries.every((line) =>
      /^- [^<>\r\n]+ \([a-z0-9-]+@openai-curated-remote\)$/.test(line),
    )
  )
    return null;

  // Remove only the block and its line separator, preserving prompt indentation.
  return content.slice(end + closing.length).replace(/^\r?\n(?:\r?\n)?/, "");
}

function stripAgentsInstructionsPrefix(content: string): string | null {
  // Codex's injected project-instruction wrapper starts with this exact heading.
  // Require the heading's paragraph break, an absolute or home-relative
  // directory, and both tags on their own lines. Use the final closing tag:
  // AGENTS.md itself can contain a standalone closing-tag example.
  const match =
    /^# AGENTS\.md instructions for (?:\/|~\/)[^\r\n]+\r?\n\r?\n<INSTRUCTIONS>\r?\n([\s\S]*)\r?\n<\/INSTRUCTIONS>(?=\r?\n|$)/.exec(
      content,
    );
  if (!match?.[1]?.trim()) return null;
  return content.slice(match[0].length).replace(/^\r?\n(?:\r?\n)?/, "");
}

/**
 * Remove only complete, recognized Codex-injected leading blocks for display.
 * Persisted history remains untouched, and unrecognized or embedded text stays.
 */
export function sanitizeCodexPromptDisplay(content: string): string {
  let visible = content;
  while (true) {
    const next =
      stripRecommendationPrefix(visible) ??
      stripAgentsInstructionsPrefix(visible);
    if (next === null) return visible;
    visible = next;
  }
}
