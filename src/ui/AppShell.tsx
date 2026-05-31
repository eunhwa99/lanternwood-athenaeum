import { useMemo, useState } from "react";
import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import { createInitialRunState, reduceAgentEvent } from "../events/reducer";
import type { AgentEvent, AgentStatus, RunState } from "../events/types";
import { createCodexRunAdapter } from "../harness/codexRunAdapter";
import { createMockApprovalRunAdapter, createMockRunAdapter } from "../harness/mockRunAdapter";
import { isSandboxMode, type SandboxMode } from "../harness/permissions";
import type { RunAdapter, RunRequestOptions } from "../harness/runAdapter";
import { LanternwoodScene } from "../world/LanternwoodScene";
import { AgentStatusPanel } from "./AgentStatusPanel";
import { FinalOutputPanel } from "./FinalOutputPanel";
import { LiveRunInspector } from "./LiveRunInspector";
import { TaskInput } from "./TaskInput";
import { Timeline } from "./Timeline";

declare global {
  interface Window {
    __LANTERNWOOD_APPROVAL_TEST_FLOW__?: boolean;
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

  if (typeof window !== "undefined" && window.__LANTERNWOOD_APPROVAL_TEST_FLOW__ === true) {
    return createMockApprovalRunAdapter({ eventDelayMs: getVisibleEventDelayMs() });
  }

  return visibleMockRunAdapter;
}

type AppShellProps = {
  runAdapter?: RunAdapter;
  runMode?: "codex" | "mock";
};

const defaultRunAdapter = createDefaultRunAdapter();
const defaultRunMode = import.meta.env.VITE_RUN_ADAPTER === "codex" ? "codex" : "mock";

function stableTaskId(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const encoded = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `task-${encoded || "empty"}`;
}

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
  };
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

type PermissionRequestView = {
  approvalToken?: string;
  agentName: string;
  blockedAction?: string;
  prompt: string;
  reason: string;
  requestedSandbox: SandboxMode;
};

function payloadString(event: AgentEvent, key: string) {
  const value = event.payload?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function latestPermissionRequest(state: RunState): PermissionRequestView | null {
  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const event = state.timeline[index];

    if (event.type !== "approval.requested") {
      continue;
    }

    const requestedSandbox = event.payload?.requestedSandbox;
    const prompt = state.currentTask?.prompt;

    if (!isSandboxMode(requestedSandbox) || !prompt) {
      return null;
    }

    return {
      approvalToken: payloadString(event, "approvalToken"),
      agentName: AGENTS.find((agent) => agent.id === event.agentId)?.displayName ?? event.agentId,
      blockedAction: payloadString(event, "blockedAction"),
      prompt,
      reason: payloadString(event, "reason") ?? event.message,
      requestedSandbox,
    };
  }

  return null;
}

function PermissionRequestPanel({
  disabled,
  onApprove,
  request,
}: {
  disabled: boolean;
  onApprove: (prompt: string, sandbox: SandboxMode, approvalToken?: string) => void;
  request: PermissionRequestView;
}) {
  return (
    <section className="permission-request-panel" aria-label="Permission request">
      <div>
        <h2>{request.agentName} requests {request.requestedSandbox}</h2>
        <p>{request.reason}</p>
        {request.blockedAction ? <p className="permission-blocked-action">{request.blockedAction}</p> : null}
      </div>
      <button disabled={disabled} onClick={() => onApprove(request.prompt, request.requestedSandbox, request.approvalToken)} type="button">
        Approve and retry
      </button>
    </section>
  );
}

export function AppShell({ runAdapter = defaultRunAdapter, runMode = defaultRunMode }: AppShellProps) {
  const initialState = useMemo(() => createInitialRunState(AGENTS), []);
  const [runState, setRunState] = useState<RunState>(initialState);
  const [isRunning, setIsRunning] = useState(false);
  const permissionRequest = latestPermissionRequest(runState);

  async function startRun(prompt: string, options?: RunRequestOptions) {
    setRunState(createInitialRunState(AGENTS));
    setIsRunning(true);

    let taskId = stableTaskId(prompt);
    let sawTaskCreated = false;

    try {
      for await (const event of runAdapter.startRun(prompt, options)) {
        if (event.type === "task.created") {
          taskId = event.taskId;
          sawTaskCreated = true;
        }

        setRunState((current) => reduceAgentEvent(current, event));
      }
    } catch (error) {
      setRunState((current) => {
        const withTask = sawTaskCreated
          ? current
          : reduceAgentEvent(
              current,
              createClientEvent(taskId, current.timeline.length + 1, "luma", "task.created", prompt, clientDiagnostics(runMode)),
            );
        const failedSpecialists = AGENTS.filter(
          (agent) => agent.id !== "luma" && isUnfinishedActiveStatus(withTask.agents[agent.id].status),
        ).reduce(
          (state, agent, offset) =>
            reduceAgentEvent(
              state,
              createClientEvent(
                taskId,
                withTask.timeline.length + offset + 1,
                agent.id,
                "agent.failed",
                `${agent.displayName}'s route closed after the stream failed`,
              ),
            ),
          withTask,
        );

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
      setIsRunning(false);
    }
  }

  return (
    <main className="dashboard">
      <section className="library-stage">
        <div className="scene-frame">
          <LanternwoodScene state={runState} />
        </div>
        <TaskInput disabled={isRunning} onSubmit={startRun} />
        {permissionRequest ? (
          <PermissionRequestPanel
            disabled={isRunning}
            onApprove={(prompt, sandbox, approvalToken) => void startRun(prompt, { approvalToken, sandbox })}
            request={permissionRequest}
          />
        ) : null}
        <LiveRunInspector runMode={runMode} state={runState} />
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
