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
