# 2026-05-28 Agent Task Queues Plan

## Scope

Build the full queued execution model requested for Lanternwood:

- Remove the inline `Routing Decision` panel from Live Run Inspector.
- Let users submit new work while agents are busy; submissions become task records instead of replacing the current run.
- Store final output per task and let users open the selected task's final output.
- Maintain per-agent queues so different agents can work in parallel while each individual agent processes its own queue sequentially.
- Treat Luma as router and task finalizer: Luma routes new tasks, queues specialist jobs, then synthesizes final output for each task after selected specialist reports arrive.
- Refine the task UX now that outputs are task-scoped:
  - remove the scene-level `Open full final output` action,
  - show stable user-facing task numbers (`T1`, `T2`, ...),
  - split work queue visibility into `Active`, `Queued`, and recent `Completed`,
  - keep older completed work behind an explicit task-history expansion,
  - prefix speech bubbles and agent/report details with the task number so parallel work stays distinguishable.

## Non-goals

- Do not add new external dependencies.
- Do not add API-key-backed OpenAI integrations or bypass the existing Codex adapter/server path.
- Do not remove the existing run-detail drawer; adapt it to task-scoped details.
- Do not implement priority editing, drag-and-drop reordering, or persistent storage in this pass.

## Expected files

- `src/events/types.ts`: add task records, agent job records, agent queues, task status, and task-scoped final output fields.
- `src/events/reducer.ts`: initialize and update queued tasks, agent jobs, task-scoped outputs, and existing event timeline.
- `src/events/reducer.test.ts`: add reducer coverage for task queue and final output per task.
- `src/harness/runAdapter.ts`: extend adapter contract with optional specialist job and synthesis streams.
- `src/harness/mockRunAdapter.ts`: implement specialist job and task synthesis streams for queue-mode testing and demo UX.
- `src/harness/codexRunAdapter.ts`: call approved SSE backend endpoints for specialist jobs and synthesis.
- `server/codexWorkflow.ts`: expose specialist-job and synthesis event streams using the existing Codex workflow executors.
- `server/index.ts`: add guarded `/api/agent-jobs` and `/api/synthesis` SSE endpoints.
- `src/ui/AppShell.tsx`: replace single-run ownership with a task scheduler and per-agent worker loops.
- `src/ui/TaskInput.tsx`: allow submission while work is running and label submission as queueing.
- `src/ui/LiveRunInspector.tsx`: remove inline routing panel and show agent workload data.
- `src/ui/runDetails.ts`, `src/ui/RunDetailDrawer.tsx`: support task-scoped final output/details.
- `src/world/LanternwoodScene.tsx`: prefix visible/debug speech bubbles with the task badge derived from event `taskId`.
- `src/ui/AppShell.test.tsx`, `src/ui/LiveRunInspector.test.tsx`, relevant harness/server tests, and e2e snapshot: cover queue UX, task outputs, and parallel agent behavior.

## Worker personas when relevant

- Runtime worker: event types, reducer helpers, adapter contracts, mock/Codex streams.
- UI worker: AppShell scheduler, task queue UX, inspector, drawer.
- Verification worker: focused unit/e2e coverage and review findings.

The main agent coordinates all edits in this session because current tool state has a shared dirty working tree.

## Verification plan

1. Add failing reducer tests for task records, per-agent queues, and task-scoped final outputs.
2. Add failing AppShell/UI tests for:
   - submit remains enabled during active work,
   - multiple tasks appear in the work queue,
   - task-specific final outputs can be opened,
   - Orion and Quill jobs from different tasks can be active concurrently,
   - same-agent jobs remain queued behind the active job,
   - global final output action is gone,
   - task rows show task numbers and are grouped by active/queued/completed,
   - task-scoped drawer content and agent report details include task numbers.
3. Add failing scene coverage for task-numbered speech bubbles through debug bubble history.
4. Implement runtime and UI changes until focused tests pass.
5. Run:

   ```sh
   npm run typecheck
   npm test
   npm run lint
   npm run build
   npm run e2e
   git diff --check
   ```

6. Run the available subagent review gate and fix Critical/Important findings.

## Progress log

- Created this plan after inspecting the current single-run `AppShell`, `RunState`, reducer, mock adapter, Codex adapter, and server workflow. The existing Codex workflow already supports concurrent specialists inside a single run; this pass extends the app state and adapter boundaries so queues can coordinate work across multiple user tasks.
- Added the task-identification UX refinement requested after queue-mode manual review: reduce global final-output affordances, prevent completed task sprawl from crowding live work, and make task ownership visible in queue rows, speech bubbles, and detail views.
- Follow-up refinement:
  - keep inspector task badges visually outside clipped preview text,
  - make specialist reporting travel read as a handoff to Luma,
  - route specialists back through their home position before visually starting the next queued job,
  - replace raw prompt/report speech bubbles with short task-summary bubbles.
- Report drawer refinement:
  - replace small fixed-height report cards with a report list plus a large selected-report reader,
  - remove the `Raw Codex` tab and the inspector raw-details action from the user-facing drawer,
  - keep raw output sanitization in `runDetails` for internal data safety tests.
- Verification-set refinement:
  - add `npm run verify` as the full local verification set for typecheck, unit tests, lint, build, and Playwright e2e,
  - make Playwright e2e use a stable default port outside the common dev-server port, with an environment override for local conflicts.
- Workload visibility refinement:
  - show each agent's current job and queued jobs with task numbers in Live Run Inspector,
  - show the current task's agent-level progress in the dashboard header,
  - keep long queue lists bounded with visible task labels and concise prompt previews.
- Workload drawer refinement:
  - add a `Workload` tab to the run details drawer with focused views for current task, selected agent, and all tasks,
  - keep the dashboard current-task panel compact and open detailed activity from a `View activity` action,
  - keep Live Run Inspector agent rows compact by showing current work plus queued counts, with a detail action that opens the drawer report view.
- Inspector action simplification:
  - remove the duplicate per-agent `Workload` button from Live Run Inspector,
  - keep `Details` as the only agent-row action because the drawer already exposes the `Workload` tab.
- Luma output refinement:
  - show Luma's task badge in Live Run Inspector output previews like other agents,
  - surface task final outputs as Luma agent reports in the details drawer,
  - remove the standalone `Final output` tab and route final-output entry points to Luma's report view.
