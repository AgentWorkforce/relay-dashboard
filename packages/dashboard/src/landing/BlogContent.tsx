/**
 * Agent Relay Cloud - Blog Content Renderer
 * Server-side compatible markdown rendering
 */

import React from 'react';

function parseInlineMarkdown(text: string): string {
  // Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // Bold: **text**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Inline code: `text`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  return text;
}

export function renderBlogContent(content: string): React.ReactNode[] {
  const lines = content.trim().split('\n');
  const elements: React.ReactNode[] = [];
  let currentParagraph: string[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = '';
  let key = 0;

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(' ').trim();
      if (text) {
        elements.push(
          <p key={key++} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(text) }} />
        );
      }
      currentParagraph = [];
    }
  };

  for (const line of lines) {
    // Code block start/end
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flushParagraph();
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBlockContent = [];
      } else {
        elements.push(
          <pre key={key++} className="code-block" data-lang={codeBlockLang}>
            <code>{codeBlockContent.join('\n')}</code>
          </pre>
        );
        inCodeBlock = false;
        codeBlockContent = [];
        codeBlockLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Headers
    if (line.startsWith('## ')) {
      flushParagraph();
      elements.push(<h2 key={key++}>{line.slice(3)}</h2>);
      continue;
    }
    if (line.startsWith('### ')) {
      flushParagraph();
      elements.push(<h3 key={key++}>{line.slice(4)}</h3>);
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    // List items
    if (line.trim().startsWith('- ')) {
      flushParagraph();
      elements.push(
        <ul key={key++}>
          <li dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(line.trim().slice(2)) }} />
        </ul>
      );
      continue;
    }

    // Regular text
    currentParagraph.push(line);
  }

  flushParagraph();
  return elements;
}
