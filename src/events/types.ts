
import type { AgentDefinition, AgentId } from "../agents/types";

export const AGENT_IDS = ["luma", "orion", "neria", "quill", "argus"] as const;
export const SPECIALIST_AGENT_IDS = ["orion", "neria", "quill", "argus"] as const;
export type SpecialistAgentId = (typeof SPECIALIST_AGENT_IDS)[number];

export type AgentEventType =
  | "task.created"
  | "route.planned"
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
  "route.planned",
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

export type TaskStatus = "queued" | "routing" | "running" | "synthesizing" | "done" | "failed";

export type AgentJobStatus = "queued" | "running" | "done" | "failed";

export type PreviousRunContext = {
  prompt: string;
  taskId: string;
  finalOutput: string;
  delegatedAgents: string[];
  timeline: string[];
};

type BaseAgentEvent<TType extends AgentEventType, TAgentId extends AgentId = AgentId> = {
  eventId: string;
  taskId: string;
  agentId: TAgentId;
  type: TType;
  message: string;
  timestamp: string;
};

export type AgentPromptedPayload = {
  senderAgentId: "luma";
  recipientAgentId: SpecialistAgentId;
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

export type RoutePlannedPayload = {
  selectedAgentIds: SpecialistAgentId[];
  skippedAgentIds: SpecialistAgentId[];
  rationale: string;
  confidence: "low" | "medium" | "high";
} & Record<string, unknown>;

export type AgentEvent =
  | (BaseAgentEvent<"route.planned", "luma"> & { payload: RoutePlannedPayload })
  | (BaseAgentEvent<"agent.prompted", "luma"> & { payload: AgentPromptedPayload })
  | (BaseAgentEvent<"agent.reporting"> & { payload: AgentReportingPayload })
  | (BaseAgentEvent<"permission.reviewed"> & { payload: PermissionReviewedPayload })
  | (BaseAgentEvent<Exclude<AgentEventType, "route.planned" | "agent.prompted" | "agent.reporting" | "permission.reviewed">> & {
      payload?: Record<string, unknown>;
    });

export type AgentRuntimeState = {
  definition: AgentDefinition;
  status: AgentStatus;
  lastMessage: string;
  currentJobId?: string;
};

export type CurrentTask = {
  taskId: string;
  prompt: string;
};

export type TaskRecord = {
  completedAt?: string;
  createdAt: string;
  error?: string;
  finalOutput: string | null;
  prompt: string;
  selectedAgentIds: AgentId[];
  skippedAgentIds: AgentId[];
  status: TaskStatus;
  taskId: string;
};

export type AgentJob = {
  agentId: AgentId;
  completedAt?: string;
  error?: string;
  jobId: string;
  lastMessage: string;
  output?: string;
  prompt: string;
  queuedAt: string;
  startedAt?: string;
  status: AgentJobStatus;
  taskId: string;
};

export type RunState = {
  currentTask: CurrentTask | null;
  agents: Record<AgentId, AgentRuntimeState>;
  agentQueues: Record<AgentId, AgentJob[]>;
  finalOutput: string | null;
  finalOutputs: Record<string, string>;
  tasks: TaskRecord[];
  timeline: AgentEvent[];
};
