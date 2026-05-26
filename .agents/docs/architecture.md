# Architecture

The Lanternwood Athenaeum is a Vite React TypeScript app with a PixiJS scene.

The UI is event-driven:

```text
RunAdapter -> AgentEvent -> reducer -> React panels + PixiJS scene
```

Rules:

- `src/events/` is the source of truth for runtime state.
- `src/world/` must not own business state.
- `src/harness/mockRunAdapter.ts` is the first run source.
- Future live-run work must implement the same `RunAdapter` interface.
- The current live-run path is Codex CLI through `src/harness/codexRunAdapter.ts` and the local SSE backend.
- Side-effecting tools must require explicit approval before execution.
