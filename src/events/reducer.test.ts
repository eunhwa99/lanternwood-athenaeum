import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { createInitialRunState, reduceAgentEvent } from "./reducer";
import type { AgentEvent } from "./types";

const baseEvent = {
  eventId: "evt-1",
  taskId: "task-1",
  timestamp: "2026-05-25T00:00:00.000Z",
} satisfies Pick<AgentEvent, "eventId" | "taskId" | "timestamp">;

describe("event reducer", () => {
  it("creates an idle state for every registered agent", () => {
    const state = createInitialRunState(AGENTS);

    expect(Object.keys(state.agents)).toEqual(["luma", "orion", "neria", "quill", "argus"]);
    expect(state.agents.luma.status).toBe("idle");
  });

  it("updates task and agent status from events", () => {
    const initial = createInitialRunState(AGENTS);
    const created = reduceAgentEvent(initial, {
      ...baseEvent,
      agentId: "luma",
      type: "task.created",
      message: "Prepare a weekly plan",
    });
    const working = reduceAgentEvent(created, {
      ...baseEvent,
      eventId: "evt-2",
      agentId: "orion",
      type: "agent.working",
      message: "Orion is checking references",
    });

    expect(created.currentTask?.prompt).toBe("Prepare a weekly plan");
    expect(working.agents.orion.status).toBe("working");
    expect(working.timeline).toHaveLength(2);
  });
});
