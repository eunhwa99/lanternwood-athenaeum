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
    ]);
    expect(events[0].message).toBe("Plan my interview prep");
    expect(new Set(events.map((event) => event.taskId)).size).toBe(1);
  });
});
