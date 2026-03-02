---
paths:
  - "packages/dashboard-server/src/**/*.ts"
---

# Server Module Patterns

The dashboard server follows a decomposed architecture. server.ts is a pure wiring orchestrator (~593 lines). All business logic lives in extracted modules.

## Route modules (`routes/`)
- Export `registerXRoutes(app: Application, deps: XRouteDeps): void`
- Define a `XRouteDeps` interface for all dependencies (dependency injection)
- Never import global state; receive everything via deps

## WebSocket modules (`websocket/`)
- Export `setupXWebSocket(deps: XWebSocketDeps): void` (or return value if needed)
- Handle keepalive, subscribe/unsubscribe, and cleanup internally

## Library modules (`lib/`)
- Export factory functions: `createX(deps): X`
- Keep pure state + accessors pattern (no Express dependency in state modules)
- Use factory pattern for anything with internal caches (e.g., `createProcessMetrics()`)

## Rules
- Never add inline route handlers or business logic to server.ts
- New endpoints go in the appropriate routes/ file or a new one
- Always define a typed deps interface; never reach for globals
- Guard `decodeURIComponent()` calls with try/catch
- Add `.catch()` to fire-and-forget promise calls (e.g., `broadcastData().catch(...)`)
