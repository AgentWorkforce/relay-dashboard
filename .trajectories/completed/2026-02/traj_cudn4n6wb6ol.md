# Trajectory: Fix /api/send false 409 when spawned agent is actually online in Relaycast

> **Status:** ✅ Completed
> **Confidence:** 78%
> **Started:** February 23, 2026 at 12:33 PM
> **Completed:** February 24, 2026 at 01:07 AM

---

## Summary

Implemented unified identity + SDK foundation, completed reaction migration and presence dedup path, validated all dashboard/server tests.

**Approach:** Standard approach

---

## Key Decisions

### Expose relay credentials through /api/relay-config for @relaycast/react integration
- **Chose:** Expose relay credentials through /api/relay-config for @relaycast/react integration
- **Reasoning:** The current React SDK requires client-side apiKey + agentToken; returning credentials from local relaycast.json unblocks migration and can later be replaced by scoped credentials

### Prioritized SDK reactions + presence via public APIs
- **Chose:** Prioritized SDK reactions + presence via public APIs
- **Reasoning:** Replaced custom reaction overlays and presence WS duplication while avoiding brittle internal SDK imports

---

## Chapters

### 1. Work
*Agent: default*

- Expose relay credentials through /api/relay-config for @relaycast/react integration: Expose relay credentials through /api/relay-config for @relaycast/react integration
- Prioritized SDK reactions + presence via public APIs: Prioritized SDK reactions + presence via public APIs

---

## Artifacts

**Commits:** 4ef474e, de7b349, b2382de, dc2049e, 9dffdb7, bdca3b2, 72aadb3, a9c36f9, 34a5630, 3133759, 88a4d0c
**Files changed:** 49
