import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { getAgentSceneTarget, getAvatarPose } from "./avatarAnimation";
import { getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

describe("avatar animation", () => {
  it("keeps idle and done agents at their home position", () => {
    const luma = AGENTS[0];

    expect(getAgentSceneTarget(luma, "idle")).toEqual(getAgentScenePosition(luma));
    expect(getAgentSceneTarget(luma, "done")).toEqual(getAgentScenePosition(luma));
  });

  it("moves active agents to role-specific work positions", () => {
    const orion = AGENTS.find((agent) => agent.id === "orion")!;

    expect(getAgentSceneTarget(orion, "working")).toEqual(getAgentWorkPosition("orion"));
    expect(getAgentSceneTarget(orion, "reporting")).toEqual(getAgentWorkPosition("orion"));
  });

  it("returns a walking pose while an avatar is travelling", () => {
    const pose = getAvatarPose("working", 0.25, true);

    expect(pose.mode).toBe("moving");
    expect(Math.abs(pose.legSwing)).toBeGreaterThan(0);
    expect(pose.bob).not.toBe(0);
  });

  it("returns a review glow pose for reviewing state", () => {
    const pose = getAvatarPose("reviewing", 0.5, false);

    expect(pose.mode).toBe("reviewing");
    expect(pose.effectAlpha).toBeGreaterThan(0.2);
  });
});
