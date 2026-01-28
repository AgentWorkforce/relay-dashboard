# Trajectory: Update getMessages to use SQLite storage first for local mode

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** January 28, 2026 at 12:58 PM
> **Completed:** January 28, 2026 at 12:58 PM

---

## Summary

Changed getMessages() in server.ts to check SQLite storage first before querying daemon. This improves local mode performance and avoids timeouts when daemon is busy. Cloud mode unaffected as it uses different endpoints.

**Approach:** Standard approach

---

## Key Decisions

### Use SQLite storage first, daemon as fallback
- **Chose:** Use SQLite storage first, daemon as fallback
- **Reasoning:** SQLite is faster and avoids daemon query timeouts when daemon is busy processing. Storage is only available in local/integrated mode, so this doesn't affect cloud which uses different endpoints.

---

## Chapters

### 1. Work
*Agent: default*

- Use SQLite storage first, daemon as fallback: Use SQLite storage first, daemon as fallback
