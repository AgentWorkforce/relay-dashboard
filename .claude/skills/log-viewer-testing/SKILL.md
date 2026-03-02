---
name: log-viewer-testing
description: Test the log viewer components in isolation using the /dev/log-viewer test page. Loads real worker logs from the dashboard server API and renders them through both inline (sanitized text) and xterm.js (full ANSI) modes. Use when asked to "test the log viewer", "verify log rendering", "check ANSI rendering", or "test CLI output display".
---

# Log Viewer Testing

Test the log viewer rendering pipeline in isolation using the `/dev/log-viewer` test page — no WebSocket or live agent connection required.

## Overview

The test page at `/dev/log-viewer` renders log viewer components with:
- **Static fixtures**: Edge cases (malformed ANSI, Unicode, spinners, backspaces) and streaming simulation
- **Real worker logs**: Loaded dynamically from the dashboard server's `/api/logs/:name` endpoint

Both **inline mode** (sanitized text, ANSI stripped) and **xterm panel mode** (full ANSI color rendering) are shown side by side for comparison.

## Prerequisites

1. **Next.js dev server** running on port 3888:
   ```bash
   npm run dev -w @agent-relay/dashboard
   ```

2. **Dashboard server** running (for real log loading):
   ```bash
   # From repo root — starts both Next.js and dashboard-server
   npm run dev

   # Or start dashboard-server separately with CORS for cross-origin dev:
   CORS_ORIGINS='*' DATA_DIR=$(pwd)/.agent-relay npm run dev -w @agent-relay/dashboard-server
   ```

3. **Worker log files** at `.agent-relay/team/worker-logs/*.log` — these are created automatically when agents run through the dashboard.

## Quick Start

```bash
# Start everything
npm run dev

# Open the test page
open http://localhost:3888/dev/log-viewer
```

If the dashboard server is on a different port, use the `?api=` query parameter:
```
http://localhost:3888/dev/log-viewer?api=http://localhost:3891
```

## What to Test

### 1. Static Fixtures (always available)

| Fixture | What it tests |
|---------|---------------|
| **Edge Cases** | Malformed ANSI escapes, Unicode/emoji, long lines, stderr, carriage returns, spinners, backspace handling, 256-color codes |
| **Streaming** | Auto-scroll, line buffering, timed delays between lines |

### 2. Real Worker Logs (requires dashboard server)

Click any agent name in the "Real Logs" row to load their actual PTY output. Key agents to test:

| Agent | CLI | What to look for |
|-------|-----|-----------------|
| **Lead/Leader** | Claude Code | ANSI colors, permission prompts, tool use blocks, thinking indicators, status line |
| **Codex-Identity/Codex-MessageID** | Codex | Progress bars, file diffs, colored output, different ANSI patterns |
| **Reviewer/CodexReviewer** | Claude Code | Relay messages, review formatting |
| **Shadow** | Claude Code | Extended output, mixed formatting |
| **BrokerFixer/DMFixer** | Codex | Code changes, git diffs |

### 3. Rendering Checks

For each fixture, verify:

**Inline Mode (left panel)**:
- [ ] No raw ANSI escape codes visible (no `[0m`, `[31m`, etc.)
- [ ] No orphaned bracket sequences from stripped ESC bytes
- [ ] Spinner characters filtered out (no lone braille dots)
- [ ] Backspace characters properly handle overwrites
- [ ] stderr lines appear in red
- [ ] system messages appear in blue italic
- [ ] Unicode and emoji render correctly
- [ ] Long lines wrap properly

**XTerm Panel (right panel)**:
- [ ] ANSI colors render correctly (red for errors, green for success, etc.)
- [ ] 256-color codes display properly
- [ ] Bold, underline, and other SGR attributes work
- [ ] Carriage returns overwrite lines (not duplicate them)
- [ ] Content is scrollable for large logs

### 4. Streaming Mode

Toggle "Streaming" on, then click "Replay":
- [ ] Lines appear one at a time with delays
- [ ] Auto-scroll follows new content
- [ ] No duplicate lines (React Strict Mode handled)
- [ ] Replay resets and replays from beginning

## Architecture

```
packages/dashboard/src/
  app/dev/log-viewer/
    page.tsx           — Test page with controls and side-by-side layout
    fixtures.ts        — Static fixtures + rawLogToFixture() for real logs
    MockLogViewer.tsx   — InlineMockViewer (sanitized text rendering)
  lib/
    sanitize-logs.ts    — Shared sanitization (used by LogViewer + AgentLogPreview)
    sanitize-logs.test.ts — Unit tests for sanitization
```

### Key Components

- **`XTermLogViewer`** — Production terminal component; accepts `mockData` prop to run with fixture data instead of WebSocket
- **`preprocessLineForXterm()`** — Resolves `\r` carriage-return overwrites and filters spinner fragments before writing to xterm (in `XTermLogViewer.tsx`)
- **`sanitizeLogContent()`** — Strips ANSI (OSC, DCS, CSI, SGR), handles backspaces iteratively, removes orphaned escape sequences
- **`isSpinnerFragment()`** — Detects lone spinner characters (braille dots, line-drawing chars) and Claude Code spinner words
- **`rawLogToFixture()`** — Converts raw log file content into fixture format

## Automated Testing with Browser Tools

For visual verification using browser automation:

```bash
# Start Chrome
browser-start.js

# Navigate to test page
browser-nav.js "http://localhost:3888/dev/log-viewer?api=http://localhost:3891"

# Wait for page load, then screenshot
sleep 3
browser-screenshot.js

# Click a real log agent button (index 3+ for real logs)
browser-eval.js 'document.querySelectorAll("button")[14].click()'
sleep 4
browser-screenshot.js

# Check for raw ANSI in inline mode
browser-eval.js 'document.querySelector(".font-mono").textContent.includes("[0m")'
# Should return: false
```

## Running Unit Tests

```bash
npx vitest run packages/dashboard/src/lib/sanitize-logs.test.ts
```

## Spawning Live CLI Agents for Fresh Logs

To generate fresh log output from real CLIs for testing:

```bash
# Spawn a Claude Code agent (creates a new .log file in worker-logs)
cat > $AGENT_RELAY_OUTBOX/spawn << 'EOF'
KIND: spawn
NAME: TestClaude
CLI: claude

Run a simple task: list the files in the current directory and describe the project structure.
EOF
```
Then: `->relay-file:spawn`

```bash
# Spawn a Codex agent
cat > $AGENT_RELAY_OUTBOX/spawn << 'EOF'
KIND: spawn
NAME: TestCodex
CLI: codex

Run a simple task: check the TypeScript types in this project and report any issues.
EOF
```
Then: `->relay-file:spawn`

After agents complete, their logs appear in the "Real Logs" section of the test page.

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "No real log agents found" | Dashboard server not running | Start with `npm run dev` from repo root |
| CORS error loading logs | Cross-origin fetch blocked | Add `CORS_ORIGINS='*'` when starting dashboard-server, or use `?api=` param |
| Empty xterm panel | xterm.js failed to load | Check browser console for import errors |
| Duplicate lines in streaming | React Strict Mode double-invoking effects | Fixed via `cancelled` boolean in useEffect cleanup |
| Raw brackets in inline mode | ANSI ESC bytes stripped by PTY capture but CSI sequences remain | `sanitizeLogContent` handles orphaned sequences |
