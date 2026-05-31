import type { AgentDefinition, AgentId, ScenePosition } from "../agents/types";

 export const SCENE_SIZE = {
   width: 960,
   height: 620,
 };

 export const CENTRAL_DESK: ScenePosition = {
   x: 480,
   y: 300,
 };

export const WORK_POSITIONS: Partial<Record<AgentId, ScenePosition>> = {
   luma: { x: 480, y: 315 },
   orion: { x: 220, y: 190 },
   neria: { x: 260, y: 430 },
   quill: { x: 690, y: 430 },
   argus: { x: 735, y: 195 },
 };

export const REPORT_POSITIONS: Partial<Record<AgentId, ScenePosition>> = {
   luma: { x: 480, y: 315 },
   orion: { x: 440, y: 286 },
   neria: { x: 445, y: 330 },
   quill: { x: 515, y: 330 },
   argus: { x: 520, y: 286 },
 };

const BUBBLE_OFFSETS: Partial<Record<AgentId, ScenePosition>> = {
   luma: { x: -125, y: -140 },
   orion: { x: -280, y: -126 },
   neria: { x: -280, y: -26 },
   quill: { x: 32, y: -26 },
   argus: { x: 32, y: -126 },
 };

export function getAgentScenePosition(agent: AgentDefinition): ScenePosition {
  return agent.homePosition;
}

function hashAgentId(agentId: AgentId) {
  let hash = 0;

  for (const character of agentId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function fallbackOrbitPosition(agentId: AgentId, radiusX: number, radiusY: number, center = CENTRAL_DESK): ScenePosition {
  const angle = (hashAgentId(agentId) % 360) * (Math.PI / 180);

  return {
    x: Math.max(40, Math.min(SCENE_SIZE.width - 40, Math.round(center.x + Math.cos(angle) * radiusX))),
    y: Math.max(60, Math.min(SCENE_SIZE.height - 50, Math.round(center.y + Math.sin(angle) * radiusY))),
  };
}

export function getAgentWorkPosition(agentId: AgentId): ScenePosition {
  return WORK_POSITIONS[agentId] ?? fallbackOrbitPosition(agentId, 280, 180);
}

export function getAgentReportPosition(agentId: AgentId): ScenePosition {
  return REPORT_POSITIONS[agentId] ?? fallbackOrbitPosition(agentId, 78, 52);
}

export function getAgentBubblePosition(agentId: AgentId, ownerPosition: ScenePosition): ScenePosition {
  const offset = BUBBLE_OFFSETS[agentId] ?? { x: ownerPosition.x < CENTRAL_DESK.x ? -280 : 32, y: -86 };

   return {
     x: Math.max(12, Math.min(SCENE_SIZE.width - 250, ownerPosition.x + offset.x)),
     y: Math.max(16, ownerPosition.y + offset.y),
   };
 }