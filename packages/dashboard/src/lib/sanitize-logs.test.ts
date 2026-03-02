import { describe, it, expect } from 'vitest';
import { sanitizeLogContent, isHarnessNoisyLine, isSpinnerFragment } from './sanitize-logs.js';

describe('sanitizeLogContent', () => {
  it('returns empty string for falsy input', () => {
    expect(sanitizeLogContent('')).toBe('');
    expect(sanitizeLogContent(null as unknown as string)).toBe('');
    expect(sanitizeLogContent(undefined as unknown as string)).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(sanitizeLogContent('Hello, world!')).toBe('Hello, world!');
  });

  describe('ANSI escape sequences', () => {
    it('removes SGR color codes', () => {
      expect(sanitizeLogContent('\x1b[31mError\x1b[0m')).toBe('Error');
      expect(sanitizeLogContent('\x1b[1;32mSuccess\x1b[0m')).toBe('Success');
    });

    it('removes 256-color codes', () => {
      expect(sanitizeLogContent('\x1b[38;5;216mOrange text\x1b[0m')).toBe('Orange text');
    });

    it('removes 24-bit (truecolor) codes', () => {
      expect(sanitizeLogContent('\x1b[38;2;255;100;0mRGB text\x1b[0m')).toBe('RGB text');
    });

    it('removes cursor movement sequences', () => {
      expect(sanitizeLogContent('\x1b[2KOverwritten line')).toBe('Overwritten line');
      expect(sanitizeLogContent('\x1b[1AMove up')).toBe('Move up');
      expect(sanitizeLogContent('\x1b[10CMove right')).toBe('Move right');
    });

    it('removes OSC sequences (window title)', () => {
      expect(sanitizeLogContent('\x1b]0;My Title\x07Real content')).toBe('Real content');
      expect(sanitizeLogContent('\x1b]0;Title\x1b\\Content')).toBe('Content');
    });

    it('removes DCS sequences', () => {
      expect(sanitizeLogContent('\x1bPsome device string\x1b\\After')).toBe('After');
    });

    it('removes single-character escapes', () => {
      expect(sanitizeLogContent('\x1bMReverse index')).toBe('Reverse index');
    });
  });

  describe('orphaned/degraded sequences', () => {
    it('removes orphaned CSI at start of line', () => {
      expect(sanitizeLogContent('[?25h')).toBe('');
      expect(sanitizeLogContent('[2K')).toBe('');
    });

    it('removes literal SGR without ESC byte', () => {
      expect(sanitizeLogContent('[38;5;216mOrange')).toBe('Orange');
      expect(sanitizeLogContent('[0mPlain')).toBe('Plain');
      expect(sanitizeLogContent('[1;31mBold red[0m text')).toBe('Bold red text');
    });
  });

  describe('control characters', () => {
    it('handles carriage returns (overwrites line from start)', () => {
      expect(sanitizeLogContent('line1\rline2')).toBe('line2');
      expect(sanitizeLogContent('old text\rnew')).toBe('new');
      expect(sanitizeLogContent('no cr here')).toBe('no cr here');
    });

    it('handles backspaces (overwrites previous char)', () => {
      expect(sanitizeLogContent('ab\x08c')).toBe('ac');
    });

    it('handles consecutive backspaces correctly', () => {
      expect(sanitizeLogContent('Typo\x08\x08\x08\x08Fixed text here')).toBe('Fixed text here');
    });

    it('removes orphaned backspaces', () => {
      expect(sanitizeLogContent('\x08\x08leftover')).toBe('leftover');
    });

    it('preserves newlines and tabs', () => {
      expect(sanitizeLogContent('line1\nline2\ttabbed')).toBe('line1\nline2\ttabbed');
    });

    it('removes other control characters', () => {
      expect(sanitizeLogContent('text\x00\x01\x02\x03end')).toBe('textend');
    });
  });

  describe('real-world Claude CLI output', () => {
    it('handles Claude thinking indicator', () => {
      const input = '\x1b[2m⠋ Thinking...\x1b[22m';
      const result = sanitizeLogContent(input);
      expect(result).not.toContain('\x1b');
      expect(result).toContain('Thinking...');
    });

    it('handles Claude tool use output', () => {
      const input = '\x1b[1;36m● Tool use:\x1b[0m \x1b[33mRead\x1b[0m src/index.ts';
      const result = sanitizeLogContent(input);
      expect(result).toBe('● Tool use: Read src/index.ts');
    });

    it('handles nested/compound ANSI codes', () => {
      const input = '\x1b[1m\x1b[38;5;82m✓\x1b[0m \x1b[2mDone\x1b[22m';
      const result = sanitizeLogContent(input);
      expect(result).toBe('✓ Done');
    });
  });

  describe('real-world Codex CLI output', () => {
    it('handles Codex progress bar', () => {
      const input = '\x1b[32m████████████████\x1b[0m\x1b[90m░░░░\x1b[0m 80%';
      const result = sanitizeLogContent(input);
      expect(result).toBe('████████████████░░░░ 80%');
    });

    it('handles Codex status line with carriage return (keeps last overwrite)', () => {
      const input = 'Processing files... 3/10\rProcessing files... 4/10';
      const result = sanitizeLogContent(input);
      expect(result).toBe('Processing files... 4/10');
    });
  });

  describe('edge cases', () => {
    it('handles very long lines', () => {
      const longLine = 'x'.repeat(10000) + '\x1b[31m' + 'y'.repeat(10000);
      const result = sanitizeLogContent(longLine);
      expect(result).toBe('x'.repeat(10000) + 'y'.repeat(10000));
    });

    it('handles Unicode/emoji in content', () => {
      expect(sanitizeLogContent('🚀 Deploy \x1b[32msuccess\x1b[0m ✅')).toBe('🚀 Deploy success ✅');
    });

    it('handles malformed escape sequences gracefully', () => {
      // Incomplete escape - should remove what it can
      const result = sanitizeLogContent('\x1b[mtext');
      expect(result).toContain('text');
    });

    it('handles mixed content with multiple sequence types', () => {
      const input = '\x1b]0;title\x07\x1b[1;31mError:\x1b[0m Something \x1b[2Kfailed\r\n';
      const result = sanitizeLogContent(input);
      expect(result).toContain('Error:');
      expect(result).toContain('Something');
      expect(result).toContain('failed');
      expect(result).not.toContain('\x1b');
    });
  });
});

describe('isSpinnerFragment', () => {
  it('detects braille spinner characters', () => {
    expect(isSpinnerFragment('⠋')).toBe(true);
    expect(isSpinnerFragment('⠙')).toBe(true);
    expect(isSpinnerFragment('⣾')).toBe(true);
  });

  it('detects ASCII spinner characters', () => {
    expect(isSpinnerFragment('|')).toBe(true);
    expect(isSpinnerFragment('/')).toBe(true);
    expect(isSpinnerFragment('-')).toBe(true);
    expect(isSpinnerFragment('\\')).toBe(true);
  });

  it('detects two-char spinner sequences', () => {
    expect(isSpinnerFragment('⠋⠙')).toBe(true);
  });

  it('rejects normal text', () => {
    expect(isSpinnerFragment('hello')).toBe(false);
    expect(isSpinnerFragment('Error')).toBe(false);
  });

  it('rejects longer strings even with spinner chars', () => {
    expect(isSpinnerFragment('⠋⠙⠹')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isSpinnerFragment('')).toBe(false);
  });
});

describe('isHarnessNoisyLine', () => {
  it('suppresses rust warning lines', () => {
    expect(
      isHarnessNoisyLine('2026-02-25T13:38:03.737927Z WARN agent_relay_broker::pty_worker: delivery echo not detected'),
    ).toBe(true);
  });

  it('suppresses short spinner frame artifacts', () => {
    expect(isHarnessNoisyLine('✶ O b')).toBe(true);
    expect(isHarnessNoisyLine('✳')).toBe(true);
  });

  it('suppresses spinner status lines with ui instructions', () => {
    expect(
      isHarnessNoisyLine('⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt'),
    ).toBe(true);
    expect(isHarnessNoisyLine('Shimmying…')).toBe(true);
  });

  it('suppresses broker debug lines', () => {
    expect(
      isHarnessNoisyLine(
        '2026-02-25T13:43:52.921035Z DEBUG hyper_util::client::legacy::connect::http: connected to [2600:1f18:4c12:9a01:6ea1:6e82:d8b9:9650]:443',
      ),
    ).toBe(true);
  });

  it('suppresses tool instructions regardless of spacing', () => {
    expect(isHarnessNoisyLine('⏵⏵bypasspermissionson (shift+tabto[')).toBe(true);
    expect(isHarnessNoisyLine('relay_send(to: \"<sender>\", message: \"...\")')).toBe(true);
  });

  it('suppresses broker telemetry banner fragments', () => {
    expect(isHarnessNoisyLine('[broker] Run `agent-relay telemetry disable` to opt out.')).toBe(true);
    expect(isHarnessNoisyLine('[broker] Run')).toBe(true);
  });

  it('suppresses short spinner text fragments', () => {
    expect(isHarnessNoisyLine('O')).toBe(true);
    expect(isHarnessNoisyLine(' b ')).toBe(true);
    expect(isHarnessNoisyLine('⏢')).toBe(true);
  });
});
