import type { AgentEvent } from "../src/events/types";

export function encodeAgentEvent(event: AgentEvent): string {
  return `event: agent-event\ndata: ${JSON.stringify(event)}\n\n`;
}
