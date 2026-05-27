import type { AgentEvent } from "../events/types";
import type { PreviousRunContext } from "../events/types";

export type RunAdapterOptions = {
  previousRun?: PreviousRunContext;
  signal?: AbortSignal;
  taskId?: string;
};

export type RunAdapter = {
  startRun(input: string, options?: RunAdapterOptions): AsyncIterable<AgentEvent>;
};
