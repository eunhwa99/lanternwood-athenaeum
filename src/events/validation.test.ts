import { describe, expect, it } from "vitest";
import { isAgentEvent } from "./validation";

const baseEvent = {
  agentId: "orion",
  eventId: "evt-1",
  message: "Orion reports",
  taskId: "task-1",
  timestamp: "2026-05-27T00:00:00.000Z",
  type: "agent.reporting",
};

describe("agent event validation", () => {
  it("accepts reporting payloads with optional string fields", () => {
    expect(
      isAgentEvent({
        ...baseEvent,
        payload: {
          rawResponse: "raw",
          report: "report",
          reportExcerpt: "report",
          speechBubble: "report",
        },
      }),
    ).toBe(true);
  });

  it("rejects reporting payloads with non-string contract fields", () => {
    expect(
      isAgentEvent({
        ...baseEvent,
        payload: {
          report: 123,
        },
      }),
    ).toBe(false);
  });

  it("rejects reporting events without a non-empty report", () => {
    expect(isAgentEvent({ ...baseEvent })).toBe(false);
    expect(isAgentEvent({ ...baseEvent, payload: { report: "" } })).toBe(false);
  });

  it("rejects oversized event ids and task ids from runtime streams", () => {
    expect(isAgentEvent({ ...baseEvent, eventId: `evt-${"x".repeat(100)}`, payload: { report: "report" } })).toBe(false);
    expect(isAgentEvent({ ...baseEvent, payload: { report: "report" }, taskId: `task-${"x".repeat(60)}` })).toBe(false);
  });

  it("rejects permission reviewed payloads with non-string optional paths", () => {
    expect(
      isAgentEvent({
        ...baseEvent,
        agentId: "luma",
        payload: {
          action: "create_project",
          decision: "approve",
          path: 123,
          reason: "Allowed",
          requestId: "permission-1",
        },
        type: "permission.reviewed",
      }),
    ).toBe(false);
  });
});
