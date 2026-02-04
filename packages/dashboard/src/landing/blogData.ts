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
    id: 'let-them-cook-multi-agent-orchestration',
    title: 'Let Them Cook: Lessons from 6 Weeks of Multi-Agent Orchestration',
    subtitle: 'What I learned watching AI agents coordinate, communicate, and occasionally fall apart',
    date: 'February 4, 2026',
    author: 'Khaliq Gant',
    category: 'Engineering',
    excerpt: 'Multi-agent orchestration is a step change in how tasks get done. After 6 weeks of building with agent swarms, here\'s what works, what breaks, and why the planning phase becomes everything.',
    content: `
It's rumored that Claude Code is coming out with the ability to use agent swarms in an upcoming release.

{{tweet:https://twitter.com/nummanali/status/2014698883507462387}}

Multi-agent orchestration is a step change in how tasks get done by putting agents front and center while the human takes a step back and just lets them cook. That doesn't mean the human will be completely removed—there are still some bumps in the road to truly autonomous agent work, and the planning phase becomes one of the most crucial steps.

I've been working with multi-agent orchestration using [Agent Relay](https://github.com/AgentWorkforce/relay) for the past six weeks and it has been an eye-opening experience. Agent Relay is an open-source communication layer allowing any CLI tool—Claude, Cursor, OpenCode, Gemini—to communicate efficiently and seamlessly. Am I worried that Claude Code is coming out with first-party support for agent swarms? If I'm being completely honest, yes, a little bit. But my main feeling is that it's great to push multi-agent orchestration into the forefront of developer minds so the true power can be experienced and more best practices and opinions form around it.

## The Power of Agent Teams

First and foremost, having agents who can communicate with each other and coordinate on tasks is a huge unlock. Assigning agent profiles similar to how human teams would organize has been a paradigm I have found success with. For instance:

- **Lead** – coordinates the team and breaks down tasks
- **Backend** – implements server-side logic
- **BackendReviewer** – reviews backend code for quality
- **FrontendReviewer** – reviews frontend code for quality
- **TypeChecker** – ensures type safety across the codebase
- **TestWriter** – writes and maintains tests
- **DocumentationExpert** – handles docs and comments

Each agent assumes its role, can read the logs of other agents, and can message others to check their work, sanity-check their decisions, and hand off tasks in a coordinated manner.

The other method that has worked well for me is creating a detailed spec upfront and then spawning a Lead agent. I give it the spec and tell it to assemble a team as it sees fit. The Lead then spawns agents accordingly. Because Agent Relay is CLI-agnostic, I make sure to mix Codex, Claude, OpenCode, Gemini, and Droid agents, assigning different models based on the role—a fast model like Haiku or Conductor for Lead roles, and for deeper technical tasks, Opus or GPT-5 Codex high.

Using this workflow, I've seen that not only does code quality increase, but the speed at which agents can pump out complex features is at least a **4-5X improvement**.

I have been using Agent Relay to build itself on the cloud environment at [agent-relay.com](https://agent-relay.com) and the pace of delivery using agent orchestration has been mind-blowing.

It hasn't been all good though...

## Agents Are Sometimes Lazy

I've had instances where an agent swarm takes on a complicated feature and then the Lead excitedly declares everything done. However, upon further inspection I find stubbed-out implementations and TODOs scattered through the code. This happened occasionally with single-agent sessions, but imagine it compounding across 5, 6, or 10 agents—it becomes very problematic.

Agent Relay has a notion of a **shadow agent** that helps quite a bit with this problem. Reviewer agents also typically catch this type of shoddy work.

## Agents Get Overwhelmed and Die

Having a Lead agent creates a single point of failure. If the swarm is large and chatty, the Lead receives a flood of messages from other agents plus queries from the human asking about status or redirecting work. This can overwhelm the Lead, causing it to enter an endless loop and eventually die or become completely unresponsive.

Team structure matters here. There's a magic ratio of Lead-to-worker agents that I haven't exactly figured out yet—it varies depending on roles—but I've had success with **2-5 worker agents per Lead**. A single Lead managing 10 agents usually becomes problematic.

Agent Relay also has a [\`continuity\`](https://docs.agent-relay.com/guides/session-continuity#session-continuity) concept, largely borrowed from the [Continuous Claude](https://github.com/parcadei/Continuous-Claude-v3) package by [@parcadei](https://x.com/parcadei). This enables ephemeral agents that save their context periodically, get released, then spawn again and continue seamlessly by reading their saved state.

## Communication Pattern Observations

**Codex** is great on heads-down work but doesn't communicate that well, and once working is hard to interrupt.

**Claude** in general communicates very well and can be interrupted.

**Cursor** (and in particular Composer) is very fast and also communicates well.

Agent Relay allows users to define a \`teams.json\` ([docs](https://docs.agent-relay.com/reference/configuration#project-configuration-files)) that auto-spawns agents on start, so these staffing decisions can be codified and stay consistent across sessions:

\`\`\`json
{
  "team": "my-team",
  "autoSpawn": true,
  "agents": [
    {
      "name": "Coordinator",
      "cli": "claude",
      "role": "coordinator",
      "task": "Coordinate the team..."
    },
    {
      "name": "Developer",
      "cli": "codex",
      "task": "Implement features..."
    }
  ]
}
\`\`\`

## The Human's New Role

Coordinating with multiple agents and seeing output fly in at rapid speed is quite exhilarating. Being able to remove myself as the bottleneck and just let the agents do their thing is a huge benefit. This necessitates that the **planning phase is carefully and meticulously done** to ensure agents have well-defined tasks with edge cases thought out.

It also means the **review phase is paramount**. Having agents self-review and cross-review is an effective strategy. 

![Agent Relay dashboard showing Developer reporting completion to Coordinator, who then routes the work to ReviewerA for review](/blog/agent-review-workflow.png)


Additionally, layering in one of the many AI code review tools has also been effective at catching minor issues.

## Trajectories: The Unexpected Unlock

One other thing that has been a huge and unexpected unlock is to have agents store **trajectories**—which can be defined as a train of thought of an agent stored in logical chapters for a completed task. It was inspired by [this thread](https://x.com/gergelyorosz/status/2002160432841097239) from [@GergelyOrosz](https://x.com/GergelyOrosz).

An example would look like this:

\`\`\`json
{
  "id": "traj_itn5hyej5mi6",
  "task": {
    "title": "Fix module resolution issues - 17 test failures"
  },
  "status": "completed",
  "chapters": [
    {
      "title": "Work",
      "events": [
        {
          "type": "decision",
          "content": "Thread shadowMode through protocol layers",
          "raw": {
            "reasoning": "Devin review found fields were silently dropped..."
          },
          "significance": "high"
        }
      ]
    }
  ],
  "retrospective": {
    "summary": "Fixed issue by threading shadow options through all layers",
    "confidence": 0.9
  }
}
\`\`\`

The [AgentWorkforce/trajectories](https://github.com/AgentWorkforce/trajectories/) repo provides a CLI tool that agents can easily understand. It becomes invaluable when an agent in a new session needs to revisit a previously-worked feature or investigate a bug. By finding the relevant trajectory, the agent gains instant context and insight, making it much better informed on how to proceed. These trajectories are also useful to humans reviewing the codebase.

## Looking Forward

I'll continue to jot down thoughts as I continue down the road of multi-agent orchestration and communication using Agent Relay. I'm super bullish on it (I guess obviously since I started a company around it) and am excited for what's to come!

Hit me on X with any thoughts or questions—I'm all for a discussion: [@khaliqgant](https://x.com/khaliqgant)
`,
  },
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
