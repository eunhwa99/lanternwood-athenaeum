import { describe, expect, it } from "vitest";
import { createTaskId } from "./taskIds";

describe("task ids", () => {
  it("creates short stable ids for long prompts", () => {
    const prompt = "Draft a focused migration plan. ".repeat(80);
    const first = createTaskId(prompt);
    const second = createTaskId(prompt);

    expect(second).toBe(first);
    expect(first).toMatch(/^task-[a-z0-9]+-[a-z0-9]+$/);
    expect(first.length).toBeLessThanOrEqual(32);
  });

  it("normalizes surrounding whitespace without collapsing distinct prompts", () => {
    expect(createTaskId("  Plan my interview prep  ")).toBe(createTaskId("Plan my interview prep"));
    expect(createTaskId("Plan my interview prep")).not.toBe(createTaskId("Plan my project prep"));
  });

  it("does not collide for known simple hash-collision-like inputs", () => {
    expect(createTaskId("Aa")).not.toBe(createTaskId("BB"));
  });
});
