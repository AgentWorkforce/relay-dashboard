# Trajectory: Switch dashboard-server log WS to SDK followLogs

> **Status:** ✅ Completed
> **Confidence:** 93%
> **Started:** February 23, 2026 at 11:26 AM
> **Completed:** February 23, 2026 at 11:28 AM

---

## Summary

Switched dashboard-server standalone log websocket path to SDK followLogs with resubscribe support and cleanup on close/error; removed local delta-tail helper; typecheck/tests/build all pass.

**Approach:** Standard approach

---

## Key Decisions

### Replaced standalone /ws/logs tailing with SDK followLogs
- **Chose:** Replaced standalone /ws/logs tailing with SDK followLogs
- **Reasoning:** Centralizes log follow semantics in SDK so dashboard and other consumers share one implementation (history bootstrap, incremental polling, unsubscribe, missing-log handling).

---

## Chapters

### 1. Work
*Agent: default*

- Replaced standalone /ws/logs tailing with SDK followLogs: Replaced standalone /ws/logs tailing with SDK followLogs
