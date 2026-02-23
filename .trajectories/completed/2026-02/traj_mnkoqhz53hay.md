# Trajectory: Fix /api/send target resolution and agent cli/model display

> **Status:** ✅ Completed
> **Confidence:** 92%
> **Started:** February 23, 2026 at 11:40 AM
> **Completed:** February 23, 2026 at 11:40 AM

---

## Summary

Fixed local dashboard messaging/display regressions: canonicalized /api/send target resolution, added explicit spawned-not-connected errors, normalized spawned/relaycast cli+model parsing, stopped forcing synthetic spawned-only agents online, and propagated model/cwd through /api/bridge to frontend mapping.

**Approach:** Standard approach

---

## Key Decisions

### Normalized direct-message recipients and added spawned-not-connected guard
- **Chose:** Normalized direct-message recipients and added spawned-not-connected guard
- **Reasoning:** Dashboard can show broker-spawned agents before Relaycast registration; sending to those names produced opaque 'Agent not found'. We now resolve case-insensitive canonical names and return a specific 409 when spawned agent is not yet relay-connected.

### Parsed CLI command strings into provider + model in server snapshot paths
- **Chose:** Parsed CLI command strings into provider + model in server snapshot paths
- **Reasoning:** Spawned agents and Relaycast metadata may encode '--model' inline in cli strings; splitting this restores consistent AgentCard/sidebar display and avoids showing full command as cli.

---

## Chapters

### 1. Work
*Agent: default*

- Normalized direct-message recipients and added spawned-not-connected guard: Normalized direct-message recipients and added spawned-not-connected guard
- Parsed CLI command strings into provider + model in server snapshot paths: Parsed CLI command strings into provider + model in server snapshot paths
