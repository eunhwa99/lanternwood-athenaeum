import { describe, expect, it } from "vitest";
import { AGENTS, getAgentById } from "./registry";

describe("agent registry", () => {
  it("contains the five Lanternwood agents in stable order", () => {
    expect(AGENTS.map((agent) => agent.id)).toEqual([
      "luma",
      "orion",
      "neria",
      "quill",
      "argus",
    ]);
  });

  it("defines Luma as the manager and Argus as the reviewer", () => {
    expect(getAgentById("luma")?.systemRole).toBe("ManagerAgent");
    expect(getAgentById("argus")?.systemRole).toBe("ReviewAgent");
  });

  it("stores visual identity and home position for every agent", () => {
    for (const agent of AGENTS) {
      expect(agent.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(agent.homePosition.x).toBeGreaterThanOrEqual(0);
      expect(agent.homePosition.y).toBeGreaterThanOrEqual(0);
      expect(agent.persona.length).toBeGreaterThan(20);
    }
  });
});
