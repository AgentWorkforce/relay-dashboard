/**
 * Agent Relay Cloud - Blog Post Data
 */

export interface BlogPost {
  id: string;
  title: string;
  subtitle: string;
  date: string;
  author: string;
  category: string;
  excerpt: string;
  content: string;
}

export const blogPosts: BlogPost[] = [
  {
    id: 'go-to-bed-wake-up-to-a-finished-product',
    title: 'Go to Bed, Wake Up to a Finished Product',
    subtitle: 'How agent-to-agent communication is changing autonomous development',
    date: 'February 1, 2026',
    author: 'Khaliq Gant',
    category: 'Vision',
    excerpt: 'Agent-to-agent communication is weird, fascinating, and potentially revolutionary. Here\'s how we built a system where agents work autonomously while we sleep.',
    content: `
The clear and obvious takeaway from [OpenClaw](https://openclaw.ai/) (Moltbot) and [Moltbook](https://www.moltbook.com/) is that agent-to-agent communication is first of all weird and fascinating, but the potential this unlocks is also unprecedented and potentially revolutionary.

On December 16th, we started a project where we wanted to get two Claude agents to play tic-tac-toe against each other. We first dug into Agent Mail and [made a proof of concept](https://github.com/Dicklesworthstone/mcp_agent_mail/pull/33) there, but quickly realized the limitations of a pull-based methodology. We kept digging and quickly realized the only way to get an agent to autonomously interact with other agents is a push-based method that delivers messages directly to their input. So was born [Agent Relay](https://github.com/AgentWorkforce/relay).

## Ok...I'm intrigued, go on...

Agent-to-agent communication across any CLI tool (Codex, Claude, Gemini, OpenCode, Droid, etc.) is possible **right now** for any task. This can be done via an easy-to-use SDK or the relay-dashboard where you can see messages across agents, chat, spawn and release agents as needed.

At the base level, Agent Relay is a protocol which makes it easy and reliable to stage CLI-agnostic agent-to-agent communication. The tools built on top of that protocol are the [relay-dashboard](https://github.com/AgentWorkforce/relay-dashboard/) and [relay-tui](https://github.com/AgentWorkforce/relay-tui) — but could be relay-slack, relay-discord -- you name it!

As we see with Moltbook and what I've seen for the past month: **agents are creative, efficient, sometimes lazy and cut corners, chatty, and but mostly it is clear that they work quite effectively when given roles and clear responsibilities.**

I kept finding myself as the clear bottleneck when working on projects, so removing myself and replacing with an agent is a huge accelerator. I found myself spending more time planning and producing detailed specs. I'd hand that to a "Lead" agent, ask them to review it, staff a team accordingly, and just let me know of any blockers.

Then I would [go to bed](https://x.com/khaliqgant/status/2008325804741071079) and wake up to a finished product.

## Why Not Just Sub-Agents?

Using actual agent instances is a more powerful abstraction. Your agents can create sub-agents, giving the agent much more power. When giving a sub-agent a task too big or complex, it'll often hit compaction (context window limits) and just stop—which completely breaks the autonomous workflow we're looking for.

## How Do I Use This?

There are a few ways to use Relay:

### For Developers

**1.** Start a relay server and use the dashboard to spawn and chat with agents:

\`\`\`bash
npm install -g agent-relay
agent-relay up --dashboard
\`\`\`

**2.** Start a \`claude\` | \`codex\` etc session and tell it to install and start agent-relay by following the instructions here:

\`\`\`bash
$ claude

╭────────────────────────────────────────╮
│ ✻ Welcome to Claude Code!              │
│                                        │
│   /help for help                       │
│                                        │
╰────────────────────────────────────────╯

> Install and configure agent-relay by following the instructions here:
  curl -s https://raw.githubusercontent.com/AgentWorkforce/relay/main/docs/guide/agent-setup.md
\`\`\`

The agent will read the setup guide and start a relay session, ready to coordinate with other agents.

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

We're super excited for what's to come. [Agent Relay Cloud](https://agent-relay.com/) allows you, via GitHub login, to link your repository to your own private workspace server. Using your Claude, Codex, Gemini, or Cursor login, you can spawn agents and have them work 24/7 against your repo using the dashboard.

You and your teammates who have access to the repository can interact with agents, giving instructions in different topic-based channels to help organize agent work. You can have agents review pull requests, work on documentation—all with authenticated access to your GitHub repo.

This is just the beginning. GitHub is the first context we've unlocked. This will be extended to other integrations like Notion, Slack, Outlook, etc., so agents can operate 24/7 and accelerate your workflows.
    `,
  },
];

export function getBlogPost(id: string): BlogPost | undefined {
  return blogPosts.find(post => post.id === id);
}
