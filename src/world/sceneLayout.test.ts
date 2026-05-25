import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { getAgentScenePosition } from "./sceneLayout";

describe("scene layout", () => {
  it("uses the agent definition home position as the scene position", () => {
    for (const agent of AGENTS) {
      expect(getAgentScenePosition(agent)).toEqual(agent.homePosition);
    }
  });
});
