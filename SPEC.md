# Dashboard Extraction Spec

## Overview

Extract the dashboard from the relay monorepo into a standalone package (`@agent-relay/dashboard`) that acts as a pure presentation layer over the relay protocol.

## Current State

- Dashboard code lives in `relay/src/dashboard/` (frontend) and `relay/packages/dashboard/` (server)
- Tightly coupled with `@agent-relay/*` internal packages
- Built and deployed as part of relay monorepo

## Target State

- Dashboard is a standalone npm package: `@agent-relay/dashboard`
- Zero `@agent-relay/*` dependencies
- Proxies all requests to relay daemon via HTTP/WebSocket
- Can be installed globally or run via npx
- Relay CLI provides convenience commands to launch dashboard

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Machine                          │
│                                                              │
│  ┌──────────────────┐         ┌──────────────────────────┐  │
│  │  relay-dashboard │   HTTP  │      relay daemon        │  │
│  │                  │ ──────▶ │                          │  │
│  │  - Static UI     │   WS    │  - Agent management      │  │
│  │  - Proxy server  │ ◀────── │  - Message routing       │  │
│  │                  │         │  - Storage               │  │
│  │  Port 3888       │         │  - All business logic    │  │
│  └──────────────────┘         │                          │  │
│                               │  Port 3889               │  │
│                               └──────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## User Experience

### Running Dashboard

```bash
# Option A: Standalone
agent-relay up              # Start daemon
npx @agent-relay/dashboard  # Start dashboard separately

# Option B: With flag
agent-relay up --dashboard  # Start daemon + dashboard together

# Option C: Separate command
agent-relay up              # Start daemon
agent-relay dashboard       # Start dashboard (connects to running daemon)

# Option D: All-in-one
agent-relay up --dashboard  # Start both
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `agent-relay up` | Start daemon only (port 3889) |
| `agent-relay up --dashboard` | Start daemon + launch dashboard |
| `agent-relay dashboard` | Launch dashboard, connect to running daemon |
| `agent-relay dashboard --port 3000` | Launch on custom port |
| `agent-relay dashboard --open` | Launch and open browser |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_DASHBOARD_PORT` | 3888 | Dashboard server port |
| `RELAY_DASHBOARD_AUTO` | false | Auto-launch dashboard with `agent-relay up` |

## CLI Integration

### Implementation in Relay

```typescript
// packages/cli/src/commands/dashboard.ts

import { spawn } from 'child_process';
import { resolve } from 'path';

interface DashboardOptions {
  port?: number;
  relayUrl?: string;
  open?: boolean;
}

export async function launchDashboard(options: DashboardOptions = {}) {
  const {
    port = process.env.RELAY_DASHBOARD_PORT || 3888,
    relayUrl = `http://localhost:${process.env.RELAY_PORT || 3889}`,
    open = false,
  } = options;

  const args = [
    '@agent-relay/dashboard',
    '--port', String(port),
    '--relay-url', relayUrl,
  ];

  console.log(`Starting dashboard at http://localhost:${port}`);
  console.log(`Connecting to relay daemon at ${relayUrl}`);

  const dashboard = spawn('npx', args, {
    stdio: 'inherit',
    shell: true,
  });

  dashboard.on('error', (err) => {
    if (err.message.includes('ENOENT')) {
      console.error('Dashboard not found. Install with: npm install -g @agent-relay/dashboard');
    } else {
      console.error('Failed to start dashboard:', err.message);
    }
  });

  if (open) {
    // Wait for server to start, then open browser
    setTimeout(() => {
      const openCmd = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(openCmd, [`http://localhost:${port}`], { shell: true });
    }, 2000);
  }

  return dashboard;
}

// Integration with `agent-relay up`
export function integrateWithUp(upOptions: UpOptions) {
  if (upOptions.dashboard || process.env.RELAY_DASHBOARD_AUTO === 'true') {
    // Launch dashboard after daemon is ready
    launchDashboard({
      open: upOptions.open,
    });
  }
}
```

### CLI Argument Parsing

```typescript
// In agent-relay up command
program
  .command('up')
  .option('--dashboard', 'Launch dashboard alongside daemon')
  .option('--open', 'Open dashboard in browser')
  .action(async (options) => {
    await startDaemon(options);
    if (options.dashboard) {
      await launchDashboard({ open: options.open });
    }
  });

// Standalone dashboard command
program
  .command('dashboard')
  .option('-p, --port <port>', 'Dashboard port', '3888')
  .option('-r, --relay-url <url>', 'Relay daemon URL')
  .option('--open', 'Open in browser')
  .action(async (options) => {
    await launchDashboard(options);
  });
```

## Migration Steps

### Phase 1: Publish Standalone Dashboard (Done)
- [x] Extract dashboard code to `relay-dashboard` repo
- [x] Remove `@agent-relay/*` dependencies
- [x] Create minimal proxy server
- [x] Set up npm publishing
- [x] Set up deployment (Fly.io)

### Phase 2: Add CLI Integration
- [ ] Add `agent-relay dashboard` command
- [ ] Add `--dashboard` flag to `agent-relay up`
- [ ] Add `RELAY_DASHBOARD_AUTO` env var support
- [ ] Update CLI help/docs

### Phase 3: Remove from Relay Monorepo
- [ ] Delete `src/dashboard/`
- [ ] Delete `packages/dashboard/`
- [ ] Remove dashboard from build scripts
- [ ] Remove dashboard-related dependencies
- [ ] Update monorepo documentation

### Phase 4: Update Documentation
- [ ] Update relay README
- [ ] Update getting started guide
- [ ] Add dashboard installation instructions
- [ ] Update deployment docs

## Sync Strategy

### Option A: Manual Sync (Current)
- Manually copy changes between repos
- Good for stability, bad for keeping in sync

### Option B: Automated Sync via GitHub Actions
- Trigger workflow in `relay-dashboard` when `relay/src/dashboard` changes
- Creates PR with synced changes
- Requires maintaining both locations temporarily

### Option C: Full Separation (Recommended after Phase 3)
- Dashboard development happens only in `relay-dashboard`
- No sync needed
- Clean separation of concerns

## API Contract

The dashboard depends on these relay daemon endpoints:

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List agents |
| GET | `/api/agents/:name` | Get agent details |
| POST | `/api/agents/spawn` | Spawn new agent |
| DELETE | `/api/agents/:name` | Kill agent |
| GET | `/api/messages` | Get messages |
| POST | `/api/messages` | Send message |
| GET | `/api/sessions` | List sessions |
| GET | `/api/trajectory/:agent` | Get agent trajectory |
| GET | `/api/health` | Health check |
| GET | `/api/metrics` | Prometheus metrics |

### WebSocket

| Event | Direction | Description |
|-------|-----------|-------------|
| `agents` | Server→Client | Agent list updates |
| `message` | Bidirectional | New messages |
| `presence` | Server→Client | User presence |
| `typing` | Bidirectional | Typing indicators |

### Versioning

- Dashboard and daemon should be version-compatible
- Major version bumps require coordination
- Consider adding `/api/version` endpoint for compatibility checks

## Timeline

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | Done | - |
| Phase 2 | 1-2 days | Phase 1 |
| Phase 3 | 1 day | Phase 2 tested |
| Phase 4 | 1 day | Phase 3 |

**Total: ~1 week** from start to full extraction (excluding Phase 1 which is complete)

## Open Questions

1. **Version pinning**: Should `agent-relay dashboard` pin to a specific dashboard version?
2. **Offline support**: Should the CLI bundle the dashboard for offline use?
3. **Auto-update**: Should the dashboard auto-update when a new version is available?
4. **Cloud dashboard**: How does this affect the hosted cloud dashboard?
