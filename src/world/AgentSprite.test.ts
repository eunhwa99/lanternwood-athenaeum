import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { createInitialRunState } from "../events/reducer";
import { createAgentSprite, updateAgentSprite } from "./AgentSprite";

describe("agent sprite", () => {
  it("creates an articulated character view for an agent", () => {
    const state = createInitialRunState(AGENTS);
    const luma = state.agents.luma;

    const view = createAgentSprite(luma);

    expect(view.container.children.length).toBeGreaterThan(6);
    expect(view.parts.body).toBeDefined();
    expect(view.parts.head).toBeDefined();
    expect(view.parts.leftArm).toBeDefined();
    expect(view.parts.rightArm).toBeDefined();
    expect(view.parts.prop).toBeDefined();
  });

  it("updates pose parts from runtime status", () => {
    const state = createInitialRunState(AGENTS);
    const luma = { ...state.agents.luma, status: "reviewing" as const };
    const view = createAgentSprite(luma);

    updateAgentSprite(view, luma, 0.4, false);

    expect(view.parts.effect.alpha).toBeGreaterThan(0.2);
    expect(view.parts.leftEye.scale.y).toBeGreaterThan(0);
    expect(view.parts.rightArm.rotation).not.toBe(view.parts.leftArm.rotation);
  });
});
