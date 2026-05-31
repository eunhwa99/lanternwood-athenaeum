import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import { taskLabelFor } from "../events/taskLabels";
import type { AgentEvent, RunState } from "../events/types";

function agentDisplayName(agentId: AgentId) {
  return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
}

function taskPromptFor(tasks: RunState["tasks"], event: AgentEvent) {
  return tasks.find((task) => task.taskId === event.taskId)?.prompt ?? event.message;
}

function taskSummary(prompt: string, maxLength = 68) {
  const text = prompt.trim().replace(/\s+/g, " ");

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function bubbleTextFromEvent(event: AgentEvent, tasks: RunState["tasks"]) {
  const taskLabel = taskLabelFor(tasks, event.taskId);
  const prompt = taskSummary(taskPromptFor(tasks, event));

  if (event.type === "agent.prompted" && event.payload) {
    return `[${taskLabel}] ${agentDisplayName(event.payload.recipientAgentId)} task: ${prompt}`;
  }

  if (event.type === "agent.reporting") {
    return `[${taskLabel}] ${agentDisplayName(event.agentId)} answered: ${prompt}`;
  }

  return undefined;
}
