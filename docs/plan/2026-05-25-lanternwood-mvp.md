# Lanternwood MVP Plan

## Scope

Build the first runnable PixiJS-powered Living Library Dashboard using mock events.

## Non-Goals

- No live OpenAI API integration.
- No external side effects.
- No backend persistence.

## Expected Files

- Vite and TypeScript config.
- `src/agents/`
- `src/events/`
- `src/harness/`
- `src/ui/`
- `src/world/`
- `.agents/`

## Worker Personas

- Implementation worker: owns app scaffold, event runtime, and UI.
- Test worker: owns focused Vitest coverage.
- Documentation worker: owns harness docs.

## Verification Plan

Run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Progress Log

- 2026-05-25: Plan created from approved design spec.
