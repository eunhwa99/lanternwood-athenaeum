import { AGENTS } from "../agents/registry";
import type { AgentEvent, TaskRecord } from "../events/types";
import { taskLabelFor } from "../events/taskLabels";

function agentDisplayName(agentId: AgentEvent["agentId"]) {
  return (
    AGENTS.find((agent) => agent.id === agentId)?.displayName ??
    agentId
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
      .join(" ")
  );
}

function stringPayload(event: AgentEvent, key: string): string | undefined {
  const payload = event.payload as Record<string, unknown> | undefined;
  const value = payload?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function taskPromptFor(tasks: TaskRecord[], taskId: string) {
  return tasks.find((task) => task.taskId === taskId)?.prompt.trim();
}

export function bubbleTextFromEvent(event: AgentEvent, tasks: TaskRecord[]) {
  const taskLabel = taskLabelFor(tasks, event.taskId);

  if (event.type === "agent.prompted" && event.payload) {
    const prompt = taskPromptFor(tasks, event.taskId) ?? stringPayload(event, "promptExcerpt") ?? stringPayload(event, "speechBubble");
    const recipientName = agentDisplayName(event.payload.recipientAgentId);

    return prompt ? `[${taskLabel}] ${recipientName} task: ${prompt}` : undefined;
  }

  if (event.type === "agent.reporting") {
    const report = stringPayload(event, "speechBubble") ?? stringPayload(event, "reportExcerpt") ?? stringPayload(event, "report");

    return report ? `[${taskLabel}] ${agentDisplayName(event.agentId)} answered: ${report}` : undefined;
  }

  return undefined;
}
