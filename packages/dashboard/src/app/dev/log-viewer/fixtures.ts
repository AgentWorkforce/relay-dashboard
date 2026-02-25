/**
 * CLI output fixtures for the isolated log viewer test page.
 *
 * Static fixtures for edge-case testing + dynamic loading of real log files
 * from the dashboard server's /api/logs endpoint.
 */

export interface LogFixtureLine {
  content: string;
  type: 'stdout' | 'stderr' | 'system';
  delay?: number;
}

export interface LogFixture {
  name: string;
  description: string;
  lines: LogFixtureLine[];
}

// ── Edge cases fixture (static) ─────────────────────────────────────

export const edgeCaseFixture: LogFixture = {
  name: 'Edge Cases',
  description: 'Malformed escapes, Unicode, long lines, stderr, spinners',
  lines: [
    // stderr output
    { content: 'Warning: deprecated API usage\n', type: 'stderr' },
    { content: 'Error: ENOENT: no such file or directory\n', type: 'stderr', delay: 100 },

    // system messages
    { content: '[Connected to agent log stream]\n', type: 'system' },

    // Orphaned/degraded ANSI (lost ESC byte)
    { content: '[38;5;216mThis had a color code[0m but ESC bytes were stripped\n', type: 'stdout', delay: 100 },
    { content: '[?25hCursor show command leaked\n', type: 'stdout', delay: 100 },
    { content: '[2KLine erase leaked\n', type: 'stdout', delay: 100 },

    // Unicode and emoji
    { content: '🚀 Deploying to production...\n', type: 'stdout', delay: 200 },
    { content: '✅ Deploy complete! 🎉 (took 2.3s)\n', type: 'stdout', delay: 200 },
    { content: '日本語テスト: 成功\n', type: 'stdout', delay: 100 },
    { content: '中文测试: 通过\n', type: 'stdout', delay: 100 },

    // Very long line
    { content: 'Long line: ' + 'abcdefghij'.repeat(50) + '\n', type: 'stdout', delay: 100 },

    // Rapid carriage returns (progress simulation)
    { content: 'Downloading... 10%\r', type: 'stdout', delay: 50 },
    { content: 'Downloading... 30%\r', type: 'stdout', delay: 50 },
    { content: 'Downloading... 50%\r', type: 'stdout', delay: 50 },
    { content: 'Downloading... 70%\r', type: 'stdout', delay: 50 },
    { content: 'Downloading... 90%\r', type: 'stdout', delay: 50 },
    { content: 'Downloading... 100%\n', type: 'stdout', delay: 50 },

    // Spinner sequences
    { content: '⠋', type: 'stdout', delay: 80 },
    { content: '\r⠙', type: 'stdout', delay: 80 },
    { content: '\r⠹', type: 'stdout', delay: 80 },
    { content: '\r⠸', type: 'stdout', delay: 80 },
    { content: '\r⠼', type: 'stdout', delay: 80 },
    { content: '\r\x1b[2K', type: 'stdout' },
    { content: 'Done!\n', type: 'stdout' },

    // Backspace overwrites
    { content: 'Typo\x08\x08\x08\x08Fixed text here\n', type: 'stdout', delay: 100 },

    // Mixed ANSI with content
    { content: '\x1b[1m\x1b[4mBold and underlined\x1b[0m normal \x1b[31mred\x1b[0m \x1b[42mgreen bg\x1b[0m\n', type: 'stdout' },

    // Nested 256-color
    { content: '\x1b[38;5;196m\x1b[48;5;232m Red on dark \x1b[0m \x1b[38;5;46m\x1b[48;5;17m Green on navy \x1b[0m\n', type: 'stdout' },
  ],
};

// ── Streaming simulation fixture (static) ───────────────────────────

export const streamingFixture: LogFixture = {
  name: 'Streaming',
  description: 'Simulates real-time streaming with delays to test auto-scroll and buffering',
  lines: Array.from({ length: 50 }, (_, i) => ({
    content: `\x1b[2m${String(i + 1).padStart(3, '0')}\x1b[22m \x1b[${
      i % 2 === 0 ? '36' : '33'
    }m[${new Date(Date.now() + i * 200).toISOString().slice(11, 23)}]\x1b[0m Processing item ${i + 1}/50...\n`,
    type: 'stdout' as const,
    delay: 200,
  })),
};

/** Static fixtures that don't need a server */
export const STATIC_FIXTURES: LogFixture[] = [
  edgeCaseFixture,
  streamingFixture,
];

/**
 * Convert raw log file content (single string) into LogFixtureLine array.
 * Each line of the file becomes a separate fixture line.
 */
export function rawLogToFixture(name: string, rawContent: string): LogFixture {
  const lines = rawContent.split('\n').map((line) => ({
    content: line + '\n',
    type: 'stdout' as const,
  }));

  return {
    name,
    description: `Real log output from ${name} worker`,
    lines,
  };
}
