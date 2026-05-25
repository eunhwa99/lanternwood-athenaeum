import type { AgentEvent } from "../events/types";
import type { RunAdapter } from "./runAdapter";

function stableTaskId(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const encoded = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `task-${encoded || "empty"}`;
}

function event(
  taskId: string,
  index: number,
  agentId: AgentEvent["agentId"],
  type: AgentEvent["type"],
  message: string,
): AgentEvent {
  return {
    eventId: `${taskId}-evt-${index}`,
    taskId,
    agentId,
    type,
    message,
    timestamp: new Date(Date.UTC(2026, 4, 25, 0, 0, index)).toISOString(),
  };
}

export const mockRunAdapter: RunAdapter = {
  async *startRun(input: string) {
    const taskId = stableTaskId(input);
    const events: AgentEvent[] = [
      event(taskId, 1, "luma", "task.created", input),
      event(taskId, 2, "luma", "agent.planning", "Luma is arranging the reading lamps"),
      event(taskId, 3, "luma", "agent.delegated", "Luma sends Orion and Neria into the stacks"),
      event(taskId, 4, "orion", "agent.working", "Orion studies the star maps for useful references"),
      event(taskId, 5, "orion", "agent.reporting", "Orion returns with a concise research brief"),
      event(taskId, 6, "neria", "agent.working", "Neria checks the archive for stable preferences"),
      event(taskId, 7, "neria", "agent.reporting", "Neria finds relevant memory notes"),
      event(taskId, 8, "argus", "agent.reviewing", "Argus checks the answer for risk and gaps"),
      event(taskId, 9, "orion", "agent.done", "Orion returns to the star-map balcony"),
      event(taskId, 10, "neria", "agent.done", "Neria closes the archive ledger"),
      event(taskId, 11, "argus", "agent.done", "Argus lowers the review lantern"),
      event(taskId, 12, "luma", "agent.done", "Luma places the final summary on the central desk"),
    ];

    for (const item of events) {
      yield item;
    }
  },
};
