# Trajectory: Fix: Auto-register dashboard agent to obtain agentToken for frontend SDK

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** March 4, 2026 at 09:39 AM
> **Completed:** March 4, 2026 at 09:40 AM

---

## Summary

When bootstrapRelayApiKeyFromBroker provides only an apiKey (no agentToken), GET /api/relay-config returned 503, leaving the frontend SDK disabled and forcing all writes through REST fallback (causing 404s on thread replies). Fix: relay-config.ts now calls getDashboardAgentToken() — a new shared helper in relaycast-provider-helpers.ts that uses the same RelayCast.registerOrRotate() pattern as getWriterClient, with promise-based caching. Files changed: relay-config.ts (auto-register on missing token), relaycast-provider-helpers.ts (new exported getDashboardAgentToken + agentTokenCache). All 207 tests pass.

**Approach:** Standard approach

---

## Key Decisions

### Added getDashboardAgentToken() to relaycast-provider-helpers.ts instead of duplicating registration in relay-config.ts
- **Chose:** Added getDashboardAgentToken() to relaycast-provider-helpers.ts instead of duplicating registration in relay-config.ts
- **Reasoning:** The dashboard already registers agents via getWriterClient -> createRelaycastClient -> registerOrRotate. Rather than duplicating that pattern in relay-config.ts with a direct @relaycast/sdk import, we added a shared getDashboardAgentToken() that uses the same RelayCast + registerOrRotate flow with promise-based caching (matching getCachedClient pattern). This keeps all SDK registration logic centralized in the helpers module.

### Reader client intentionally bypasses SDK for read-only operations
- **Chose:** Reader client intentionally bypasses SDK for read-only operations
- **Reasoning:** Audit confirmed getReaderClient() uses direct fetch() to /v1/* endpoints by design — avoids agent registration overhead (POST /v1/agents) for read-only data fetching. Only write operations (send, reply, DM) need the SDK with agent tokens.

---

## Chapters

### 1. Work
*Agent: default*

- Added getDashboardAgentToken() to relaycast-provider-helpers.ts instead of duplicating registration in relay-config.ts: Added getDashboardAgentToken() to relaycast-provider-helpers.ts instead of duplicating registration in relay-config.ts
- Reader client intentionally bypasses SDK for read-only operations: Reader client intentionally bypasses SDK for read-only operations
