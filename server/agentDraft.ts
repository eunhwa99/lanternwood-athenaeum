import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAgentDefinitionInput, type CreateAgentDefinitionInput } from "./agentCatalog";
import { runCodexCommand, type CodexProgressHandler, type RunCodexCommandOptions } from "./codexWorkflow";

type AgentDraftRunCommand = (
  prompt: string,
  onProgress?: CodexProgressHandler,
  options?: RunCodexCommandOptions,
) => Promise<string>;

type CreateAgentDraftOptions = {
  existingAgentIds?: string[];
  runCommand?: AgentDraftRunCommand;
  signal?: AbortSignal;
  workspacePath?: string;
};

const agentDraftSchemaPath = join(dirname(fileURLToPath(import.meta.url)), "agentDraftSchema.json");

function buildAgentDraftPrompt(description: string, existingAgentIds: string[]) {
  return `You create Lanternwood Athenaeum agent definition drafts.

Return only one JSON object matching this exact shape:
{
  "id": "lowercase-hyphen-id",
  "displayName": "Readable Name",
  "worldRole": "Short scene role",
  "color": "#7AA2F7",
  "routingKeywords": ["keyword"],
  "routingReason": "when this agent should be selected",
  "promptInstruction": "one sentence instruction for the specialist",
  "persona": "one paragraph persona for persona.md"
}

Rules:
- Do not write files.
- Do not run commands.
- Do not include markdown fences or explanatory text.
- Use lowercase letters, numbers, and hyphens for id.
- Avoid existing agent ids: ${existingAgentIds.length > 0 ? existingAgentIds.join(", ") : "none"}.
- Make routingKeywords specific, concise, and useful for automatic routing.
- Keep promptInstruction direct and scoped to the described specialty.
- Keep persona concrete and operational.

Existing agent ids: ${existingAgentIds.length > 0 ? existingAgentIds.join(", ") : "none"}

Agent description:
${description}`;
}

function parseJsonObject(output: string) {
  const trimmed = output.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);

    if (fenced) {
      return JSON.parse(fenced[1]) as unknown;
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }

    throw new Error("Codex agent draft output did not include a JSON object.");
  }
}

function coerceDraft(value: unknown): CreateAgentDefinitionInput {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  return {
    color: typeof record.color === "string" ? record.color : "",
    displayName: typeof record.displayName === "string" ? record.displayName : "",
    id: typeof record.id === "string" ? record.id : "",
    persona: typeof record.persona === "string" ? record.persona : "",
    promptInstruction: typeof record.promptInstruction === "string" ? record.promptInstruction : "",
    routingKeywords: Array.isArray(record.routingKeywords)
      ? record.routingKeywords.filter((keyword): keyword is string => typeof keyword === "string")
      : [],
    routingReason: typeof record.routingReason === "string" ? record.routingReason : "",
    worldRole: typeof record.worldRole === "string" ? record.worldRole : "",
  };
}

export async function createAgentDraftWithCodex(description: string, options: CreateAgentDraftOptions = {}) {
  const trimmedDescription = description.trim();

  if (!trimmedDescription) {
    throw new Error("Agent description is required");
  }

  const runCommand = options.runCommand ?? runCodexCommand;
  const output = await runCommand(buildAgentDraftPrompt(trimmedDescription, options.existingAgentIds ?? []), undefined, {
    outputSchemaPath: agentDraftSchemaPath,
    sandboxMode: "read-only",
    signal: options.signal,
    workspacePath: options.workspacePath ?? process.cwd(),
  });

  return validateAgentDefinitionInput(coerceDraft(parseJsonObject(output)));
}