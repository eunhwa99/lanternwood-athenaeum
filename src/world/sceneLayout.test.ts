import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

describe("scene layout", () => {
  it("uses the agent definition home position as the scene position", () => {
    for (const agent of AGENTS) {
      expect(getAgentScenePosition(agent)).toEqual(agent.homePosition);
    }
  });

  it("defines a role-specific work position for every agent", () => {
    for (const agent of AGENTS) {
      const position = getAgentWorkPosition(agent.id);

      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(960);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(620);
    }
  });
});
