# Lanternwood Character Animation Plan

## Scope

Upgrade the PixiJS scene from simple agent markers to game-character-like avatars with status-specific animation, a richer Lanternwood Athenaeum background, and deterministic visual QA.

## Expected Files

- `src/world/avatarAnimation.ts`
- `src/world/avatarParts.ts`
- `src/world/AgentSprite.ts`
- `src/world/LanternwoodScene.tsx`
- `src/world/sceneBackground.ts`
- `src/world/sceneLayout.ts`
- `tests/e2e/lanternwood.spec.ts`
- `tests/e2e/__snapshots__/lanternwood-dashboard.png`

## Verification Plan

Run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run e2e
```

## Review Gate

- Use a fresh five-reviewer `$subagent-review-loop` after verification.
- Fix every actionable finding, rerun verification, then start a new five-reviewer pass.
- Stop only when the newest fresh five-reviewer pass reports no actionable findings.

## Progress Log

- 2026-05-25: Character avatars, background, status animation, screenshot/pixel QA, and responsive QA implemented.
- 2026-05-25: Review findings routed back into animation identity, E2E stability, and durable harness docs.
