---
paths:
  - "packages/dashboard-server/src/websocket/**/*.ts"
---

# WebSocket Identity Binding

WebSocket client identity must not be trusted from message payloads alone. Format-only validation (e.g., username regex) is insufficient for authentication.

When implementing WS handlers that accept identity claims:
- Document clearly if identity is self-asserted (current state for presence WS)
- Never use unverified identity for privileged operations (credential access, admin actions)
- Future work: bind username to an authenticated session or token during WS handshake upgrade
- Consider validating identity against the HTTP upgrade request headers or query params

This is a known design gap in the presence WebSocket flow. Any new WS handler should not repeat this pattern.
