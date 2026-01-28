/**
 * @vitest-environment jsdom
 */

/**
 * Message Formatting Tests
 *
 * Tests for markdown rendering in messages including:
 * - Inline formatting (bold, italic, strikethrough, code)
 * - Block elements (headings, lists, blockquotes)
 * - Links and URLs
 * - Code blocks and tables
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock react-syntax-highlighter to avoid ESM issues in tests
vi.mock('react-syntax-highlighter', () => {
  const MockPrismLight = ({ children }: { children: string }) => <pre data-testid="code-block">{children}</pre>;
  MockPrismLight.registerLanguage = vi.fn();
  return { PrismLight: MockPrismLight };
});

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
}));

vi.mock('react-syntax-highlighter/dist/esm/languages/prism/javascript', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/typescript', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/python', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/bash', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/json', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/markdown', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/yaml', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/css', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/go', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/rust', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/sql', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/ruby', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/java', () => ({ default: {} }));
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/docker', () => ({ default: {} }));

import { formatMessageBody } from './messageFormatting.js';

describe('messageFormatting', () => {
  describe('inline formatting', () => {
    it('renders bold text with double asterisks', () => {
      const { container } = render(<>{formatMessageBody('This is **bold** text')}</>);
      const strong = container.querySelector('strong');
      expect(strong).not.toBeNull();
      expect(strong?.textContent).toBe('bold');
    });

    it('renders bold text with double underscores', () => {
      const { container } = render(<>{formatMessageBody('This is __bold__ text')}</>);
      const strong = container.querySelector('strong');
      expect(strong).not.toBeNull();
      expect(strong?.textContent).toBe('bold');
    });

    it('renders italic text with single asterisks', () => {
      const { container } = render(<>{formatMessageBody('This is *italic* text')}</>);
      const em = container.querySelector('em');
      expect(em).not.toBeNull();
      expect(em?.textContent).toBe('italic');
    });

    it('renders italic text with single underscores', () => {
      const { container } = render(<>{formatMessageBody('This is _italic_ text')}</>);
      const em = container.querySelector('em');
      expect(em).not.toBeNull();
      expect(em?.textContent).toBe('italic');
    });

    it('renders strikethrough text', () => {
      const { container } = render(<>{formatMessageBody('This is ~~deleted~~ text')}</>);
      const del = container.querySelector('del');
      expect(del).not.toBeNull();
      expect(del?.textContent).toBe('deleted');
    });

    it('renders inline code', () => {
      const { container } = render(<>{formatMessageBody('Use `npm install` to install')}</>);
      const code = container.querySelector('code');
      expect(code).not.toBeNull();
      expect(code?.textContent).toBe('npm install');
    });

    it('handles multiple inline formats in one line', () => {
      const { container } = render(
        <>{formatMessageBody('**Bold** and *italic* and `code`')}</>
      );
      expect(container.querySelector('strong')?.textContent).toBe('Bold');
      expect(container.querySelector('em')?.textContent).toBe('italic');
      expect(container.querySelector('code')?.textContent).toBe('code');
    });

    it('handles nested bold within text', () => {
      const { container } = render(
        <>{formatMessageBody('Start **middle** end')}</>
      );
      expect(container.textContent).toBe('Start middle end');
      expect(container.querySelector('strong')?.textContent).toBe('middle');
    });
  });

  describe('links', () => {
    it('renders markdown links', () => {
      const { container } = render(
        <>{formatMessageBody('Check out [Google](https://google.com)')}</>
      );
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link?.textContent).toBe('Google');
      expect(link?.getAttribute('href')).toBe('https://google.com');
      expect(link?.getAttribute('target')).toBe('_blank');
    });

    it('auto-links URLs', () => {
      const { container } = render(
        <>{formatMessageBody('Visit https://example.com for more')}</>
      );
      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe('https://example.com');
    });

    it('auto-links http URLs', () => {
      const { container } = render(
        <>{formatMessageBody('Visit http://example.com')}</>
      );
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe('http://example.com');
    });
  });

  describe('headings', () => {
    it('renders h1 headings', () => {
      const { container } = render(<>{formatMessageBody('# Main Title')}</>);
      const heading = container.querySelector('div');
      expect(heading?.textContent).toBe('Main Title');
      expect(heading?.className).toContain('font-bold');
      expect(heading?.className).toContain('border-b');
      expect(heading?.style.fontSize).toBe('1.5rem');
    });

    it('renders h2 headings', () => {
      const { container } = render(<>{formatMessageBody('## Section')}</>);
      const heading = container.querySelector('div');
      expect(heading?.textContent).toBe('Section');
      expect(heading?.style.fontSize).toBe('1.25rem');
    });

    it('renders h3 headings', () => {
      const { container } = render(<>{formatMessageBody('### Subsection')}</>);
      const heading = container.querySelector('div');
      expect(heading?.textContent).toBe('Subsection');
      expect(heading?.style.fontSize).toBe('1.125rem');
    });

    it('renders heading with inline formatting', () => {
      const { container } = render(<>{formatMessageBody('## **Bold** Heading')}</>);
      const strong = container.querySelector('strong');
      expect(strong?.textContent).toBe('Bold');
    });
  });

  describe('lists', () => {
    it('renders bullet list with dash', () => {
      const { container } = render(<>{formatMessageBody('- Item one')}</>);
      expect(container.textContent).toContain('•');
      expect(container.textContent).toContain('Item one');
    });

    it('renders bullet list with asterisk', () => {
      const { container } = render(<>{formatMessageBody('* Item one')}</>);
      expect(container.textContent).toContain('•');
      expect(container.textContent).toContain('Item one');
    });

    it('renders numbered list', () => {
      const { container } = render(<>{formatMessageBody('1. First item')}</>);
      expect(container.textContent).toContain('1.');
      expect(container.textContent).toContain('First item');
    });

    it('renders list item with inline formatting', () => {
      const { container } = render(<>{formatMessageBody('- **Bold** item')}</>);
      expect(container.querySelector('strong')?.textContent).toBe('Bold');
    });
  });

  describe('blockquotes', () => {
    it('renders blockquote', () => {
      const { container } = render(<>{formatMessageBody('> This is quoted')}</>);
      const blockquote = container.querySelector('blockquote');
      expect(blockquote).not.toBeNull();
      expect(blockquote?.textContent).toBe('This is quoted');
    });

    it('renders blockquote with space after >', () => {
      const { container } = render(<>{formatMessageBody('> Quoted text')}</>);
      const blockquote = container.querySelector('blockquote');
      expect(blockquote?.textContent).toBe('Quoted text');
    });

    it('renders multi-line blockquote', () => {
      const { container } = render(
        <>{formatMessageBody('> Line one\n> Line two')}</>
      );
      const blockquote = container.querySelector('blockquote');
      expect(blockquote?.textContent).toContain('Line one');
      expect(blockquote?.textContent).toContain('Line two');
    });
  });

  describe('code blocks', () => {
    it('renders fenced code block', () => {
      const { container } = render(
        <>{formatMessageBody('```javascript\nconst x = 1;\n```')}</>
      );
      // Code blocks are rendered with syntax highlighter
      expect(container.textContent).toContain('const x = 1;');
    });

    it('renders code block without language', () => {
      const { container } = render(
        <>{formatMessageBody('```\nplain code\n```')}</>
      );
      expect(container.textContent).toContain('plain code');
    });
  });

  describe('tables', () => {
    it('renders table-like content', () => {
      const tableContent = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |';
      const { container } = render(<>{formatMessageBody(tableContent)}</>);
      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain('Header 1');
      expect(pre?.textContent).toContain('Cell 1');
    });
  });

  describe('mentions', () => {
    it('highlights mentions when provided', () => {
      const { container } = render(
        <>{formatMessageBody('Hello @alice and @bob', { mentions: ['alice', 'bob'] })}</>
      );
      const mentions = container.querySelectorAll('span.bg-accent-cyan\\/20');
      expect(mentions.length).toBe(2);
    });

    it('does not highlight non-matching mentions', () => {
      const { container } = render(
        <>{formatMessageBody('Hello @charlie', { mentions: ['alice'] })}</>
      );
      const mentions = container.querySelectorAll('span.bg-accent-cyan\\/20');
      expect(mentions.length).toBe(0);
    });
  });

  describe('mixed content', () => {
    it('handles complex markdown message', () => {
      const content = `# Title

**Bold** and *italic* text.

- List item 1
- List item 2

> A quote

\`\`\`typescript
const x = 1;
\`\`\`

Visit https://example.com`;

      const { container } = render(<>{formatMessageBody(content)}</>);

      // Check various elements exist
      expect(container.querySelector('strong')).not.toBeNull();
      expect(container.querySelector('em')).not.toBeNull();
      expect(container.querySelector('blockquote')).not.toBeNull();
      expect(container.querySelector('a')).not.toBeNull();
    });

    it('preserves newlines in regular text', () => {
      const { container } = render(
        <>{formatMessageBody('Line 1\nLine 2\nLine 3')}</>
      );
      const brs = container.querySelectorAll('br');
      expect(brs.length).toBe(2);
    });

    it('handles escaped newlines', () => {
      const { container } = render(
        <>{formatMessageBody('Line 1\\nLine 2')}</>
      );
      const brs = container.querySelectorAll('br');
      expect(brs.length).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      const { container } = render(<>{formatMessageBody('')}</>);
      expect(container.textContent).toBe('');
    });

    it('handles plain text without formatting', () => {
      const { container } = render(<>{formatMessageBody('Just plain text')}</>);
      expect(container.textContent).toBe('Just plain text');
    });

    it('handles unclosed formatting markers', () => {
      const { container } = render(<>{formatMessageBody('**unclosed bold')}</>);
      // Should not crash, renders as-is
      expect(container.textContent).toContain('**unclosed bold');
    });

    it('handles special characters', () => {
      const { container } = render(<>{formatMessageBody('Test < > & " \'')}</>);
      expect(container.textContent).toContain('<');
      expect(container.textContent).toContain('>');
    });
  });
});
