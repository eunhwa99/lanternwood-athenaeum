import type { AgentDefinition, AgentId } from "../agents/types";

export const AGENT_IDS = ["luma", "orion", "neria", "quill", "argus"] as const;

export type AgentEventType =
  | "task.created"
  | "agent.planning"
  | "agent.delegated"
  | "agent.prompted"
  | "agent.moving"
  | "agent.working"
  | "agent.reporting"
  | "agent.reviewing"
  | "agent.done"
  | "agent.failed"
  | "approval.requested"
  | "permission.reviewed";

export const AGENT_EVENT_TYPES = [
  "task.created",
  "agent.planning",
  "agent.delegated",
  "agent.prompted",
  "agent.moving",
  "agent.working",
  "agent.reporting",
  "agent.reviewing",
  "agent.done",
  "agent.failed",
  "approval.requested",
  "permission.reviewed",
] as const satisfies readonly AgentEventType[];

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

export type PreviousRunContext = {
  prompt: string;
  taskId: string;
  finalOutput: string;
  delegatedAgents: string[];
  timeline: string[];
};

type BaseAgentEvent<TType extends AgentEventType> = {
  eventId: string;
  taskId: string;
  agentId: AgentId;
  type: TType;
  message: string;
  timestamp: string;
};

export type AgentPromptedPayload = {
  senderAgentId: AgentId;
  recipientAgentId: AgentId;
  prompt: string;
  promptExcerpt: string;
  speechBubble: string;
} & Record<string, unknown>;

export type AgentReportingPayload = {
  report: string;
  reportExcerpt?: string;
  rawResponse?: string;
  speechBubble?: string;
} & Record<string, unknown>;

export type PermissionReviewedPayload = {
  requestId: string;
  decision: "approve" | "deny" | "escalate";
  reason: string;
  action: string;
  path?: string;
} & Record<string, unknown>;

export type AgentEvent =
  | (BaseAgentEvent<"agent.prompted"> & { payload: AgentPromptedPayload })
  | (BaseAgentEvent<"agent.reporting"> & { payload: AgentReportingPayload })
  | (BaseAgentEvent<"permission.reviewed"> & { payload: PermissionReviewedPayload })
  | (BaseAgentEvent<Exclude<AgentEventType, "agent.prompted" | "agent.reporting" | "permission.reviewed">> & {
      payload?: Record<string, unknown>;
    });

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
