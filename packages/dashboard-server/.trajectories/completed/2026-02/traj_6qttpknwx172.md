# Trajectory: Replace hardcoded 'Dashboard' sender name with project name derived from workspace directory

> **Status:** ✅ Completed
> **Confidence:** 80%
> **Started:** February 24, 2026 at 12:39 PM
> **Completed:** February 24, 2026 at 12:40 PM

---

## Summary

Replaced hardcoded 'Dashboard' sender name with project name across server and frontend. Server derives name from dataDir parent when relaycast.json agent_name is null. normalizeIdentity now preserves project identity instead of mapping to 'Dashboard'. Frontend reads agentName from relay-config API via context. All 137 tests pass. One known gap: Relay SDK agentToken identity is baked in at registration time and not addressed here.

**Approach:** Standard approach

---

## Key Decisions

### Used dataDir parent directory basename as project name fallback
- **Chose:** Used dataDir parent directory basename as project name fallback
- **Reasoning:** relaycast.json agent_name is null in user's config. The dataDir is always .agent-relay inside the project root, so path.basename(path.resolve(dataDir, '..')) reliably gives the project directory name (e.g. relay-dashboard).

### Changed normalizeIdentity to return projectIdentity instead of DASHBOARD_DISPLAY_NAME
- **Chose:** Changed normalizeIdentity to return projectIdentity instead of DASHBOARD_DISPLAY_NAME
- **Reasoning:** normalizeIdentity was mapping project names back to 'Dashboard', which defeated the purpose. By returning the project name when set, incoming messages now preserve the project identity for display. This is the key behavioral change - without it, server-side normalization would undo the frontend fallback changes.

### Exposed agentName through RelayConfigProvider context
- **Chose:** Exposed agentName through RelayConfigProvider context
- **Reasoning:** The relay-config API endpoint already returned agentName but the frontend ignored it. Threading it through the RelayConfigStatus context lets MessageProvider use it as the preferred fallback before 'Dashboard', keeping the frontend consistent with the server-side project identity.

### Kept 'Dashboard' as final fallback in all locations
- **Chose:** Kept 'Dashboard' as final fallback in all locations
- **Reasoning:** Rather than removing 'Dashboard' entirely, it remains as the last fallback in the chain: currentUser?.displayName -> relayAgentName/projectIdentity -> 'Dashboard'. This ensures backward compatibility if both relaycast.json agent_name is null AND dataDir derivation fails for any reason.

---

## Chapters

### 1. Work
*Agent: default*

- Used dataDir parent directory basename as project name fallback: Used dataDir parent directory basename as project name fallback
- Changed normalizeIdentity to return projectIdentity instead of DASHBOARD_DISPLAY_NAME: Changed normalizeIdentity to return projectIdentity instead of DASHBOARD_DISPLAY_NAME
- Exposed agentName through RelayConfigProvider context: Exposed agentName through RelayConfigProvider context
- Kept 'Dashboard' as final fallback in all locations: Kept 'Dashboard' as final fallback in all locations

---

## Artifacts

**Commits:** a236da8
**Files changed:** 10
