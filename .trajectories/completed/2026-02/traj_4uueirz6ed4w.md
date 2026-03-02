# Trajectory: Fix C1 hook-order issue and finalize relaycast migration

> **Status:** ✅ Completed
> **Task:** mlztgfn7
> **Confidence:** 86%
> **Started:** February 24, 2026 at 01:23 AM
> **Completed:** February 24, 2026 at 01:27 AM

---

## Summary

Fixed C1 Rules-of-Hooks regression by removing optional hook wrappers and stabilizing SDK hook usage; fixed C2 by replacing unsafe AgentClient cast with structural interface; revalidated dashboard and broker tests/typecheck.

**Approach:** Standard approach

---

## Key Decisions

### Resolve hook-order violation by always keeping SDK hooks mounted under RelayProvider context
- **Chose:** Resolve hook-order violation by always keeping SDK hooks mounted under RelayProvider context
- **Reasoning:** try/catch wrappers around SDK hooks caused variable hook counts when provider presence changed; stable provider+hook order removes Rules-of-Hooks risk

### Replace AgentClient cast with structural RelaycastClientLike interface
- **Chose:** Replace AgentClient cast with structural RelaycastClientLike interface
- **Reasoning:** RelayCast.as(token) and @agent-relay/sdk AgentClient types come from different packages; structural typing removes unsafe runtime assumptions

---

## Chapters

### 1. Work
*Agent: default*

- Resolve hook-order violation by always keeping SDK hooks mounted under RelayProvider context: Resolve hook-order violation by always keeping SDK hooks mounted under RelayProvider context
- Replace AgentClient cast with structural RelaycastClientLike interface: Replace AgentClient cast with structural RelaycastClientLike interface
