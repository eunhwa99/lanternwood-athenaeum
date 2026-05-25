import type { AgentEvent } from "../events/types";
import type { RunAdapter } from "./runAdapter";

let taskCounter = 0;

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
    taskCounter += 1;
    const taskId = `task-${taskCounter}`;
    const events: AgentEvent[] = [
      event(taskId, 1, "luma", "task.created", input),
      event(taskId, 2, "luma", "agent.planning", "Luma is arranging the reading lamps"),
      event(taskId, 3, "luma", "agent.delegated", "Luma sends Orion and Neria into the stacks"),
      event(taskId, 4, "orion", "agent.working", "Orion studies the star maps for useful references"),
      event(taskId, 5, "orion", "agent.reporting", "Orion returns with a concise research brief"),
      event(taskId, 6, "neria", "agent.working", "Neria checks the archive for stable preferences"),
      event(taskId, 7, "neria", "agent.reporting", "Neria finds relevant memory notes"),
      event(taskId, 8, "argus", "agent.reviewing", "Argus checks the answer for risk and gaps"),
      event(taskId, 9, "luma", "agent.done", "Luma places the final summary on the central desk"),
    ];

    for (const item of events) {
      yield item;
    }
  },
};
