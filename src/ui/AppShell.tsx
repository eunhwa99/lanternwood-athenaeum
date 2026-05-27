import { useMemo, useRef, useState, type CSSProperties } from "react";
import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import { createInitialRunState, reduceAgentEvent } from "../events/reducer";
import type { AgentEvent, AgentStatus, PreviousRunContext, RunState } from "../events/types";
import { createCodexRunAdapter } from "../harness/codexRunAdapter";
import { createMockRunAdapter } from "../harness/mockRunAdapter";
import type { RunAdapter } from "../harness/runAdapter";
import { createTaskId } from "../harness/taskIds";
import { LanternwoodScene } from "../world/LanternwoodScene";
import { LiveRunInspector } from "./LiveRunInspector";
import { RunDetailDrawer } from "./RunDetailDrawer";
import { TaskInput } from "./TaskInput";
import type { RunDetailsTab } from "./runDetails";

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

function createDefaultRunAdapter() {
  if (import.meta.env.VITE_RUN_ADAPTER === "codex") {
    return createCodexRunAdapter();
  }

  return visibleMockRunAdapter;
}

type AppShellProps = {
  runAdapter?: RunAdapter;
  runMode?: "codex" | "mock";
};

const defaultRunAdapter = createDefaultRunAdapter();
const defaultRunMode = import.meta.env.VITE_RUN_ADAPTER === "codex" ? "codex" : "mock";

function createClientEvent(
  taskId: string,
  index: number,
  agentId: AgentId,
  type: AgentEvent["type"],
  message: string,
  payload?: AgentEvent["payload"],
): AgentEvent {
  return {
    agentId,
    eventId: `${taskId}-client-${index}`,
    message,
    payload,
    taskId,
    timestamp: new Date().toISOString(),
    type,
  } as AgentEvent;
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Run adapter failed";
}

function isUnfinishedActiveStatus(status: AgentStatus) {
  return !["done", "failed", "idle", "reporting"].includes(status);
}

function clientDiagnostics(runMode: "codex" | "mock") {
  if (runMode === "mock") {
    return undefined;
  }

  return {
    backend: "unavailable",
    cliCommand: "codex exec",
    codexStatus: "failed",
    model: "Codex CLI backend unavailable (model unresolved)",
    runMode: "codex",
  };
}

function clientFailureDiagnostics(runMode: "codex" | "mock", hasServerDiagnostics: boolean) {
  if (runMode === "mock") {
    return undefined;
  }

  return hasServerDiagnostics ? { codexStatus: "failed" } : clientDiagnostics(runMode);
}

function agentDisplayName(agentId: AgentId) {
  return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
}

function createPreviousRunContext(events: AgentEvent[], finalOutput: string): PreviousRunContext | null {
  const taskCreated = events.find((event) => event.type === "task.created");

  if (!taskCreated) {
    return null;
  }

  const delegatedAgents = Array.from(
    new Set(
      events
        .filter((event) => event.agentId !== "luma" && (event.type === "agent.reporting" || event.type === "agent.done"))
        .map((event) => agentDisplayName(event.agentId)),
    ),
  );

  return {
    delegatedAgents,
    finalOutput,
    prompt: taskCreated.message,
    taskId: taskCreated.taskId,
    timeline: events.slice(-12).map((event) => event.message),
  };
}

function failUnfinishedSpecialists(state: RunState, taskId: string, reason: string): RunState {
  return AGENTS.filter((agent) => agent.id !== "luma" && isUnfinishedActiveStatus(state.agents[agent.id].status)).reduce(
    (current, agent) =>
      reduceAgentEvent(
        current,
        createClientEvent(taskId, current.timeline.length + 1, agent.id, "agent.failed", reason),
      ),
    state,
  );
}

export function AppShell({ runAdapter = defaultRunAdapter, runMode = defaultRunMode }: AppShellProps) {
  const initialState = useMemo(() => createInitialRunState(AGENTS), []);
  const [runState, setRunState] = useState<RunState>(initialState);
  const [runEpoch, setRunEpoch] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [drawer, setDrawer] = useState<{ agentId?: AgentId; isOpen: boolean; tab: RunDetailsTab }>({
    isOpen: false,
    tab: "final",
  });
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef<symbol | null>(null);
  const previousRunRef = useRef<PreviousRunContext | null>(null);

  async function startRun(prompt: string) {
    const runToken = Symbol("run");
    activeRunRef.current = runToken;
    setRunState(createInitialRunState(AGENTS));
    setRunEpoch((current) => current + 1);
    setIsRunning(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let taskId = createTaskId(prompt);
    let sawTaskCreated = false;
    const runEvents: AgentEvent[] = [];
    let finalOutput: string | null = null;

    try {
      for await (const event of runAdapter.startRun(prompt, {
        previousRun: previousRunRef.current ?? undefined,
        signal: abortController.signal,
      })) {
        if (activeRunRef.current !== runToken) {
          return;
        }

        if (event.type === "task.created") {
          taskId = event.taskId;
          sawTaskCreated = true;
        }

        runEvents.push(event);
        if (event.type === "agent.done" && event.agentId === "luma" && typeof event.payload?.finalOutput === "string") {
          finalOutput = event.payload.finalOutput;
        }
        setRunState((current) => {
          const next = reduceAgentEvent(current, event);

          if (event.agentId === "luma" && event.type === "agent.failed") {
            return failUnfinishedSpecialists(next, event.taskId, "Route closed after Luma reported a run failure");
          }

          return next;
        });
      }

      if (abortController.signal.aborted) {
        throw new Error("Run aborted");
      }

      if (finalOutput) {
        previousRunRef.current = createPreviousRunContext(runEvents, finalOutput);
      }
    } catch (error) {
      if (activeRunRef.current !== runToken) {
        return;
      }

      setRunState((current) => {
        const withTask = sawTaskCreated
          ? current
          : reduceAgentEvent(
              current,
              createClientEvent(taskId, current.timeline.length + 1, "luma", "task.created", prompt, clientDiagnostics(runMode)),
            );
        const failedSpecialists = failUnfinishedSpecialists(withTask, taskId, "Route closed after the stream failed");

        return reduceAgentEvent(
          failedSpecialists,
          createClientEvent(
            taskId,
            failedSpecialists.timeline.length + 1,
            "luma",
            "agent.failed",
            messageFromError(error),
            clientFailureDiagnostics(runMode, sawTaskCreated),
          ),
        );
      });
    } finally {
      if (activeRunRef.current === runToken) {
        activeRunRef.current = null;
      }
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      if (activeRunRef.current === null) {
        setIsRunning(false);
      }
    }
  }

  function stopRun() {
    abortControllerRef.current?.abort();
  }

  return (
    <main className="dashboard">
      <section className="library-stage">
        <header className="dashboard-top">
          <div>
            <p className="eyebrow">The Lanternwood Athenaeum</p>
            <h1>Living Library Dashboard</h1>
          </div>
          <div className="task-summary">
            <span>Current task</span>
            <p>{runState.currentTask?.prompt ?? "No active task"}</p>
          </div>
          <div className="agents-summary" aria-label="Agents summary">
            {AGENTS.map((agent) => (
              <span key={agent.id} style={{ "--agent-color": agent.color } as CSSProperties}>
                {agent.displayName}: {runState.agents[agent.id].status}
              </span>
            ))}
          </div>
        </header>
        <div className="scene-frame">
          <LanternwoodScene runEpoch={runEpoch} state={runState} />
          {runState.finalOutput ? (
            <div className="scene-output-action">
              <button onClick={() => setDrawer({ isOpen: true, tab: "final" })} type="button">
                Open full final output
              </button>
            </div>
          ) : null}
        </div>
        <TaskInput disabled={isRunning} isRunning={isRunning} onStop={stopRun} onSubmit={startRun} />
        <LiveRunInspector
          onOpenDetails={(tab, agentId) => setDrawer({ agentId, isOpen: true, tab })}
          runMode={runMode}
          state={runState}
        />
      </section>
      {drawer.isOpen ? (
        <RunDetailDrawer
          initialTab={drawer.tab}
          isOpen
          key={`${drawer.tab}-${drawer.agentId ?? "all"}`}
          onClose={() => setDrawer((current) => ({ ...current, isOpen: false }))}
          runMode={runMode}
          selectedAgentId={drawer.agentId}
          state={runState}
        />
      ) : null}
    </main>
  );
}
