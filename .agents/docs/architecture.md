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
- Future OpenAI Agents SDK work must implement the same `RunAdapter` interface.
- Side-effecting tools must require explicit approval before execution.
