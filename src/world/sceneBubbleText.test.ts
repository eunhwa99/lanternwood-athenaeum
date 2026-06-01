import { describe, expect, it } from "vitest";
import type { AgentEvent, TaskRecord } from "../events/types";
import { bubbleTextFromEvent } from "./sceneBubbleText";

const tasks: TaskRecord[] = [
  {
    createdAt: "2026-05-31T00:00:00.000Z",
    finalOutput: null,
    prompt: "Review this code and verify risky edge cases",
    selectedAgentIds: ["orion"],
    skippedAgentIds: [],
    status: "running",
    taskId: "task-1",
  },
];

const baseEvent = {
  eventId: "evt-1",
  taskId: "task-1",
  timestamp: "2026-05-31T00:00:00.000Z",
} satisfies Pick<AgentEvent, "eventId" | "taskId" | "timestamp">;

describe("scene bubble text", () => {
  it("uses the original task prompt for delegated specialist task bubbles", () => {
    const text = bubbleTextFromEvent(
      {
        ...baseEvent,
        agentId: "luma",
        message: "Luma prompts Orion",
        payload: {
          prompt: "Orion, focus the plan around the highest-risk milestone first.",
          promptExcerpt: "Orion, focus the plan around the highest-risk milestone first.",
          recipientAgentId: "orion",
          senderAgentId: "luma",
          speechBubble: "Orion, focus the plan around the highest-risk milestone first.",
        },
        type: "agent.prompted",
      },
      tasks,
    );

    expect(text).toBe("[T1] Orion task: Review this code and verify risky edge cases");
  });

  it("labels report bubbles as agent answers", () => {
    const text = bubbleTextFromEvent(
      {
        ...baseEvent,
        agentId: "orion",
        message: "Orion reports",
        payload: {
          report: "Research brief: focus the plan around the highest-risk milestone first.",
          reportExcerpt: "Research brief: focus the plan around the highest-risk milestone first.",
          speechBubble: "Research brief: focus the plan around the highest-risk milestone first.",
        },
        type: "agent.reporting",
      },
      tasks,
    );

    expect(text).toBe("[T1] Orion answered: Research brief: focus the plan around the highest-risk milestone first.");
  });

  it("ignores events without visible bubble content", () => {
    const text = bubbleTextFromEvent(
      {
        ...baseEvent,
        agentId: "orion",
        message: "Orion works",
        type: "agent.working",
      },
      tasks,
    );

    expect(text).toBeUndefined();
  });
});
