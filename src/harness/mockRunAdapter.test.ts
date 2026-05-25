import { describe, expect, it, vi } from "vitest";
import { createMockRunAdapter, mockRunAdapter } from "./mockRunAdapter";

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
      "approval.requested",
      "agent.done",
      "agent.done",
      "agent.done",
      "agent.done",
    ]);
    expect(events[0].message).toBe("Plan my interview prep");
    expect(events[8].message).toBe("Luma raises the blue approval lantern");
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

  it("derives different task ids for different inputs", async () => {
    const first = [];
    const second = [];

    for await (const event of mockRunAdapter.startRun("Plan my interview prep")) {
      first.push(event);
    }

    for await (const event of mockRunAdapter.startRun("Draft a project roadmap")) {
      second.push(event);
    }

    expect(second[0].taskId).not.toBe(first[0].taskId);
    expect(second[0].eventId).not.toBe(first[0].eventId);
  });

  it("does not collide for known base-31 hash collision inputs", async () => {
    const first = [];
    const second = [];

    for await (const event of mockRunAdapter.startRun("Aa")) {
      first.push(event);
    }

    for await (const event of mockRunAdapter.startRun("BB")) {
      second.push(event);
    }

    expect(second[0].taskId).not.toBe(first[0].taskId);
    expect(second[0].eventId).not.toBe(first[0].eventId);
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

  it("can delay event delivery for visible UI animation", async () => {
    vi.useFakeTimers();
    const adapter = createMockRunAdapter({ eventDelayMs: 300 });
    const iterator = adapter.startRun("Plan my interview prep")[Symbol.asyncIterator]();

    const first = iterator.next();
    let settled = false;
    first.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(299);
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect((await first).value.type).toBe("task.created");
    vi.useRealTimers();
  });
});
