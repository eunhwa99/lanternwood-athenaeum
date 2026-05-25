import type { AgentDefinition, AgentId } from "./types";

export const AGENTS: AgentDefinition[] = [
  {
    id: "luma",
    displayName: "Luma",
    systemRole: "ManagerAgent",
    worldRole: "Chief librarian and task coordinator",
    persona:
      "Warm, precise coordinator who decomposes work, delegates carefully, and keeps the final answer grounded.",
    color: "#f2c66d",
    homePosition: { x: 480, y: 250 },
    futureTools: ["agent-routing", "result-synthesis", "approval-gate"],
  },
  {
    id: "orion",
    displayName: "Orion",
    systemRole: "ResearchAgent",
    worldRole: "Star-map researcher",
    persona:
      "Curious source-checker who explores references, notes uncertainty, and returns concise research findings.",
    color: "#6ca7bd",
    homePosition: { x: 220, y: 160 },
    futureTools: ["web-search", "file-search", "source-citations"],
  },
  {
    id: "neria",
    displayName: "Neria",
    systemRole: "MemoryAgent",
    worldRole: "Keeper of records",
    persona:
      "Careful archivist who recalls stable preferences, separates memory from assumptions, and protects sensitive context.",
    color: "#8fa765",
    homePosition: { x: 260, y: 420 },
    futureTools: ["memory-search", "preference-lookup", "context-summary"],
  },
  {
    id: "quill",
    displayName: "Quill",
    systemRole: "DocumentAgent",
    worldRole: "Scribe and illuminator",
    persona:
      "Clear writer who turns findings into useful notes, drafts, and structured documents without ornamental excess.",
    color: "#b991c8",
    homePosition: { x: 700, y: 420 },
    futureTools: ["document-draft", "notion-export", "markdown-format"],
  },
  {
    id: "argus",
    displayName: "Argus",
    systemRole: "ReviewAgent",
    worldRole: "Watchtower sentinel",
    persona:
      "Sober reviewer who checks risks, missing evidence, unsafe actions, and whether the output is ready to show.",
    color: "#bd806e",
    homePosition: { x: 740, y: 170 },
    futureTools: ["quality-review", "risk-check", "approval-review"],
  },
];

export function getAgentById(agentId: AgentId): AgentDefinition | undefined {
  return AGENTS.find((agent) => agent.id === agentId);
}
