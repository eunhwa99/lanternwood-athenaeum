import type { PreviousRunContext } from "../src/events/types";

const maxPreviousFieldLength = 8_000;
const maxTimelineItems = 24;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function bounded(value: string) {
  return value.slice(0, maxPreviousFieldLength);
}

export function validatePreviousRun(value: unknown): PreviousRunContext | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid previousRun");
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.prompt !== "string" ||
    typeof record.taskId !== "string" ||
    typeof record.finalOutput !== "string" ||
    !isStringArray(record.delegatedAgents) ||
    !isStringArray(record.timeline)
  ) {
    throw new Error("Invalid previousRun");
  }

  return {
    delegatedAgents: record.delegatedAgents.map(bounded).slice(0, 12),
    finalOutput: bounded(record.finalOutput),
    prompt: bounded(record.prompt),
    taskId: bounded(record.taskId),
    timeline: record.timeline.map(bounded).slice(0, maxTimelineItems),
  };
}
