import React, { useCallback, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
// Only import languages we actually need (saves ~300KB)
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';

SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('ruby', ruby);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('docker', docker);
SyntaxHighlighter.registerLanguage('dockerfile', docker);

/**
 * Custom theme extending oneDark to match dashboard styling
 */
const customCodeTheme = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: 'rgba(15, 23, 42, 0.8)',
    margin: '0.5rem 0',
    padding: '1rem',
    borderRadius: '0.5rem',
    border: '1px solid rgba(148, 163, 184, 0.1)',
    fontSize: '0.75rem',
    lineHeight: '1.5',
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: 'transparent',
    fontSize: '0.75rem',
  },
};

/**
 * CodeBlock Component - Renders syntax highlighted code
 */
interface CodeBlockProps {
  code: string;
  language: string;
}

function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [code]);

  // Normalize language names for syntax highlighter
  const normalizedLanguage = language.toLowerCase().replace(/^(js|jsx)$/, 'javascript')
    .replace(/^(ts|tsx)$/, 'typescript')
    .replace(/^(py)$/, 'python')
    .replace(/^(rb)$/, 'ruby')
    .replace(/^(sh|shell|zsh)$/, 'bash');

  return (
    <div className="relative group my-2">
      {/* Language badge and copy button */}
      <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
        {language && language !== 'text' && (
          <span className="text-xs px-2 py-0.5 rounded bg-accent-cyan/20 text-accent-cyan font-mono">
            {language}
          </span>
        )}
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded bg-bg-tertiary hover:bg-bg-card text-text-muted hover:text-text-primary border border-border-subtle"
          title="Copy code"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={normalizedLanguage}
        style={customCodeTheme}
        customStyle={{
          margin: 0,
          background: 'rgba(15, 23, 42, 0.8)',
        }}
        showLineNumbers={code.split('\n').length > 3}
        lineNumberStyle={{
          minWidth: '2.5em',
          paddingRight: '1em',
          color: 'rgba(148, 163, 184, 0.4)',
          userSelect: 'none',
        }}
      >
        {code.trim()}
      </SyntaxHighlighter>
    </div>
  );
}

/**
 * Check if a line looks like part of a table (has pipe characters)
 */
function isTableLine(line: string): boolean {
  const pipeCount = (line.match(/\|/g) || []).length;
  return pipeCount >= 2 || (line.trim().startsWith('|') && line.trim().endsWith('|'));
}

/**
 * Check if a line is a table separator (dashes and pipes)
 */
function isTableSeparator(line: string): boolean {
  return /^[\s|:-]+$/.test(line) && line.includes('-') && line.includes('|');
}

/**
 * Check if a line is a blockquote (starts with >)
 */
function isQuoteLine(line: string): boolean {
  return line.trimStart().startsWith('>');
}

/**
 * Extract the content from a quote line (remove the leading > and space)
 */
function getQuoteContent(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('> ')) {
    return trimmed.slice(2);
  }
  if (trimmed.startsWith('>')) {
    return trimmed.slice(1);
  }
  return line;
}

interface ContentSection {
  type: 'text' | 'table' | 'code' | 'quote';
  content: string;
  language?: string;
}

/**
 * Split content into text, table, and code sections
 * Code blocks are detected by fenced code block syntax (```language ... ```)
 */
function splitContentSections(content: string): ContentSection[] {
  const sections: ContentSection[] = [];

  // First, extract code blocks using regex
  // Matches ```language\ncode\n``` or ```\ncode\n```
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add any content before this code block
    if (match.index > lastIndex) {
      const beforeContent = content.slice(lastIndex, match.index);
      const beforeSections = splitTextAndTableSections(beforeContent);
      sections.push(...beforeSections);
    }

    // Add the code block
    sections.push({
      type: 'code',
      language: match[1] || 'text',
      content: match[2],
    });

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining content after the last code block
  if (lastIndex < content.length) {
    const afterContent = content.slice(lastIndex);
    const afterSections = splitTextAndTableSections(afterContent);
    sections.push(...afterSections);
  }

  // If no code blocks were found, just split text/tables
  if (sections.length === 0) {
    return splitTextAndTableSections(content);
  }

  return sections;
}

/**
 * Split content into text, table, and quote sections (helper for non-code content)
 */
function splitTextAndTableSections(content: string): ContentSection[] {
  const lines = content.split('\n');
  const sections: ContentSection[] = [];
  let currentSection: ContentSection | null = null;

  for (const line of lines) {
    let sectionType: 'text' | 'table' | 'quote';
    let lineContent = line;

    if (isQuoteLine(line)) {
      sectionType = 'quote';
      lineContent = getQuoteContent(line);
    } else if (isTableLine(line) || isTableSeparator(line)) {
      sectionType = 'table';
    } else {
      sectionType = 'text';
    }

    if (!currentSection || currentSection.type !== sectionType) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = { type: sectionType, content: lineContent };
    } else {
      currentSection.content += '\n' + lineContent;
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

export interface FormatMessageOptions {
  mentions?: string[];
}

/**
 * Format message body with newline preservation, link detection, table, and code support
 */
export function formatMessageBody(content: string, options: FormatMessageOptions = {}): React.ReactNode {
  const normalizedContent = content
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const sections = splitContentSections(normalizedContent);

  // If only one section and not a table, use simple rendering
  if (sections.length === 1 && sections[0].type === 'text') {
    const lines = normalizedContent.split('\n');
    return lines.map((line, i) => (
      <React.Fragment key={i}>
        {i > 0 && <br />}
        {formatLine(line, options.mentions)}
      </React.Fragment>
    ));
  }

  // Render mixed content with tables, code blocks, and quotes
  return sections.map((section, sectionIndex) => {
    if (section.type === 'code') {
      return (
        <CodeBlock
          key={sectionIndex}
          code={section.content}
          language={section.language || 'text'}
        />
      );
    }

    if (section.type === 'table') {
      return (
        <pre
          key={sectionIndex}
          className="font-mono text-xs leading-relaxed whitespace-pre overflow-x-auto my-2 p-3 bg-bg-tertiary/50 rounded-lg border border-border-subtle"
        >
          {section.content}
        </pre>
      );
    }

    if (section.type === 'quote') {
      const lines = section.content.split('\n');
      return (
        <blockquote
          key={sectionIndex}
          className="my-2 pl-3 py-1 border-l-2 border-accent-cyan/50 bg-bg-tertiary/30 rounded-r text-text-secondary italic"
        >
          {lines.map((line, i) => (
            <React.Fragment key={i}>
              {i > 0 && <br />}
              {formatLine(line, options.mentions)}
            </React.Fragment>
          ))}
        </blockquote>
      );
    }

    // Regular text section
    const lines = section.content.split('\n');
    return (
      <span key={sectionIndex}>
        {lines.map((line, i) => (
          <React.Fragment key={i}>
            {i > 0 && <br />}
            {formatLine(line, options.mentions)}
          </React.Fragment>
        ))}
      </span>
    );
  });
}

/**
 * Check if a line is a heading and return the level (1-6) or 0 if not
 */
function getHeadingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s+/);
  return match ? match[1].length : 0;
}

/**
 * Check if a line is a list item (bullet or numbered)
 */
function getListInfo(line: string): { type: 'bullet' | 'numbered' | null; content: string; indent: number } {
  const bulletMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
  if (bulletMatch) {
    return { type: 'bullet', content: bulletMatch[3], indent: bulletMatch[1].length };
  }
  const numberedMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
  if (numberedMatch) {
    return { type: 'numbered', content: numberedMatch[3], indent: numberedMatch[1].length };
  }
  return { type: null, content: line, indent: 0 };
}

/**
 * Format inline markdown elements (bold, italic, strikethrough, links, code, URLs)
 * Processes patterns sequentially to avoid regex complexity issues
 */
function formatInlineMarkdown(text: string, mentions?: string[], keyPrefix: string = ''): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let partIndex = 0;

  // Define patterns in order of precedence (most specific first)
  const patterns: Array<{
    regex: RegExp;
    render: (match: RegExpMatchArray, key: string) => React.ReactNode;
  }> = [
    // Inline code `code` - process first to protect content
    {
      regex: /`([^`]+)`/,
      render: (match, key) => (
        <code
          key={key}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-bg-elevated/80 text-accent-cyan font-mono text-[0.85em] border border-border-subtle/50"
        >
          {match[1]}
        </code>
      ),
    },
    // Markdown link [text](url)
    {
      regex: /\[([^\]]+)\]\(([^)]+)\)/,
      render: (match, key) => (
        <a
          key={key}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-cyan no-underline hover:underline"
        >
          {match[1]}
        </a>
      ),
    },
    // Bold **text** (must come before italic *)
    {
      regex: /\*\*([^*]+)\*\*/,
      render: (match, key) => (
        <strong key={key} className="font-semibold text-text-primary">
          {formatInlineMarkdown(match[1], mentions, `${key}-inner`)}
        </strong>
      ),
    },
    // Bold __text__
    {
      regex: /__([^_]+)__/,
      render: (match, key) => (
        <strong key={key} className="font-semibold text-text-primary">
          {formatInlineMarkdown(match[1], mentions, `${key}-inner`)}
        </strong>
      ),
    },
    // Italic _text_ (using underscore to avoid conflict with bold **)
    {
      regex: /_([^_]+)_/,
      render: (match, key) => (
        <em key={key} className="italic">
          {formatInlineMarkdown(match[1], mentions, `${key}-inner`)}
        </em>
      ),
    },
    // Italic *text* (single asterisk - bold ** is matched first due to ordering)
    {
      regex: /\*([^*]+)\*/,
      render: (match, key) => (
        <em key={key} className="italic">
          {formatInlineMarkdown(match[1], mentions, `${key}-inner`)}
        </em>
      ),
    },
    // Strikethrough ~~text~~
    {
      regex: /~~([^~]+)~~/,
      render: (match, key) => (
        <del key={key} className="line-through text-text-muted">
          {match[1]}
        </del>
      ),
    },
    // URL
    {
      regex: /https?:\/\/[^\s]+/,
      render: (match, key) => (
        <a
          key={key}
          href={match[0]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-cyan no-underline hover:underline"
        >
          {match[0]}
        </a>
      ),
    },
  ];

  while (remaining.length > 0) {
    // Find the earliest match among all patterns
    let earliestMatch: { pattern: typeof patterns[0]; match: RegExpMatchArray; index: number } | null = null;

    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match && match.index !== undefined) {
        if (!earliestMatch || match.index < earliestMatch.index) {
          earliestMatch = { pattern, match, index: match.index };
        }
      }
    }

    if (!earliestMatch) {
      // No more matches, add remaining text
      parts.push(highlightMentions(remaining, mentions, `${keyPrefix}-text-${partIndex}`));
      break;
    }

    // Add text before the match
    if (earliestMatch.index > 0) {
      const textBefore = remaining.slice(0, earliestMatch.index);
      parts.push(highlightMentions(textBefore, mentions, `${keyPrefix}-pre-${partIndex}`));
      partIndex++;
    }

    // Render the matched element
    parts.push(earliestMatch.pattern.render(earliestMatch.match, `${keyPrefix}-el-${partIndex}`));
    partIndex++;

    // Move past the match
    remaining = remaining.slice(earliestMatch.index + earliestMatch.match[0].length);
  }

  return parts.length === 1 ? parts[0] : parts;
}

/**
 * Format a single line, detecting headings, lists, and inline markdown
 */
function formatLine(line: string, mentions?: string[]): React.ReactNode {
  // Check for headings
  const headingLevel = getHeadingLevel(line);
  if (headingLevel > 0) {
    const content = line.replace(/^#{1,6}\s+/, '');
    // Use inline styles for font-size to override parent's text-sm
    const headingStyles: Record<number, { className: string; style: React.CSSProperties }> = {
      1: {
        className: 'font-bold text-text-primary mt-4 mb-2 pb-1 border-b border-border-subtle',
        style: { fontSize: '1.5rem', lineHeight: '2rem' }, // 24px
      },
      2: {
        className: 'font-bold text-text-primary mt-3 mb-2',
        style: { fontSize: '1.25rem', lineHeight: '1.75rem' }, // 20px
      },
      3: {
        className: 'font-semibold text-text-primary mt-2.5 mb-1.5',
        style: { fontSize: '1.125rem', lineHeight: '1.5rem' }, // 18px
      },
      4: {
        className: 'font-semibold text-text-primary mt-2 mb-1',
        style: { fontSize: '1rem', lineHeight: '1.5rem' }, // 16px
      },
      5: {
        className: 'font-medium text-text-secondary mt-1.5 mb-1',
        style: { fontSize: '0.875rem', lineHeight: '1.25rem' }, // 14px
      },
      6: {
        className: 'font-medium text-text-muted mt-1 mb-0.5 uppercase tracking-wide',
        style: { fontSize: '0.75rem', lineHeight: '1rem' }, // 12px
      },
    };
    const { className, style } = headingStyles[headingLevel] || headingStyles[3];
    return (
      <div className={className} style={style}>
        {formatInlineMarkdown(content, mentions, 'heading')}
      </div>
    );
  }

  // Check for list items
  const listInfo = getListInfo(line);
  if (listInfo.type) {
    const indentStyle = { marginLeft: `${listInfo.indent * 0.5 + 0.5}rem` };
    return (
      <div className="flex items-start gap-2 my-0.5" style={indentStyle}>
        <span className="text-accent-cyan flex-shrink-0 w-4 text-center">
          {listInfo.type === 'bullet' ? '•' : line.match(/^\s*(\d+\.)/)?.[1]}
        </span>
        <span>{formatInlineMarkdown(listInfo.content, mentions, 'list')}</span>
      </div>
    );
  }

  // Regular line with inline formatting
  return formatInlineMarkdown(line, mentions, 'line');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMentions(text: string, mentions: string[] | undefined, keyPrefix: string): React.ReactNode {
  if (!mentions || mentions.length === 0) {
    return text;
  }

  const escapedMentions = mentions.map(escapeRegExp).filter(Boolean);
  if (escapedMentions.length === 0) {
    return text;
  }

  const pattern = new RegExp(`@(${escapedMentions.join('|')})\\b`, 'g');
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    nodes.push(
      <span
        key={`${keyPrefix}-mention-${match.index}`}
        className="px-1 py-0.5 bg-accent-cyan/20 text-accent-cyan rounded"
      >
        @{match[1]}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : text;
}
