import { useState } from "react";
import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import { taskLabelFor } from "../events/taskLabels";
import type { AgentJob, AgentStatus, RunState } from "../events/types";
import { previewText, type RunDetailsTab } from "./runDetails";

type LiveRunInspectorProps = {
  onOpenDetails?: (tab: RunDetailsTab, agentId?: AgentId) => void;
  runMode?: "codex" | "mock";
  state: RunState;
};

type AgentRosterGroupKey = "active" | "review" | "done" | "idle";
type AgentOutputPreview = {
  taskLabel?: string;
  text: string;
};

const QUEUED_JOB_PREVIEW_LIMIT = 2;

const AGENT_ROSTER_GROUPS: {
  defaultOpen: boolean;
  key: AgentRosterGroupKey;
  label: string;
}[] = [
  { defaultOpen: true, key: "active", label: "Active" },
  { defaultOpen: true, key: "review", label: "Needs review" },
  { defaultOpen: false, key: "done", label: "Done" },
  { defaultOpen: false, key: "idle", label: "Idle" },
];

function rosterGroupForStatus(status: AgentStatus, hasPendingJobs: boolean): AgentRosterGroupKey {
  if (hasPendingJobs && status !== "failed") {
    return "active";
  }

  if (status === "idle") {
    return "idle";
  }

  if (status === "done") {
    return "done";
  }

  if (status === "waitingApproval" || status === "failed") {
    return "review";
  }

  return "active";
}

function latestAgentOutput(state: RunState, agentId: AgentId): AgentOutputPreview | null {
  if (state.agents[agentId].status === "failed") {
    return { text: previewText(state.agents[agentId].lastMessage) };
  }

  if (agentId === "luma") {
    for (let index = state.tasks.length - 1; index >= 0; index -= 1) {
      const task = state.tasks[index];
      const finalOutput = state.finalOutputs[task.taskId] ?? task.finalOutput;

      if (finalOutput) {
        return { taskLabel: taskLabelFor(state.tasks, task.taskId), text: previewText(finalOutput) };
      }
    }
  }

  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const event = state.timeline[index];

    if (event.agentId !== agentId) {
      continue;
    }

    const payload = event.payload as Record<string, unknown> | undefined;
    const report = payload?.report;
    if (typeof report === "string" && report.trim()) {
      return { taskLabel: taskLabelFor(state.tasks, event.taskId), text: previewText(report) };
    }

    const progress = payload?.progress;
    if (typeof progress === "string" && progress.trim()) {
      return { taskLabel: taskLabelFor(state.tasks, event.taskId), text: previewText(progress) };
    }
  }

  return null;
}

function outputPreview(value: string | AgentOutputPreview | null) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return (
    <>
      {value.taskLabel ? <span className="task-badge task-badge-small">{value.taskLabel}</span> : null}
      <span>{value.text}</span>
    </>
  );
}

function AgentWorkload({
  agentId,
  currentJob,
  queuedJobs,
  state,
}: {
  agentId: AgentId;
  currentJob?: AgentJob;
  queuedJobs: AgentJob[];
  state: RunState;
}) {
  if (!currentJob && queuedJobs.length === 0) {
    return null;
  }

  const agentName = AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
  const visibleQueuedJobs = queuedJobs.slice(0, QUEUED_JOB_PREVIEW_LIMIT);
  const hiddenQueuedJobCount = queuedJobs.length - visibleQueuedJobs.length;

  return (
    <section aria-label={`${agentName} workload`} className="agent-roster-workload-panel">
      {currentJob ? (
        <div className="agent-workload-row">
          <span className="agent-workload-label">Now</span>
          <span className="task-badge task-badge-small">{taskLabelFor(state.tasks, currentJob.taskId)}</span>
          <span className="agent-roster-workload-text">{previewText(currentJob.prompt, 96)}</span>
        </div>
      ) : null}
      {queuedJobs.length > 0 ? (
        <div className="agent-workload-queue">
          <span className="agent-workload-label">Queue</span>
          <span className="agent-workload-more">
            {queuedJobs.length} queued
            {visibleQueuedJobs[0] ? ` · next ${taskLabelFor(state.tasks, visibleQueuedJobs[0].taskId)}` : ""}
            {hiddenQueuedJobCount > 0 ? ` · +${hiddenQueuedJobCount} more` : ""}
          </span>
        </div>
      ) : null}
    </section>
  );
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

export function LiveRunInspector({ onOpenDetails, runMode = "mock", state }: LiveRunInspectorProps) {
  const [openRosterGroups, setOpenRosterGroups] = useState<Record<AgentRosterGroupKey, boolean>>(() =>
    Object.fromEntries(AGENT_ROSTER_GROUPS.map((group) => [group.key, group.defaultOpen])) as Record<AgentRosterGroupKey, boolean>,
  );
  const diagnostics = latestDiagnostics(state);
  const permissionReviews = state.timeline.filter((event) => event.type === "permission.reviewed");
  const traceStatus = state.agents.luma.status === "done" || state.agents.luma.status === "failed" ? state.agents.luma.status : state.currentTask ? "running trace" : "idle";
  const groupedAgents = AGENT_ROSTER_GROUPS.map((group) => ({
    ...group,
    agents: AGENTS.filter((agent) => {
      const pendingJobs = state.agentQueues[agent.id].some((job) => job.status === "queued" || job.status === "running");

      return rosterGroupForStatus(state.agents[agent.id].status, pendingJobs) === group.key;
    }),
  }));

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

      <section className="agent-roster" aria-label="Agent roster">
        {groupedAgents.map((group) => (
          <section aria-label={`${group.label} agents`} className="agent-roster-group" key={group.key}>
            <details open={openRosterGroups[group.key]}>
              <summary
                className="agent-roster-summary"
                onClick={(event) => {
                  event.preventDefault();
                  setOpenRosterGroups((current) => ({ ...current, [group.key]: !current[group.key] }));
                }}
              >
                <span>{group.label}</span>
                <span>{group.agents.length}</span>
              </summary>
              <ul className="agent-roster-list">
                {group.agents.map((agent) => {
                  const agentJobs = state.agentQueues[agent.id];
                  const currentJob = state.agents[agent.id].currentJobId
                    ? agentJobs.find((job) => job.jobId === state.agents[agent.id].currentJobId)
                    : agentJobs.find((job) => job.status === "running");
                  const queuedJobs = agentJobs.filter((job) => job.status === "queued");
                  const output =
                    agent.id === "luma"
                      ? latestAgentOutput(state, agent.id) || previewText(state.agents[agent.id].lastMessage)
                      : latestAgentOutput(state, agent.id) || previewText(state.agents[agent.id].lastMessage);
                  const previewHasTaskBadge = typeof output !== "string" && Boolean(output?.taskLabel);

                  return (
                    <li className="agent-roster-row" key={agent.id}>
                      <div className="agent-roster-heading">
                        <h3>{agent.displayName}</h3>
                        <span className="agent-roster-status">{state.agents[agent.id].status}</span>
                      </div>
                      <p className={`agent-roster-preview${previewHasTaskBadge ? " agent-roster-preview-with-badge" : ""}`}>
                        {outputPreview(output)}
                      </p>
                      <AgentWorkload agentId={agent.id} currentJob={currentJob} queuedJobs={queuedJobs} state={state} />
                      <button
                        aria-label={`View ${agent.displayName} details`}
                        onClick={() => onOpenDetails?.("reports", agent.id)}
                        type="button"
                      >
                        Details
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          </section>
        ))}
      </section>

      <div className="inspector-actions">
        <button onClick={() => onOpenDetails?.("log")} type="button">
          Open run log
        </button>
      </div>
    </section>
  );
}
