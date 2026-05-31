import { describe, expect, it } from "vitest";
import type { TaskRecord } from "./types";
import { taskLabelFor } from "./taskLabels";

function task(taskId: string): TaskRecord {
  return {
    createdAt: "2026-05-31T00:00:00.000Z",
    finalOutput: null,
    prompt: `Prompt for ${taskId}`,
    selectedAgentIds: [],
    skippedAgentIds: [],
    status: "queued",
    taskId,
  };
}

describe("task labels", () => {
  it("labels tasks by their current queue order", () => {
    const tasks = [task("task-alpha"), task("task-beta"), task("task-gamma")];

    expect(taskLabelFor(tasks, "task-alpha")).toBe("T1");
    expect(taskLabelFor(tasks, "task-beta")).toBe("T2");
    expect(taskLabelFor(tasks, "task-gamma")).toBe("T3");
  });

  it("uses a stable fallback for unknown task ids", () => {
    expect(taskLabelFor([task("task-alpha")], "missing-task")).toBe("T?");
  });
});
