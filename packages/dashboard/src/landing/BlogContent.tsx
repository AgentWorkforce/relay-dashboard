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
  return elements;
}
