import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDefinition, SystemRole } from "../src/agents/types";

export type CreateAgentDefinitionInput = {
  color: string;
  displayName: string;
  id: string;
  persona: string;
  promptInstruction: string;
  routingKeywords: string[];
  routingReason: string;
  worldRole: string;
};

const agentIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const colorPattern = /^#[0-9a-f]{6}$/i;
const systemRoles = new Set<SystemRole>(["DocumentAgent", "ManagerAgent", "MemoryAgent", "ResearchAgent", "ReviewAgent"]);

function assertNonEmpty(value: string, label: string) {
  if (!value.trim()) {
    throw new Error(`${label} is required`);
  }
}

function normalizeKeywords(keywords: string[]) {
  return Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)));
}

function normalizeColor(color: string) {
  return color.toLocaleLowerCase();
}

export function validateAgentDefinitionInput(input: CreateAgentDefinitionInput) {
  if (!agentIdPattern.test(input.id)) {
    throw new Error("Agent id must use lowercase letters, numbers, and hyphens");
  }

  if (!colorPattern.test(input.color)) {
    throw new Error("Agent color must be a hex color");
  }

  assertNonEmpty(input.displayName, "Display name");
  assertNonEmpty(input.persona, "Persona");
  assertNonEmpty(input.promptInstruction, "Prompt instruction");
  assertNonEmpty(input.routingReason, "Routing reason");
  assertNonEmpty(input.worldRole, "World role");

  const routingKeywords = normalizeKeywords(input.routingKeywords);

  if (routingKeywords.length === 0) {
    throw new Error("At least one routing keyword is required");
  }

  return {
    ...input,
    color: normalizeColor(input.color),
    displayName: input.displayName.trim(),
    persona: input.persona.trim(),
    promptInstruction: input.promptInstruction.trim(),
    routingKeywords,
    routingReason: input.routingReason.trim(),
    worldRole: input.worldRole.trim(),
  };
}

export async function createAgentDefinition(catalogRoot: string, input: CreateAgentDefinitionInput) {
  const normalized = validateAgentDefinitionInput(input);
  const agentDirectory = join(catalogRoot, normalized.id);

  await mkdir(agentDirectory, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") {
      throw new Error("Agent already exists");
    }

    throw error;
  });

  const agentDefinition = {
    color: normalized.color,
    displayName: normalized.displayName,
    futureTools: [],
    homePosition: { x: 480, y: 300 },
    id: normalized.id,
    promptInstruction: normalized.promptInstruction,
    routing: {
      keywords: normalized.routingKeywords,
      reason: normalized.routingReason,
    },
    systemRole: "ResearchAgent",
    worldRole: normalized.worldRole,
  };

  await Promise.all([
    writeFile(join(agentDirectory, "agent.json"), `${JSON.stringify(agentDefinition, null, 2)}\n`, "utf8"),
    writeFile(join(agentDirectory, "persona.md"), `${normalized.persona}\n`, "utf8"),
  ]);

  return {
    agentDirectory,
    id: normalized.id,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function parseScenePosition(value: unknown) {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    return { x: 480, y: 300 };
  }

  return { x: value.x, y: value.y };
}

function parseAgentDefinition(value: unknown, persona: string): AgentDefinition {
  if (!isRecord(value) || typeof value.id !== "string" || !agentIdPattern.test(value.id)) {
    throw new Error("Invalid agent id");
  }

  const routing = isRecord(value.routing) ? value.routing : {};
  const systemRole = typeof value.systemRole === "string" && systemRoles.has(value.systemRole as SystemRole)
    ? (value.systemRole as SystemRole)
    : "ResearchAgent";

  return {
    color: typeof value.color === "string" && colorPattern.test(value.color) ? normalizeColor(value.color) : "#7aa2f7",
    displayName: typeof value.displayName === "string" && value.displayName.trim() ? value.displayName.trim() : value.id,
    futureTools: parseStringArray(value.futureTools),
    homePosition: parseScenePosition(value.homePosition),
    id: value.id,
    persona: persona.trim(),
    promptInstruction:
      typeof value.promptInstruction === "string" && value.promptInstruction.trim()
        ? value.promptInstruction.trim()
        : "Return concise specialist notes for the requested task.",
    routing: {
      keywords: parseStringArray(routing.keywords),
      reason:
        typeof routing.reason === "string" && routing.reason.trim()
          ? routing.reason.trim()
          : "specialist task handling",
    },
    systemRole,
    worldRole: typeof value.worldRole === "string" && value.worldRole.trim() ? value.worldRole.trim() : "Specialist",
  };
}

const builtinAgentOrder = ["luma", "orion", "neria", "quill", "argus"];

function agentOrder(agent: AgentDefinition) {
  const builtinIndex = builtinAgentOrder.indexOf(agent.id);

  return builtinIndex >= 0 ? builtinIndex : builtinAgentOrder.length;
}

async function loadAgentDefinitionFromDirectory(agentDirectory: string) {
  let rawJson: string;

  try {
    rawJson = await readFile(join(agentDirectory, "agent.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  const persona = await readFile(join(agentDirectory, "persona.md"), "utf8").catch(() => "");

  return parseAgentDefinition(JSON.parse(rawJson), persona);
}

async function loadAgentDefinitionFromFile(catalogRoot: string, fileName: string) {
  const rawJson = await readFile(join(catalogRoot, fileName), "utf8");
  const agentId = fileName.replace(/\.json$/i, "");
  const persona = await readFile(join(catalogRoot, agentId, "persona.md"), "utf8").catch(() => "");

  return parseAgentDefinition(JSON.parse(rawJson), persona);
}

export async function loadAgentDefinitions(catalogRoot = join(process.cwd(), ".agents", "lanternwood", "agents")) {
  const entries = await readdir(catalogRoot, { withFileTypes: true }).catch(() => []);
  const directoryAgents = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => loadAgentDefinitionFromDirectory(join(catalogRoot, entry.name))),
  );
  const fileAgents = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => loadAgentDefinitionFromFile(catalogRoot, entry.name)),
  );
  const agentsById = new Map<string, AgentDefinition>();

  for (const agent of [...fileAgents, ...directoryAgents]) {
    if (agent) {
      agentsById.set(agent.id, agent);
    }
  }

  return Array.from(agentsById.values())
    .sort((left, right) => agentOrder(left) - agentOrder(right) || left.id.localeCompare(right.id));
}
