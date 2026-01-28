# Trajectory: Refactor channel system: remove legacy general broadcast, make Activity feed show events only, #general is real channel

> **Status:** ✅ Completed
> **Confidence:** 85%
> **Started:** January 28, 2026 at 12:49 PM
> **Completed:** January 28, 2026 at 12:50 PM

---

## Summary

Refactored channel system: (1) Activity Feed now shows activity events (agent spawns, releases, status changes) instead of broadcast messages; (2) Removed legacy currentChannel='general'→broadcast behavior; (3) #general is now a proper channel; (4) Broadcasts to '*' are delivered to individual DMs, not shown in any channel view

**Approach:** Standard approach

---

## Key Decisions

### Unified channel system: Activity Feed shows activity events only, #general is a real channel, broadcasts (*) go to individual DMs
- **Chose:** Unified channel system: Activity Feed shows activity events only, #general is a real channel, broadcasts (*) go to individual DMs
- **Reasoning:** Removes confusion between legacy 'general' broadcast behavior and actual #general channel. Activity Feed now shows agent spawns/releases/status changes. Broadcasts are delivered to individual DMs, not shown in any channel.

---

## Chapters

### 1. Work
*Agent: default*

- Unified channel system: Activity Feed shows activity events only, #general is a real channel, broadcasts (*) go to individual DMs: Unified channel system: Activity Feed shows activity events only, #general is a real channel, broadcasts (*) go to individual DMs
