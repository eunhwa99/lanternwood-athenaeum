# 2026-05-31 Build Missing Modules Plan

## Scope

Restore the modules expected by the current multi-task UI and scene changes so `npm run build` can complete.

## Non-goals

- Do not refactor the existing multi-workspace/workload implementation.
- Do not revert the current dirty worktree.
- Do not add live OpenAI or external service integrations.

## Expected files

- `src/events/taskLabels.test.ts`
- `src/events/taskLabels.ts`
- `src/world/sceneBubbleText.test.ts`
- `src/world/sceneBubbleText.ts`
- `src/agents/registry.ts`
- `src/ui/runDetails.test.ts`
- `server/verificationScripts.test.ts`
- `src/test/setup.ts`
- `src/ui/TaskInput.tsx`
- `server/agentDraft.test.ts`
- `server/agentCatalog.ts`
- `server/httpGuards.test.ts`
- `server/httpGuards.ts`
- `server/index.ts`
- `tsconfig.node.json`

## Worker personas when relevant

- Debug implementation worker: identify the missing module contracts from their import sites and add minimal helpers.
- Verification worker: run focused tests, typecheck/build, and review-loop checks.

The main agent remains the orchestrator for the repair.

## Verification plan

1. Reproduce the build failure with `npm run build`.
2. Add RED tests for task labels and scene bubble text before implementation.
3. Implement the missing modules with the smallest stable API.
4. Update the stale `RunState` test fixture fields.
5. Run focused tests for the touched helpers.
6. Run `npm run typecheck` and `npm run build`.
7. Run `$subagent-review-loop` when available and address actionable findings.

## Progress log

- Reproduced `npm run build` failure:
  - `src/events/taskLabels` is imported by AppShell, LiveRunInspector, RunDetailDrawer, and runDetails but the file is absent.
  - `src/world/sceneBubbleText` is imported by LanternwoodScene but the file is absent.
  - `src/ui/runDetails.test.ts` constructs an older `RunState` shape without `agentQueues`, `finalOutputs`, or `tasks`.
- After adding the missing files, focused tests exposed that `src/agents/registry.ts` only loaded nested `*/agent.json` files while the current built-in definitions are top-level `.agents/lanternwood/agents/<agent-id>.json` files with persona files under matching directories.
- `npm run typecheck` also exposed that `server/verificationScripts.test.ts` imported `../../package.json`, which resolves outside the repo from `server/`; the repo root package file is `../package.json`.
- Follow-up test run after the build repair exposed three additional contract mismatches in the same dirty worktree:
  - `TaskInput` rendered `Send to Luma` while unit and e2e tests still use `Send to Queue`.
  - agent colors loaded from JSON can be uppercase, while existing UI tests expect normalized lowercase CSS values.
  - the Vitest/JSDOM environment can expose a broken `window.localStorage` without `setItem`/`clear`, causing workspace recent-storage tests to cascade fail.
- Runtime agent checks exposed that the Codex API guard only allowed `http://127.0.0.1:5173`, while the dashboard can run on configured local dev/e2e ports. That makes agent and workspace POST calls fail with `Forbidden origin` when the UI is opened on another approved local port.
- Review found that configured dashboard origins must also be constrained to local HTTP origins, otherwise `LANTERNWOOD_DASHBOARD_ORIGINS` could accidentally allow a remote site. The guard should reject or ignore non-local configured origins rather than treating the env var as a wildcard escape hatch.
- PR conflict resolution started after `origin/main` advanced to include the queued task workflow merge. Resolve by preserving the newer main queue behavior while retaining the agent workbench runtime, workspace discovery, dynamic agent catalog, missing-module build fixes, and local Codex API guard hardening from this branch.
