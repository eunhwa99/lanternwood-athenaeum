import type { AgentId, ScenePosition } from "../agents/types";

export const SCENE_SIZE = {
  width: 960,
  height: 620,
};

export const CENTRAL_DESK: ScenePosition = {
  x: 480,
  y: 300,
};

export const HOME_POSITIONS: Record<AgentId, ScenePosition> = {
  luma: { x: 480, y: 300 },
  orion: { x: 230, y: 165 },
  neria: { x: 280, y: 455 },
  quill: { x: 690, y: 455 },
  argus: { x: 735, y: 175 },
};
