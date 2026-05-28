import type { TaskRecord } from "./types";

export function taskSequenceNumber(tasks: TaskRecord[], taskId: string) {
  const index = tasks.findIndex((task) => task.taskId === taskId);

  return index >= 0 ? index + 1 : null;
}

export function taskLabelFor(tasks: TaskRecord[], taskId: string) {
  const sequence = taskSequenceNumber(tasks, taskId);

  return sequence ? `T${sequence}` : "Task";
}
