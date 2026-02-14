# Trajectory: Fix /metrics agent memory sampling correctness and performance regressions

> **Status:** ✅ Completed
> **Task:** PR-50
> **Confidence:** 86%
> **Started:** February 14, 2026 at 02:32 PM
> **Completed:** February 14, 2026 at 02:32 PM

---

## Summary

Updated /metrics handlers in relay-dashboard to make memory/CPU sampling accurate and performant: added ps-tree snapshot caching, and removed stale cloud CPU sample state when monitored pids die.

**Approach:** Read Devin findings, inspected metrics code path, implemented minimal changes in server.ts, then pushed follow-up commits to fix regressions.

---

## Key Decisions

### Use cached ps tree snapshot for cloud getPsTreeUsage
- **Chose:** Use cached ps tree snapshot for cloud getPsTreeUsage
- **Rejected:** Recompute per worker (regression risk), parse ps once in each handler
- **Reasoning:** Avoid blocking the event loop by preventing execSync('ps -axo ...') from running once per worker; cache global process snapshot for short TTL and reuse across workers.

### Clear stale CPU sample map entry when root pid disappears
- **Chose:** Clear stale CPU sample map entry when root pid disappears
- **Rejected:** Leave stale sample until next valid read, periodic map cleanup
- **Reasoning:** Prevent PID-reuse CPU artifacts by deleting procTreeCpuSamples on dead process so a reused pid doesn\''t inherit stale jiffies baseline.

---

## Chapters

### 1. Work
*Agent: default*

- Use cached ps tree snapshot for cloud getPsTreeUsage: Use cached ps tree snapshot for cloud getPsTreeUsage
- Clear stale CPU sample map entry when root pid disappears: Clear stale CPU sample map entry when root pid disappears
