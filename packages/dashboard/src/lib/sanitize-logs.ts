/**
 * Shared log sanitization utilities.
 *
 * Strips ANSI escape codes (including degraded sequences like "[38;5;216m")
 * and control characters so logs render as clean text in inline mode.
 */

const CLI_SPINNER_GLYPHS = '✳✢✶✻✺✹✸✷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒●○◉◎◉·⎿⎽⎾⎷⏺⏵⏢✢✣';
const CLI_SPINNER_GLYPH_RE = new RegExp(`[${CLI_SPINNER_GLYPHS}]`, 'g');
const CLI_SPINNER_GLYPH_TEST_RE = new RegExp(`[${CLI_SPINNER_GLYPHS}]`);

/**
 * Strip ANSI escape codes and control characters from log content.
 * Used by inline log viewers that don't have native ANSI support (unlike xterm.js).
 */
export function sanitizeLogContent(text: string): string {
  if (!text) return '';

  let result = text;

  // Remove OSC sequences (like window title): \x1b]...(\x07|\x1b\\)
  result = result.replace(/\x1b\].*?(?:\x07|\x1b\\)/gs, '');

  // Remove DCS (Device Control String) sequences: \x1bP...\x1b\\
  result = result.replace(/\x1bP.*?\x1b\\/gs, '');

  // Remove standard ANSI escape sequences (CSI, SGR, etc.)
  result = result.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');

  // Remove single-character escapes
  result = result.replace(/\x1b[@-Z\\-_]/g, '');

  // Remove orphaned CSI sequences that lost their escape byte
  result = result.replace(/^\[\??\d+[hlKJHfABCDGPXsu]/gm, '');

  // Remove literal SGR sequences that show up without ESC (e.g. "[38;5;216m")
  result = result.replace(/\[\d+(?:;\d+)*m/g, '');

  // Normalize \r\n to \n first (Windows line endings)
  result = result.replace(/\r\n/g, '\n');

  // Handle carriage returns: \r moves cursor to start of line, so text after
  // \r overwrites text before it. For each line, only keep the last \r segment.
  result = result
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      const parts = line.split('\r');
      // Last non-empty part is what's visible after all overwrites
      return parts[parts.length - 1];
    })
    .join('\n');

  // Handle backspaces iteratively — each \x08 erases the preceding character.
  // A single pass of /.\x08/g fails for consecutive backspaces (e.g. "Typo\b\b\b\b")
  // because after removing one pair, new pairs may form.
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result.replace(/[^\x08]\x08/g, '');
  }
  result = result.replace(/\x08+/g, '');

  // Remove any remaining standalone escape bytes (incomplete sequences).
  result = result.replace(/\x1b/g, '');

  // Remove other control chars (except newline/tab)
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  return result;
}

/** Spinner characters used by common CLI tools */
export const SPINNER_PATTERN =
  /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒●○◉◎✳✢✶✻✺✹✸✷⏢|\\\/\-*.\u2800-\u28FF]+$/;

/** Claude Code spinner status words (e.g. "✳ Nebulizing…") */
const CLAUDE_SPINNER_PATTERN = /^[✳✢✶✻✺✹✸✷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●○*]?\s*(?:Nebulizing|Simmering|Percolating|Brewing|Distilling|Crystallizing|Synthesizing|Composing|Weaving|Forging|Manifesting|Conjuring|Materializing|Transmuting|Catalyzing|Combobulating|Orbiting|Bypassing|Bypass|Thinking|Thinking…|Running|Working)\s*…?\s*$/i;

const RUST_WARNING_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+WARN\b.*\bagent_relay_broker\b/;
const BROKER_LOG_LEVEL_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+(?:TRACE|DEBUG|INFO|WARN|ERROR)\s+.*$/i;

const MCP_NOISE_PATTERN = /<system-reminder>|Failed to resolve path|Unknown message|relaycast/i;
const UI_NOISE_PATTERN = /(?:\bshift\+tab\b|\besc to interrupt\b|to cycle|bypass permissions|shimmying|shimming|combobulat|orbiting|nebuliz|simmer|percolat|distill|forge|materializ|conjur|transmut|cataly|thinking to|working on|running on|connecting to)/i;
const MCP_HELP_PATTERN = /relay_send\(/i;
const TELEMETRY_NOISE_PATTERN =
  /agent relay collects anonymous usage data|agent-relay telemetry|`agent-relay telemetry disable`|learn more:\s*https:\/\/agent-relay\.com\/telemetry/i;
const NETWORK_NOISE_PATTERN = /hyper_util::|posthog\.com|pooling idle connection|connected to \[/i;
const TOOL_CLI_NOISE_PREFIX_PATTERN =
  /\b(?:by|byp|bypass|shift\+tab|esct|esctointerrupt|shim|shimmy|orbit|comb|combob|think|running|working|relaycast|relay_send|to:|text:|send_dm)\b/i;
const SPINNER_DENSITY_THRESHOLD = 0.4;

const NON_ALPHA_NUMERIC_PATTERN = /^[^a-zA-Z0-9]+$/;
const SYMBOL_ONLY_THRESHOLD = 8;

function isLikelySpinnerNoise(trimmedText: string): boolean {
  const hasSpinnerGlyph = CLI_SPINNER_GLYPH_TEST_RE.test(trimmedText);
  if (!hasSpinnerGlyph) return false;

  const printable = trimmedText.replace(/\s+/g, '');
  if (!printable) return false;

  const spinGlyphCount = (printable.match(CLI_SPINNER_GLYPH_RE) || []).length;
  const alphaWordCount = /\b[a-zA-Z]{3,}\b/.test(trimmedText) ? 1 : 0;
  const density = spinGlyphCount / printable.length;

  if (spinGlyphCount >= 1 && (density > SPINNER_DENSITY_THRESHOLD || alphaWordCount === 0)) {
    return true;
  }

  return false;
}

function isDecorativeNoise(trimmedText: string): boolean {
  if (!trimmedText) return false;

  const normalized = trimmedText.replace(/\s/g, '');
  if (!normalized) return false;
  if (!NON_ALPHA_NUMERIC_PATTERN.test(normalized)) return false;

  const spinGlyphCount = (normalized.match(CLI_SPINNER_GLYPH_RE) || []).length;
  if (spinGlyphCount > 0) return true;

  // Small lines that are just punctuation/box-art from redraw sequences.
  if (normalized.length <= 2) return true;
  return false;
}

function isCompactToolInstruction(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, '');
  if (!compact) return false;

  if (MCP_HELP_PATTERN.test(compact)) return true;
  if (UI_NOISE_PATTERN.test(compact)) return true;
  if (TOOL_CLI_NOISE_PREFIX_PATTERN.test(compact)) return true;
  if (/^(?:b|bi|by|sh|shi|esc|es|to|com|combb|comb|or|ori|orb|ora|th|thi|thin|thi|run|r|re|relo|relay|rel|send|sending|send_dm|text|t:)/.test(compact)) {
    return true;
  }
  if (compact.includes('shift+tabtocycle')) return true;
  if (compact.includes('bypasspermissions')) return true;
  if (compact.includes('bypasspermission')) return true;
  if (compact.includes('esctointerrupt')) return true;

  if (compact.length <= 3 && /^[a-z]+$/.test(compact)) {
    return true;
  }

  return false;
}

function isSymbolHeavyNoise(trimmedText: string): boolean {
  const compact = trimmedText.replace(/\s/g, '');
  if (!compact) return false;

  const symbols = compact.replace(/[a-zA-Z0-9]/g, '');
  if (!symbols) return false;
  if (symbols.length >= compact.length) return true;
  if (compact.length <= SYMBOL_ONLY_THRESHOLD && symbols.length / compact.length > 0.35) return true;
  if (/[⏵⏴⏷⏶⎽⎿⎾]/.test(compact) && symbols.length >= 2) return true;

  return false;
}

/**
 * Returns true if the given (already-sanitized, trimmed) text looks like a
 * spinner fragment that should be filtered out of inline log displays.
 */
export function isSpinnerFragment(trimmedText: string): boolean {
  if (trimmedText.length <= 2 && SPINNER_PATTERN.test(trimmedText)) return true;
  if (CLAUDE_SPINNER_PATTERN.test(trimmedText)) return true;
  return false;
}

export function isRustWarningLine(trimmedText: string): boolean {
  return RUST_WARNING_PATTERN.test(trimmedText);
}

/**
 * Returns true when a log line is known UI noise for this project
 * and should not be shown in the compact harness.
 */
export function isHarnessNoisyLine(trimmedText: string): boolean {
  const normalized = trimmedText.toLowerCase().replace(/\s+/g, ' ').trim();
  const withoutTag = trimmedText.replace(/^\[[^\]]+\]\s*/g, '').trim().toLowerCase();
  if (isSpinnerFragment(trimmedText)) return true;
  if (isLikelySpinnerNoise(trimmedText)) return true;
  if (isDecorativeNoise(trimmedText)) return true;
  if (BROKER_LOG_LEVEL_PATTERN.test(normalized)) return true;
  if (BROKER_LOG_LEVEL_PATTERN.test(withoutTag)) return true;
  if (isRustWarningLine(trimmedText)) return true;
  if (MCP_NOISE_PATTERN.test(normalized)) return true;
  if (UI_NOISE_PATTERN.test(normalized)) return true;
  if (UI_NOISE_PATTERN.test(trimmedText)) return true;
  if (isCompactToolInstruction(trimmedText)) return true;
  if (NETWORK_NOISE_PATTERN.test(normalized)) return true;
  if (TELEMETRY_NOISE_PATTERN.test(normalized)) return true;
  if (TELEMETRY_NOISE_PATTERN.test(withoutTag)) return true;
  if (isSymbolHeavyNoise(trimmedText)) return true;
  return false;
}
