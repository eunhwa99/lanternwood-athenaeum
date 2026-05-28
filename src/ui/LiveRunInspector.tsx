import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import type { RunState } from "../events/types";
import { previewText, type RunDetailsTab } from "./runDetails";

type LiveRunInspectorProps = {
  onOpenDetails?: (tab: RunDetailsTab, agentId?: AgentId) => void;
  runMode?: "codex" | "mock";
  state: RunState;
};

function latestAgentOutput(state: RunState, agentId: AgentId): string | null {
  if (state.agents[agentId].status === "failed") {
    return previewText(state.agents[agentId].lastMessage);
  }

  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const event = state.timeline[index];

    if (event.agentId !== agentId) {
      continue;
    }

    const payload = event.payload as Record<string, unknown> | undefined;
    const report = payload?.report;
    if (typeof report === "string" && report.trim()) {
      return previewText(report);
    }

    const progress = payload?.progress;
    if (typeof progress === "string" && progress.trim()) {
      return previewText(progress);
    }
  }

  return null;
}

function globalCodexStatus(state: RunState, runMode: "codex" | "mock") {
  if (runMode === "mock") {
    return state.currentTask ? state.agents.luma.status : "idle";
  }

  if (state.agents.luma.status === "failed") {
    return "failed";
  }

  if (state.agents.luma.status === "done") {
    return "completed";
  }

  return state.currentTask ? "running" : "idle";
}

function latestDiagnostics(state: RunState) {
  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const payload = state.timeline[index].payload as Record<string, unknown> | undefined;

    if (payload?.backend || payload?.cliCommand || payload?.model) {
      return {
        backend: typeof payload.backend === "string" ? payload.backend : "unknown",
        cliCommand: typeof payload.cliCommand === "string" ? payload.cliCommand : "codex exec",
        model: typeof payload.model === "string" ? payload.model : "unresolved",
      };
    }
  }

  return null;
}

function agentDisplayName(agentId: AgentId) {
  return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
}

function latestRouteEvent(state: RunState) {
  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const event = state.timeline[index];

    if (event.type === "route.planned") {
      return event;
    }
  }

  return undefined;
}

export function LiveRunInspector({ onOpenDetails, runMode = "mock", state }: LiveRunInspectorProps) {
  const diagnostics = latestDiagnostics(state);
  const permissionReviews = state.timeline.filter((event) => event.type === "permission.reviewed");
  const latestRoute = latestRouteEvent(state);
  const traceStatus = state.agents.luma.status === "done" || state.agents.luma.status === "failed" ? state.agents.luma.status : state.currentTask ? "running trace" : "idle";

  return (
    <section className="live-run-inspector" aria-label="Live run inspector" aria-live="polite">
      <header className="inspector-header">
        <h2>Live Run Inspector</h2>
        <span>{traceStatus}</span>
      </header>
      <dl className="run-diagnostics">
        <div>
          <dt>Mode</dt>
          <dd>{runMode}</dd>
        </div>
        <div>
          <dt>Codex</dt>
          <dd>{globalCodexStatus(state, runMode)}</dd>
        </div>
        <div>
          <dt>Events</dt>
          <dd>{state.timeline.length}</dd>
        </div>
        {diagnostics ? (
          <>
            <div>
              <dt>Backend</dt>
              <dd>{diagnostics.backend}</dd>
            </div>
            <div>
              <dt>CLI</dt>
              <dd>{diagnostics.cliCommand}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{diagnostics.model}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {latestRoute?.payload ? (
        <section className="routing-panel" aria-label="Routing decision">
          <h3>Routing Decision</h3>
          <p>Luma selected: {latestRoute.payload.selectedAgentIds.map(agentDisplayName).join(", ") || "None"}</p>
          <p>Skipped: {latestRoute.payload.skippedAgentIds.map(agentDisplayName).join(", ") || "None"}</p>
          <p>Confidence: {latestRoute.payload.confidence}</p>
          <p>Reason: {latestRoute.payload.rationale}</p>
        </section>
      ) : null}

      {permissionReviews.length > 0 ? (
        <section className="permission-panel" aria-label="Coordinator permissions">
          <h3>Coordinator Permissions</h3>
          {permissionReviews.map((event) => (
            <p key={event.eventId}>
              {event.payload.decision}: {event.payload.action}
            </p>
          ))}
        </section>
      ) : null}

      <div className="agent-output-grid">
        {AGENTS.map((agent) => {
          const output =
            agent.id === "luma"
              ? previewText(state.finalOutput) || latestAgentOutput(state, agent.id) || previewText(state.agents[agent.id].lastMessage)
              : latestAgentOutput(state, agent.id) || previewText(state.agents[agent.id].lastMessage);

          return (
            <article className="agent-output-card" key={agent.id}>
              <div className="agent-output-card-header">
                <h3>{agent.displayName}</h3>
                <span>{state.agents[agent.id].status}</span>
              </div>
              <p>{output}</p>
              <button onClick={() => onOpenDetails?.(agent.id === "luma" ? "final" : "reports", agent.id)} type="button">
                View {agent.displayName} details
              </button>
            </article>
          );
        })}
      </div>

      <div className="inspector-actions">
        <button onClick={() => onOpenDetails?.("raw")} type="button">
          Open raw Codex details
        </button>
        <button onClick={() => onOpenDetails?.("log")} type="button">
          Open run log
        </button>
      </div>
    </section>
  );
}
