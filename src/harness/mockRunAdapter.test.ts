import { describe, expect, it } from "vitest";
import { mockRunAdapter } from "./mockRunAdapter";

describe("mock run adapter", () => {
  it("emits a deterministic manager-led event sequence", async () => {
    const events = [];

    for await (const event of mockRunAdapter.startRun("Plan my interview prep")) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "task.created",
      "agent.planning",
      "agent.delegated",
      "agent.working",
      "agent.reporting",
      "agent.working",
      "agent.reporting",
      "agent.reviewing",
      "agent.done",
      "agent.done",
      "agent.done",
      "agent.done",
    ]);
    expect(events[0].message).toBe("Plan my interview prep");
    expect(new Set(events.map((event) => event.taskId)).size).toBe(1);
  });

  it("emits the same event ids for the same input", async () => {
    const first = [];
    const second = [];

    for await (const event of mockRunAdapter.startRun("Plan my interview prep")) {
      first.push(event);
    }

    for await (const event of mockRunAdapter.startRun("Plan my interview prep")) {
      second.push(event);
    }

    expect(second.map((event) => event.eventId)).toEqual(first.map((event) => event.eventId));
    expect(second.map((event) => event.taskId)).toEqual(first.map((event) => event.taskId));
  });

  it("emits terminal done events for participating specialist agents", async () => {
    const events = [];

    for await (const event of mockRunAdapter.startRun("Plan my interview prep")) {
      events.push(event);
    }

    expect(
      events
        .filter((event) => event.type === "agent.done")
        .map((event) => event.agentId),
    ).toEqual(["orion", "neria", "argus", "luma"]);
  });
});
