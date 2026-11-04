// Hosted session-table-data.ts `tools[...].icon`: one onboarding icon per
// harness, shared by the list, the session header and the transcript.
import { Terminal } from "lucide-react";
import { toolKey } from "./data";

const ICONS: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  devin: "devin",
  gemini: "gemini",
  cursor: "cursor",
  opencode: "opencode",
  grok: "grok",
  "grok-bot": "grok",
  muse: "muse",
  capy: "capy",
  chatgpt: "chatgpt",
  mcp: "mcp",
};

/** The icon file for a source, or null when the harness has none. */
export function harnessIconName(source: string): string | null {
  return ICONS[toolKey(source)] ?? null;
}

export function HarnessIcon({
  source,
  className,
  fallback = true,
}: {
  source: string;
  className?: string;
  /** Show a terminal glyph for unknown harnesses (otherwise nothing). */
  fallback?: boolean;
}) {
  const icon = harnessIconName(source);
  if (icon)
    return (
      <img
        src={`${import.meta.env.BASE_URL}onboarding-icons/${icon}.svg`}
        alt=""
        className={className}
      />
    );
  return fallback ? <Terminal aria-hidden="true" className={className} /> : null;
}
