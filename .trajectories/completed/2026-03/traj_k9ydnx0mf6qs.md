# Trajectory: Replace stale-token heuristics with deterministic Relaycast auth recovery

> **Status:** ✅ Completed
> **Confidence:** 95%
> **Started:** March 13, 2026 at 10:27 AM
> **Completed:** March 13, 2026 at 10:34 AM

---

## Summary

Removed relaycast.json from the dashboard server flow. Runtime config now comes only from in-memory/env/broker bootstrap, helper clients no longer point the SDK at a relaycast.json cache path, file-based error text was removed, and server tests were updated to validate the no-file credential flow. Verified dashboard-server typecheck and full test suite.

**Approach:** Standard approach

---

## Key Decisions

### Remove all dashboard-server reliance on file-backed Relaycast credentials and keep config strictly in memory/env/broker bootstrap.
- **Chose:** Remove all dashboard-server reliance on file-backed Relaycast credentials and keep config strictly in memory/env/broker bootstrap.
- **Reasoning:** The product contract is that relaycast.json should not exist; reading it or passing it as an SDK cache path reintroduces hidden state and stale-token behavior

---

## Chapters

### 1. Work
*Agent: default*

- Remove all dashboard-server reliance on file-backed Relaycast credentials and keep config strictly in memory/env/broker bootstrap.: Remove all dashboard-server reliance on file-backed Relaycast credentials and keep config strictly in memory/env/broker bootstrap.
