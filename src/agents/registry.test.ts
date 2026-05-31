import { describe, expect, it } from "vitest";
import { AGENTS, getAgentById } from "./registry";

describe("agent registry", () => {
  it("loads the built-in roster from repo-local .agents definitions", () => {
    expect(AGENTS.map((agent) => agent.id)).toEqual(["luma", "orion", "neria", "quill", "argus"]);
    expect(getAgentById("orion")).toMatchObject({
      displayName: "Orion",
      promptInstruction: expect.stringContaining("Identify research context"),
      routing: {
        reason: expect.stringContaining("technical analysis"),
      },
    });
  });
});