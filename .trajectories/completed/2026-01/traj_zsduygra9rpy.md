# Trajectory: Fix external worker logs visibility in dashboard

> **Status:** ✅ Completed
> **Task:** external-worker-logs
> **Confidence:** 85%
> **Started:** January 29, 2026 at 10:31 PM
> **Completed:** January 29, 2026 at 10:32 PM

---

## Summary

Fixed external worker logs visibility: 1) Dashboard now checks workers.json to detect externally-spawned workers and sets isSpawned=true so log button appears, 2) Added fallback to read logs from worker log files when agent not in dashboard spawner, 3) Added file watching for live log streaming, 4) Added 12 unit tests covering detection, reading, and flag logic

**Approach:** Standard approach

---

## Key Decisions

### Check workers.json for external workers to set isSpawned flag
- **Chose:** Check workers.json for external workers to set isSpawned flag
- **Reasoning:** Dashboard spawner only tracks workers it spawned. External spawners (agentswarm, SDK) write to workers.json with logFile paths. By checking workers.json, we can identify these and show the log button.

### Read logs from external worker log files with file watching
- **Chose:** Read logs from external worker log files with file watching
- **Reasoning:** External workers have log files in worker-logs/ directory. Instead of saying PTY output not available, read from these files and watch for changes to stream live updates.

---

## Chapters

### 1. Work
*Agent: default*

- Check workers.json for external workers to set isSpawned flag: Check workers.json for external workers to set isSpawned flag
- Read logs from external worker log files with file watching: Read logs from external worker log files with file watching
