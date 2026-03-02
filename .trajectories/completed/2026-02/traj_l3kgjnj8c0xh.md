# Trajectory: Unblock Phase 4 threads via public relay client hook

> **Status:** ✅ Completed
> **Task:** mlztgfn7
> **Confidence:** 83%
> **Started:** February 24, 2026 at 09:43 AM
> **Completed:** February 24, 2026 at 09:49 AM

---

## Summary

Added public useRelayClient hook in @relaycast/react and migrated dashboard thread hook/channel thread replies to SDK-first with safe fallback.

**Approach:** Standard approach

---

## Key Decisions

### Use SDK thread/reply APIs first with REST fallback
- **Chose:** Use SDK thread/reply APIs first with REST fallback
- **Reasoning:** Phase 4 requires Relay SDK threading without regressing topic-thread or non-relay flows; fallback keeps compatibility when SDK cannot resolve thread IDs

---

## Chapters

### 1. Work
*Agent: default*

- Use SDK thread/reply APIs first with REST fallback: Use SDK thread/reply APIs first with REST fallback

---

## Artifacts

**Commits:** 17c9d1f
**Files changed:** 2
