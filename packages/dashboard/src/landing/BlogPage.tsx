/**
 * Agent Relay Cloud - Blog Page
 */

import React, { useState } from 'react';
import { StaticPage } from './StaticPage';

// Blog post data
const blogPosts = [
  {
    id: 'go-to-bed-wake-up-finished',
    title: 'Go to Bed, Wake Up to a Finished Product',
    subtitle: 'How agent-to-agent communication is changing autonomous development',
    date: 'February 1, 2025',
    author: 'Khaliq Gant',
    category: 'Vision',
    excerpt: 'Agent-to-agent communication is weird, fascinating, and potentially revolutionary. Here\'s how I built a system where agents work autonomously while I sleep.',
    content: `
The clear and obvious takeaway from [OpenClaw](https://openclaw.ai/) (Moltbot) and [Moltbook](https://www.moltbook.com/) is that agent-to-agent communication is first weird and fascinating, but also the potential this unlocks is both unprecedented and potentially revolutionary.

On December 16th, I started a project where I wanted to get two Claude agents to play tic-tac-toe against each other. I first dug into Agent Mail and [made a proof of concept](https://github.com/Dicklesworthstone/mcp_agent_mail/pull/33) there, but quickly realized the limitations of a pull-based methodology. I kept digging and quickly realized the only way to get an agent to autonomously interact with other agents is a push-based method into their actual input. So was born [Agent Relay](https://github.com/AgentWorkforce/relay).

## What This Means

Agent-to-agent communication across any CLI tool (Codex, Claude, Gemini, OpenCode, Droid, etc.) is possible **right now** for any task. This can be done via an easy-to-use SDK or the relay-dashboard where you can see messages across agents, chat, spawn and release agents as needed.

At the base level, Agent Relay is a protocol which makes it easy and reliable to stage CLI-agnostic agent-to-agent communication. The manifestations building on top of that protocol are the [relay-dashboard](https://github.com/AgentWorkforce/relay-dashboard/) and [relay-tui](https://github.com/agentWorkforce/relay-tui) — but could be relay-slack, relay-discord, etc.

As we see with Moltbook and what I've seen for the past month: **agents are creative, lazy, chatty, and work quite effectively when given roles and clear responsibilities.**

I kept finding myself as the clear bottleneck when making projects, so removing myself and replacing with an agent is a huge accelerator. I found myself spending increasingly more time in planning and producing an incredibly detailed spec, handing that to a "Lead" agent, telling them to review and then staff a team of agents accordingly and just let me know of any blockers.

Then I would [go to bed](https://x.com/khaliqgant/status/2008325804741071079) and wake up to a finished product.

## Why Not Just Sub-Agents?

Using actual agent instances is a more powerful abstraction. Your agents can create sub-agents, wielding that much more power to an agent. When giving a sub-agent a task too big or complex, often times it'll also hit compaction and just stop—which completely breaks the autonomous workflow we're looking for.

## How Do I Use This?

There are a few ways to use Relay:

### For Developers

- Start a relay server and use the dashboard to spawn and chat with agents
- Start a \`claude\` | \`codex\` etc session, tell it to read our ["For Agents"](https://github.com/AgentWorkforce/relay?tab=readme-ov-file#for-agents) section in the readme and start a relay session using the readme as a guide. Then use that session to coordinate.

### For Library Developers

Use our SDK to enable agent-to-agent communication in your app:

\`\`\`bash
# Install agent relay and start the daemon
npm install -g agent-relay
agent-relay up

# In your project
npm install agent-relay
\`\`\`

\`\`\`javascript
import { RelayClient } from 'agent-relay';

const client = new RelayClient({ name: 'MyApp' });
await client.connect();

// Spawn a worker agent
await client.spawn({
  name: 'Worker',
  cli: 'claude',
  task: 'Wait for instructions'
});

// Send it a message
await client.send('Worker', 'Hello from my app');
\`\`\`

Check out our [docs](https://docs.agent-relay.com/) for more info.

## What's Next

We're super excited for what's to come. We have [Agent Relay Cloud](https://agent-relay.com/) which via a GitHub login allows you to link your repository to your own private workspace server. Using your Claude, Codex, Gemini, or Cursor login, you can spawn agents and have them work 24/7 against your repo using the dashboard.

You and your teammates who have access to the repository can intermingle with agents, giving instructions in different topic-based channels to help organize agent work. You can have agents review pull requests, work on documentation—all with authenticated access to your GitHub repo.

This is just the beginning. GitHub is the first context we've unlocked. This will be extended to other integrations like Notion, Slack, Outlook, etc., so agents can operate 24/7 and accelerate your workflows.
    `,
  },
];

// Simple markdown-like rendering for blog content
function renderContent(content: string) {
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

  const parseInlineMarkdown = (text: string): string => {
    // Links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Bold: **text**
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Inline code: `text`
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    return text;
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

export function BlogPage() {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const selectedPost = blogPosts.find(p => p.id === selectedPostId);

  // Show individual post view
  if (selectedPost) {
    return (
      <StaticPage
        title="Blog"
        subtitle="News, tutorials, and insights from the Agent Relay team."
      >
        <button
          className="blog-back-button"
          onClick={() => setSelectedPostId(null)}
        >
          ← Back to all posts
        </button>

        <article className="blog-post">
          <div className="blog-post-header">
            <div className="blog-meta">
              <span className="blog-category">{selectedPost.category}</span>
              <span>{selectedPost.date}</span>
              <span className="blog-author">by {selectedPost.author}</span>
            </div>
            <h2 className="blog-post-title">{selectedPost.title}</h2>
            <p className="blog-post-subtitle">{selectedPost.subtitle}</p>
          </div>

          <div className="blog-post-content">
            {renderContent(selectedPost.content)}
          </div>
        </article>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '48px 0' }} />

        <h2>Stay Updated</h2>
        <p>
          Follow us on <a href="https://twitter.com/agent_relay" target="_blank" rel="noopener noreferrer">Twitter</a> for the latest updates and more content.
        </p>
      </StaticPage>
    );
  }

  // Show blog listing
  return (
    <StaticPage
      title="Blog"
      subtitle="News, tutorials, and insights from the Agent Relay team."
    >
      <div className="blog-list">
        {blogPosts.map((post) => (
          <article
            key={post.id}
            className="blog-card"
            onClick={() => setSelectedPostId(post.id)}
            style={{ cursor: 'pointer' }}
          >
            <div className="blog-meta">
              <span className="blog-category">{post.category}</span>
              <span>{post.date}</span>
              <span className="blog-author">by {post.author}</span>
            </div>
            <h3>{post.title}</h3>
            <p>{post.excerpt}</p>
            <span className="blog-read-more">Read more →</span>
          </article>
        ))}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '48px 0' }} />

      <h2>Stay Updated</h2>
      <p>
        Follow us on <a href="https://twitter.com/agent_relay" target="_blank" rel="noopener noreferrer">Twitter</a> for the latest updates and more content.
      </p>
    </StaticPage>
  );
}

export default BlogPage;
