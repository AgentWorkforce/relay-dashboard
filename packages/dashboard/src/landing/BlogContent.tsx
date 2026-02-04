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
  // Italic: *text* (single asterisks, but not inside words)
  text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em>$1</em>');
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
  let inTable = false;
  let tableRows: string[] = [];
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

  const flushTable = () => {
    if (tableRows.length >= 2) {
      const parseRow = (row: string) =>
        row.split('|').slice(1, -1).map(cell => cell.trim());

      const headerCells = parseRow(tableRows[0]);
      const dataRows = tableRows.slice(2); // Skip header and separator

      elements.push(
        <div key={key++} style={{ overflowX: 'auto', margin: '24px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
            <thead>
              <tr>
                {headerCells.map((cell, i) => (
                  <th key={i} style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    borderBottom: '2px solid var(--border-subtle)',
                    fontWeight: 600
                  }} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(cell) }} />
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, i) => (
                <tr key={i}>
                  {parseRow(row).map((cell, j) => (
                    <td key={j} style={{
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--border-subtle)'
                    }} dangerouslySetInnerHTML={{ __html: parseInlineMarkdown(cell) }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    tableRows = [];
    inTable = false;
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
      if (inTable) flushTable();
      continue;
    }

    // Table rows: | col1 | col2 |
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      flushParagraph();
      inTable = true;
      tableRows.push(line.trim());
      continue;
    } else if (inTable) {
      flushTable();
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

    // Images: ![alt](src)
    const imageMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushParagraph();
      elements.push(
        <figure key={key++} className="blog-image" style={{ margin: '32px 0' }}>
          <img src={imageMatch[2]} alt={imageMatch[1]} style={{ width: '100%', borderRadius: '8px' }} />
          {imageMatch[1] && <figcaption style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '12px', fontSize: '14px', fontStyle: 'italic' }}>{imageMatch[1]}</figcaption>}
        </figure>
      );
      continue;
    }

    // Twitter embed: {{tweet:TWEET_URL}}
    const tweetMatch = line.trim().match(/^\{\{tweet:(.+)\}\}$/);
    if (tweetMatch) {
      flushParagraph();
      const tweetUrl = tweetMatch[1];
      elements.push(
        <div key={key++} className="tweet-embed" style={{ margin: '24px 0', display: 'flex', justifyContent: 'center' }}>
          <blockquote className="twitter-tweet" data-theme="dark">
            <a href={tweetUrl}>View tweet</a>
          </blockquote>
        </div>
      );
      continue;
    }

    // Regular text
    currentParagraph.push(line);
  }

  flushParagraph();
  if (inTable) flushTable();
  return elements;
}
