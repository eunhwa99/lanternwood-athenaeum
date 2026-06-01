import type { AgentEvent } from "../events/types";
import { AGENTS } from "../agents/registry";
import { planRoute } from "./routePlanning";
import type { AgentJobRequest, RunAdapter, RunAdapterOptions, SynthesisTaskRequest } from "./runAdapter";
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

function agentDisplayName(agentId: AgentEvent["agentId"]) {
  return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
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

function reportEventsFor(taskId: string, startIndex: number, agentId: AgentEvent["agentId"]): AgentEvent[] {
  const reports: Partial<Record<AgentEvent["agentId"], AgentEvent[]>> = {
    argus: [
      promptedEvent(taskId, startIndex, "argus", "Argus, review the plan for risk and completion criteria."),
      event(taskId, startIndex + 1, "argus", "agent.reviewing", "Argus checks the answer for risk and gaps"),
      event(taskId, startIndex + 2, "argus", "agent.reporting", "Argus returns review notes", {
        report: "Review note: verify scope, risk, and completion criteria before handoff.",
        reportExcerpt: "Review note: verify scope, risk, and completion criteria before handoff.",
        speechBubble: "Review note: verify scope, risk, and completion criteria before handoff.",
      }),
    ],
    neria: [
      promptedEvent(taskId, startIndex, "neria", "Neria, keep recommendations concrete and repo-grounded."),
      event(taskId, startIndex + 1, "neria", "agent.working", "Neria checks the archive for stable preferences"),
      event(taskId, startIndex + 2, "neria", "agent.reporting", "Neria finds relevant memory notes", {
        report: "Memory note: keep recommendations concrete, repo-grounded, and action-oriented.",
        reportExcerpt: "Memory note: keep recommendations concrete, repo-grounded, and action-oriented.",
        speechBubble: "Memory note: keep recommendations concrete, repo-grounded, and action-oriented.",
      }),
    ],
    orion: [
      promptedEvent(taskId, startIndex, "orion", "Orion, focus the plan around the highest-risk milestone first."),
      event(taskId, startIndex + 1, "orion", "agent.working", "Orion studies the star maps for useful references"),
      event(taskId, startIndex + 2, "orion", "agent.reporting", "Orion returns with a concise research brief", {
        report: "Research brief: focus the plan around the highest-risk milestone first.",
        reportExcerpt: "Research brief: focus the plan around the highest-risk milestone first.",
        speechBubble: "Research brief: focus the plan around the highest-risk milestone first.",
      }),
    ],
    quill: [
      promptedEvent(taskId, startIndex, "quill", "Quill, turn the findings into a short milestone plan."),
      event(taskId, startIndex + 1, "quill", "agent.working", "Quill turns findings into a draft"),
      event(taskId, startIndex + 2, "quill", "agent.reporting", "Quill returns a concise draft", {
        report: "Draft note: turn the findings into a short milestone plan.",
        reportExcerpt: "Draft note: turn the findings into a short milestone plan.",
        speechBubble: "Draft note: turn the findings into a short milestone plan.",
      }),
    ],
  };

  return (
    reports[agentId] ?? [
      promptedEvent(taskId, startIndex, agentId, `${agentDisplayName(agentId)}, return concise notes for this task.`),
      event(taskId, startIndex + 1, agentId, "agent.working", `${agentDisplayName(agentId)} works through the request`),
      event(taskId, startIndex + 2, agentId, "agent.reporting", `${agentDisplayName(agentId)} returns notes`, {
        report: `${agentDisplayName(agentId)} note: handle the requested specialist work.`,
        reportExcerpt: `${agentDisplayName(agentId)} note: handle the requested specialist work.`,
        speechBubble: `${agentDisplayName(agentId)} note: handle the requested specialist work.`,
      }),
    ]
  );
}

function specialistEventIndex(agentId: AgentEvent["agentId"]) {
  return {
    argus: 30,
    luma: 70,
    neria: 20,
    orion: 10,
    quill: 40,
  }[agentId] ?? 50;
}

async function* yieldWithDelay(events: AgentEvent[], eventDelayMs: number, signal?: AbortSignal) {
  for (const item of events) {
    if (signal?.aborted) {
      throw abortError();
    }

    if (eventDelayMs > 0) {
      await wait(eventDelayMs, signal);
    }

    yield item;
  }
}

export function createMockRunAdapter(options: MockRunAdapterOptions = {}): RunAdapter {
  const eventDelayMs = options.eventDelayMs ?? 0;

  return {
    async *startRun(input: string, runOptions: RunAdapterOptions = {}) {
      const taskId = runOptions.taskId ?? createTaskId(input);
      const routePlan = planRoute(input, AGENTS);
      let index = 1;
      const events: AgentEvent[] = [
        event(taskId, 1, "luma", "task.created", input),
        event(taskId, 2, "luma", "agent.planning", "Luma is arranging the reading lamps"),
        event(taskId, 3, "luma", "route.planned", "Luma selected a specialist route", routePlan),
      ];
      index = events.length + 1;

      if (routePlan.selectedAgentIds.length > 0) {
        events.push(
          event(
            taskId,
            index++,
            "luma",
            "agent.delegated",
            `Luma selected: ${routePlan.selectedAgentIds.map((agentId) => agentDisplayName(agentId)).join(", ")}`,
          ),
        );
      }

      for (const agentId of routePlan.selectedAgentIds) {
        const agentEvents = reportEventsFor(taskId, index, agentId);
        events.push(...agentEvents);
        index += agentEvents.length;
      }

      events.push(event(taskId, index++, "luma", "agent.reporting", "Luma raises the blue approval lantern"));

      for (const agentId of routePlan.selectedAgentIds) {
        events.push(event(taskId, index++, agentId, "agent.done", `${agentDisplayName(agentId)} returns to their alcove`));
      }

      const selectedNames = routePlan.selectedAgentIds.map((agentId) => agentDisplayName(agentId)).join(" and ");
      events.push(
        event(taskId, index++, "luma", "agent.done", "Luma places the final summary on the central desk", {
          finalOutput: selectedNames
            ? `Here is the focused plan synthesized from ${selectedNames}.`
            : "This request is simple enough for Luma to answer directly without specialist routing.",
        }),
      );

      yield* yieldWithDelay(events, eventDelayMs, runOptions.signal);
    },

    async *startAgentJob(job: AgentJobRequest, runOptions: RunAdapterOptions = {}) {
      const events = reportEventsFor(job.taskId, specialistEventIndex(job.agentId), job.agentId).slice(1);

      yield* yieldWithDelay(events, eventDelayMs, runOptions.signal);
    },

    async *synthesizeTask(task: SynthesisTaskRequest, runOptions: RunAdapterOptions = {}) {
      const events: AgentEvent[] = [];
      let index = 80;
      events.push(event(task.taskId, index++, "luma", "agent.reporting", "Luma raises the blue approval lantern"));

      for (const agentId of task.selectedAgentIds) {
        events.push(event(task.taskId, index++, agentId, "agent.done", `${agentDisplayName(agentId)} returns to their alcove`));
      }

      const selectedNames = task.selectedAgentIds.map((agentId) => agentDisplayName(agentId)).join(" and ");
      events.push(
        event(task.taskId, index++, "luma", "agent.done", "Luma places the final summary on the central desk", {
          finalOutput: selectedNames
            ? `Here is the focused plan synthesized from ${selectedNames}.`
            : "This request is simple enough for Luma to answer directly without specialist routing.",
        }),
      );

      yield* yieldWithDelay(events, eventDelayMs, runOptions.signal);
    },
  };
}

export function createMockApprovalRunAdapter(options: MockRunAdapterOptions = {}): RunAdapter {
  const eventDelayMs = options.eventDelayMs ?? 0;
  const approved = (runOptions: RunAdapterOptions) =>
    runOptions.sandboxMode === "danger-full-access" && runOptions.approvalToken === "approval-1";

  return {
    async *startRun(input: string, runOptions: RunAdapterOptions = {}) {
      const taskId = runOptions.taskId ?? createTaskId(input);
      const events: AgentEvent[] =
        approved(runOptions)
          ? [
              event(taskId, 1, "luma", "task.created", input),
              event(taskId, 2, "luma", "agent.done", "Luma places the final summary on the central desk", {
                finalOutput: "Approved retry completed with danger-full-access.",
              }),
            ]
          : [
              event(taskId, 1, "luma", "task.created", input),
              event(taskId, 2, "orion", "approval.requested", "Orion requests danger-full-access permission: Needs a file outside the workspace.", {
                approvalToken: "approval-1",
                blockedAction: "write /Users/eunhwa/shared/report.md",
                reason: "Needs a file outside the workspace.",
                requestedSandbox: "danger-full-access",
              }),
            ];

      yield* yieldWithDelay(events, eventDelayMs, runOptions.signal);
    },

    async *startAgentJob(job: AgentJobRequest, runOptions: RunAdapterOptions = {}) {
      const events: AgentEvent[] = approved(runOptions)
        ? [
            event(job.taskId, specialistEventIndex(job.agentId), job.agentId, "agent.reporting", `${agentDisplayName(job.agentId)} returns approved notes`, {
              report: "Approved specialist retry completed with danger-full-access.",
              reportExcerpt: "Approved specialist retry completed with danger-full-access.",
              speechBubble: "Approved specialist retry completed with danger-full-access.",
            }),
          ]
        : [
            event(
              job.taskId,
              specialistEventIndex(job.agentId),
              job.agentId,
              "approval.requested",
              `${agentDisplayName(job.agentId)} requests danger-full-access permission: Needs a file outside the workspace.`,
              {
                approvalToken: "approval-1",
                blockedAction: "write /Users/eunhwa/shared/report.md",
                reason: "Needs a file outside the workspace.",
                requestedSandbox: "danger-full-access",
              },
            ),
          ];

      yield* yieldWithDelay(events, eventDelayMs, runOptions.signal);
    },

    async *synthesizeTask(task: SynthesisTaskRequest, runOptions: RunAdapterOptions = {}) {
      const events: AgentEvent[] = [
        event(task.taskId, 80, "luma", "agent.done", "Luma places the final summary on the central desk", {
          finalOutput: "Approved retry completed with danger-full-access.",
        }),
      ];

      yield* yieldWithDelay(events, eventDelayMs, runOptions.signal);
    },
  };
}

export const mockRunAdapter = createMockRunAdapter();
