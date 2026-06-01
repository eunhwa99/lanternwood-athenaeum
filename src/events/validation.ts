import { AGENT_EVENT_TYPES, type AgentEvent } from "./types";

const eventTypes = new Set<string>(AGENT_EVENT_TYPES);
const agentIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAgentId(value: unknown): value is string {
  return typeof value === "string" && agentIdPattern.test(value);
}

function isSpecialistAgentId(value: unknown): value is string {
  return isAgentId(value) && value !== "luma";
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isString(value) && value.length <= maxLength;
}

function hasBaseEventShape(value: Record<string, unknown>) {
  return (
    isBoundedString(value.eventId, 96) &&
    isBoundedString(value.taskId, 48) &&
    isAgentId(value.agentId) &&
    isString(value.type) &&
    eventTypes.has(value.type) &&
    typeof value.message === "string" &&
    isString(value.timestamp) &&
    (value.payload === undefined || isRecord(value.payload))
  );
}

function isPromptedPayload(payload: unknown) {
  return (
    isRecord(payload) &&
    payload.senderAgentId === "luma" &&
    isSpecialistAgentId(payload.recipientAgentId) &&
    isString(payload.prompt) &&
    isString(payload.promptExcerpt) &&
    isString(payload.speechBubble)
  );
}

function isPermissionPayload(payload: unknown) {
  return (
    isRecord(payload) &&
    isString(payload.requestId) &&
    (payload.decision === "approve" || payload.decision === "deny" || payload.decision === "escalate") &&
    isString(payload.reason) &&
    isString(payload.action) &&
    isOptionalString(payload.path)
  );
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isReportingPayload(payload: unknown) {
  return (
    isRecord(payload) &&
    isString(payload.report) &&
    isOptionalString(payload.reportExcerpt) &&
    isOptionalString(payload.rawResponse) &&
    isOptionalString(payload.speechBubble)
  );
}

function isSpecialistPartition(selected: unknown, skipped: unknown) {
  if (!Array.isArray(selected) || !Array.isArray(skipped)) {
    return false;
  }

  const selectedSet = new Set(selected);
  const skippedSet = new Set(skipped);
  const routeSet = new Set([...selected, ...skipped]);

  return (
    selected.length === selectedSet.size &&
    skipped.length === skippedSet.size &&
    routeSet.size > 0 &&
    selected.every((item) => isSpecialistAgentId(item) && !skippedSet.has(item)) &&
    skipped.every((item) => isSpecialistAgentId(item) && !selectedSet.has(item))
  );
}

function isRoutePlannedPayload(payload: unknown) {
  return (
    isRecord(payload) &&
    isSpecialistPartition(payload.selectedAgentIds, payload.skippedAgentIds) &&
    isString(payload.rationale) &&
    (payload.confidence === "low" || payload.confidence === "medium" || payload.confidence === "high")
  );
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value) || !hasBaseEventShape(value)) {
    return false;
  }

  if (value.type === "agent.prompted") {
    return value.agentId === "luma" && isPromptedPayload(value.payload);
  }

  if (value.type === "route.planned") {
    return value.agentId === "luma" && isRoutePlannedPayload(value.payload);
  }

  if (value.type === "permission.reviewed") {
    return isPermissionPayload(value.payload);
  }

  if (value.type === "agent.reporting") {
    return isReportingPayload(value.payload);
  }

  return true;
}

export function validateAgentEvent(value: unknown, message: string): AgentEvent {
  if (!isAgentEvent(value)) {
    throw new Error(message);
  }

  return value;
}