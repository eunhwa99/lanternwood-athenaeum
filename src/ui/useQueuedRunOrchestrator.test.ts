import { describe, expect, it } from "vitest";
import type { AgentJobRequest } from "../harness/runAdapter";
import {
  createInitialQueuedRunOrchestratorState,
  queuedRunOrchestratorReducer,
} from "./useQueuedRunOrchestrator";

function job(taskId: string, agentId: AgentJobRequest["agentId"]): AgentJobRequest {
  return {
    agentId,
    delegatedPrompt: `${agentId} delegated prompt`,
    prompt: `${taskId} prompt`,
    selectedAgentIds: [agentId],
    skippedAgentIds: [],
    taskId,
  };
}

describe("queuedRunOrchestratorReducer", () => {
  it("clears pending queues and runtimes on stop while preserving active lane ownership", () => {
    const orionJob = job("task-1", "orion");
    const quillJob = job("task-2", "quill");
    const initialState = createInitialQueuedRunOrchestratorState();
    const withTask = queuedRunOrchestratorReducer(initialState, {
      runtime: {
        completedAgentIds: [],
        failedAgentIds: [],
        finalizing: false,
        approvalPausedAgentIds: [],
        prompt: "Research first topic",
        queuedAgentIds: [],
        reports: {},
        sandboxMode: "read-only",
        selectedAgentIds: ["orion"],
        skippedAgentIds: [],
        synthesisQueued: false,
        taskId: "task-1",
      },
      type: "registerTask",
    });
    const withQueuedSpecialist = queuedRunOrchestratorReducer(withTask, {
      agentId: "orion",
      job: orionJob,
      taskId: "task-1",
      type: "enqueueSpecialist",
    });
    const withQueuedSynthesis = queuedRunOrchestratorReducer(withQueuedSpecialist, {
      taskId: "task-1",
      type: "enqueueSynthesis",
    });
    const withActiveLane = queuedRunOrchestratorReducer(
      {
        ...withQueuedSynthesis,
        specialistQueues: {
          ...withQueuedSynthesis.specialistQueues,
          quill: [quillJob],
        },
      },
      {
        active: true,
        agentId: "orion",
        type: "setSpecialistActive",
      },
    );

    const stopped = queuedRunOrchestratorReducer(withActiveLane, { type: "clearPendingWork" });

    expect(stopped.specialistQueues.orion).toEqual([]);
    expect(stopped.specialistQueues.quill).toEqual([]);
    expect(stopped.synthesisQueue).toEqual([]);
    expect(stopped.taskRuntimes).toEqual({});
    expect(stopped.activeSpecialists.orion).toBe(true);
  });
});
