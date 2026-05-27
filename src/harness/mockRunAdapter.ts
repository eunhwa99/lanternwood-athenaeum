import type { AgentEvent } from "../events/types";
import type { RunAdapter, RunAdapterOptions } from "./runAdapter";
import { createTaskId } from "./taskIds";

type MockRunAdapterOptions = {
  eventDelayMs?: number;
};

function abortError() {
  return new Error("Run aborted");
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);

    const abort = () => {
      globalThis.clearTimeout(timeout);
      reject(abortError());
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
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
  } as AgentEvent;
}

function promptedEvent(taskId: string, index: number, recipientAgentId: AgentEvent["agentId"], prompt: string): AgentEvent {
  return event(taskId, index, "luma", "agent.prompted", `Luma prompts ${recipientAgentId}`, {
    prompt,
    promptExcerpt: prompt,
    recipientAgentId,
    senderAgentId: "luma",
    speechBubble: prompt,
  });
}

export function createMockRunAdapter(options: MockRunAdapterOptions = {}): RunAdapter {
  const eventDelayMs = options.eventDelayMs ?? 0;

  return {
    async *startRun(input: string, runOptions: RunAdapterOptions = {}) {
      const taskId = runOptions.taskId ?? createTaskId(input);
      const events: AgentEvent[] = [
        event(taskId, 1, "luma", "task.created", input),
        event(taskId, 2, "luma", "agent.planning", "Luma is arranging the reading lamps"),
        event(taskId, 3, "luma", "agent.delegated", "Luma sends Orion, Neria, Quill, and Argus into the stacks"),
        promptedEvent(taskId, 4, "orion", "Orion, focus the plan around the highest-risk milestone first."),
        event(taskId, 5, "orion", "agent.working", "Orion studies the star maps for useful references"),
        event(taskId, 6, "orion", "agent.reporting", "Orion returns with a concise research brief", {
          report: "Research brief: focus the plan around the highest-risk milestone first.",
          reportExcerpt: "Research brief: focus the plan around the highest-risk milestone first.",
          speechBubble: "Research brief: focus the plan around the highest-risk milestone first.",
        }),
        promptedEvent(taskId, 7, "neria", "Neria, keep recommendations concrete and repo-grounded."),
        event(taskId, 8, "neria", "agent.working", "Neria checks the archive for stable preferences"),
        event(taskId, 9, "neria", "agent.reporting", "Neria finds relevant memory notes", {
          report: "Memory note: keep recommendations concrete, repo-grounded, and action-oriented.",
          reportExcerpt: "Memory note: keep recommendations concrete, repo-grounded, and action-oriented.",
          speechBubble: "Memory note: keep recommendations concrete, repo-grounded, and action-oriented.",
        }),
        promptedEvent(taskId, 10, "quill", "Quill, turn the findings into a short milestone plan."),
        event(taskId, 11, "quill", "agent.working", "Quill turns findings into a draft"),
        event(taskId, 12, "quill", "agent.reporting", "Quill returns a concise draft", {
          report: "Draft note: turn the findings into a short milestone plan.",
          reportExcerpt: "Draft note: turn the findings into a short milestone plan.",
          speechBubble: "Draft note: turn the findings into a short milestone plan.",
        }),
        promptedEvent(taskId, 13, "argus", "Argus, review the plan for risk and completion criteria."),
        event(taskId, 14, "argus", "agent.reviewing", "Argus checks the answer for risk and gaps"),
        event(taskId, 15, "argus", "agent.reporting", "Argus returns review notes", {
          report: "Review note: verify scope, risk, and completion criteria before handoff.",
          reportExcerpt: "Review note: verify scope, risk, and completion criteria before handoff.",
          speechBubble: "Review note: verify scope, risk, and completion criteria before handoff.",
        }),
        event(taskId, 16, "luma", "approval.requested", "Luma raises the blue approval lantern"),
        event(taskId, 17, "orion", "agent.done", "Orion returns to the star-map balcony"),
        event(taskId, 18, "neria", "agent.done", "Neria closes the archive ledger"),
        event(taskId, 19, "quill", "agent.done", "Quill shelves the illuminated draft"),
        event(taskId, 20, "argus", "agent.done", "Argus lowers the review lantern"),
        event(taskId, 21, "luma", "agent.done", "Luma places the final summary on the central desk", {
          finalOutput: "Here is the focused plan synthesized from Orion, Neria, Quill, and Argus.",
        }),
      ];

      for (const item of events) {
        if (runOptions.signal?.aborted) {
          throw abortError();
        }

        if (eventDelayMs > 0) {
          await wait(eventDelayMs, runOptions.signal);
        }

        yield item;
      }
    },
  };
}

export const mockRunAdapter = createMockRunAdapter();
