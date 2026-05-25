# The Lanternwood Athenaeum Design

## Summary

The Lanternwood Athenaeum is a personal agent workspace with a warm living-library fantasy theme. The first version is a local web app that visualizes role-based agents as PixiJS avatars inside a floating library dashboard. It uses mock agent events first, while keeping the event contract and adapter boundary ready for a later OpenAI Agents SDK integration.

Display name: `The Lanternwood Athenaeum`
Project folder and package name: `lanternwood-athenaeum`

## Goals

- Create a Vite, React, TypeScript, and PixiJS app under `/Users/eunhwa/IdeaProjects/lanternwood-athenaeum`.
- Render a Living Library Dashboard with a central PixiJS scene and a right-side operational panel.
- Define role-based agents with stable names, personas, visual identity, and capability boundaries.
- Drive the world from mock event streams rather than hardcoded animation state.
- Keep a clean adapter boundary so real Agents SDK events can replace mock events later.
- Apply a repo-local harness engineering workflow adapted from `MCPContentSearch`.

## Non-Goals

- Do not connect to live OpenAI APIs in the first implementation slice.
- Do not send emails, modify calendars, edit files, or perform side effects.
- Do not copy protected worlds, characters, places, or names from existing franchises.
- Do not build a full game loop with quests, inventory, combat, or physics.
- Do not introduce backend persistence until the event contract is stable.

## World Direction

The world is a warm, original, cloudborne living library. Lantern-lit shelves move on their own, agents work at enchanted desks, and tasks appear as glowing cards that travel between agents.

Core tone:

- Cozy, capable, and magical.
- Operational enough for daily productivity.
- Original rather than franchise-derived.
- Clear enough that agent state and task progress remain inspectable.

## Agent Registry

The app starts with five agents.

| Agent | System Role | World Role | Initial Purpose |
| --- | --- | --- | --- |
| `Luma` | ManagerAgent | Chief librarian and task coordinator | Decompose requests, assign work, synthesize results |
| `Orion` | ResearchAgent | Star-map researcher | Simulate research, source checks, and summaries |
| `Neria` | MemoryAgent | Keeper of records | Simulate memory lookup and preference recall |
| `Quill` | DocumentAgent | Scribe and illuminator | Simulate note, brief, and document drafting |
| `Argus` | ReviewAgent | Watchtower sentinel | Simulate review, risk checks, and final validation |

Each agent definition includes:

- `id`
- `displayName`
- `systemRole`
- `worldRole`
- `persona`
- `color`
- `homePosition`
- `allowedEventTypes`
- `futureTools`

## User Experience

The first screen is the Living Library Dashboard.

Main regions:

- Center: PixiJS canvas showing the library scene and animated agents.
- Right panel: current task, agent statuses, event timeline, and an approval gate stub for future side-effecting actions.
- Bottom input: a task request box that starts a mock run.

Initial workflow:

1. User enters a task.
2. Mock manager creates a `task.created` event.
3. Luma enters `planning`.
4. Luma delegates to one or more agents.
5. Agents transition through `moving`, `working`, `reporting`, and `done`.
6. Argus performs a review step.
7. Luma summarizes the run.
8. Timeline keeps the full event trace visible.

## Event Contract

The UI state is derived from events. PixiJS animation is a projection of the current agent state, not the source of truth.

Initial event shape:

```ts
type AgentEvent = {
  eventId: string;
  taskId: string;
  agentId: "luma" | "orion" | "neria" | "quill" | "argus";
  type:
    | "task.created"
    | "agent.planning"
    | "agent.delegated"
    | "agent.moving"
    | "agent.working"
    | "agent.reporting"
    | "agent.reviewing"
    | "agent.done"
    | "agent.failed"
    | "approval.requested";
  message: string;
  timestamp: string;
  payload?: Record<string, unknown>;
};
```

Initial agent states:

```ts
type AgentStatus =
  | "idle"
  | "planning"
  | "moving"
  | "working"
  | "reporting"
  | "reviewing"
  | "waitingApproval"
  | "done"
  | "failed";
```

## Architecture

Recommended structure:

```text
src/
  agents/
    registry.ts
    types.ts
  events/
    fixtures.ts
    reducer.ts
    types.ts
  world/
    LanternwoodScene.ts
    AgentSprite.ts
    sceneLayout.ts
  ui/
    AppShell.tsx
    TaskInput.tsx
    AgentStatusPanel.tsx
    Timeline.tsx
  harness/
    agentsSdkAdapter.ts
    mockRunAdapter.ts
  test/
    render.tsx
.agents/
  docs/
    architecture.md
    github-workflow.md
    harness-engineering.md
    adr/README.md
  skills/
docs/
  plan/
  superpowers/specs/
```

Key boundaries:

- `agents/` owns persona and role definitions.
- `events/` owns event types, mock streams, and reducer logic.
- `world/` owns PixiJS rendering only.
- `ui/` owns React panels and user interaction.
- `harness/` owns the future integration boundary between mock runs and real agent runs.

## PixiJS Design

PixiJS is included in the MVP.

Rendering responsibilities:

- Draw the library background.
- Draw agent avatars as simple, polished 2D sprites or generated shapes in the first slice.
- Move agents between named positions based on event-derived state.
- Show lightweight status indicators above each avatar.

React remains responsible for:

- Task input.
- Timeline.
- Agent status panel.
- Approval gate stub.

PixiJS must not own business state. It receives derived state from React and renders it.

## Harness Engineering

The project will include a repo-local harness adapted from `MCPContentSearch`, but rewritten for a TypeScript/React/PixiJS app.

Required workflow for file-changing work:

1. Run branch preflight when the project is a git repo.
2. Create or update a `docs/plan/YYYY-MM-DD-short-task-name.md` plan before target edits.
3. Keep the main agent as orchestrator.
4. Use bounded worker personas for implementation, tests, docs, or integration when the task is not atomic.
5. Run focused verification before review.
6. Run `$subagent-review-loop` after verification when review tools are available.
7. Route actionable findings back to the responsible worker persona.
8. Repeat until the newest review pass has no actionable findings.
9. Stage only relevant files, commit, push, and create a PR when requested or when the repo workflow calls for it.

Initial verification commands:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

If dependency installation is unavailable, the blocker must be reported clearly rather than hidden.

## Testing Strategy

Use TDD for behavior changes.

Initial tests:

- Agent registry returns the five expected agents and stable roles.
- Event reducer updates agent state from mock events.
- Mock run adapter emits a deterministic event sequence.
- Timeline renders events in order.
- World component can mount without throwing.

Pixel-perfect PixiJS rendering is not required in unit tests. Visual behavior is verified through browser screenshots once the dev server runs.

## Risks

- PixiJS and React state can drift if rendering owns state. Mitigation: React/event reducer is the source of truth.
- Fantasy theme can obscure operational status. Mitigation: timeline and status panel remain visible.
- Adding real OpenAI APIs too early can slow iteration. Mitigation: mock adapter first, real adapter later.
- Subagent workflow may be overkill for tiny changes. Mitigation: record when a change is atomic and why direct implementation is acceptable.
- Protected IP risk from inspired themes. Mitigation: keep all names, places, visuals, and characters original.

## Acceptance Criteria

The first implementation slice is complete when:

- The app runs locally.
- The first screen shows the Living Library Dashboard.
- PixiJS renders the central library scene with five agents.
- Submitting a sample task starts a mock event run.
- The right panel shows current task, agent statuses, and timeline.
- The repo contains adapted harness docs and a plan workflow.
- Focused verification commands are run and reported.
