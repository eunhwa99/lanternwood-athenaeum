import type { TaskRecord } from "./types";

export function taskLabelFor(tasks: TaskRecord[], taskId: string) {
  const taskIndex = tasks.findIndex((task) => task.taskId === taskId);

  return taskIndex >= 0 ? `T${taskIndex + 1}` : "T?";
}
