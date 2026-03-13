# Trajectory: Add integration tests for Relaycast token rotation recovery

> **Status:** ✅ Completed
> **Confidence:** 92%
> **Started:** March 13, 2026 at 10:37 AM
> **Completed:** March 13, 2026 at 10:48 AM

---

## Summary

Added dashboard integration coverage for Relaycast token invalidation and refresh.

**Approach:** Standard approach

---

## Key Decisions

### Added a real dashboard-provider integration test with a fake Relaycast backend
- **Chose:** Added a real dashboard-provider integration test with a fake Relaycast backend
- **Reasoning:** This covers the real dashboard server, RelayConfigProvider, SDK HTTP retry path, and wsToken wiring without depending on external Relaycast infrastructure.

---

## Chapters

### 1. Work
*Agent: default*

- Added a real dashboard-provider integration test with a fake Relaycast backend: Added a real dashboard-provider integration test with a fake Relaycast backend
