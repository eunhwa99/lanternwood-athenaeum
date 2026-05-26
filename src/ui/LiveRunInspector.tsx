import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import type { AgentEvent, RunState } from "../events/types";

type LiveRunInspectorProps = {
  runMode?: "codex" | "mock";
  state: RunState;
};

type RunDiagnostics = {
  backend?: string;
  cliCommand?: string;
  codexStatus?: string;
  model?: string;
  rawChunk?: string;
  rawResponse?: string;
  runMode?: string;
  stderrChunk?: string;
};

function stringPayload(event: AgentEvent, key: keyof RunDiagnostics): string | undefined {
  const value = event.payload?.[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function rawPayload(event: AgentEvent, key: "rawChunk" | "stderrChunk" | "rawResponse"): string | undefined {
  const value = event.payload?.[key];

  return typeof value === "string" ? value : undefined;
}

function agentDisplayName(agentId: AgentId) {
  return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
}

function collectDiagnostics(events: AgentEvent[], runMode: "codex" | "mock"): Required<RunDiagnostics> {
  const diagnostics: Required<RunDiagnostics> = {
    backend: runMode === "codex" ? "not connected" : "not connected",
    cliCommand: runMode === "codex" ? "codex exec" : "none",
    codexStatus: "idle",
    model: runMode === "codex" ? "awaiting Codex backend" : "mock",
    rawChunk: "",
    rawResponse: "",
    runMode,
    stderrChunk: "",
  };
  const rawParts: string[] = [];
  const finalRawResponses: string[] = [];

  for (const event of events) {
    diagnostics.backend = stringPayload(event, "backend") ?? diagnostics.backend;
    diagnostics.cliCommand = stringPayload(event, "cliCommand") ?? diagnostics.cliCommand;
    diagnostics.codexStatus = stringPayload(event, "codexStatus") ?? diagnostics.codexStatus;
    diagnostics.model = stringPayload(event, "model") ?? diagnostics.model;
    diagnostics.runMode = stringPayload(event, "runMode") ?? diagnostics.runMode;

    const rawChunk = rawPayload(event, "rawChunk");
    const stderrChunk = rawPayload(event, "stderrChunk");
    const explicitRawResponse = rawPayload(event, "rawResponse");

    if (rawChunk) {
      rawParts.push(rawChunk);
    }

    if (stderrChunk) {
      rawParts.push(stderrChunk);
    }

    if (explicitRawResponse) {
      finalRawResponses.push(`--- ${agentDisplayName(event.agentId)} final response ---\n${explicitRawResponse}`);
    }
  }

  diagnostics.rawResponse = [...(rawParts.length > 0 ? [rawParts.join("")] : []), ...finalRawResponses].join("\n");

  return diagnostics;
}

function globalCodexStatus(state: RunState, runMode: "codex" | "mock", fallback: string) {
  if (runMode === "mock") {
    return fallback;
  }

  if (state.agents.luma.status === "failed") {
    return "failed";
  }

  if (state.agents.luma.status === "done") {
    return "completed";
  }

  if (state.currentTask) {
    if (!state.timeline.some((event) => event.payload?.runMode === "codex" || event.payload?.cliCommand === "codex exec")) {
      return fallback;
    }

    return fallback === "completed" || fallback === "failed" ? "running" : fallback;
  }

  return fallback;
}

function latestAgentOutput(events: AgentEvent[], agentId: AgentId): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event.agentId !== agentId) {
      continue;
    }

    const report = event.payload?.report;
    if (typeof report === "string" && report.trim()) {
      return report;
    }

    const progress = event.payload?.progress;
    if (typeof progress === "string" && progress.trim()) {
      return progress;
    }
  }

  return null;
}

function agentRawResponse(events: AgentEvent[], agentId: AgentId): string {
  const rawParts: string[] = [];
  let finalRawResponse = "";

  for (const event of events) {
    if (event.agentId !== agentId) {
      continue;
    }

    const rawChunk = rawPayload(event, "rawChunk");
    const stderrChunk = rawPayload(event, "stderrChunk");
    const explicitRawResponse = rawPayload(event, "rawResponse");

    if (rawChunk) {
      rawParts.push(rawChunk);
    }

    if (stderrChunk) {
      rawParts.push(stderrChunk);
    }

    if (explicitRawResponse) {
      finalRawResponse = explicitRawResponse;
    }
  }

  if (rawParts.length > 0 && finalRawResponse) {
    return `${rawParts.join("")}\n--- Codex final response ---\n${finalRawResponse}`;
  }

  return finalRawResponse || rawParts.join("");
}

function pendingOutputText(state: RunState, agentId: AgentId) {
  const agentState = state.agents[agentId];

  if (agentState.status === "idle") {
    return "Awaiting output";
  }

  return `Live status: ${agentState.lastMessage}. Output appears after a verified report.`;
}

export function LiveRunInspector({ runMode = "mock", state }: LiveRunInspectorProps) {
  const diagnostics = collectDiagnostics(state.timeline, runMode);
  const effectiveRunMode = diagnostics.runMode === "codex" ? "codex" : runMode;
  const codexStatus = globalCodexStatus(state, effectiveRunMode, diagnostics.codexStatus);
  const lumaStatus = state.agents.luma.status;
  const traceStatus = lumaStatus === "done" || lumaStatus === "failed" ? lumaStatus : state.currentTask ? "running trace" : "idle";

  return (
    <section className="live-run-inspector" aria-label="Live run inspector" aria-live="polite">
      <header className="inspector-header">
        <h2>Live Run Inspector</h2>
        <span>{traceStatus}</span>
      </header>
      <dl className="run-diagnostics">
        <div>
          <dt>Mode</dt>
          <dd>{diagnostics.runMode}</dd>
        </div>
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
        <div>
          <dt>Codex</dt>
          <dd>{codexStatus}</dd>
        </div>
      </dl>

      <div className="agent-output-grid">
        {AGENTS.map((agent) => {
          const rawOutput = agentRawResponse(state.timeline, agent.id);
          const output =
            state.agents[agent.id].status === "failed"
              ? state.agents[agent.id].lastMessage
              : (agent.id === "luma" ? state.finalOutput ?? latestAgentOutput(state.timeline, agent.id) : latestAgentOutput(state.timeline, agent.id)) ??
                pendingOutputText(state, agent.id);

          return (
            <article className="agent-output-card" key={agent.id}>
              <h3>{agent.displayName}</h3>
              <span>{state.agents[agent.id].status}</span>
              <p>{output}</p>
              {rawOutput ? (
                <details className="agent-raw-response">
                  <summary>{agent.displayName} raw Codex</summary>
                  <pre>{rawOutput}</pre>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>

      <details className="raw-response" open={Boolean(diagnostics.rawResponse)}>
        <summary>Codex Raw Response</summary>
        <pre>{diagnostics.rawResponse || "No raw Codex response yet."}</pre>
      </details>
    </section>
  );
}
