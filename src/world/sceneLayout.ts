import type { AgentDefinition, ScenePosition } from "../agents/types";

export const SCENE_SIZE = {
  width: 960,
  height: 620,
};

export const CENTRAL_DESK: ScenePosition = {
  x: 480,
  y: 300,
};

export function getAgentScenePosition(agent: AgentDefinition): ScenePosition {
  return agent.homePosition;
}
