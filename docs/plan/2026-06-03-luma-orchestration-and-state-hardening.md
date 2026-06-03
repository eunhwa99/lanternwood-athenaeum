# Luma Orchestration and Approval-State Hardening

## Goal
- Stop run-state cross-talk between tasks by resetting/cleaning per-task event history.
- Make permission-request selection linear-time and stable across concurrent/successive approvals.
- Verify Luma orchestration behavior (normal run, approval retry, and queued approval path).

## Scope
- `src/ui/AppShell.tsx`
  - Hardening for drawer close behavior: clamp `.library-stage`/window scroll safely when `scrollTo` is not available in test environments.
- `src/ui/AppShell.tsx`
  - Reset/clear `taskEventsRef` per run and on stop.
  - Prevent stale per-task event retention from leaking into subsequent runs.
- `src/ui/permissionRequests.ts`
  - Replace reverse-slice scan with single-pass reverse traversal + tracking sets.
- Test suite
  - `src/ui/AppShell.test.tsx` (existing approval/orchestration tests)
  - `src/ui/useQueuedRunOrchestrator.test.ts` as needed
  - focused orchestration runtime tests if failures indicate coverage gaps

## Acceptance Criteria
- Running multiple tasks with overlapping/similar task IDs does not surface stale permission requests from prior runs.
- Approval request selection is correct when stale approvals, resumed siblings, and completion events coexist.
- Drawer-closing scroll/focus corrections do not throw in test environments and do not regress completed-run layout clipping checks.
- `npm run verify` (or equivalent focused+full gate when feasible) runs without regressions.
- Luma orchestration is observed end-to-end with approval + queued workflow checks.
