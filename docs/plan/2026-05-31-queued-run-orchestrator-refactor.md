# Queued Run Orchestrator Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract queued-run orchestration out of `src/ui/AppShell.tsx` into a focused hook/service backed by explicit reducer transitions.

**Architecture:** Keep `AppShell` responsible for dashboard state, workspace selection, and rendering. Move queued task runtime state, specialist lane queues, synthesis queue, cancellation controllers, and queue worker loops into `useQueuedRunOrchestrator`. Add a pure reducer for queue state transitions and test it directly before wiring the hook.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing `RunAdapter` and event reducer contracts.

---

## Worker Personas

- **Implementation worker:** Extract the hook and keep AppShell behavior unchanged.
- **Test worker:** Add reducer-focused tests and run the existing queue regression suite.
- **Review worker:** Inspect the final diff for missed cancellation, stale-ref, and terminal-state regressions.

## Files

- Create: `src/ui/useQueuedRunOrchestrator.ts`
- Create: `src/ui/useQueuedRunOrchestrator.test.ts`
- Modify: `src/ui/AppShell.tsx`
- Modify: `docs/plan/2026-05-31-queued-run-orchestrator-refactor.md`

## Tasks

- [x] Add a reducer-level test for queue-state cleanup when stopping queued work.
- [x] Create `useQueuedRunOrchestrator.ts` with reducer actions for task runtime registration, specialist enqueue/dequeue, synthesis enqueue/dequeue, active lane tracking, and reset.
- [x] Move queued-run helper functions from `AppShell.tsx` into the hook while preserving existing event commits and `RunState` updates through callbacks.
- [x] Simplify `AppShell.tsx` to call `queueRun` and `stopQueuedRuns` from the hook while deriving `hasQueuedWork` from visible `RunState`.
- [x] Run focused tests: `npm test -- src/ui/useQueuedRunOrchestrator.test.ts src/ui/AppShell.test.tsx`.
- [x] Run broader verification: `npm run verify` completed successfully, including typecheck, unit tests, lint, build, and e2e.
- [x] Run `$subagent-review-loop` after verification if the subagent tool is available.

## Notes

- Keep legacy single-run behavior in `AppShell` for adapters that do not support queued runs.
- Preserve queue-time snapshots for `previousRun`, `workspacePath`, and `sandboxMode`.
- Keep abort behavior idempotent: stopping queued work must fail visible queued/running jobs, clear pending internal queues, and avoid starting stale same-agent work after an aborted worker settles.
