import { AGENT_EVENT_TYPES, AGENT_IDS, type AgentEvent } from "./types";

const agentIds = new Set<string>(AGENT_IDS);
const eventTypes = new Set<string>(AGENT_EVENT_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isString(value) && value.length <= maxLength;
}

function hasBaseEventShape(value: Record<string, unknown>) {
  return (
    isBoundedString(value.eventId, 96) &&
    isBoundedString(value.taskId, 48) &&
    isString(value.agentId) &&
    agentIds.has(value.agentId) &&
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
    isString(payload.senderAgentId) &&
    agentIds.has(payload.senderAgentId) &&
    isString(payload.recipientAgentId) &&
    agentIds.has(payload.recipientAgentId) &&
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

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value) || !hasBaseEventShape(value)) {
    return false;
  }

  if (value.type === "agent.prompted") {
    return isPromptedPayload(value.payload);
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
