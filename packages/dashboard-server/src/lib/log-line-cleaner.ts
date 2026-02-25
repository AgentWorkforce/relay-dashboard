/**
 * Shared log sanitization helpers for dashboard log streaming.
 */

const CLI_SPINNER_GLYPHS =
  '✳✢✶✻✺✹⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒●○◉◎◉·⎿⎽⎾⎷⏺⏵⏢✢✣⣻';
const CLI_SPINNER_GLYPH_RE = new RegExp(`[${CLI_SPINNER_GLYPHS}]`, 'g');
const CLI_SPINNER_GLYPH_TEST_RE = new RegExp(`[${CLI_SPINNER_GLYPHS}]`);

const RUST_WARNING_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+WARN\b.*\bagent_relay_broker\b/i;
const UI_NOISE_PATTERN =
  /\b(?:shift\+tab|esc\s*to\s*interrupt|bypass\s+permissions|shimmying|shimming|combobulating|orbiting|nebulizing|simmering|percolating|brewing|distilling|synthesizing|weaving|forging|materializing|catalyzing|conjuring|transmuting|bypass|shim|orbit|comb|thinking|running|working|connecting\s+to)\b/i;
const TELEMETRY_PATTERN =
  /agent\s+relay\s+collects\s+anonymous\s+usage\s+data|agent-relay\s+telemetry|agent-relay\s+telemetry\s+disable|learn\s+more:\s*https:\/\/agent-relay\.com\/telemetry/i;

function stripAnsiAndControls(text: string): string {
  let result = text;

  // OSC / DCS control sequences
  result = result.replace(/\x1b\].*?(?:\x07|\x1b\\)/gs, '');
  result = result.replace(/\x1bP.*?\x1b\\/gs, '');

  // CSI / SGR and legacy ESC sequences
  result = result.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
  result = result.replace(/\x1b[@-Z\\-_]/g, '');
  result = result.replace(/^\[\??\d+[hlKJHfABCDGPXsu]/gm, '');

  // Common literal SGR fragments
  result = result.replace(/\[\d+(?:;\d+)*m/g, '');

  // Normalize CRLF to LF and remove overwrite behavior via carriage returns.
  result = result.replace(/\r\n/g, '\n');
  result = result
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      const parts = line.split('\r');
      return parts[parts.length - 1];
    })
    .join('\n');

  // Handle backspace sequences.
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result.replace(/[^\x08]\x08/g, '');
  }
  result = result.replace(/\x08+/g, '');

  // Remove remaining control bytes and orphaned escape.
  result = result.replace(/\x1b/g, '');
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  return result;
}

function isSpinnerFragment(line: string): boolean {
  const compact = line.replace(/\s+/g, '');
  if (!compact) return false;

  if (compact.length <= 2 && CLI_SPINNER_GLYPH_TEST_RE.test(compact)) {
    return true;
  }

  if (compact.length <= 4 && /^(?:b|by|bi|shi|shim|orbit|comb|o|to)$/i.test(compact)) {
    return true;
  }

  const spinGlyphCount = (compact.match(CLI_SPINNER_GLYPH_RE) || []).length;
  if (spinGlyphCount > 0) {
    return compact.length <= 30 || spinGlyphCount / compact.length > 0.4;
  }

  return false;
}

function isLikelyNoiseLine(trimmed: string): boolean {
  if (!trimmed) return true;

  const lower = trimmed.toLowerCase();
  const compact = trimmed.replace(/\s+/g, '');
  const symbolsRemoved = trimmed.replace(/[a-zA-Z0-9]/g, '');

  if (trimmed.length <= 2 && /^[^a-zA-Z0-9]+$/.test(trimmed)) {
    return true;
  }

  if (RUST_WARNING_PATTERN.test(trimmed)) return true;
  if (TELEMETRY_PATTERN.test(lower)) return true;
  if (UI_NOISE_PATTERN.test(trimmed)) return true;
  if (compact.length >= 2 && /^(\.{1,4}|[⎿⎽⎾⎷⏺⏵⎺⎼·]+)$/.test(compact)) {
    return true;
  }

  if (isSpinnerFragment(trimmed)) return true;

  if (symbolsRemoved.length > 0) {
    if (trimmed.length <= 10 && !/[a-zA-Z]/.test(trimmed)) {
      return true;
    }

    if (trimmed.length <= 12) {
      const hasAlpha = /[a-z]/i.test(trimmed);
      if (!hasAlpha) return true;
    }

    if (symbolsRemoved.length / trimmed.length > 0.7) {
      return true;
    }
  }

  return false;
}

export interface LogChunkResult {
  lines: string[];
  carry: string;
}

export interface LogSanitizeOptions {
  /** Keep leading/trailing whitespace after stripping control characters. */
  trimWhitespace?: boolean;
  /**
   * Filter lines that look like spinner/status noise.
   * Keep enabled for compact mock-like displays; disable for raw logs.
   */
  dropNoise?: boolean;
}

export function sanitizeLogLine(rawLine: string, options: LogSanitizeOptions = {}): string {
  const { trimWhitespace = false } = options;
  const cleaned = stripAnsiAndControls(rawLine).replace(/\uFEFF/g, '');
  return trimWhitespace ? cleaned.trim() : cleaned.trimEnd();
}

export function sanitizeLogLines(lines: string[], options: LogSanitizeOptions = {}): string[] {
  const { dropNoise = false } = options;
  const sanitized = lines.map((line) => sanitizeLogLine(line, options)).filter((line) => line.length > 0);
  if (!dropNoise) {
    return sanitized;
  }
  return sanitized.filter((line) => !isLikelyNoiseLine(line));
}

export function splitLogChunk(rawContent: string, carry = '', options: LogSanitizeOptions = {}): LogChunkResult {
  const merged = `${carry}${stripAnsiAndControls(rawContent)}`;
  const lines = merged.split('\n');
  const nextCarry = lines.pop() ?? '';

  return {
    lines: sanitizeLogLines(lines, options),
    carry: nextCarry,
  };
}
