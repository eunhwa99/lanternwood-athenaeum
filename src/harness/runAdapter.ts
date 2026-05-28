import type { AgentId } from "../agents/types";
import type { AgentEvent, PreviousRunContext, SpecialistAgentId } from "../events/types";

export type RunAdapterOptions = {
  previousRun?: PreviousRunContext;
  signal?: AbortSignal;
  taskId?: string;
};

export type AgentJobRequest = {
  agentId: SpecialistAgentId;
  delegatedPrompt: string;
  prompt: string;
  selectedAgentIds: SpecialistAgentId[];
  skippedAgentIds: SpecialistAgentId[];
  taskId: string;
};

export type SynthesisTaskRequest = {
  prompt: string;
  reports: Partial<Record<AgentId, string>>;
  selectedAgentIds: SpecialistAgentId[];
  skippedAgentIds: SpecialistAgentId[];
  taskId: string;
};

export type RunAdapter = {
  startRun(input: string, options?: RunAdapterOptions): AsyncIterable<AgentEvent>;
  startAgentJob?(job: AgentJobRequest, options?: RunAdapterOptions): AsyncIterable<AgentEvent>;
  synthesizeTask?(task: SynthesisTaskRequest, options?: RunAdapterOptions): AsyncIterable<AgentEvent>;
};
