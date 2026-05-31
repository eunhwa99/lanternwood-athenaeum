import { describe, expect, it } from "vitest";
import type { AgentEvent, TaskRecord } from "../events/types";
import { bubbleTextFromEvent } from "./sceneBubbleText";

const tasks: TaskRecord[] = [
  {
    completedAt: undefined,
    createdAt: "2026-05-28T00:00:00.000Z",
    finalOutput: null,
    prompt: "Review this code and verify risky edge cases",
    selectedAgentIds: ["orion"],
    skippedAgentIds: ["neria", "quill", "argus"],
    status: "running",
    taskId: "task-1",
  },
];

function event(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    agentId: "luma",
    eventId: "evt-1",
    message: "event",
    taskId: "task-1",
    timestamp: "2026-05-28T00:00:00.000Z",
    type: "agent.prompted",
    ...overrides,
  } as AgentEvent;
}

describe("scene bubble text", () => {
  it("summarizes delegated task bubbles without showing the full delegated prompt", () => {
    const text = bubbleTextFromEvent(
      event({
        payload: {
          prompt: "Orion, focus the plan around the highest-risk milestone first.",
          promptExcerpt: "Orion, focus the plan around the highest-risk milestone first.",
          recipientAgentId: "orion",
          senderAgentId: "luma",
          speechBubble: "Orion, focus the plan around the highest-risk milestone first.",
        },
        type: "agent.prompted",
      }),
      tasks,
    );

    expect(text).toBe("[T1] Orion task: Review this code and verify risky edge cases");
    expect(text).not.toContain("highest-risk milestone");
  });

  it("summarizes report bubbles by task instead of showing report prose", () => {
    const text = bubbleTextFromEvent(
      event({
        agentId: "orion",
        payload: {
          report: "Research brief: focus the plan around the highest-risk milestone first.",
          speechBubble: "Research brief: focus the plan around the highest-risk milestone first.",
        },
        type: "agent.reporting",
      }),
      tasks,
    );

    expect(text).toBe("[T1] Orion answered: Review this code and verify risky edge cases");
    expect(text).not.toContain("Research brief");
  });
});
