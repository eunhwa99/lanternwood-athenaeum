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

  it("places specialist reporting targets close enough to read as a Luma handoff", () => {
    const specialistAgents = AGENTS.filter((agent) => agent.id !== "luma");

    for (const agent of specialistAgents) {
      const reportPosition = getAgentSceneTarget(agent, "reporting");

      expect(
        Math.hypot(reportPosition.x - CENTRAL_DESK.x, reportPosition.y - CENTRAL_DESK.y),
        `${agent.displayName} report handoff distance`,
      ).toBeLessThan(64);
    }
  });

  it("returns a walking pose while an avatar is travelling", () => {
    const pose = getAvatarPose("working", 0.25, true);

    expect(pose.mode).toBe("working");
    expect(Math.abs(pose.legSwing)).toBeGreaterThan(0);
    expect(pose.bob).not.toBe(0);
  });

  it("returns a review glow pose for reviewing state", () => {
    const pose = getAvatarPose("reviewing", 0.5, false);

    expect(pose.mode).toBe("reviewing");
    expect(pose.effectAlpha).toBeGreaterThan(0.2);
  });

  it("keeps approval waits visually distinct and active", () => {
    const pose = getAvatarPose("waitingApproval", 0.5, false);

    expect(pose.mode).toBe("waitingApproval");
    expect(pose.effectAlpha).toBeGreaterThan(0.4);
    expect(pose.effectColor).toBe(0x8fd7ff);
  });

  it("preserves approval wait identity while travelling", () => {
    const pose = getAvatarPose("waitingApproval", 0.25, true);

    expect(pose.mode).toBe("waitingApproval");
    expect(Math.abs(pose.legSwing)).toBeGreaterThan(0);
    expect(pose.effectColor).toBe(0x8fd7ff);
  });

  it("preserves reporting and review identity while travelling", () => {
    const reportingPose = getAvatarPose("reporting", 0.25, true);
    const reviewPose = getAvatarPose("reviewing", 0.25, true);

    expect(reportingPose.mode).toBe("reporting");
    expect(reportingPose.legSwing).not.toBe(0);
    expect(reviewPose.mode).toBe("reviewing");
    expect(reviewPose.legSwing).not.toBe(0);
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

  it("keeps failed warning colors while the failed avatar is travelling", () => {
    const pose = getAvatarPose("failed", 0.25, true);

    expect(pose.mode).toBe("failed");
    expect(pose.effectColor).toBe(0xdd7777);
    expect(pose.effectAlpha).toBeGreaterThan(0.5);
  });

  it("keeps a done arrival pose visible while the avatar is travelling home", () => {
    const pose = getAvatarPose("done", 0.25, true, 2);

    expect(pose.mode).toBe("done");
    expect(Math.abs(pose.legSwing)).toBeGreaterThan(0);
    expect(pose.effectAlpha).toBeGreaterThan(0.1);
  });
});
