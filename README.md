# Agent Relay Dashboard

Standalone web dashboard for Agent Relay - a pure presentation layer over the relay protocol.

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│   Dashboard UI      │     │   Relay Daemon      │
│   (Next.js)         │     │   (relay)           │
│                     │     │                     │
│   ┌─────────────┐   │     │   ┌─────────────┐   │
│   │  React      │   │     │   │  Agents     │   │
│   │  Components │   │     │   │  Storage    │   │
│   └──────┬──────┘   │     │   │  Bridge     │   │
│          │          │     │   └─────────────┘   │
│   ┌──────▼──────┐   │     │                     │
│   │  API Client │───┼─────┼─▶ HTTP/WebSocket    │
│   └─────────────┘   │     │   Port 3889         │
│                     │     │                     │
└─────────────────────┘     └─────────────────────┘
     Port 3888
```

The dashboard is **purely presentational** - all business logic lives in the relay daemon:
- **No direct database access** - queries via relay API
- **No agent management logic** - commands sent to relay daemon
- **No @agent-relay/* dependencies** - completely decoupled

## Installation

```bash
# Install globally
npm install -g @agent-relay/dashboard

# Or use npx
npx @agent-relay/dashboard
```

## Usage

### With Relay Daemon Running

```bash
# Start relay daemon (in another terminal)
agent-relay up

# Start dashboard
relay-dashboard
# or
npx @agent-relay/dashboard
```

### Configuration

```bash
# Custom port
relay-dashboard --port 3000

# Custom relay daemon URL
relay-dashboard --relay-url http://remote-relay:3889

# Verbose logging
relay-dashboard --verbose
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3888 | Dashboard server port |
| `RELAY_URL` | http://localhost:3889 | Relay daemon URL to proxy to |
| `STATIC_DIR` | ./out | Path to static files |
| `VERBOSE` | false | Enable verbose logging |

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Development mode runs:
- Frontend (Next.js): http://localhost:3888
- Expects relay daemon at: http://localhost:3889

## Project Structure

```
relay-dashboard/
├── src/
│   ├── app/           # Next.js App Router pages
│   ├── components/    # React components (65+)
│   │   ├── hooks/     # Custom React hooks (25+)
│   │   ├── channels/  # Channel management
│   │   ├── layout/    # Layout components
│   │   └── settings/  # Settings panels
│   ├── lib/           # API clients & utilities
│   ├── types/         # TypeScript definitions
│   └── landing/       # Landing page
├── server/            # Minimal proxy server
│   ├── server.ts      # Express + WS proxy
│   ├── start.ts       # CLI entry point
│   └── index.ts       # Package exports
├── public/            # Static assets
└── out/               # Built static site
```

## Deployment

### Fly.io

```bash
# Create app
fly apps create relay-dashboard

# Set secrets
fly secrets set RELAY_URL=https://your-relay-daemon.fly.dev

# Deploy
fly deploy
```

### Docker

```bash
docker build -t relay-dashboard .
docker run -p 3888:3888 -e RELAY_URL=http://relay:3889 relay-dashboard
```

### Vercel / Static Hosting

The `out/` directory contains a static export. Deploy to any static host and configure a reverse proxy for `/api/*` and `/ws` to your relay daemon.

## Publishing

```bash
# Build and publish to npm
npm publish --access public
```

## Syncing with Relay

This repository can be synced from the relay repo via GitHub Actions.

### Automatic Sync (Optional)

See [.github/RELAY_WORKFLOW_TRIGGER.md](.github/RELAY_WORKFLOW_TRIGGER.md) for instructions on setting up automatic syncing when dashboard code changes in the relay repo.

## API Endpoints (Proxied)

All API requests are proxied to the relay daemon:

| Endpoint | Description |
|----------|-------------|
| `GET /api/agents` | List all agents |
| `POST /api/agents/spawn` | Spawn a new agent |
| `POST /api/messages` | Send a message |
| `GET /api/messages` | Get message history |
| `WS /ws` | Real-time WebSocket connection |

See the relay daemon documentation for full API reference.

## Features

- Real-time agent monitoring and management
- Multi-workspace support
- Channel-based team coordination
- Activity feed and broadcasts
- Metrics and health monitoring
- Provider authentication flows
- Session tracking and trajectory viewing
- Terminal log viewer

## License

MIT
