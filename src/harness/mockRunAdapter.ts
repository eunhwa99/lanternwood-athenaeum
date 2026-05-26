import type { AgentEvent } from "../events/types";
import type { RunAdapter } from "./runAdapter";

type MockRunAdapterOptions = {
  eventDelayMs?: number;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function stableTaskId(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const encoded = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `task-${encoded || "empty"}`;
}

function event(
  taskId: string,
  index: number,
  agentId: AgentEvent["agentId"],
  type: AgentEvent["type"],
  message: string,
  payload?: AgentEvent["payload"],
): AgentEvent {
  return {
    eventId: `${taskId}-evt-${index}`,
    taskId,
    agentId,
    type,
    message,
    timestamp: new Date(Date.UTC(2026, 4, 25, 0, 0, index)).toISOString(),
    payload,
  };
}

export function createMockRunAdapter(options: MockRunAdapterOptions = {}): RunAdapter {
  const eventDelayMs = options.eventDelayMs ?? 0;

  return {
    async *startRun(input: string) {
      const taskId = stableTaskId(input);
      const events: AgentEvent[] = [
        event(taskId, 1, "luma", "task.created", input),
        event(taskId, 2, "luma", "agent.planning", "Luma is arranging the reading lamps"),
        event(taskId, 3, "luma", "agent.delegated", "Luma sends Orion, Neria, Quill, and Argus into the stacks"),
        event(taskId, 4, "orion", "agent.working", "Orion studies the star maps for useful references"),
        event(taskId, 5, "orion", "agent.reporting", "Orion returns with a concise research brief", {
          report: "Research brief: focus the plan around the highest-risk milestone first.",
        }),
        event(taskId, 6, "neria", "agent.working", "Neria checks the archive for stable preferences"),
        event(taskId, 7, "neria", "agent.reporting", "Neria finds relevant memory notes", {
          report: "Memory note: keep recommendations concrete, repo-grounded, and action-oriented.",
        }),
        event(taskId, 8, "quill", "agent.working", "Quill turns findings into a draft"),
        event(taskId, 9, "quill", "agent.reporting", "Quill returns a concise draft", {
          report: "Draft note: turn the findings into a short milestone plan.",
        }),
        event(taskId, 10, "argus", "agent.reviewing", "Argus checks the answer for risk and gaps", {
          report: "Review note: verify scope, risk, and completion criteria before handoff.",
        }),
        event(taskId, 11, "luma", "approval.requested", "Luma raises the blue approval lantern"),
        event(taskId, 12, "orion", "agent.done", "Orion returns to the star-map balcony"),
        event(taskId, 13, "neria", "agent.done", "Neria closes the archive ledger"),
        event(taskId, 14, "quill", "agent.done", "Quill shelves the illuminated draft"),
        event(taskId, 15, "argus", "agent.done", "Argus lowers the review lantern"),
        event(taskId, 16, "luma", "agent.done", "Luma places the final summary on the central desk", {
          finalOutput: "Here is the focused plan synthesized from Orion, Neria, Quill, and Argus.",
        }),
      ];

      for (const item of events) {
        if (eventDelayMs > 0) {
          await wait(eventDelayMs);
        }

        yield item;
      }
    },
  };
}

export const mockRunAdapter = createMockRunAdapter();
