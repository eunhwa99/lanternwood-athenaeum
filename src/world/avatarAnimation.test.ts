import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { getAgentSceneTarget, getAvatarPose } from "./avatarAnimation";
import { CENTRAL_DESK, getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

describe("avatar animation", () => {
  it("keeps idle and done agents at their home position", () => {
    const luma = AGENTS[0];

    expect(getAgentSceneTarget(luma, "idle")).toEqual(getAgentScenePosition(luma));
    expect(getAgentSceneTarget(luma, "done")).toEqual(getAgentScenePosition(luma));
  });

  it("moves working agents to role-specific work positions", () => {
    const orion = AGENTS.find((agent) => agent.id === "orion")!;

    expect(getAgentSceneTarget(orion, "working")).toEqual(getAgentWorkPosition("orion"));
  });

  it("routes reporting agents back toward the central manager desk", () => {
    const orion = AGENTS.find((agent) => agent.id === "orion")!;
    const workPosition = getAgentWorkPosition("orion");
    const reportPosition = getAgentSceneTarget(orion, "reporting");

    expect(reportPosition).not.toEqual(workPosition);
    expect(Math.hypot(reportPosition.x - CENTRAL_DESK.x, reportPosition.y - CENTRAL_DESK.y)).toBeLessThan(
      Math.hypot(workPosition.x - CENTRAL_DESK.x, workPosition.y - CENTRAL_DESK.y),
    );
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

  it("settles the done bounce after the completion moment", () => {
    const earlyPose = getAvatarPose("done", 0.25, false, 0.1);
    const settledPose = getAvatarPose("done", 0.25, false, 1.2);

    expect(earlyPose.bob).toBeGreaterThan(0);
    expect(settledPose.bob).toBe(0);
  });

  it("uses a red warning effect for failed agents", () => {
    const pose = getAvatarPose("failed", 0.25, false);

    expect(pose.effectColor).toBe(0xdd7777);
    expect(pose.effectAlpha).toBeGreaterThan(0.5);
  });
});
