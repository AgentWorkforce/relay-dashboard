# Trajectory: Remove legacy relay client and begin server.ts decomposition

> **Status:** ❌ Abandoned
> **Started:** February 24, 2026 at 01:12 AM
> **Completed:** March 4, 2026 at 09:39 AM

---

## Key Decisions

### Removed legacy socket relay-client path and required RelayAdapter
- **Chose:** Removed legacy socket relay-client path and required RelayAdapter
- **Reasoning:** Spec requires broker-only operation and eliminating daemon-mode branches to simplify server behavior.

### Kept UserBridge interface but backed it with broker shim clients
- **Chose:** Kept UserBridge interface but backed it with broker shim clients
- **Reasoning:** Preserves presence/channel API contracts while removing RelayClient/socket dependencies and duplicate-connection logic.

### Introduced ServerState module to centralize mutable runtime data
- **Chose:** Introduced ServerState module to centralize mutable runtime data
- **Reasoning:** Phase 1 requires decoupling shared state from startDashboard closures so subsequent websocket/routes extraction can use a stable state object.

### Wave 1 (Phase 0) approved: Legacy relay-client.ts deleted, all daemon code paths removed, useBrokerAdapter/useExternalSpawnManager collapsed. ~1800 lines removed. Minor: stale spawnManager type and MultiProjectClient comment noted.
- **Chose:** Wave 1 (Phase 0) approved: Legacy relay-client.ts deleted, all daemon code paths removed, useBrokerAdapter/useExternalSpawnManager collapsed. ~1800 lines removed. Minor: stale spawnManager type and MultiProjectClient comment noted.
- **Reasoning:** Clean removal with no orphaned imports. BrokerRelayClientShim properly typed. Fail-fast on missing RelayAdapter. 2 cosmetic findings deferred to Wave 2.

### Wave 2 (Phase 1) approved: ServerState extracted to server-state.ts (279 lines). Pure state+accessors, zero Express dependency. BrokerRelayClientShim type consolidated. Wave 1 cosmetic findings addressed.
- **Chose:** Wave 2 (Phase 1) approved: ServerState extracted to server-state.ts (279 lines). Pure state+accessors, zero Express dependency. BrokerRelayClientShim type consolidated. Wave 1 cosmetic findings addressed.
- **Reasoning:** Clean foundation for remaining extractions. Generic type params allow server.ts to cast to concrete types. Aliasing pattern shares references correctly.

### Extracted broadcaster logic from server.ts into createBroadcasters and wired state-backed broadcasters
- **Chose:** Extracted broadcaster logic from server.ts into createBroadcasters and wired state-backed broadcasters
- **Reasoning:** Centralizing dedup/replay-aware broadcast behavior reduces server.ts surface area and prepares for websocket/route module extraction without changing call-site contracts

### Wave 3 (Phase 2) approved: broadcast.ts extracted (180 lines). All 4 broadcaster functions moved with dedup/hash/buffer logic. No inline broadcast implementations remain in server.ts.
- **Chose:** Wave 3 (Phase 2) approved: broadcast.ts extracted (180 lines). All 4 broadcaster functions moved with dedup/hash/buffer logic. No inline broadcast implementations remain in server.ts.
- **Reasoning:** Clean extraction with proper dependency injection via createBroadcasters(state, deps). Dedup state (lastBroadcastPayload, recentLogHashes) encapsulated in broadcast module. PTY global bridge preserved.

### Extracted dashboard data assembly into lib/data-assembly.ts and replaced inline helpers in server.ts
- **Chose:** Extracted dashboard data assembly into lib/data-assembly.ts and replaced inline helpers in server.ts
- **Reasoning:** Moving getAllData/getBridgeData and shared mapping utilities behind a factory isolates stateful data composition logic, keeps server routes/websockets behavior unchanged, and reduces orchestrator complexity for later route/websocket extraction

### Wave 4 (Phase 3) approved: data-assembly.ts extracted (749 lines). getAllData, getBridgeData, and all helper utilities moved. Storage dual-mode and cloud needs-attention preserved.
- **Chose:** Wave 4 (Phase 3) approved: data-assembly.ts extracted (749 lines). getAllData, getBridgeData, and all helper utilities moved. Storage dual-mode and cloud needs-attention preserved.
- **Reasoning:** Largest extraction so far. Clean factory pattern with DataAssemblyDeps interface. Helper utilities (isInternalAgent, remapAgentName, buildThreadSummaryMap, formatDuration) exported standalone and used at 12 call sites in server.ts. No inline data assembly remains.

### Extracted main and bridge WebSocket handlers into websocket modules
- **Chose:** Extracted main and bridge WebSocket handlers into websocket modules
- **Reasoning:** Moving connection/replay/initial-sync logic into setupMainWebSocket/setupBridgeWebSocket reduces server.ts orchestration burden while preserving ping integration and existing broadcast call sites

### Extracted integrated logs WebSocket handler into websocket/logs.ts while preserving standalone proxy log handler export
- **Chose:** Extracted integrated logs WebSocket handler into websocket/logs.ts while preserving standalone proxy log handler export
- **Reasoning:** The logs connection logic (subscriptions, file watching, replay, input passthrough, keepalive) is isolated behind setupLogsWebSocket; preserving handleStandaloneLogWebSocket in the same module avoids proxy-mode regression

### Wave 5/6 (Phase 4 partial) approved: logs WebSocket extracted to websocket/logs.ts (543 lines). setupLogsWebSocket(deps) factory with keepalive, subscribe/unsubscribe, replay, file watching, and input passthrough.
- **Chose:** Wave 5/6 (Phase 4 partial) approved: logs WebSocket extracted to websocket/logs.ts (543 lines). setupLogsWebSocket(deps) factory with keepalive, subscribe/unsubscribe, replay, file watching, and input passthrough.
- **Reasoning:** Existing handleStandaloneLogWebSocket preserved unchanged. New setupLogsWebSocket cleanly extracted from server.ts inline block. All log state (subscriptions, file watchers, file sizes, buffers) passed via LogsWebSocketDeps interface. No inline logs WS code remains in server.ts.

### Extracted presence websocket lifecycle and channel/DM broadcasters into websocket/presence.ts
- **Chose:** Extracted presence websocket lifecycle and channel/DM broadcasters into websocket/presence.ts
- **Reasoning:** Centralizing presence connection management, heartbeat, typing/join/leave handling, and channel/direct broadcast helpers removes another large closure from server.ts while preserving relay inbound message routing via returned broadcaster functions

### Wave 7 (Phase 4 complete) approved: All 4 WebSocket handlers extracted. presence.ts (429 lines) handles heartbeat, join/leave, typing, channel/DM message events. Returns broadcastChannelMessage and broadcastDirectMessage to caller.
- **Chose:** Wave 7 (Phase 4 complete) approved: All 4 WebSocket handlers extracted. presence.ts (429 lines) handles heartbeat, join/leave, typing, channel/DM message events. Returns broadcastChannelMessage and broadcastDirectMessage to caller.
- **Reasoning:** Clean extraction with security checks preserved (auth validation, username mismatch guards). Multi-tab support intact. UserBridgeLike interface avoids tight coupling. broadcastChannelMessage/broadcastDirectMessage returned to server.ts for relay_inbound event routing. Server.ts now 5046 lines.

### Extracted integrated messaging endpoints into routes/messaging.ts and registered via registerMessagingRoutes
- **Chose:** Extracted integrated messaging endpoints into routes/messaging.ts and registered via registerMessagingRoutes
- **Reasoning:** Moving send/bridge-send/upload/attachment routes behind explicit deps separates route logic from server orchestration and establishes the register*Routes(app, deps) pattern for remaining Phase 5 extractions

### Wave 8 (Phase 5 partial) approved: messaging.ts extracted (275 lines). /api/send, /api/bridge/send, /api/upload, /api/attachment/:id moved with MessagingRouteDeps interface.
- **Chose:** Wave 8 (Phase 5 partial) approved: messaging.ts extracted (275 lines). /api/send, /api/bridge/send, /api/upload, /api/attachment/:id moved with MessagingRouteDeps interface.
- **Reasoning:** Clean registerMessagingRoutes(app, deps) pattern. RelayClientLike interface for loose coupling. Attachment MIME validation and base64 handling preserved. Bridge send returns 501 as expected.

### Extracted history/session/stat endpoints into routes/history.ts and registered via registerHistoryRoutes
- **Chose:** Extracted history/session/stat endpoints into routes/history.ts and registered via registerHistoryRoutes
- **Reasoning:** History APIs are storage-focused and share common remapping/filter helpers; moving them into a dedicated route module reduces server.ts size and follows the same dependency-injected route registration pattern

### Wave 9 (Phase 5: history routes) approved: 5 endpoints extracted to routes/history.ts (263 lines). Clean HistoryRouteDeps with storage, formatDuration, isInternalAgent, remapAgentName.
- **Chose:** Wave 9 (Phase 5: history routes) approved: 5 endpoints extracted to routes/history.ts (263 lines). Clean HistoryRouteDeps with storage, formatDuration, isInternalAgent, remapAgentName.
- **Reasoning:** All /api/history/* handlers moved. Storage guard (503 when unconfigured) preserved. Search filtering, conversation pairing, and stats aggregation intact.

### Extracted CLI auth + credentials endpoints into routes/auth.ts with dependency-injected auth handlers
- **Chose:** Extracted CLI auth + credentials endpoints into routes/auth.ts with dependency-injected auth handlers
- **Reasoning:** Keeps server.ts focused on orchestration and preserves existing token-validation/auth polling behavior while isolating auth concerns

### Wave 10 (Phase 5: auth routes) approved: 10 endpoints extracted to routes/auth.ts (341 lines). Timing-safe token validation middleware preserved. OAuth flow, code submission, credential CRUD all moved.
- **Chose:** Wave 10 (Phase 5: auth routes) approved: 10 endpoints extracted to routes/auth.ts (341 lines). Timing-safe token validation middleware preserved. OAuth flow, code submission, credential CRUD all moved.
- **Reasoning:** Security-sensitive code properly extracted. timingSafeEqual for workspace token validation preserved. Dynamic import of @agent-relay/user-directory for credential management intact. AuthRouteDeps cleanly decouples from cli-auth internals.

### Wave 11 (Phase 5: settings routes) approved: 3 endpoints in routes/settings.ts (128 lines). Zero deps — all config via dynamic imports.
- **Chose:** Wave 11 (Phase 5: settings routes) approved: 3 endpoints in routes/settings.ts (128 lines). Zero deps — all config via dynamic imports.
- **Reasoning:** Self-contained module. No external state needed. Dynamic imports of @agent-relay/config preserve lazy loading pattern.

### Wave 12 (Phase 5: decisions routes) approved: 5 CRUD endpoints in routes/decisions.ts (156 lines). Urgency ordering, relay notification on approve/reject preserved.
- **Chose:** Wave 12 (Phase 5: decisions routes) approved: 5 CRUD endpoints in routes/decisions.ts (156 lines). Urgency ordering, relay notification on approve/reject preserved.
- **Reasoning:** Clean DecisionsRouteDeps. Decision type exported for server.ts casting. Approve/reject notify agent via relay client.

### Wave 13 (Phase 5: tasks routes) approved: 4 CRUD endpoints in routes/tasks.ts (150 lines). Priority sorting, relay notification on assign/cancel preserved.
- **Chose:** Wave 13 (Phase 5: tasks routes) approved: 4 CRUD endpoints in routes/tasks.ts (150 lines). Priority sorting, relay notification on assign/cancel preserved.
- **Reasoning:** Mirrors decisions pattern. TaskAssignment type exported. Filter by status/agent on GET.

### Wave 14 (Phase 5: fleet routes) approved: 2 endpoints + loadAgentStatuses helper in routes/fleet.ts (174 lines). Bridge-state enrichment, local-daemon fallback, aggregate stats preserved.
- **Chose:** Wave 14 (Phase 5: fleet routes) approved: 2 endpoints + loadAgentStatuses helper in routes/fleet.ts (174 lines). Bridge-state enrichment, local-daemon fallback, aggregate stats preserved.
- **Reasoning:** Imports Decision and TaskAssignment types from sibling route modules — good cross-module typing. loadAgentStatuses moved out of server.ts.

### Extracted spawn/logs/repos/trajectory endpoints into routes/spawn.ts and wired via registerSpawnRoutes
- **Chose:** Extracted spawn/logs/repos/trajectory endpoints into routes/spawn.ts and wired via registerSpawnRoutes
- **Reasoning:** Consolidates operational endpoints into a dedicated module and removes a large inline server.ts block while preserving broker passthrough and relay event broadcasts

### Chose dashboard postbuild out-sync over proxy static path change
- **Chose:** Chose dashboard postbuild out-sync over proxy static path change
- **Reasoning:** Keeps server runtime/static path unchanged while ensuring dashboard-server/out stays current after dashboard builds

---

## Chapters

### 1. Work
*Agent: default*

- Removed legacy socket relay-client path and required RelayAdapter: Removed legacy socket relay-client path and required RelayAdapter
- Kept UserBridge interface but backed it with broker shim clients: Kept UserBridge interface but backed it with broker shim clients
- Introduced ServerState module to centralize mutable runtime data: Introduced ServerState module to centralize mutable runtime data
- Wave 1 (Phase 0) approved: Legacy relay-client.ts deleted, all daemon code paths removed, useBrokerAdapter/useExternalSpawnManager collapsed. ~1800 lines removed. Minor: stale spawnManager type and MultiProjectClient comment noted.: Wave 1 (Phase 0) approved: Legacy relay-client.ts deleted, all daemon code paths removed, useBrokerAdapter/useExternalSpawnManager collapsed. ~1800 lines removed. Minor: stale spawnManager type and MultiProjectClient comment noted.
- Wave 2 (Phase 1) approved: ServerState extracted to server-state.ts (279 lines). Pure state+accessors, zero Express dependency. BrokerRelayClientShim type consolidated. Wave 1 cosmetic findings addressed.: Wave 2 (Phase 1) approved: ServerState extracted to server-state.ts (279 lines). Pure state+accessors, zero Express dependency. BrokerRelayClientShim type consolidated. Wave 1 cosmetic findings addressed.
- Extracted broadcaster logic from server.ts into createBroadcasters and wired state-backed broadcasters: Extracted broadcaster logic from server.ts into createBroadcasters and wired state-backed broadcasters
- Wave 3 (Phase 2) approved: broadcast.ts extracted (180 lines). All 4 broadcaster functions moved with dedup/hash/buffer logic. No inline broadcast implementations remain in server.ts.: Wave 3 (Phase 2) approved: broadcast.ts extracted (180 lines). All 4 broadcaster functions moved with dedup/hash/buffer logic. No inline broadcast implementations remain in server.ts.
- Extracted dashboard data assembly into lib/data-assembly.ts and replaced inline helpers in server.ts: Extracted dashboard data assembly into lib/data-assembly.ts and replaced inline helpers in server.ts
- Wave 4 (Phase 3) approved: data-assembly.ts extracted (749 lines). getAllData, getBridgeData, and all helper utilities moved. Storage dual-mode and cloud needs-attention preserved.: Wave 4 (Phase 3) approved: data-assembly.ts extracted (749 lines). getAllData, getBridgeData, and all helper utilities moved. Storage dual-mode and cloud needs-attention preserved.
- Extracted main and bridge WebSocket handlers into websocket modules: Extracted main and bridge WebSocket handlers into websocket modules
- Extracted integrated logs WebSocket handler into websocket/logs.ts while preserving standalone proxy log handler export: Extracted integrated logs WebSocket handler into websocket/logs.ts while preserving standalone proxy log handler export
- Wave 5/6 (Phase 4 partial) approved: logs WebSocket extracted to websocket/logs.ts (543 lines). setupLogsWebSocket(deps) factory with keepalive, subscribe/unsubscribe, replay, file watching, and input passthrough.: Wave 5/6 (Phase 4 partial) approved: logs WebSocket extracted to websocket/logs.ts (543 lines). setupLogsWebSocket(deps) factory with keepalive, subscribe/unsubscribe, replay, file watching, and input passthrough.
- Extracted presence websocket lifecycle and channel/DM broadcasters into websocket/presence.ts: Extracted presence websocket lifecycle and channel/DM broadcasters into websocket/presence.ts
- Wave 7 (Phase 4 complete) approved: All 4 WebSocket handlers extracted. presence.ts (429 lines) handles heartbeat, join/leave, typing, channel/DM message events. Returns broadcastChannelMessage and broadcastDirectMessage to caller.: Wave 7 (Phase 4 complete) approved: All 4 WebSocket handlers extracted. presence.ts (429 lines) handles heartbeat, join/leave, typing, channel/DM message events. Returns broadcastChannelMessage and broadcastDirectMessage to caller.
- Extracted integrated messaging endpoints into routes/messaging.ts and registered via registerMessagingRoutes: Extracted integrated messaging endpoints into routes/messaging.ts and registered via registerMessagingRoutes
- Wave 8 (Phase 5 partial) approved: messaging.ts extracted (275 lines). /api/send, /api/bridge/send, /api/upload, /api/attachment/:id moved with MessagingRouteDeps interface.: Wave 8 (Phase 5 partial) approved: messaging.ts extracted (275 lines). /api/send, /api/bridge/send, /api/upload, /api/attachment/:id moved with MessagingRouteDeps interface.
- Extracted history/session/stat endpoints into routes/history.ts and registered via registerHistoryRoutes: Extracted history/session/stat endpoints into routes/history.ts and registered via registerHistoryRoutes
- Wave 9 (Phase 5: history routes) approved: 5 endpoints extracted to routes/history.ts (263 lines). Clean HistoryRouteDeps with storage, formatDuration, isInternalAgent, remapAgentName.: Wave 9 (Phase 5: history routes) approved: 5 endpoints extracted to routes/history.ts (263 lines). Clean HistoryRouteDeps with storage, formatDuration, isInternalAgent, remapAgentName.
- Extracted CLI auth + credentials endpoints into routes/auth.ts with dependency-injected auth handlers: Extracted CLI auth + credentials endpoints into routes/auth.ts with dependency-injected auth handlers
- Wave 10 (Phase 5: auth routes) approved: 10 endpoints extracted to routes/auth.ts (341 lines). Timing-safe token validation middleware preserved. OAuth flow, code submission, credential CRUD all moved.: Wave 10 (Phase 5: auth routes) approved: 10 endpoints extracted to routes/auth.ts (341 lines). Timing-safe token validation middleware preserved. OAuth flow, code submission, credential CRUD all moved.
- Wave 11 (Phase 5: settings routes) approved: 3 endpoints in routes/settings.ts (128 lines). Zero deps — all config via dynamic imports.: Wave 11 (Phase 5: settings routes) approved: 3 endpoints in routes/settings.ts (128 lines). Zero deps — all config via dynamic imports.
- Wave 12 (Phase 5: decisions routes) approved: 5 CRUD endpoints in routes/decisions.ts (156 lines). Urgency ordering, relay notification on approve/reject preserved.: Wave 12 (Phase 5: decisions routes) approved: 5 CRUD endpoints in routes/decisions.ts (156 lines). Urgency ordering, relay notification on approve/reject preserved.
- Wave 13 (Phase 5: tasks routes) approved: 4 CRUD endpoints in routes/tasks.ts (150 lines). Priority sorting, relay notification on assign/cancel preserved.: Wave 13 (Phase 5: tasks routes) approved: 4 CRUD endpoints in routes/tasks.ts (150 lines). Priority sorting, relay notification on assign/cancel preserved.
- Wave 14 (Phase 5: fleet routes) approved: 2 endpoints + loadAgentStatuses helper in routes/fleet.ts (174 lines). Bridge-state enrichment, local-daemon fallback, aggregate stats preserved.: Wave 14 (Phase 5: fleet routes) approved: 2 endpoints + loadAgentStatuses helper in routes/fleet.ts (174 lines). Bridge-state enrichment, local-daemon fallback, aggregate stats preserved.
- Extracted spawn/logs/repos/trajectory endpoints into routes/spawn.ts and wired via registerSpawnRoutes: Extracted spawn/logs/repos/trajectory endpoints into routes/spawn.ts and wired via registerSpawnRoutes
- Wave 15 (spawn routes): APPROVED - 637 lines extracted to routes/spawn.ts. 16 endpoints covering logs, online status, cwd registration, spawn, release, interrupt, repos clone/remove, architect spawn, broker spawned-agents proxy, and trajectory APIs. Clean dependency injection via SpawnRouteDeps. Path traversal guard on repos/clone and repos/remove. 409 duplicate check on architect spawn.: Wave 15 (spawn routes): APPROVED - 637 lines extracted to routes/spawn.ts. 16 endpoints covering logs, online status, cwd registration, spawn, release, interrupt, repos clone/remove, architect spawn, broker spawned-agents proxy, and trajectory APIs. Clean dependency injection via SpawnRouteDeps. Path traversal guard on repos/clone and repos/remove. 409 duplicate check on architect spawn.
- Wave 16 (metrics + process-metrics): APPROVED - 267 lines in routes/metrics.ts (5 endpoints: needs-attention proxy, metrics, prometheus, agents, health) and 291 lines in lib/process-metrics.ts (process-tree CPU/RSS sampling with /proc + ps fallback, cached snapshots). Clean factory pattern createProcessMetrics(). Server.ts down to 2542 lines from 7153 original.: Wave 16 (metrics + process-metrics): APPROVED - 267 lines in routes/metrics.ts (5 endpoints: needs-attention proxy, metrics, prometheus, agents, health) and 291 lines in lib/process-metrics.ts (process-tree CPU/RSS sampling with /proc + ps fallback, cached snapshots). Clean factory pattern createProcessMetrics(). Server.ts down to 2542 lines from 7153 original.
- Waves 17-18 (Phase 6-7: Final extraction + orchestrator slim-down): APPROVED - 5 new modules extracted: cloud-persistence.ts (150 lines, session tracking via API), channel-state.ts (194 lines, channel record persistence), attachment-storage.ts (64 lines, uploads/eviction), websocket-runtime.ts (110 lines, upgrade routing + ping/pong), system.ts (220 lines, health/files/bridge/beads/relay-send), ui.ts (117 lines, static serving + fallback). Server.ts reduced to 593 lines — pure orchestrator wiring imports, creates state, and registers all modules. No inline business logic remains.: Waves 17-18 (Phase 6-7: Final extraction + orchestrator slim-down): APPROVED - 5 new modules extracted: cloud-persistence.ts (150 lines, session tracking via API), channel-state.ts (194 lines, channel record persistence), attachment-storage.ts (64 lines, uploads/eviction), websocket-runtime.ts (110 lines, upgrade routing + ping/pong), system.ts (220 lines, health/files/bridge/beads/relay-send), ui.ts (117 lines, static serving + fallback). Server.ts reduced to 593 lines — pure orchestrator wiring imports, creates state, and registers all modules. No inline business logic remains.
- CodexReviewer final audit: 3 CRITICAL (command injection in bead endpoint, unauthed credential mutations, presence identity spoofing), 7 WARNING (path traversal, missing catch handlers, dropped thread semantics, unguarded decodeURIComponent, type-safety regressions, orphaned initCloudPersistence import, global state leaks), 2 INFO (dead Dashboard filter, unused spawn void fields). Prioritized CRITICALs #1 and #2 for immediate patching by Implementer.: CodexReviewer final audit: 3 CRITICAL (command injection in bead endpoint, unauthed credential mutations, presence identity spoofing), 7 WARNING (path traversal, missing catch handlers, dropped thread semantics, unguarded decodeURIComponent, type-safety regressions, orphaned initCloudPersistence import, global state leaks), 2 INFO (dead Dashboard filter, unused spawn void fields). Prioritized CRITICALs #1 and #2 for immediate patching by Implementer.
- Verified all CRITICAL and WARNING patches from CodexReviewer audit. CRITICAL #1 (command injection) fixed via execFile with array args. CRITICAL #2 (unauthed credentials) fixed via workspace-token middleware on /api/credentials. CRITICAL #3 (presence spoofing) confirmed pre-existing. 5 WARNING fixes also verified (path traversal, catch handlers, thread semantics, decodeURIComponent guard, orphaned import removed). All checks passing.: Verified all CRITICAL and WARNING patches from CodexReviewer audit. CRITICAL #1 (command injection) fixed via execFile with array args. CRITICAL #2 (unauthed credentials) fixed via workspace-token middleware on /api/credentials. CRITICAL #3 (presence spoofing) confirmed pre-existing. 5 WARNING fixes also verified (path traversal, catch handlers, thread semantics, decodeURIComponent guard, orphaned import removed). All checks passing.
- Chose dashboard postbuild out-sync over proxy static path change: Chose dashboard postbuild out-sync over proxy static path change
- Abandoned: Stale trajectory from previous session
