import type { AgentEvent } from "../events/types";

export type RunAdapter = {
  startRun(input: string): AsyncIterable<AgentEvent>;
};
