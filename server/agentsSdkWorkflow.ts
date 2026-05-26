import { Agent, run } from "@openai/agents";
import type { AgentEvent } from "../src/events/types";

type SpecialistReports = Partial<Record<"argus" | "neria" | "orion" | "quill", string>>;

const REQUIRED_SPECIALISTS = [
  { displayName: "Orion", id: "orion" },
  { displayName: "Neria", id: "neria" },
  { displayName: "Quill", id: "quill" },
  { displayName: "Argus", id: "argus" },
] as const;

const reportingMessages: Record<(typeof REQUIRED_SPECIALISTS)[number]["id"], string> = {
  argus: "Argus returns review notes",
  neria: "Neria returns memory context",
  orion: "Orion returns research findings",
  quill: "Quill returns a draft",
};

export type AgentsSdkExecutionResult = {
  finalOutput: unknown;
  specialistReports: SpecialistReports;
};

export type AgentsSdkExecutor = (input: string) => Promise<AgentsSdkExecutionResult>;

export class AgentsSdkRunError extends Error {
  readonly specialistReports: SpecialistReports;

  constructor(message: string, specialistReports: SpecialistReports) {
    super(message);
    this.name = "AgentsSdkRunError";
    this.specialistReports = specialistReports;
  }
}

function stableTaskId(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const encoded = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `task-${encoded || "empty"}`;
}

function event(
  taskId: string,
  index: number,
  agentId: AgentEvent["agentId"],
  type: AgentEvent["type"],
  message: string,
  payload?: AgentEvent["payload"],
): AgentEvent {
  return {
    agentId,
    eventId: `${taskId}-agents-sdk-${index}`,
    message,
    payload,
    taskId,
    timestamp: new Date(Date.UTC(2026, 4, 26, 0, 0, index)).toISOString(),
    type,
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Agents SDK run failed";
}

function reportsFromError(error: unknown): SpecialistReports {
  return error instanceof AgentsSdkRunError ? error.specialistReports : {};
}

function modelConfig() {
  return process.env.OPENAI_AGENTS_MODEL ? { model: process.env.OPENAI_AGENTS_MODEL } : {};
}

function createSpecialistAgent(name: string, instructions: string) {
  return new Agent({
    name,
    instructions,
    ...modelConfig(),
  });
}

function assertRequiredSpecialistsWereCalled(reports: SpecialistReports) {
  const missing = REQUIRED_SPECIALISTS.filter((specialist) => !reports[specialist.id]?.trim()).map(
    (specialist) => specialist.displayName,
  );

  if (missing.length > 0) {
    throw new Error(`Luma did not call required specialist tools: ${missing.join(", ")}`);
  }
}

function requireFinalOutput(value: unknown) {
  const finalOutput = String(value ?? "").trim();

  if (!finalOutput) {
    throw new Error("Luma did not return a final output.");
  }

  return finalOutput;
}

export async function runLanternwoodAgents(input: string): Promise<AgentsSdkExecutionResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run the Agents SDK adapter.");
  }

  const specialistReports: SpecialistReports = {};
  const orion = createSpecialistAgent(
    "Orion",
    "You are Orion, the star-map researcher. Research the request, identify useful references or assumptions, and return concise findings with uncertainty clearly marked.",
  );
  const neria = createSpecialistAgent(
    "Neria",
    "You are Neria, keeper of records. Recall stable user preferences from the provided task context, separate known context from assumptions, and return a concise memory brief.",
  );
  const quill = createSpecialistAgent(
    "Quill",
    "You are Quill, scribe and illuminator. Turn the available findings into a clear draft or structured notes without ornamental excess.",
  );
  const argus = createSpecialistAgent(
    "Argus",
    "You are Argus, watchtower sentinel. Review the draft for risk, missing evidence, unsafe actions, and readiness to show.",
  );

  const luma = new Agent({
    name: "Luma",
    instructions:
      "You are Luma, the Lanternwood orchestrator. You must call ask_orion, ask_neria, ask_quill, and ask_argus exactly once before your final output. Keep control of the final answer and synthesize one practical final output for the user.",
    tools: [
      orion.asTool({
        customOutputExtractor: (result) => {
          specialistReports.orion = String(result.finalOutput ?? "");
          return specialistReports.orion;
        },
        toolDescription: "Research references, assumptions, and source-grounded findings.",
        toolName: "ask_orion",
      }),
      neria.asTool({
        customOutputExtractor: (result) => {
          specialistReports.neria = String(result.finalOutput ?? "");
          return specialistReports.neria;
        },
        toolDescription: "Check stable user preferences and prior context.",
        toolName: "ask_neria",
      }),
      quill.asTool({
        customOutputExtractor: (result) => {
          specialistReports.quill = String(result.finalOutput ?? "");
          return specialistReports.quill;
        },
        toolDescription: "Draft structured notes or final prose from findings.",
        toolName: "ask_quill",
      }),
      argus.asTool({
        customOutputExtractor: (result) => {
          specialistReports.argus = String(result.finalOutput ?? "");
          return specialistReports.argus;
        },
        toolDescription: "Review quality, risk, missing evidence, and readiness.",
        toolName: "ask_argus",
      }),
    ],
    ...modelConfig(),
  });

  let result;
  try {
    result = await run(luma, input, {
      maxTurns: Number(process.env.OPENAI_AGENTS_MAX_TURNS ?? 12),
    });
  } catch (error) {
    throw new AgentsSdkRunError(messageFromError(error), specialistReports);
  }

  return {
    finalOutput: result.finalOutput,
    specialistReports,
  };
}

export async function* createAgentsSdkEvents(input: string, execute: AgentsSdkExecutor = runLanternwoodAgents): AsyncIterable<AgentEvent> {
  const taskId = stableTaskId(input);
  let index = 1;
  const reportedSpecialists = new Set<(typeof REQUIRED_SPECIALISTS)[number]["id"]>();

  yield event(taskId, index++, "luma", "task.created", input);
  yield event(taskId, index++, "luma", "agent.planning", "Luma studies the request and prepares the specialist route");
  yield event(taskId, index++, "luma", "agent.delegated", "Luma opens paths to Orion, Neria, Quill, and Argus");
  yield event(taskId, index++, "orion", "agent.working", "Orion searches the star maps for useful context");
  yield event(taskId, index++, "neria", "agent.working", "Neria checks the archive for stable memory");
  yield event(taskId, index++, "quill", "agent.working", "Quill prepares the draft table");
  yield event(taskId, index++, "argus", "agent.reviewing", "Argus lights the review lantern");

  try {
    const result = await execute(input);
    const reports = result.specialistReports;

    for (const specialist of REQUIRED_SPECIALISTS) {
      const report = reports[specialist.id]?.trim();

      if (report) {
        yield event(taskId, index++, specialist.id, "agent.reporting", reportingMessages[specialist.id], {
          report,
        });
        reportedSpecialists.add(specialist.id);
      }
    }

    assertRequiredSpecialistsWereCalled(reports);
    const finalOutput = requireFinalOutput(result.finalOutput);

    yield event(taskId, index++, "luma", "approval.requested", "Luma raises the blue approval lantern");
    yield event(taskId, index++, "orion", "agent.done", "Orion returns to the star-map balcony");
    yield event(taskId, index++, "neria", "agent.done", "Neria closes the archive ledger");
    yield event(taskId, index++, "quill", "agent.done", "Quill shelves the illuminated draft");
    yield event(taskId, index++, "argus", "agent.done", "Argus lowers the review lantern");
    yield event(taskId, index++, "luma", "agent.done", "Luma places the final summary on the central desk", {
      finalOutput,
    });
  } catch (error) {
    const reports = reportsFromError(error);

    for (const specialist of REQUIRED_SPECIALISTS) {
      const report = reports[specialist.id]?.trim();

      if (report && !reportedSpecialists.has(specialist.id)) {
        yield event(taskId, index++, specialist.id, "agent.reporting", reportingMessages[specialist.id], {
          report,
        });
        reportedSpecialists.add(specialist.id);
      }
    }

    for (const specialist of REQUIRED_SPECIALISTS) {
      if (!reportedSpecialists.has(specialist.id)) {
        yield event(taskId, index++, specialist.id, "agent.failed", `${specialist.displayName}'s route closes before a verified report`);
      }
    }

    yield event(taskId, index++, "luma", "agent.failed", messageFromError(error));
  }
}

export async function collectAgentsSdkEvents(input: string, execute?: AgentsSdkExecutor): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];

  for await (const item of createAgentsSdkEvents(input, execute)) {
    events.push(item);
  }

  return events;
}
