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

  it("accepts Luma prompted events to selected specialists", () => {
    expect(
      isAgentEvent({
        ...baseEvent,
        agentId: "luma",
        payload: {
          prompt: "Orion, verify this",
          promptExcerpt: "Orion, verify this",
          recipientAgentId: "orion",
          senderAgentId: "luma",
          speechBubble: "Orion, verify this",
        },
        type: "agent.prompted",
      }),
    ).toBe(true);
  });

  it("accepts dynamically authored specialist ids in prompted, reporting, and route events", () => {
    expect(
      isAgentEvent({
        ...baseEvent,
        agentId: "luma",
        payload: {
          prompt: "Build Scribe, inspect this task",
          promptExcerpt: "Build Scribe, inspect this task",
          recipientAgentId: "build-scribe",
          senderAgentId: "luma",
          speechBubble: "Build Scribe, inspect this task",
        },
        type: "agent.prompted",
      }),
    ).toBe(true);
    expect(
      isAgentEvent({
        ...baseEvent,
        agentId: "build-scribe",
        payload: { report: "Build notes" },
      }),
    ).toBe(true);
    expect(
      isAgentEvent({
        ...baseEvent,
        agentId: "luma",
        payload: {
          confidence: "medium",
          rationale: "Custom implementation route",
          selectedAgentIds: ["build-scribe"],
          skippedAgentIds: ["orion"],
        },
        type: "route.planned",
      }),
    ).toBe(true);
  });

  it("rejects prompted events from non-Luma senders or to non-specialist recipients", () => {
    const promptedEvent = {
      ...baseEvent,
      agentId: "luma",
      payload: {
        prompt: "Orion, verify this",
        promptExcerpt: "Orion, verify this",
        recipientAgentId: "orion",
        senderAgentId: "luma",
        speechBubble: "Orion, verify this",
      },
      type: "agent.prompted",
    };

    expect(isAgentEvent({ ...promptedEvent, agentId: "orion" })).toBe(false);
    expect(isAgentEvent({ ...promptedEvent, payload: { ...promptedEvent.payload, senderAgentId: "orion" } })).toBe(false);
    expect(isAgentEvent({ ...promptedEvent, payload: { ...promptedEvent.payload, recipientAgentId: "luma" } })).toBe(false);
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

  it("accepts route planned payloads with selected and skipped agent ids", () => {
    expect(
      isAgentEvent({
        ...baseEvent,
        agentId: "luma",
        payload: {
          confidence: "high",
          rationale: "Technical review only",
          selectedAgentIds: ["orion", "argus"],
          skippedAgentIds: ["neria", "quill"],
        },
        type: "route.planned",
      }),
    ).toBe(true);
  });

  it("rejects route planned payloads from non-Luma agents", () => {
    expect(
      isAgentEvent({
        ...baseEvent,
        agentId: "orion",
        payload: {
          confidence: "high",
          rationale: "Bad route sender",
          selectedAgentIds: ["orion", "argus"],
          skippedAgentIds: ["neria", "quill"],
        },
        type: "route.planned",
      }),
    ).toBe(false);
  });

  it("rejects route planned payloads with non-specialist agent ids", () => {
    expect(
      isAgentEvent({
        ...baseEvent,
        agentId: "luma",
        payload: {
          confidence: "high",
          rationale: "Bad route",
          selectedAgentIds: ["orion", "luma"],
          skippedAgentIds: ["neria", "quill"],
        },
        type: "route.planned",
      }),
    ).toBe(false);
  });

  it("rejects route planned payloads with duplicate or overlapping route sets", () => {
    const route = {
      ...baseEvent,
      agentId: "luma",
      payload: {
        confidence: "high",
        rationale: "Bad route",
        selectedAgentIds: ["orion"],
        skippedAgentIds: ["neria", "quill", "argus"],
      },
      type: "route.planned",
    };

    expect(isAgentEvent({ ...route, payload: { ...route.payload, selectedAgentIds: ["orion", "orion"] } })).toBe(false);
    expect(isAgentEvent({ ...route, payload: { ...route.payload, skippedAgentIds: ["orion", "neria", "quill", "argus"] } })).toBe(false);
  });
});