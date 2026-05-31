export type AgentId = string;

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
  promptInstruction: string;
  routing: {
    keywords: string[];
    reason: string;
  };
};