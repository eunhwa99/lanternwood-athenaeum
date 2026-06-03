import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import type { RunState } from "../events/types";
import { isSandboxMode, type SandboxMode } from "../harness/permissions";

export type PermissionRequestView = {
  approvalToken?: string;
  agentId: AgentId;
  agentName: string;
  blockedAction?: string;
  prompt: string;
  reason: string;
  requestedSandbox: SandboxMode;
  taskId: string;
  workspacePath?: string;
};

function agentDisplayName(agentId: AgentId) {
  return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
}

function payloadString(event: RunState["timeline"][number], key: string) {
  const value = event.payload?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function latestPermissionRequest(state: RunState): PermissionRequestView | null {
  const taskCompleteByManager = new Set<string>();
  const resolvedByAgent = new Set<string>();

  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const event = state.timeline[index];
    const eventAgentKey = `${event.taskId}\u0000${event.agentId}`;

    if (event.type !== "approval.requested") {
      if (event.type === "agent.paused" || event.type === "permission.reviewed") {
        continue;
      }

      if (event.agentId === "luma" && ["agent.done", "agent.failed"].includes(event.type)) {
        taskCompleteByManager.add(event.taskId);
      }

      resolvedByAgent.add(eventAgentKey);
      continue;
    }

    if (taskCompleteByManager.has(event.taskId) || resolvedByAgent.has(eventAgentKey)) {
      continue;
    }

    const requestedSandbox = event.payload?.requestedSandbox;
    const task = state.tasks.find((candidate) => candidate.taskId === event.taskId);
    const prompt = task?.prompt ?? state.currentTask?.prompt;

    if (task && ["done", "failed"].includes(task.status)) {
      continue;
    }

    if (!isSandboxMode(requestedSandbox) || !prompt) {
      return null;
    }

    return {
      approvalToken: payloadString(event, "approvalToken"),
      agentId: event.agentId,
      agentName: agentDisplayName(event.agentId),
      blockedAction: payloadString(event, "blockedAction"),
      prompt,
      reason: payloadString(event, "reason") ?? event.message,
      requestedSandbox,
      taskId: event.taskId,
      workspacePath: task?.workspacePath,
    };
  }

  return null;
}
