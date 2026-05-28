# Harness Engineering

## Purpose

This is the implementation harness for The Lanternwood Athenaeum.

## Phase Order

1. Branch preflight when the repo has commits.
2. Create or update a plan in `docs/plan/`.
3. Define implementation, test, documentation, or integration worker personas for non-atomic work.
4. Implement with TDD where behavior changes.
5. Run focused verification.
6. Run `$subagent-review-loop` when available.
7. Route actionable findings back to the responsible worker persona.
8. Repeat verification and review until clean.

## Verification Commands

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run e2e
```

For this harness, `npm run verify` is the single full verification set and must include the e2e suite.

## Safety

- Do not commit secrets or `.env` files.
- Do not add API-key-backed OpenAI integrations without explicit approval.
- Codex CLI live mode is allowed only through the approved local `RunAdapter` and SSE backend path.
- Do not add side-effecting external tools without an approval gate.
