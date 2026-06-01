# 2026-05-28 Live Run Inspector Roster Plan

## Scope

Replace the Live Run Inspector agent card grid with a compact monitoring roster so the current five agents can be scanned without an internal card-grid scrollbar. Each agent should render as a stable row with its name, status, preview text, and existing details action.

Add collapsible status groups to the compact roster so agents are organized by `Active`, `Needs review`, `Done`, and `Idle`. Keep `Active` and `Needs review` open by default, while `Done` and `Idle` start collapsed to keep the inspector dense as the agent count grows.

## Non-goals

- Do not add pagination, filtering, virtualization, or search in this pass.
- Do not change run event contracts, agent routing, drawer content, or Codex runtime behavior.
- Do not add dependencies or redesign the scene, top summary, or task input.

## Expected files

- `src/ui/LiveRunInspector.test.tsx`: add focused component coverage for the roster semantics and detail action.
- `src/ui/LiveRunInspector.tsx`: replace the agent output card grid markup with a compact grouped roster.
- `src/styles.css`: update inspector agent styles from fixed cards to row-based roster layout.
- `server/coordinatorPolicy.ts`: fix an existing cross-platform allow-root check exposed by full unit verification.
- `docs/plan/2026-05-28-live-run-inspector-roster.md`: track the work.

## Worker personas when relevant

This is an atomic UI change, so no separate worker persona is needed. The main agent owns planning, implementation, and verification.

## Verification plan

1. Run the focused test after adding it to confirm it fails against the existing card markup:

   ```sh
   npm test -- src/ui/LiveRunInspector.test.tsx
   ```

2. Implement the roster markup and CSS.
3. Re-run the focused test and then run:

   ```sh
   npm run typecheck
   npm test
   npm run lint
   npm run build
   npm run e2e
   git diff --check
   ```

4. Run the subagent review loop only if the project provides it in the current tool context.

## Progress log

- Created the plan after reviewing `AGENTS.md`, `.agents/docs/harness-engineering.md`, `LiveRunInspector`, current CSS constraints, and the existing e2e layout assertions.
- Added a failing Live Run Inspector roster test, then replaced card markup and fixed-height grid styles with compact row markup and CSS.
- Full unit verification exposed an existing Linux-path failure in `server/coordinatorPolicy.ts`; fixed the root existence guard so nonexistent allow roots are compared lexically while existing roots still use realpath checks.
- Added the approved follow-up scope for collapsible status groups: active states in `Active`, `waitingApproval`/`failed` in `Needs review`, completed agents in `Done`, and idle agents in `Idle`.
- Implemented collapsible roster groups with `Active` and `Needs review` open by default, `Done` and `Idle` collapsed by default, preserved user toggles across run-state updates, and refreshed the dashboard e2e snapshot.
