import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

export type CodexExecutionResult = {
  finalOutput: unknown;
  specialistReports: SpecialistReports;
};

export type CodexExecutor = (input: string) => Promise<CodexExecutionResult>;

export class CodexCliRunError extends Error {
  readonly specialistReports: SpecialistReports;

  constructor(message: string, specialistReports: SpecialistReports = {}) {
    super(message);
    this.name = "CodexCliRunError";
    this.specialistReports = specialistReports;
  }
}

type CodexCliExecutorOptions = {
  runCommand?: (prompt: string) => Promise<string>;
};

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "codexOutputSchema.json");

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
    eventId: `${taskId}-codex-${index}`,
    message,
    payload,
    taskId,
    timestamp: new Date(Date.UTC(2026, 4, 26, 0, 0, index)).toISOString(),
    type,
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Codex CLI run failed";
}

function reportsFromError(error: unknown): SpecialistReports {
  return error instanceof CodexCliRunError ? error.specialistReports : {};
}

function buildCodexPrompt(input: string) {
  return `You are Luma, the Lanternwood Athenaeum orchestrator.

Delegate the user's request to four internal roles and synthesize the result:
- Orion: research context, assumptions, and uncertainty.
- Neria: memory/preferences context and stable constraints.
- Quill: draft structure or prose.
- Argus: review risks, gaps, and readiness.

Return only one JSON object with exactly these string fields:
{
  "orion": "...",
  "neria": "...",
  "quill": "...",
  "argus": "...",
  "finalOutput": "..."
}

User request:
${input}`;
}

function normalizeResult(value: unknown): CodexExecutionResult {
  if (!value || typeof value !== "object") {
    throw new Error("Codex CLI did not return a JSON object.");
  }

  const record = value as Record<string, unknown>;

  return {
    finalOutput: record.finalOutput,
    specialistReports: {
      argus: typeof record.argus === "string" ? record.argus : undefined,
      neria: typeof record.neria === "string" ? record.neria : undefined,
      orion: typeof record.orion === "string" ? record.orion : undefined,
      quill: typeof record.quill === "string" ? record.quill : undefined,
    },
  };
}

function parseCodexJsonOutput(output: string): CodexExecutionResult {
  try {
    return normalizeResult(JSON.parse(output.trim()));
  } catch {
    throw new Error("Codex CLI output did not include a parseable JSON result.");
  }
}

async function runCodexCommand(prompt: string): Promise<string> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "lanternwood-codex-"));
  const outputPath = join(tempDirectory, "last-message.json");

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", [
        "exec",
        "--color",
        "never",
        "--sandbox",
        "read-only",
        "--cd",
        process.cwd(),
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        void (async () => {
          const message = stderr.trim() || `Codex CLI exited with code ${code}`;

          try {
            const partial = parseCodexJsonOutput(await readFile(outputPath, "utf8"));
            reject(new CodexCliRunError(message, partial.specialistReports));
          } catch {
            try {
              const partial = parseCodexJsonOutput(stdout);
              reject(new CodexCliRunError(message, partial.specialistReports));
            } catch {
              reject(new Error(message));
            }
          }
        })();
      });

      child.stdin.end(prompt);
    });

    return await readFile(outputPath, "utf8");
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

export function createCodexCliExecutor({ runCommand = runCodexCommand }: CodexCliExecutorOptions = {}): CodexExecutor {
  return async (input: string) => {
    const output = await runCommand(buildCodexPrompt(input));

    return parseCodexJsonOutput(output);
  };
}

function assertRequiredSpecialistsWereCalled(reports: SpecialistReports) {
  const missing = REQUIRED_SPECIALISTS.filter((specialist) => !reports[specialist.id]?.trim()).map(
    (specialist) => specialist.displayName,
  );

  if (missing.length > 0) {
    throw new Error(`Codex CLI result did not include required specialist reports: ${missing.join(", ")}`);
  }
}

function requireFinalOutput(value: unknown) {
  const finalOutput = String(value ?? "").trim();

  if (!finalOutput) {
    throw new Error("Codex CLI result did not include final output.");
  }

  return finalOutput;
}

export async function* createCodexEvents(input: string, execute: CodexExecutor = createCodexCliExecutor()): AsyncIterable<AgentEvent> {
  const taskId = stableTaskId(input);
  let index = 1;
  const reportedSpecialists = new Set<(typeof REQUIRED_SPECIALISTS)[number]["id"]>();

  yield event(taskId, index++, "luma", "task.created", input);
  yield event(taskId, index++, "luma", "agent.planning", "Luma prepares a Codex CLI orchestration prompt");
  yield event(taskId, index++, "luma", "agent.delegated", "Luma routes the work to Orion, Neria, Quill, and Argus through Codex");
  yield event(taskId, index++, "orion", "agent.working", "Orion prepares research context");
  yield event(taskId, index++, "neria", "agent.working", "Neria prepares memory context");
  yield event(taskId, index++, "quill", "agent.working", "Quill prepares the draft");
  yield event(taskId, index++, "argus", "agent.reviewing", "Argus prepares the review");

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

export async function collectCodexEvents(input: string, execute?: CodexExecutor): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];

  for await (const item of createCodexEvents(input, execute)) {
    events.push(item);
  }

  return events;
}
