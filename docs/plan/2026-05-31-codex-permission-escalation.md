# Codex Permission Escalation Plan

## Goal

Let Lanternwood Codex runs start with workspace write access, and let agents ask for broader permission instead of ending the task when a sandbox boundary blocks useful work.

## Scope

- Change live Codex execution from `read-only` to `workspace-write` by default.
- Carry an optional sandbox override from the UI run request to the local SSE backend and into each Codex CLI route.
- Add prompt guidance for specialist and synthesis routes to return a structured permission request when they need a broader sandbox.
- Convert structured permission requests into `approval.requested` events with the requested sandbox, reason, blocked action, and raw response.
- Add a small UI approval panel that retries the same task with the requested sandbox.
- Guard the local run endpoint against cross-site POSTs now that the default run can write inside the workspace.
- Cover backend SSE approval-token injection, approved retry, synthesis permission requests, and JSONL stdout fallback parsing.

## Tests

- Unit test that Codex workflow routes use `workspace-write` by default.
- Unit test that a structured permission request yields `approval.requested` and does not become a generic failure.
- Adapter/server tests for passing sandbox overrides through request bodies.
- App shell test for showing an approval retry control and rerunning with the requested sandbox.
- Server tests for rejecting untrusted origins, rejecting non-JSON run requests, denying unapproved `danger-full-access`, injecting approval tokens, and accepting a matching approved retry.
- Workflow tests for synthesis permission requests and failed-route permission requests embedded in Codex JSONL stdout.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run e2e`
- `$subagent-review-loop` after focused verification when available.
