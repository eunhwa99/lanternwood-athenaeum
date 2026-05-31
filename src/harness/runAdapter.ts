import type { AgentEvent } from "../events/types";
import type { SandboxMode } from "./permissions";

export type RunRequestOptions = {
  approvalToken?: string;
  sandbox?: SandboxMode;
};

export type RunAdapter = {
  startRun(input: string, options?: RunRequestOptions): AsyncIterable<AgentEvent>;
};
