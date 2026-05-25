import type { AgentDefinition, ScenePosition } from "../agents/types";
import type { AgentStatus } from "../events/types";
import { getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

export type AvatarPoseMode =
  | "idle"
  | "planning"
  | "moving"
  | "working"
  | "reporting"
  | "reviewing"
  | "done"
  | "failed";

export type AvatarPose = {
  mode: AvatarPoseMode;
  bob: number;
  armSwing: number;
  legSwing: number;
  propAngle: number;
  effectAlpha: number;
  blinkScale: number;
};

const activeStatuses = new Set<AgentStatus>([
  "planning",
  "moving",
  "working",
  "reporting",
  "reviewing",
  "waitingApproval",
]);

export function getAgentSceneTarget(agent: AgentDefinition, status: AgentStatus): ScenePosition {
  if (activeStatuses.has(status)) {
    return getAgentWorkPosition(agent.id);
  }

  return getAgentScenePosition(agent);
}

export function getAvatarPose(status: AgentStatus, elapsedSeconds: number, isTravelling: boolean): AvatarPose {
  const wave = Math.sin(elapsedSeconds * Math.PI * 2);
  const fastWave = Math.sin(elapsedSeconds * Math.PI * 5);
  const blinkScale = Math.sin(elapsedSeconds * Math.PI * 0.8) > 0.96 ? 0.18 : 1;

  if (isTravelling || status === "moving") {
    return {
      mode: "moving",
      bob: Math.abs(fastWave) * 5,
      armSwing: fastWave * 0.45,
      legSwing: -fastWave * 0.55,
      propAngle: fastWave * 0.15,
      effectAlpha: 0.25,
      blinkScale,
    };
  }

  switch (status) {
    case "planning":
      return { mode: "planning", bob: wave * 2, armSwing: 0.18, legSwing: 0, propAngle: wave * 0.08, effectAlpha: 0.28, blinkScale };
    case "working":
      return {
        mode: "working",
        bob: wave * 2,
        armSwing: fastWave * 0.22,
        legSwing: 0,
        propAngle: fastWave * 0.18,
        effectAlpha: 0.5 + Math.abs(wave) * 0.25,
        blinkScale,
      };
    case "reporting":
      return { mode: "reporting", bob: wave * 1.5, armSwing: -0.45, legSwing: 0, propAngle: -0.35, effectAlpha: 0.38, blinkScale };
    case "reviewing":
      return {
        mode: "reviewing",
        bob: wave * 1.5,
        armSwing: fastWave * 0.12,
        legSwing: 0,
        propAngle: wave * 0.2,
        effectAlpha: 0.55 + Math.abs(wave) * 0.3,
        blinkScale,
      };
    case "done":
      return { mode: "done", bob: Math.max(0, wave) * 2, armSwing: -0.2, legSwing: 0, propAngle: -0.1, effectAlpha: 0.18, blinkScale };
    case "failed":
      return { mode: "failed", bob: 0, armSwing: 0, legSwing: 0, propAngle: 0, effectAlpha: 0.7, blinkScale };
    default:
      return { mode: "idle", bob: wave * 2, armSwing: wave * 0.08, legSwing: 0, propAngle: wave * 0.04, effectAlpha: 0.12, blinkScale };
  }
}

export function approach(current: number, target: number, deltaSeconds: number, speed: number): number {
  const distance = target - current;
  const step = Math.min(1, deltaSeconds * speed);

  return current + distance * step;
}
