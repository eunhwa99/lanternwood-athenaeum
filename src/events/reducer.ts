import type { AgentDefinition, AgentId } from "../agents/types";
import type { AgentEvent, AgentStatus, RunState } from "./types";

const eventStatus: Partial<Record<AgentEvent["type"], AgentStatus>> = {
  "agent.planning": "planning",
  "agent.delegated": "planning",
  "agent.moving": "moving",
  "agent.working": "working",
  "agent.reporting": "reporting",
  "agent.reviewing": "reviewing",
  "agent.done": "done",
  "agent.failed": "failed",
  "approval.requested": "waitingApproval",
};

export function createInitialRunState(agents: AgentDefinition[]): RunState {
  return {
    currentTask: null,
    agents: Object.fromEntries(
      agents.map((agent) => [
        agent.id,
        {
          definition: agent,
          status: "idle",
          lastMessage: "Waiting in the stacks",
        },
      ]),
    ) as RunState["agents"],
    timeline: [],
  };
}

export function reduceAgentEvent(state: RunState, event: AgentEvent): RunState {
  const nextStatus = eventStatus[event.type] ?? state.agents[event.agentId].status;
  const currentTask =
    event.type === "task.created"
      ? { taskId: event.taskId, prompt: event.message }
      : state.currentTask;

  return {
    currentTask,
    agents: {
      ...state.agents,
      [event.agentId]: {
        ...state.agents[event.agentId as AgentId],
        status: nextStatus,
        lastMessage: event.message,
      },
    },
    timeline: [...state.timeline, event],
  };
}
