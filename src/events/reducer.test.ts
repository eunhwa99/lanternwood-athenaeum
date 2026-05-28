import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { createInitialRunState, enqueueAgentJob, enqueueTask, reduceAgentEvent, updateAgentJob } from "./reducer";
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

  it("keeps completed task output available when a new task starts", () => {
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
      taskId: "task-2",
    });

    expect(nextTask.finalOutput).toBe("Previous synthesis");
    expect(nextTask.finalOutputs["task-1"]).toBe("Previous synthesis");
    expect(nextTask.tasks.find((task) => task.taskId === "task-1")).toMatchObject({
      finalOutput: "Previous synthesis",
      status: "done",
    });
    expect(nextTask.tasks.find((task) => task.taskId === "task-2")).toMatchObject({
      finalOutput: null,
      status: "routing",
    });
  });

  it("tracks queued tasks without replacing earlier task records", () => {
    const initial = createInitialRunState(AGENTS);
    const first = enqueueTask(initial, {
      createdAt: "2026-05-28T00:00:00.000Z",
      prompt: "Research the queue design",
      taskId: "task-a",
    });
    const second = enqueueTask(first, {
      createdAt: "2026-05-28T00:00:01.000Z",
      prompt: "Draft the queue UI",
      taskId: "task-b",
    });

    expect(second.tasks.map((task) => [task.taskId, task.status, task.prompt])).toEqual([
      ["task-a", "queued", "Research the queue design"],
      ["task-b", "queued", "Draft the queue UI"],
    ]);
    expect(second.currentTask?.taskId).toBe("task-a");
  });

  it("stores final outputs by task id while keeping the latest output preview", () => {
    const initial = enqueueTask(createInitialRunState(AGENTS), {
      createdAt: "2026-05-28T00:00:00.000Z",
      prompt: "Research the queue design",
      taskId: "task-a",
    });
    const completed = reduceAgentEvent(initial, {
      ...baseEvent,
      agentId: "luma",
      message: "Luma synthesizes task A",
      payload: { finalOutput: "Final output for task A" },
      taskId: "task-a",
      type: "agent.done",
    });

    expect(completed.finalOutputs["task-a"]).toBe("Final output for task A");
    expect(completed.tasks.find((task) => task.taskId === "task-a")).toMatchObject({
      finalOutput: "Final output for task A",
      status: "done",
    });
    expect(completed.finalOutput).toBe("Final output for task A");
  });

  it("tracks per-agent queues and preserves same-agent FIFO order", () => {
    const initial = createInitialRunState(AGENTS);
    const queued = [
      {
        agentId: "orion" as const,
        jobId: "job-orion-a",
        prompt: "Research task A",
        queuedAt: "2026-05-28T00:00:00.000Z",
        taskId: "task-a",
      },
      {
        agentId: "orion" as const,
        jobId: "job-orion-b",
        prompt: "Research task B",
        queuedAt: "2026-05-28T00:00:01.000Z",
        taskId: "task-b",
      },
      {
        agentId: "quill" as const,
        jobId: "job-quill-b",
        prompt: "Draft task B",
        queuedAt: "2026-05-28T00:00:01.000Z",
        taskId: "task-b",
      },
    ].reduce((state, job) => enqueueAgentJob(state, job), initial);

    const running = updateAgentJob(queued, "job-orion-a", {
      startedAt: "2026-05-28T00:00:02.000Z",
      status: "running",
    });

    expect(running.agentQueues.orion.map((job) => [job.jobId, job.status])).toEqual([
      ["job-orion-a", "running"],
      ["job-orion-b", "queued"],
    ]);
    expect(running.agentQueues.quill.map((job) => [job.jobId, job.status])).toEqual([["job-quill-b", "queued"]]);
  });
});
