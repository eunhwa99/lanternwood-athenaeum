import type { AgentDefinition, AgentId, ScenePosition } from "../agents/types";

export const SCENE_SIZE = {
  width: 960,
  height: 620,
};

export const CENTRAL_DESK: ScenePosition = {
  x: 480,
  y: 300,
};

export const WORK_POSITIONS: Record<AgentId, ScenePosition> = {
  luma: { x: 480, y: 315 },
  orion: { x: 220, y: 190 },
  neria: { x: 260, y: 430 },
  quill: { x: 690, y: 430 },
  argus: { x: 735, y: 195 },
};

export const REPORT_POSITIONS: Record<AgentId, ScenePosition> = {
  luma: { x: 480, y: 315 },
  orion: { x: 390, y: 282 },
  neria: { x: 410, y: 348 },
  quill: { x: 550, y: 348 },
  argus: { x: 570, y: 282 },
};

export function getAgentScenePosition(agent: AgentDefinition): ScenePosition {
  return agent.homePosition;
}

export function getAgentWorkPosition(agentId: AgentId): ScenePosition {
  return WORK_POSITIONS[agentId];
}

export function getAgentReportPosition(agentId: AgentId): ScenePosition {
  return REPORT_POSITIONS[agentId];
}
