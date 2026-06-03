# 2026-06-03 Worktree Workspace Routing Fix

## Goal

Fix Lanternwood's workspace inspect and agent-question flows when the app is running from a Codex worktree outside the default coordinator allow roots.

## Scope

- Confirm the current-workspace path fails `workspacePath` validation when the repo is launched from `.codex/worktrees/...`.
- Update the default global-agent policy loading so the active workspace is always an allowed root for workspace metadata and Codex run requests.
- Add regression coverage for the active-workspace allow-root behavior.
- Diagnose and fix the Codex-mode final-event failure caused by an invalid workflow event on successful specialist/synthesis runs.
- Make the workspace picker visibly clickable even before typing by always showing discovered workspaces and filtering them in place.
- Restore specialist routing for Korean repo-inspection prompts that ask for improvement findings so Luma does not answer alone.
- Harden Argus review prompting so reviewer claims about applied workspace changes are grounded in actual on-disk verification.
- Re-run focused verification for the affected server and UI paths.

## Verification

- `npm test -- server/globalAgents.test.ts src/ui/AppShell.test.tsx server/index.test.ts`
- `npm test -- server/codexWorkflow.test.ts`
- `npm test -- src/ui/AppShell.test.tsx`
- `npm test -- src/harness/routePlanning.test.ts`
- Manual API smoke:
  - `POST /api/workspace-metadata` with the current worktree path
  - `POST /api/runs` with the selected current worktree path
