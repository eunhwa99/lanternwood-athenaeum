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

  it("stores synthesized final output from the terminal manager event", () => {
    const initial = createInitialRunState(AGENTS);
    const done = reduceAgentEvent(initial, {
      ...baseEvent,
      agentId: "luma",
      type: "agent.done",
      message: "Luma places the final summary on the central desk",
      payload: {
        finalOutput: "Here is the focused plan synthesized from Orion, Neria, and Argus.",
      },
    });

    expect(done.finalOutput).toBe("Here is the focused plan synthesized from Orion, Neria, and Argus.");
  });

  it("ignores final output payloads from non-terminal specialist events", () => {
    const initial = createInitialRunState(AGENTS);
    const working = reduceAgentEvent(initial, {
      ...baseEvent,
      agentId: "orion",
      type: "agent.working",
      message: "Orion is checking references",
      payload: {
        finalOutput: "This should not be treated as the synthesized answer.",
      },
    });

    expect(working.finalOutput).toBeNull();
  });

  it("ignores final output payloads from specialist done events", () => {
    const initial = createInitialRunState(AGENTS);
    const done = reduceAgentEvent(initial, {
      ...baseEvent,
      agentId: "orion",
      type: "agent.done",
      message: "Orion returns to the star-map balcony",
      payload: {
        finalOutput: "Only Luma's terminal synthesis should populate the final output.",
      },
    });

    expect(done.finalOutput).toBeNull();
  });

  it("clears final output when a new task starts", () => {
    const initial = createInitialRunState(AGENTS);
    const completed = reduceAgentEvent(initial, {
      ...baseEvent,
      agentId: "luma",
      type: "agent.done",
      message: "Luma places the final summary on the central desk",
      payload: {
        finalOutput: "Previous synthesis",
      },
    });
    const nextTask = reduceAgentEvent(completed, {
      ...baseEvent,
      eventId: "evt-2",
      agentId: "luma",
      type: "task.created",
      message: "Prepare a new answer",
    });

    expect(nextTask.finalOutput).toBeNull();
  });
});
