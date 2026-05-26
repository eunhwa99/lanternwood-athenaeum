import type { AgentDefinition, AgentId } from "../agents/types";

export type AgentEventType =
  | "task.created"
  | "agent.planning"
  | "agent.delegated"
  | "agent.moving"
  | "agent.working"
  | "agent.reporting"
  | "agent.reviewing"
  | "agent.done"
  | "agent.failed"
  | "approval.requested";

export type AgentStatus =
  | "idle"
  | "planning"
  | "moving"
  | "working"
  | "reporting"
  | "reviewing"
  | "waitingApproval"
  | "done"
  | "failed";

export type AgentEvent = {
  eventId: string;
  taskId: string;
  agentId: AgentId;
  type: AgentEventType;
  message: string;
  timestamp: string;
  payload?: Record<string, unknown>;
};

export type AgentRuntimeState = {
  definition: AgentDefinition;
  status: AgentStatus;
  lastMessage: string;
};

export type CurrentTask = {
  taskId: string;
  prompt: string;
};

export type RunState = {
  currentTask: CurrentTask | null;
  agents: Record<AgentId, AgentRuntimeState>;
  finalOutput: string | null;
  timeline: AgentEvent[];
};
