import type { AgentDefinition } from "./types";

const builtinAgentOrder = ["luma", "orion", "neria", "quill", "argus"];

type AgentJson = Omit<AgentDefinition, "persona">;

const authoredAgentModules = import.meta.glob<AgentJson>("../../.agents/lanternwood/agents/*/agent.json", {
  eager: true,
  import: "default",
});
const builtinAgentModules = import.meta.glob<AgentJson>("../../.agents/lanternwood/agents/*.json", {
  eager: true,
  import: "default",
});
const personaModules = import.meta.glob<string>("../../.agents/lanternwood/agents/*/persona.md", {
  eager: true,
  import: "default",
  query: "?raw",
});

function agentDirectory(path: string) {
  return path.slice(0, path.lastIndexOf("/"));
}

function personaPathFor(path: string, agent: AgentJson) {
  if (path.endsWith("/agent.json")) {
    return `${agentDirectory(path)}/persona.md`;
  }

  return `${agentDirectory(path)}/${agent.id}/persona.md`;
}

function agentOrder(agent: AgentDefinition) {
  const builtinIndex = builtinAgentOrder.indexOf(agent.id);

  return builtinIndex >= 0 ? builtinIndex : builtinAgentOrder.length;
}

function normalizeColor(color: string) {
  return color.toLocaleLowerCase();
}

const agentEntries = [...Object.entries(builtinAgentModules), ...Object.entries(authoredAgentModules)];
const agentsById = new Map<string, AgentDefinition>();

for (const [path, agent] of agentEntries) {
  agentsById.set(agent.id, {
    ...agent,
    color: normalizeColor(agent.color),
    persona: personaModules[personaPathFor(path, agent)]?.trim() ?? "",
  });
}

export const AGENTS: AgentDefinition[] = Array.from(agentsById.values()).sort(
  (left, right) => agentOrder(left) - agentOrder(right) || left.id.localeCompare(right.id),
);

export function getAgentById(agentId: string): AgentDefinition | undefined {
  return AGENTS.find((agent) => agent.id === agentId);
}
