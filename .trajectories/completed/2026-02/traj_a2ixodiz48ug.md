# Trajectory: Unify DM and channel composer/avatar behavior

> **Status:** ✅ Completed
> **Confidence:** 86%
> **Started:** February 24, 2026 at 10:03 AM
> **Completed:** February 24, 2026 at 10:06 AM

---

## Summary

Unified channel UI behavior with DM: ChannelView now uses MessageComposer (attachments + mentions), channel sends now accept attachmentIds, and channel avatars now use current-user/online-user/agent/human fallbacks.

**Approach:** Standard approach

---

## Key Decisions

### Switched channels to shared MessageComposer and avatar fallback chain
- **Chose:** Switched channels to shared MessageComposer and avatar fallback chain
- **Reasoning:** Channel used legacy MessageInput and relied on fromAvatarUrl only; DM uses MessageComposer and richer identity sources. Unifying to shared composer + fallback sources aligns behavior with minimal risk.

---

## Chapters

### 1. Work
*Agent: default*

- Switched channels to shared MessageComposer and avatar fallback chain: Switched channels to shared MessageComposer and avatar fallback chain

---

## Artifacts

**Commits:** fe5b7d2
**Files changed:** 6
