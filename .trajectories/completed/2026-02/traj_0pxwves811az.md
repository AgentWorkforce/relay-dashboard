# Trajectory: Use local SDK for relay-dashboard and validate tests

> **Status:** ✅ Completed
> **Confidence:** 86%
> **Started:** February 23, 2026 at 12:14 PM
> **Completed:** February 23, 2026 at 12:22 PM

---

## Summary

Linked dashboard-server to local SDK, rebuilt SDK dist, migrated relaycast-provider/log websocket to current SDK surface, and restored passing typecheck/tests.

**Approach:** Standard approach

---

## Key Decisions

### Pinned dashboard-server SDK to local relay/packages/sdk and rebuilt local SDK dist before validation
- **Chose:** Pinned dashboard-server SDK to local relay/packages/sdk and rebuilt local SDK dist before validation
- **Reasoning:** Linked package was pointing at stale dist exports, causing false missing-export failures until rebuilt.

---

## Chapters

### 1. Work
*Agent: default*

- Pinned dashboard-server SDK to local relay/packages/sdk and rebuilt local SDK dist before validation: Pinned dashboard-server SDK to local relay/packages/sdk and rebuilt local SDK dist before validation
