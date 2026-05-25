export type AgentId = "luma" | "orion" | "neria" | "quill" | "argus";

export type SystemRole =
  | "ManagerAgent"
  | "ResearchAgent"
  | "MemoryAgent"
  | "DocumentAgent"
  | "ReviewAgent";

export type ScenePosition = {
  x: number;
  y: number;
};

export type AgentDefinition = {
  id: AgentId;
  displayName: string;
  systemRole: SystemRole;
  worldRole: string;
  persona: string;
  color: string;
  homePosition: ScenePosition;
  futureTools: string[];
};
