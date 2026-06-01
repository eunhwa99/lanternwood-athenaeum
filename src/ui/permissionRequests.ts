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
  for (let index = state.timeline.length - 1; index >= 0; index -= 1) {
    const event = state.timeline[index];

    if (event.type !== "approval.requested") {
      continue;
    }

    const hasLaterRetryEvent = state.timeline.slice(index + 1).some((laterEvent) => {
      if (laterEvent.taskId !== event.taskId || ["agent.paused", "permission.reviewed"].includes(laterEvent.type)) {
        return false;
      }

      return (
        laterEvent.agentId === event.agentId ||
        (laterEvent.agentId === "luma" && (laterEvent.type === "agent.done" || laterEvent.type === "agent.failed"))
      );
    });

    if (hasLaterRetryEvent) {
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
