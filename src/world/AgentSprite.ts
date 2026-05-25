import { Container } from "pixi.js";
import type { AgentRuntimeState } from "../events/types";
import { getAvatarPose } from "./avatarAnimation";
import { createAvatarParts, type AvatarParts } from "./avatarParts";

export type AgentSpriteView = {
  container: Container;
  parts: AvatarParts;
};

export function createAgentSprite(agent: AgentRuntimeState): AgentSpriteView {
  const parts = createAvatarParts(agent.definition);
  parts.root.scale.set(1.05);

  return {
    container: parts.root,
    parts,
  };
}

export function updateAgentSprite(view: AgentSpriteView, agent: AgentRuntimeState, elapsedSeconds: number, isTravelling: boolean): void {
  const pose = getAvatarPose(agent.status, elapsedSeconds, isTravelling);

  view.container.alpha = agent.status === "idle" ? 0.88 : 1;
  view.parts.body.y = -pose.bob;
  view.parts.head.y = -pose.bob * 0.8;
  view.parts.leftArm.rotation = pose.armSwing;
  view.parts.rightArm.rotation = -pose.armSwing;
  view.parts.leftLeg.rotation = pose.legSwing;
  view.parts.rightLeg.rotation = -pose.legSwing;
  view.parts.prop.rotation = pose.propAngle;
  view.parts.effect.alpha = pose.effectAlpha;
  view.parts.effect.scale.set(0.85 + pose.effectAlpha * 0.35);
  view.parts.leftEye.scale.y = pose.blinkScale;
  view.parts.rightEye.scale.y = pose.blinkScale;
}
