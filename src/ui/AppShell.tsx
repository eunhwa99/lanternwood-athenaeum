import { useMemo, useState } from "react";
import { AGENTS } from "../agents/registry";
import { createInitialRunState, reduceAgentEvent } from "../events/reducer";
import type { RunState } from "../events/types";
import { createMockRunAdapter } from "../harness/mockRunAdapter";
import type { RunAdapter } from "../harness/runAdapter";
import { LanternwoodScene } from "../world/LanternwoodScene";
import { AgentStatusPanel } from "./AgentStatusPanel";
import { FinalOutputPanel } from "./FinalOutputPanel";
import { TaskInput } from "./TaskInput";
import { Timeline } from "./Timeline";

declare global {
  interface Window {
    __LANTERNWOOD_EVENT_DELAY_MS__?: number;
  }
}

function getVisibleEventDelayMs() {
  if (typeof window !== "undefined" && Number.isFinite(window.__LANTERNWOOD_EVENT_DELAY_MS__)) {
    return window.__LANTERNWOOD_EVENT_DELAY_MS__;
  }

  return 800;
}

const visibleMockRunAdapter = createMockRunAdapter({ eventDelayMs: getVisibleEventDelayMs() });

type AppShellProps = {
  runAdapter?: RunAdapter;
};

export function AppShell({ runAdapter = visibleMockRunAdapter }: AppShellProps) {
  const initialState = useMemo(() => createInitialRunState(AGENTS), []);
  const [runState, setRunState] = useState<RunState>(initialState);
  const [isRunning, setIsRunning] = useState(false);

  async function startMockRun(prompt: string) {
    setRunState(createInitialRunState(AGENTS));
    setIsRunning(true);

    for await (const event of runAdapter.startRun(prompt)) {
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
        <FinalOutputPanel output={runState.finalOutput} />
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
