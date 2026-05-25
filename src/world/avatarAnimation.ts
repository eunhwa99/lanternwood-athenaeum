import type { AgentDefinition, ScenePosition } from "../agents/types";
import type { AgentStatus } from "../events/types";
import { getAgentReportPosition, getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

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
  effectColor: number;
  blinkScale: number;
};

const activeStatuses = new Set<AgentStatus>([
  "planning",
  "moving",
  "working",
  "reviewing",
  "waitingApproval",
]);

export function getAgentSceneTarget(agent: AgentDefinition, status: AgentStatus): ScenePosition {
  if (status === "reporting") {
    return getAgentReportPosition(agent.id);
  }

  if (activeStatuses.has(status)) {
    return getAgentWorkPosition(agent.id);
  }

  return getAgentScenePosition(agent);
}

export function getAvatarPose(status: AgentStatus, elapsedSeconds: number, isTravelling: boolean, statusElapsedSeconds = elapsedSeconds): AvatarPose {
  const wave = Math.sin(elapsedSeconds * Math.PI * 2);
  const fastWave = Math.sin(elapsedSeconds * Math.PI * 5);
  const blinkScale = Math.sin(elapsedSeconds * Math.PI * 0.8) > 0.96 ? 0.18 : 1;
  const effectColor = 0xf2c66d;

  if (status === "failed") {
    return { mode: "failed", bob: 0, armSwing: 0, legSwing: 0, propAngle: 0, effectAlpha: 0.72 + Math.abs(wave) * 0.18, effectColor: 0xdd7777, blinkScale };
  }

  if (status === "done" && isTravelling) {
    return {
      mode: "done",
      bob: Math.abs(fastWave) * 5,
      armSwing: fastWave * 0.28,
      legSwing: -fastWave * 0.55,
      propAngle: -0.1,
      effectAlpha: 0.18,
      effectColor,
      blinkScale,
    };
  }

  const travelOverlay = isTravelling || status === "moving";
  const travelBob = Math.abs(fastWave) * 5;
  const travelLegSwing = -fastWave * 0.55;

  if (status === "moving") {
    return {
      mode: "moving",
      bob: Math.abs(fastWave) * 5,
      armSwing: fastWave * 0.45,
      legSwing: -fastWave * 0.55,
      propAngle: fastWave * 0.15,
      effectAlpha: 0.25,
      effectColor,
      blinkScale,
    };
  }

  switch (status) {
    case "planning":
      return {
        mode: "planning",
        bob: travelOverlay ? travelBob : wave * 2,
        armSwing: travelOverlay ? fastWave * 0.3 : 0.18,
        legSwing: travelOverlay ? travelLegSwing : 0,
        propAngle: wave * 0.08,
        effectAlpha: 0.28,
        effectColor,
        blinkScale,
      };
    case "working":
      return {
        mode: "working",
        bob: travelOverlay ? travelBob : wave * 2,
        armSwing: fastWave * 0.22,
        legSwing: travelOverlay ? travelLegSwing : 0,
        propAngle: fastWave * 0.18,
        effectAlpha: 0.5 + Math.abs(wave) * 0.25,
        effectColor,
        blinkScale,
      };
    case "reporting":
      return {
        mode: "reporting",
        bob: travelOverlay ? travelBob : wave * 1.5,
        armSwing: -0.45,
        legSwing: travelOverlay ? travelLegSwing : 0,
        propAngle: -0.35,
        effectAlpha: 0.38,
        effectColor,
        blinkScale,
      };
    case "waitingApproval":
    case "reviewing":
      return {
        mode: "reviewing",
        bob: travelOverlay ? travelBob : wave * 1.5,
        armSwing: fastWave * 0.12,
        legSwing: travelOverlay ? travelLegSwing : 0,
        propAngle: wave * 0.2,
        effectAlpha: 0.55 + Math.abs(wave) * 0.3,
        effectColor,
        blinkScale,
      };
    case "done": {
      const settleFactor = Math.max(0, 1 - statusElapsedSeconds / 0.9);
      return {
        mode: "done",
        bob: Math.max(0, wave) * 2 * settleFactor,
        armSwing: -0.2 * settleFactor,
        legSwing: 0,
        propAngle: -0.1,
        effectAlpha: 0.18 * Math.max(0.35, settleFactor),
        effectColor,
        blinkScale,
      };
    }
    default:
      return { mode: "idle", bob: wave * 2, armSwing: wave * 0.08, legSwing: 0, propAngle: wave * 0.04, effectAlpha: 0.12, effectColor, blinkScale };
  }
}

export function approach(current: number, target: number, deltaSeconds: number, speed: number): number {
  const distance = target - current;
  const step = Math.min(1, deltaSeconds * speed);

  return current + distance * step;
}
