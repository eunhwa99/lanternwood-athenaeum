import { describe, expect, it } from "vitest";
import { validatePreviousRun } from "./requestValidation";

describe("request validation", () => {
  it("accepts and bounds previous run context", () => {
    const previousRun = validatePreviousRun({
      delegatedAgents: ["Orion"],
      finalOutput: "x".repeat(8_100),
      prompt: "Previous prompt",
      taskId: "task-previous",
      timeline: Array.from({ length: 30 }, (_, index) => `event ${index}`),
    });

    expect(previousRun?.delegatedAgents).toEqual(["Orion"]);
    expect(previousRun?.finalOutput).toHaveLength(8_000);
    expect(previousRun?.timeline).toHaveLength(24);
  });

  it("rejects malformed previous run context instead of silently ignoring it", () => {
    expect(() => validatePreviousRun({ prompt: "missing fields" })).toThrow("Invalid previousRun");
  });
});
