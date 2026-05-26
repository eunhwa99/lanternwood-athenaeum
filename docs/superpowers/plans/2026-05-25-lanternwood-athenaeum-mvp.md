# Lanternwood Athenaeum MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable PixiJS-powered Living Library Dashboard for The Lanternwood Athenaeum using mock agent events.

**Architecture:** The app is a Vite React TypeScript frontend. Mock run adapters emit typed `AgentEvent` objects, reducers derive agent state, React renders operational panels, and PixiJS renders the central living library scene from derived state only.

**Tech Stack:** Vite, React, TypeScript, PixiJS, Vitest, React Testing Library, ESLint, npm.

---

## File Structure

Create and maintain these boundaries:

```text
package.json
index.html
vite.config.ts
vitest.config.ts
tsconfig.json
tsconfig.node.json
eslint.config.js
src/
  main.tsx
  styles.css
  agents/
    registry.ts
    types.ts
    registry.test.ts
  events/
    reducer.ts
    reducer.test.ts
    types.ts
  harness/
    mockRunAdapter.ts
    mockRunAdapter.test.ts
    runAdapter.ts
  ui/
    AgentStatusPanel.tsx
    AppShell.tsx
    TaskInput.tsx
    Timeline.tsx
    Timeline.test.tsx
  world/
    AgentSprite.ts
    LanternwoodScene.tsx
    sceneLayout.ts
  test/
    render.tsx
    setup.ts
.agents/
  docs/
    architecture.md
    github-workflow.md
    harness-engineering.md
    adr/README.md
docs/
  plan/
```

## Task 1: Project Scaffold And Tooling

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `eslint.config.js`
- Create: `src/main.tsx`
- Create: `src/styles.css`
- Create: `src/test/setup.ts`
- Create: `src/test/render.tsx`

- [ ] **Step 1: Create package manifest**

Create `package.json`:

```json
{
  "name": "lanternwood-athenaeum",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b"
  },
  "dependencies": {
    "@pixi/react": "^8.0.3",
    "pixi.js": "^8.17.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^24.10.1",
    "@types/react": "^19.2.6",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "eslint": "^9.39.1",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.4.24",
    "globals": "^16.5.0",
    "jsdom": "^27.2.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.47.0",
    "vite": "^7.2.4",
    "vitest": "^4.0.13"
  }
}
```

- [ ] **Step 2: Create Vite entry files**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>The Lanternwood Athenaeum</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="app-shell">
      <h1>The Lanternwood Athenaeum</h1>
      <p>Living Library Dashboard scaffold</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Create TypeScript and Vite configs**

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
});
```

Create `vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "eslint.config.js"]
}
```

- [ ] **Step 4: Create ESLint and test setup**

Create `eslint.config.js`:

```js
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `src/test/render.tsx`:

```tsx
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

export function renderApp(ui: ReactElement) {
  return render(ui);
}
```

- [ ] **Step 5: Create base styles**

Create `src/styles.css`:

```css
:root {
  color: #f5eddb;
  background: #0f171b;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  padding: 24px;
}
```

- [ ] **Step 6: Install dependencies**

Run:

```bash
npm install
```

Expected: `node_modules/` and `package-lock.json` are created.

- [ ] **Step 7: Verify scaffold**

Run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Expected: all commands exit with code 0. If there are no tests yet, Vitest may report no test files; continue after confirming the tool itself starts correctly.

- [ ] **Step 8: Commit scaffold**

Run:

```bash
git add package.json package-lock.json index.html vite.config.ts vitest.config.ts tsconfig.json tsconfig.node.json eslint.config.js src
git commit -m "chore: scaffold Lanternwood app"
```

## Task 2: Agent Registry

**Files:**
- Create: `src/agents/types.ts`
- Create: `src/agents/registry.ts`
- Create: `src/agents/registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `src/agents/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AGENTS, getAgentById } from "./registry";

describe("agent registry", () => {
  it("contains the five Lanternwood agents in stable order", () => {
    expect(AGENTS.map((agent) => agent.id)).toEqual([
      "luma",
      "orion",
      "neria",
      "quill",
      "argus",
    ]);
  });

  it("defines Luma as the manager and Argus as the reviewer", () => {
    expect(getAgentById("luma")?.systemRole).toBe("ManagerAgent");
    expect(getAgentById("argus")?.systemRole).toBe("ReviewAgent");
  });

  it("stores visual identity and home position for every agent", () => {
    for (const agent of AGENTS) {
      expect(agent.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(agent.homePosition.x).toBeGreaterThanOrEqual(0);
      expect(agent.homePosition.y).toBeGreaterThanOrEqual(0);
      expect(agent.persona.length).toBeGreaterThan(20);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agents/registry.test.ts
```

Expected: FAIL because `src/agents/registry.ts` does not exist.

- [ ] **Step 3: Implement agent types and registry**

Create `src/agents/types.ts`:

```ts
export type AgentId = "luma" | "orion" | "neria" | "quill" | "argus";

export type SystemRole =
  | "ManagerAgent"
  | "ResearchAgent"
  | "MemoryAgent"
  | "DocumentAgent"
  | "ReviewAgent";

export type ScenePosition = {
  x: number;
  y: number;
};

export type AgentDefinition = {
  id: AgentId;
  displayName: string;
  systemRole: SystemRole;
  worldRole: string;
  persona: string;
  color: string;
  homePosition: ScenePosition;
  futureTools: string[];
};
```

Create `src/agents/registry.ts`:

```ts
import type { AgentDefinition, AgentId } from "./types";

export const AGENTS: AgentDefinition[] = [
  {
    id: "luma",
    displayName: "Luma",
    systemRole: "ManagerAgent",
    worldRole: "Chief librarian and task coordinator",
    persona:
      "Warm, precise coordinator who decomposes work, delegates carefully, and keeps the final answer grounded.",
    color: "#f2c66d",
    homePosition: { x: 480, y: 250 },
    futureTools: ["agent-routing", "result-synthesis", "approval-gate"],
  },
  {
    id: "orion",
    displayName: "Orion",
    systemRole: "ResearchAgent",
    worldRole: "Star-map researcher",
    persona:
      "Curious source-checker who explores references, notes uncertainty, and returns concise research findings.",
    color: "#6ca7bd",
    homePosition: { x: 220, y: 160 },
    futureTools: ["web-search", "file-search", "source-citations"],
  },
  {
    id: "neria",
    displayName: "Neria",
    systemRole: "MemoryAgent",
    worldRole: "Keeper of records",
    persona:
      "Careful archivist who recalls stable preferences, separates memory from assumptions, and protects sensitive context.",
    color: "#8fa765",
    homePosition: { x: 260, y: 420 },
    futureTools: ["memory-search", "preference-lookup", "context-summary"],
  },
  {
    id: "quill",
    displayName: "Quill",
    systemRole: "DocumentAgent",
    worldRole: "Scribe and illuminator",
    persona:
      "Clear writer who turns findings into useful notes, drafts, and structured documents without ornamental excess.",
    color: "#b991c8",
    homePosition: { x: 700, y: 420 },
    futureTools: ["document-draft", "notion-export", "markdown-format"],
  },
  {
    id: "argus",
    displayName: "Argus",
    systemRole: "ReviewAgent",
    worldRole: "Watchtower sentinel",
    persona:
      "Sober reviewer who checks risks, missing evidence, unsafe actions, and whether the output is ready to show.",
    color: "#bd806e",
    homePosition: { x: 740, y: 170 },
    futureTools: ["quality-review", "risk-check", "approval-review"],
  },
];

export function getAgentById(agentId: AgentId): AgentDefinition | undefined {
  return AGENTS.find((agent) => agent.id === agentId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/agents/registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit registry**

Run:

```bash
git add src/agents
git commit -m "feat: add Lanternwood agent registry"
```

## Task 3: Event Types, Reducer, And Mock Adapter

**Files:**
- Create: `src/events/types.ts`
- Create: `src/events/reducer.ts`
- Create: `src/events/reducer.test.ts`
- Create: `src/harness/runAdapter.ts`
- Create: `src/harness/mockRunAdapter.ts`
- Create: `src/harness/mockRunAdapter.test.ts`

- [ ] **Step 1: Write failing reducer tests**

Create `src/events/reducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { createInitialRunState, reduceAgentEvent } from "./reducer";
import type { AgentEvent } from "./types";

const baseEvent = {
  eventId: "evt-1",
  taskId: "task-1",
  timestamp: "2026-05-25T00:00:00.000Z",
} satisfies Pick<AgentEvent, "eventId" | "taskId" | "timestamp">;

describe("event reducer", () => {
  it("creates an idle state for every registered agent", () => {
    const state = createInitialRunState(AGENTS);

    expect(Object.keys(state.agents)).toEqual(["luma", "orion", "neria", "quill", "argus"]);
    expect(state.agents.luma.status).toBe("idle");
  });

  it("updates task and agent status from events", () => {
    const initial = createInitialRunState(AGENTS);
    const created = reduceAgentEvent(initial, {
      ...baseEvent,
      agentId: "luma",
      type: "task.created",
      message: "Prepare a weekly plan",
    });
    const working = reduceAgentEvent(created, {
      ...baseEvent,
      eventId: "evt-2",
      agentId: "orion",
      type: "agent.working",
      message: "Orion is checking references",
    });

    expect(created.currentTask?.prompt).toBe("Prepare a weekly plan");
    expect(working.agents.orion.status).toBe("working");
    expect(working.timeline).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run reducer test to verify it fails**

Run:

```bash
npm test -- src/events/reducer.test.ts
```

Expected: FAIL because event reducer files do not exist.

- [ ] **Step 3: Implement event types and reducer**

Create `src/events/types.ts`:

```ts
import type { AgentDefinition, AgentId } from "../agents/types";

export type AgentEventType =
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

export type AgentStatus =
  | "idle"
  | "planning"
  | "moving"
  | "working"
  | "reporting"
  | "reviewing"
  | "waitingApproval"
  | "done"
  | "failed";

export type AgentEvent = {
  eventId: string;
  taskId: string;
  agentId: AgentId;
  type: AgentEventType;
  message: string;
  timestamp: string;
  payload?: Record<string, unknown>;
};

export type AgentRuntimeState = {
  definition: AgentDefinition;
  status: AgentStatus;
  lastMessage: string;
};

export type CurrentTask = {
  taskId: string;
  prompt: string;
};

export type RunState = {
  currentTask: CurrentTask | null;
  agents: Record<AgentId, AgentRuntimeState>;
  timeline: AgentEvent[];
};
```

Create `src/events/reducer.ts`:

```ts
import type { AgentDefinition, AgentId } from "../agents/types";
import type { AgentEvent, AgentStatus, RunState } from "./types";

const eventStatus: Partial<Record<AgentEvent["type"], AgentStatus>> = {
  "agent.planning": "planning",
  "agent.delegated": "planning",
  "agent.moving": "moving",
  "agent.working": "working",
  "agent.reporting": "reporting",
  "agent.reviewing": "reviewing",
  "agent.done": "done",
  "agent.failed": "failed",
  "approval.requested": "waitingApproval",
};

export function createInitialRunState(agents: AgentDefinition[]): RunState {
  return {
    currentTask: null,
    agents: Object.fromEntries(
      agents.map((agent) => [
        agent.id,
        {
          definition: agent,
          status: "idle",
          lastMessage: "Waiting in the stacks",
        },
      ]),
    ) as RunState["agents"],
    timeline: [],
  };
}

export function reduceAgentEvent(state: RunState, event: AgentEvent): RunState {
  const nextStatus = eventStatus[event.type] ?? state.agents[event.agentId].status;
  const currentTask =
    event.type === "task.created"
      ? { taskId: event.taskId, prompt: event.message }
      : state.currentTask;

  return {
    currentTask,
    agents: {
      ...state.agents,
      [event.agentId]: {
        ...state.agents[event.agentId as AgentId],
        status: nextStatus,
        lastMessage: event.message,
      },
    },
    timeline: [...state.timeline, event],
  };
}
```

- [ ] **Step 4: Write failing mock adapter test**

Create `src/harness/mockRunAdapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mockRunAdapter } from "./mockRunAdapter";

describe("mock run adapter", () => {
  it("emits a deterministic manager-led event sequence", async () => {
    const events = [];

    for await (const event of mockRunAdapter.startRun("Plan my interview prep")) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "task.created",
      "agent.planning",
      "agent.delegated",
      "agent.working",
      "agent.reporting",
      "agent.working",
      "agent.reporting",
      "agent.reviewing",
      "agent.done",
    ]);
    expect(events[0].message).toBe("Plan my interview prep");
    expect(new Set(events.map((event) => event.taskId))).toHaveSize(1);
  });
});
```

- [ ] **Step 5: Run mock adapter test to verify it fails**

Run:

```bash
npm test -- src/harness/mockRunAdapter.test.ts
```

Expected: FAIL because mock adapter files do not exist.

- [ ] **Step 6: Implement run adapter and mock stream**

Create `src/harness/runAdapter.ts`:

```ts
import type { AgentEvent } from "../events/types";

export type RunAdapter = {
  startRun(input: string): AsyncIterable<AgentEvent>;
};
```

Create `src/harness/mockRunAdapter.ts`:

```ts
import type { AgentEvent } from "../events/types";
import type { RunAdapter } from "./runAdapter";

let taskCounter = 0;

function event(
  taskId: string,
  index: number,
  agentId: AgentEvent["agentId"],
  type: AgentEvent["type"],
  message: string,
): AgentEvent {
  return {
    eventId: `${taskId}-evt-${index}`,
    taskId,
    agentId,
    type,
    message,
    timestamp: new Date(Date.UTC(2026, 4, 25, 0, 0, index)).toISOString(),
  };
}

export const mockRunAdapter: RunAdapter = {
  async *startRun(input: string) {
    taskCounter += 1;
    const taskId = `task-${taskCounter}`;
    const events: AgentEvent[] = [
      event(taskId, 1, "luma", "task.created", input),
      event(taskId, 2, "luma", "agent.planning", "Luma is arranging the reading lamps"),
      event(taskId, 3, "luma", "agent.delegated", "Luma sends Orion and Neria into the stacks"),
      event(taskId, 4, "orion", "agent.working", "Orion studies the star maps for useful references"),
      event(taskId, 5, "orion", "agent.reporting", "Orion returns with a concise research brief"),
      event(taskId, 6, "neria", "agent.working", "Neria checks the archive for stable preferences"),
      event(taskId, 7, "neria", "agent.reporting", "Neria finds relevant memory notes"),
      event(taskId, 8, "argus", "agent.reviewing", "Argus checks the answer for risk and gaps"),
      event(taskId, 9, "luma", "agent.done", "Luma places the final summary on the central desk"),
    ];

    for (const item of events) {
      yield item;
    }
  },
};
```

- [ ] **Step 7: Run event tests to verify they pass**

Run:

```bash
npm test -- src/events/reducer.test.ts src/harness/mockRunAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit event core**

Run:

```bash
git add src/events src/harness
git commit -m "feat: add mock agent event runtime"
```

## Task 4: React Dashboard Panels

**Files:**
- Create: `src/ui/Timeline.tsx`
- Create: `src/ui/Timeline.test.tsx`
- Create: `src/ui/AgentStatusPanel.tsx`
- Create: `src/ui/TaskInput.tsx`
- Create: `src/ui/AppShell.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing timeline test**

Create `src/ui/Timeline.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test/render";
import type { AgentEvent } from "../events/types";
import { Timeline } from "./Timeline";

const events: AgentEvent[] = [
  {
    eventId: "evt-1",
    taskId: "task-1",
    agentId: "luma",
    type: "task.created",
    message: "Draft my weekly plan",
    timestamp: "2026-05-25T00:00:00.000Z",
  },
  {
    eventId: "evt-2",
    taskId: "task-1",
    agentId: "orion",
    type: "agent.working",
    message: "Orion studies the star maps",
    timestamp: "2026-05-25T00:00:01.000Z",
  },
];

describe("Timeline", () => {
  it("renders event messages in order", () => {
    renderApp(<Timeline events={events} />);

    expect(screen.getByText("Draft my weekly plan")).toBeInTheDocument();
    expect(screen.getByText("Orion studies the star maps")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run timeline test to verify it fails**

Run:

```bash
npm test -- src/ui/Timeline.test.tsx
```

Expected: FAIL because `Timeline` does not exist.

- [ ] **Step 3: Implement UI components**

Create `src/ui/Timeline.tsx`:

```tsx
import type { AgentEvent } from "../events/types";

type TimelineProps = {
  events: AgentEvent[];
};

export function Timeline({ events }: TimelineProps) {
  return (
    <section className="panel-section" aria-label="Event timeline">
      <h2>Timeline</h2>
      <ol className="timeline">
        {events.map((event) => (
          <li key={event.eventId}>
            <span className="timeline-type">{event.type}</span>
            <span>{event.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

Create `src/ui/AgentStatusPanel.tsx`:

```tsx
import type { RunState } from "../events/types";

type AgentStatusPanelProps = {
  state: RunState;
};

export function AgentStatusPanel({ state }: AgentStatusPanelProps) {
  return (
    <section className="panel-section" aria-label="Agent status">
      <h2>Agents</h2>
      <div className="agent-list">
        {Object.values(state.agents).map((agent) => (
          <article className="agent-card" key={agent.definition.id}>
            <span className="agent-dot" style={{ background: agent.definition.color }} />
            <div>
              <h3>{agent.definition.displayName}</h3>
              <p>{agent.definition.worldRole}</p>
              <strong>{agent.status}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
```

Create `src/ui/TaskInput.tsx`:

```tsx
import { FormEvent, useState } from "react";

type TaskInputProps = {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
};

export function TaskInput({ onSubmit, disabled = false }: TaskInputProps) {
  const [prompt, setPrompt] = useState("Plan my interview prep for this week");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (trimmed.length > 0) {
      onSubmit(trimmed);
    }
  }

  return (
    <form className="task-input" onSubmit={handleSubmit}>
      <input
        aria-label="Task request"
        disabled={disabled}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <button disabled={disabled} type="submit">
        Send to Luma
      </button>
    </form>
  );
}
```

Create `src/ui/AppShell.tsx`:

```tsx
import { useMemo, useState } from "react";
import { AGENTS } from "../agents/registry";
import { createInitialRunState, reduceAgentEvent } from "../events/reducer";
import type { RunState } from "../events/types";
import { mockRunAdapter } from "../harness/mockRunAdapter";
import { AgentStatusPanel } from "./AgentStatusPanel";
import { TaskInput } from "./TaskInput";
import { Timeline } from "./Timeline";

export function AppShell() {
  const initialState = useMemo(() => createInitialRunState(AGENTS), []);
  const [runState, setRunState] = useState<RunState>(initialState);
  const [isRunning, setIsRunning] = useState(false);

  async function startMockRun(prompt: string) {
    setRunState(createInitialRunState(AGENTS));
    setIsRunning(true);

    for await (const event of mockRunAdapter.startRun(prompt)) {
      setRunState((current) => reduceAgentEvent(current, event));
    }

    setIsRunning(false);
  }

  return (
    <main className="dashboard">
      <section className="library-stage">
        <div className="stage-placeholder">
          <p>The living library scene will render here.</p>
        </div>
        <TaskInput disabled={isRunning} onSubmit={startMockRun} />
      </section>
      <aside className="side-panel">
        <header>
          <p className="eyebrow">The Lanternwood Athenaeum</p>
          <h1>Living Library Dashboard</h1>
        </header>
        <section className="panel-section">
          <h2>Current Task</h2>
          <p>{runState.currentTask?.prompt ?? "No active task"}</p>
        </section>
        <AgentStatusPanel state={runState} />
        <Timeline events={runState.timeline} />
      </aside>
    </main>
  );
}
```

Modify `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./ui/AppShell";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
```

- [ ] **Step 4: Replace styles with dashboard layout**

Modify `src/styles.css`:

```css
:root {
  color: #f5eddb;
  background: #0f171b;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input {
  font: inherit;
}

.dashboard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  min-height: 100vh;
  background:
    radial-gradient(circle at 18% 12%, rgba(228, 185, 105, 0.18), transparent 30%),
    linear-gradient(135deg, #101821, #182a29 45%, #111820);
}

.library-stage {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 16px;
  padding: 24px;
}

.stage-placeholder {
  display: grid;
  place-items: center;
  min-height: 520px;
  border: 1px solid rgba(230, 205, 145, 0.25);
  border-radius: 8px;
  background: rgba(18, 30, 34, 0.7);
  color: #d9c989;
}

.side-panel {
  overflow-y: auto;
  border-left: 1px solid rgba(230, 205, 145, 0.2);
  background: rgba(12, 20, 24, 0.82);
  padding: 24px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #d8c781;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

.panel-section {
  margin-top: 24px;
}

.agent-list {
  display: grid;
  gap: 10px;
}

.agent-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px;
  border: 1px solid rgba(230, 205, 145, 0.18);
  border-radius: 8px;
  background: rgba(31, 52, 47, 0.64);
}

.agent-card h3 {
  margin-bottom: 2px;
  font-size: 1rem;
}

.agent-card p {
  margin-bottom: 6px;
  color: #c8d2cb;
  font-size: 0.88rem;
}

.agent-dot {
  width: 12px;
  height: 12px;
  margin-top: 4px;
  border-radius: 999px;
  flex: 0 0 auto;
}

.timeline {
  display: grid;
  gap: 8px;
  padding-left: 0;
  list-style: none;
}

.timeline li {
  display: grid;
  gap: 4px;
  padding: 10px;
  border-radius: 8px;
  background: rgba(23, 36, 47, 0.8);
}

.timeline-type {
  color: #d8c781;
  font-size: 0.75rem;
}

.task-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
}

.task-input input {
  min-width: 0;
  border: 1px solid rgba(230, 205, 145, 0.35);
  border-radius: 8px;
  background: rgba(12, 20, 24, 0.86);
  color: #f5eddb;
  padding: 12px 14px;
}

.task-input button {
  border: 0;
  border-radius: 8px;
  background: #e4b969;
  color: #13201d;
  padding: 12px 16px;
  font-weight: 700;
}

@media (max-width: 900px) {
  .dashboard {
    grid-template-columns: 1fr;
  }

  .side-panel {
    border-left: 0;
    border-top: 1px solid rgba(230, 205, 145, 0.2);
  }
}
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
npm test -- src/ui/Timeline.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit panels**

Run:

```bash
git add src/main.tsx src/styles.css src/ui
git commit -m "feat: add Lanternwood dashboard panels"
```

## Task 5: PixiJS Living Library Scene

**Files:**
- Create: `src/world/sceneLayout.ts`
- Create: `src/world/AgentSprite.ts`
- Create: `src/world/LanternwoodScene.tsx`
- Modify: `src/ui/AppShell.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Create scene layout**

Create `src/world/sceneLayout.ts`:

```ts
import type { AgentId, ScenePosition } from "../agents/types";

export const SCENE_SIZE = {
  width: 960,
  height: 620,
};

export const CENTRAL_DESK: ScenePosition = {
  x: 480,
  y: 300,
};

export const HOME_POSITIONS: Record<AgentId, ScenePosition> = {
  luma: { x: 480, y: 300 },
  orion: { x: 230, y: 165 },
  neria: { x: 280, y: 455 },
  quill: { x: 690, y: 455 },
  argus: { x: 735, y: 175 },
};
```

- [ ] **Step 2: Create Pixi agent sprite helper**

Create `src/world/AgentSprite.ts`:

```ts
import { Container, Graphics, Text } from "pixi.js";
import type { AgentRuntimeState } from "../events/types";

export function createAgentSprite(agent: AgentRuntimeState): Container {
  const container = new Container();
  const ring = new Graphics()
    .circle(0, 0, 28)
    .fill({ color: agent.definition.color })
    .stroke({ color: 0xf7ead0, width: 2, alpha: 0.8 });
  const label = new Text({
    text: agent.definition.displayName.slice(0, 2),
    style: {
      fill: "#13201d",
      fontSize: 14,
      fontWeight: "700",
    },
  });
  label.anchor.set(0.5);
  container.addChild(ring, label);
  return container;
}
```

- [ ] **Step 3: Create PixiJS scene component**

Create `src/world/LanternwoodScene.tsx`:

```tsx
import { Application, extend, useApplication } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useEffect } from "react";
import { createAgentSprite } from "./AgentSprite";
import { HOME_POSITIONS, SCENE_SIZE } from "./sceneLayout";
import type { RunState } from "../events/types";

extend({ Container, Graphics, Text });

type LanternwoodSceneProps = {
  state: RunState;
};

function SceneContent({ state }: LanternwoodSceneProps) {
  const { app } = useApplication();

  useEffect(() => {
    const stage = app.stage;
    stage.removeChildren();

    const background = new Graphics()
      .roundRect(20, 20, SCENE_SIZE.width - 40, SCENE_SIZE.height - 40, 18)
      .fill({ color: 0x1f362f })
      .stroke({ color: 0xd8c781, width: 2, alpha: 0.45 });

    const desk = new Graphics()
      .ellipse(480, 310, 92, 48)
      .fill({ color: 0x6a5035 })
      .stroke({ color: 0xf2c66d, width: 2, alpha: 0.5 });

    stage.addChild(background, desk);

    for (const agent of Object.values(state.agents)) {
      const sprite = createAgentSprite(agent);
      const home = HOME_POSITIONS[agent.definition.id];
      sprite.x = home.x;
      sprite.y = home.y;
      sprite.alpha = agent.status === "idle" ? 0.72 : 1;
      stage.addChild(sprite);
    }
  }, [app, state]);

  return null;
}

export function LanternwoodScene({ state }: LanternwoodSceneProps) {
  return (
    <Application
      antialias
      autoDensity
      backgroundAlpha={0}
      className="lanternwood-canvas"
      height={SCENE_SIZE.height}
      resolution={window.devicePixelRatio || 1}
      width={SCENE_SIZE.width}
    >
      <SceneContent state={state} />
    </Application>
  );
}
```

- [ ] **Step 4: Replace placeholder with Pixi scene**

Modify `src/ui/AppShell.tsx` by importing and rendering `LanternwoodScene`:

```tsx
import { useMemo, useState } from "react";
import { AGENTS } from "../agents/registry";
import { createInitialRunState, reduceAgentEvent } from "../events/reducer";
import type { RunState } from "../events/types";
import { mockRunAdapter } from "../harness/mockRunAdapter";
import { LanternwoodScene } from "../world/LanternwoodScene";
import { AgentStatusPanel } from "./AgentStatusPanel";
import { TaskInput } from "./TaskInput";
import { Timeline } from "./Timeline";

export function AppShell() {
  const initialState = useMemo(() => createInitialRunState(AGENTS), []);
  const [runState, setRunState] = useState<RunState>(initialState);
  const [isRunning, setIsRunning] = useState(false);

  async function startMockRun(prompt: string) {
    setRunState(createInitialRunState(AGENTS));
    setIsRunning(true);

    for await (const event of mockRunAdapter.startRun(prompt)) {
      setRunState((current) => reduceAgentEvent(current, event));
    }

    setIsRunning(false);
  }

  return (
    <main className="dashboard">
      <section className="library-stage">
        <div className="scene-frame">
          <LanternwoodScene state={runState} />
        </div>
        <TaskInput disabled={isRunning} onSubmit={startMockRun} />
      </section>
      <aside className="side-panel">
        <header>
          <p className="eyebrow">The Lanternwood Athenaeum</p>
          <h1>Living Library Dashboard</h1>
        </header>
        <section className="panel-section">
          <h2>Current Task</h2>
          <p>{runState.currentTask?.prompt ?? "No active task"}</p>
        </section>
        <AgentStatusPanel state={runState} />
        <Timeline events={runState.timeline} />
      </aside>
    </main>
  );
}
```

- [ ] **Step 5: Update scene styles**

In `src/styles.css`, replace `.stage-placeholder` with:

```css
.scene-frame {
  display: grid;
  place-items: center;
  min-height: 520px;
  overflow: hidden;
  border: 1px solid rgba(230, 205, 145, 0.25);
  border-radius: 8px;
  background: rgba(18, 30, 34, 0.7);
}

.lanternwood-canvas {
  width: min(100%, 960px);
  height: auto;
}
```

- [ ] **Step 6: Run focused verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all commands pass.

- [ ] **Step 7: Commit Pixi scene**

Run:

```bash
git add src/world src/ui/AppShell.tsx src/styles.css
git commit -m "feat: render Lanternwood Pixi scene"
```

## Task 6: Repo-Local Harness Docs

**Files:**
- Create: `AGENTS.md`
- Create: `.agents/docs/architecture.md`
- Create: `.agents/docs/github-workflow.md`
- Create: `.agents/docs/harness-engineering.md`
- Create: `.agents/docs/adr/README.md`
- Create: `docs/plan/README.md`
- Create: `docs/plan/2026-05-25-lanternwood-mvp.md`

- [ ] **Step 1: Create AGENTS.md**

Create `AGENTS.md`:

```md
# Repository Instructions

## Project Harness

- For file-changing work, read `.agents/docs/harness-engineering.md` before implementation.
- Create or update a plan under `docs/plan/` before target edits.
- Keep the main agent as orchestrator. Use bounded worker personas for non-atomic work.
- Run focused verification before review.
- Run `$subagent-review-loop` after verification when available. Do not claim it ran if unavailable.

## Project Structure

- `src/agents/`: role and persona definitions.
- `src/events/`: event contracts and reducers.
- `src/harness/`: mock and future real agent adapters.
- `src/ui/`: React dashboard panels.
- `src/world/`: PixiJS living library scene.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`

Do not commit secrets, `.env` files, API keys, or live OpenAI credentials.
```

- [ ] **Step 2: Create architecture docs**

Create `.agents/docs/architecture.md`:

```md
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
- Future Codex CLI work must implement the same `RunAdapter` interface.
- Side-effecting tools must require explicit approval before execution.
```

Create `.agents/docs/adr/README.md`:

```md
# ADRs

Accepted architecture decisions will live here.

Current baseline:

- Use mock `RunAdapter` first.
- Keep PixiJS as a rendering projection of event-derived state.
- Add live Codex CLI integration only after the mock event contract is stable.
```

- [ ] **Step 3: Create harness and workflow docs**

Create `.agents/docs/harness-engineering.md`:

```md
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
```

## Safety

- Do not commit secrets or `.env` files.
- Do not add API-key-backed OpenAI integrations without explicit approval.
- Do not add side-effecting external tools without an approval gate.
```

Create `.agents/docs/github-workflow.md`:

```md
# GitHub Workflow

- Work from a feature branch when remote repository setup exists.
- Preserve unrelated user changes.
- Stage only files relevant to the task.
- Run verification before review and delivery.
- Commit with a concise message that describes the behavior change.
```

Create `docs/plan/README.md`:

```md
# Plan Documents

Each file-changing task should create or update a plan document here before target edits.

Required sections:

- Scope
- Non-goals
- Expected files
- Worker personas when relevant
- Verification plan
- Progress log
```

Create `docs/plan/2026-05-25-lanternwood-mvp.md`:

```md
# Lanternwood MVP Plan

## Scope

Build the first runnable PixiJS-powered Living Library Dashboard using mock events.

## Non-Goals

- No API-key-backed OpenAI integration.
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
```

- [ ] **Step 4: Verify docs**

Run:

```bash
rg --files AGENTS.md .agents docs/plan docs/superpowers
git diff --check
```

Expected: files are listed and whitespace check passes.

- [ ] **Step 5: Commit harness docs**

Run:

```bash
git add AGENTS.md .agents docs/plan
git commit -m "docs: add Lanternwood harness workflow"
```

## Task 7: Full Verification And Browser QA

**Files:**
- Modify only if verification reveals defects.

- [ ] **Step 1: Run full static and unit verification**

Run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Expected: all commands pass.

- [ ] **Step 2: Start local dev server**

Run:

```bash
npm run dev
```

Expected: Vite prints a localhost URL.

- [ ] **Step 3: Browser verification**

Open the dev server URL and verify:

- The central PixiJS scene is visible and nonblank.
- Five agents are visible.
- The right panel lists five agents.
- Submitting the default task populates the timeline.
- No text overlaps on desktop width.

- [ ] **Step 4: Stop dev server**

Terminate the running Vite process after browser verification.

- [ ] **Step 5: Final commit if verification fixes were needed**

If Step 1 or Step 3 required fixes, run:

```bash
git add src AGENTS.md .agents docs package.json package-lock.json index.html vite.config.ts vitest.config.ts tsconfig.json tsconfig.node.json eslint.config.js
git commit -m "fix: polish Lanternwood MVP verification"
```

## Task 8: Final Review And Delivery

**Files:**
- No target files unless review finds issues.

- [ ] **Step 1: Run final verification before review**

Run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Expected: all commands pass.

- [ ] **Step 2: Run subagent review loop**

Invoke `$subagent-review-loop` with five fresh reviewer subagents. Review lenses:

- React state/event contract.
- PixiJS rendering boundary.
- TypeScript strictness.
- Test coverage and deterministic mocks.
- Harness docs and safety boundaries.

Expected: newest review pass has no actionable findings.

- [ ] **Step 3: Fix actionable findings**

If review finds issues:

1. Update `docs/plan/2026-05-25-lanternwood-mvp.md` progress log.
2. Route the finding to the responsible worker persona.
3. Implement the fix.
4. Rerun affected verification.
5. Repeat Step 2 with five fresh reviewers.

- [ ] **Step 4: Final status**

Run:

```bash
git status --short --branch
```

Expected: clean worktree after commits, or only intentionally untracked local files such as `.superpowers/`.

## Self-Review Notes

- Spec coverage: scaffold, PixiJS scene, agent registry, mock event stream, dashboard panels, harness docs, and verification are all mapped to tasks.
- Placeholder scan: this plan contains no incomplete-work markers.
- Type consistency: `AgentId`, `AgentEvent`, `RunAdapter`, `RunState`, and component names are defined before use.
