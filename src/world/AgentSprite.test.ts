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

  it("dims failed avatars and switches the effect ring to warning red", () => {
    const state = createInitialRunState(AGENTS);
    const luma = { ...state.agents.luma, status: "failed" as const };
    const view = createAgentSprite(luma);

    updateAgentSprite(view, luma, 0.4, false);

    expect(view.container.alpha).toBeLessThan(1);
    expect(view.parts.effect.tint).toBe(0xdd7777);
  });

  it("keeps the upper body connected while bobbing", () => {
    const state = createInitialRunState(AGENTS);
    const luma = { ...state.agents.luma, status: "working" as const };
    const view = createAgentSprite(luma);

    updateAgentSprite(view, luma, 0.25, true);

    expect(view.parts.leftArm.y).toBe(view.parts.body.y - 4);
    expect(view.parts.rightArm.y).toBe(view.parts.body.y - 4);
    expect(view.parts.prop.y).toBe(view.parts.body.y - 10);
  });

  it("blinks eyes in place", () => {
    const state = createInitialRunState(AGENTS);
    const view = createAgentSprite(state.agents.luma);
    const originalLeftEyeY = view.parts.leftEye.y;
    const originalRightEyeY = view.parts.rightEye.y;

    expect(originalLeftEyeY).toBe(-33);
    expect(originalRightEyeY).toBe(-33);

    updateAgentSprite(view, state.agents.luma, 0.65, false);

    expect(view.parts.leftEye.y).toBe(originalLeftEyeY);
    expect(view.parts.rightEye.y).toBe(originalRightEyeY);
    expect(view.parts.leftEye.scale.y).toBeLessThan(1);
  });
});
