import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "../src/events/types";
import { isSandboxMode, type SandboxMode } from "../src/harness/permissions";

type SpecialistId = "argus" | "neria" | "orion" | "quill";
type SpecialistReports = Partial<Record<SpecialistId, string>>;
type CodexExecutionProgress = {
  rawChunk?: string;
  stderrChunk?: string;
};
type CodexProgressHandler = (progress: CodexExecutionProgress) => void;
type CodexExecutionOptions = {
  sandbox?: SandboxMode;
  signal?: AbortSignal;
};

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
  model?: string;
  rawResponse?: string;
  specialistReports: SpecialistReports;
};

export type CodexExecutor = (input: string, onProgress?: CodexProgressHandler) => Promise<CodexExecutionResult>;

export type CodexSpecialistResult = {
  model?: string;
  rawResponse?: string;
  report: string;
};

export type CodexSynthesisResult = {
  finalOutput: string;
  model?: string;
  rawResponse?: string;
};

export type CodexSpecialistExecutor = (
  specialist: (typeof REQUIRED_SPECIALISTS)[number],
  input: string,
  onProgress?: CodexProgressHandler,
  options?: CodexExecutionOptions,
) => Promise<CodexSpecialistResult>;

export type CodexSynthesisExecutor = (
  input: string,
  reports: Required<SpecialistReports>,
  onProgress?: CodexProgressHandler,
  options?: CodexExecutionOptions,
) => Promise<CodexSynthesisResult>;

export type CodexWorkflowExecutors = {
  runSpecialist: CodexSpecialistExecutor;
  synthesize: CodexSynthesisExecutor;
};

export class CodexCliRunError extends Error {
  readonly rawResponse?: string;
  readonly specialistReports: SpecialistReports;

  constructor(message: string, specialistReports: SpecialistReports = {}, rawResponse?: string) {
    super(message);
    this.name = "CodexCliRunError";
    this.rawResponse = rawResponse;
    this.specialistReports = specialistReports;
  }
}

type CodexCliExecutorOptions = {
  runCommand?: (prompt: string, onProgress?: CodexProgressHandler, options?: RunCodexCommandOptions) => Promise<string>;
};

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "codexOutputSchema.json");

type RunCodexCommandOptions = {
  outputSchemaPath?: string;
  sandbox?: SandboxMode;
  signal?: AbortSignal;
};

export function readTopLevelModelFromCodexConfig(config: string) {
  const firstSectionIndex = config.search(/^\s*\[/m);
  const rootConfig = firstSectionIndex >= 0 ? config.slice(0, firstSectionIndex) : config;
  const match = /^\s*model\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m.exec(rootConfig);

  return match?.[1]?.trim() || undefined;
}

function readTopLevelStringValueFromCodexConfig(config: string, key: string) {
  const firstSectionIndex = config.search(/^\s*\[/m);
  const rootConfig = firstSectionIndex >= 0 ? config.slice(0, firstSectionIndex) : config;
  const match = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']\\s*(?:#.*)?$`, "m").exec(rootConfig);

  return match?.[1]?.trim() || undefined;
}

function readProfileModelFromCodexConfig(config: string, profile: string) {
  const headerPattern = /^\s*\[profiles\.(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\]\s#]+))\]\s*(?:#.*)?$/gm;
  let sectionMatch: RegExpExecArray | null = null;

  for (const match of config.matchAll(headerPattern)) {
    const profileName = (match[1] ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : match[2] ?? match[3])?.trim();

    if (profileName === profile) {
      sectionMatch = match;
      break;
    }
  }

  if (!sectionMatch) {
    return undefined;
  }

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const nextSection = config.slice(sectionStart).search(/^\s*\[/m);
  const section = nextSection >= 0 ? config.slice(sectionStart, sectionStart + nextSection) : config.slice(sectionStart);
  const match = /^\s*model\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m.exec(section);

  return match?.[1]?.trim() || undefined;
}

export function readActiveModelFromCodexConfig(config: string) {
  const activeProfile = readTopLevelStringValueFromCodexConfig(config, "profile");
  const profileModel = activeProfile ? readProfileModelFromCodexConfig(config, activeProfile) : undefined;

  if (profileModel) {
    return profileModel;
  }

  const topLevelModel = readTopLevelModelFromCodexConfig(config);

  if (topLevelModel) {
    return topLevelModel;
  }

  return undefined;
}

export function getCodexConfigPath() {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");

  return join(codexHome, "config.toml");
}

function readCodexConfigModel() {
  const configPath = getCodexConfigPath();

  if (!existsSync(configPath)) {
    return undefined;
  }

  try {
    const config = readFileSync(configPath, "utf8");
    return readActiveModelFromCodexConfig(config);
  } catch {
    return undefined;
  }
}

function getCodexModelLabel() {
  return (
    process.env.LANTERNWOOD_CODEX_MODEL?.trim() ||
    readCodexConfigModel() ||
    "CLI default (model not exposed; set LANTERNWOOD_CODEX_MODEL to pin)"
  );
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

function abortError() {
  return new CodexCliRunError("Codex CLI run aborted.");
}

function reportsFromError(error: unknown): SpecialistReports {
  return error instanceof CodexCliRunError ? error.specialistReports : {};
}

function rawResponseFromError(error: unknown): string | undefined {
  return error instanceof CodexCliRunError ? error.rawResponse : undefined;
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

function permissionRequestInstructions(currentSandbox: SandboxMode) {
  return `Current sandbox: ${currentSandbox}.

If this sandbox blocks the useful work and you need broader permission, do not end with a refusal. Set "sandbox" to exactly one of "workspace-write" or "danger-full-access". Return only this JSON object:
{
  "permissionRequest": {
    "sandbox": "danger-full-access",
    "reason": "short reason for the user",
    "blockedAction": "specific command, path, network target, or action"
  }
}`;
}

function buildSpecialistPrompt(specialist: (typeof REQUIRED_SPECIALISTS)[number], input: string, sandbox: SandboxMode) {
  const roleInstructions: Record<SpecialistId, string> = {
    argus:
      "Review the likely answer for risks, missing evidence, unsafe assumptions, and readiness. Return concise review notes only.",
    neria:
      "Extract stable user preferences, project constraints, and relevant memory-like context from the request only. Do not invent private memory. Return concise context notes only.",
    orion:
      "Identify research context, assumptions, uncertainty, and source-checking needs. Return concise research findings only.",
    quill:
      "Draft the useful structure, wording, or artifact shape that should appear in the final response. Return concise draft notes only.",
  };

  return `You are ${specialist.displayName}, ${roleInstructions[specialist.id]}.

You are one specialist in The Lanternwood Athenaeum. Luma will synthesize your output with other specialists.

${permissionRequestInstructions(sandbox)}

User request:
${input}`;
}

function buildSynthesisPrompt(input: string, reports: Required<SpecialistReports>, sandbox: SandboxMode) {
  return `You are Luma, the Lanternwood Athenaeum orchestrator.

Synthesize the specialist outputs into the final response for the user. Keep it concise, concrete, and directly useful.

${permissionRequestInstructions(sandbox)}

User request:
${input}

Orion research output:
${reports.orion}

Neria memory/context output:
${reports.neria}

Quill draft output:
${reports.quill}

Argus review output:
${reports.argus}`;
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

export function createCodexCliRunErrorFromOutput(message: string, output: string) {
  try {
    const partial = parseCodexJsonOutput(output);

    return new CodexCliRunError(message, partial.specialistReports, output);
  } catch {
    return new CodexCliRunError(message, {}, output || undefined);
  }
}

type PermissionRequest = {
  blockedAction?: string;
  reason: string;
  sandbox: SandboxMode;
};

function isBroaderSandbox(currentSandbox: SandboxMode, requestedSandbox: SandboxMode) {
  return (
    (currentSandbox === "read-only" && requestedSandbox !== "read-only") ||
    (currentSandbox === "workspace-write" && requestedSandbox === "danger-full-access")
  );
}

function permissionRequestFromValue(value: unknown, currentSandbox: SandboxMode): PermissionRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const request = (value as Record<string, unknown>).permissionRequest;
  if (!request || typeof request !== "object") {
    return null;
  }

  const record = request as Record<string, unknown>;
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  const blockedAction = typeof record.blockedAction === "string" ? record.blockedAction.trim() : undefined;

  if (!reason || !isSandboxMode(record.sandbox) || !isBroaderSandbox(currentSandbox, record.sandbox)) {
    return null;
  }

  return {
    blockedAction,
    reason,
    sandbox: record.sandbox,
  };
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function findPermissionRequest(value: unknown, currentSandbox: SandboxMode, depth = 0): PermissionRequest | null {
  if (depth > 6 || value == null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return null;
    }

    try {
      return findPermissionRequest(parseJson(trimmed), currentSandbox, depth + 1);
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const request = findPermissionRequest(item, currentSandbox, depth + 1);

      if (request) {
        return request;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const direct = permissionRequestFromValue(value, currentSandbox);

  if (direct) {
    return direct;
  }

  for (const nestedValue of Object.values(value)) {
    const request = findPermissionRequest(nestedValue, currentSandbox, depth + 1);

    if (request) {
      return request;
    }
  }

  return null;
}

function extractPermissionRequest(output: string, currentSandbox: SandboxMode): PermissionRequest | null {
  const trimmed = output.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const request = findPermissionRequest(parseJson(trimmed), currentSandbox);

    if (request) {
      return request;
    }
  } catch {
    // Codex --json stdout is JSONL. Fall through and inspect individual records.
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim().startsWith("data:") ? line.trim().slice("data:".length).trimStart() : line.trim();

    if (!candidate) {
      continue;
    }

    try {
      const request = findPermissionRequest(parseJson(candidate), currentSandbox);

      if (request) {
        return request;
      }
    } catch {
      // Ignore non-JSON progress lines.
    }
  }

  return null;
}

function permissionRequestFromError(error: unknown, currentSandbox: SandboxMode): PermissionRequest | null {
  const rawResponse = rawResponseFromError(error);

  return rawResponse ? extractPermissionRequest(rawResponse, currentSandbox) : null;
}

async function runCodexCommand(
  prompt: string,
  onProgress?: CodexProgressHandler,
  { outputSchemaPath, sandbox, signal }: RunCodexCommandOptions = {},
): Promise<string> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "lanternwood-codex-"));
  const outputPath = join(tempDirectory, "last-message.json");

  try {
    if (signal?.aborted) {
      throw abortError();
    }

    await new Promise<void>((resolve, reject) => {
      const codexArgs = [
        "exec",
        "--color",
        "never",
        "--json",
        ...(process.env.LANTERNWOOD_CODEX_MODEL?.trim() ? ["--model", process.env.LANTERNWOOD_CODEX_MODEL.trim()] : []),
        "--sandbox",
        sandbox ?? "workspace-write",
        "--cd",
        process.cwd(),
        ...(outputSchemaPath ? ["--output-schema", outputSchemaPath] : []),
        "--output-last-message",
        outputPath,
        "-",
      ];
      const child = spawn("codex", codexArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let aborted = false;

      const settleReject = (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        signal?.removeEventListener("abort", abort);
        reject(error);
      };

      const settleResolve = () => {
        if (settled) {
          return;
        }

        settled = true;
        signal?.removeEventListener("abort", abort);
        resolve();
      };

      const abort = () => {
        aborted = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) {
            child.kill("SIGKILL");
          }
        }, 1_500).unref();
      };

      signal?.addEventListener("abort", abort, { once: true });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        onProgress?.({ rawChunk: chunk });
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        onProgress?.({ stderrChunk: chunk });
      });
      child.on("error", settleReject);
      child.on("close", (code) => {
        signal?.removeEventListener("abort", abort);

        if (settled) {
          return;
        }

        if (aborted || signal?.aborted) {
          settleReject(abortError());
          return;
        }

        if (code === 0) {
          settleResolve();
          return;
        }

        void (async () => {
          const message = stderr.trim() || `Codex CLI exited with code ${code}`;

          try {
            const rawResponse = await readFile(outputPath, "utf8");
            settleReject(createCodexCliRunErrorFromOutput(message, rawResponse));
          } catch {
            settleReject(createCodexCliRunErrorFromOutput(message, stdout));
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
  return async (input: string, onProgress?: CodexProgressHandler) => {
    const output = await runCommand(buildCodexPrompt(input), onProgress, {
      outputSchemaPath: schemaPath,
      sandbox: "workspace-write",
    });

    try {
      return {
        ...parseCodexJsonOutput(output),
        model: getCodexModelLabel(),
        rawResponse: output,
      };
    } catch (error) {
      throw new CodexCliRunError(messageFromError(error), {}, output);
    }
  };
}

export function createCodexCliWorkflow({
  runCommand = runCodexCommand,
}: CodexCliExecutorOptions = {}): CodexWorkflowExecutors {
  return {
    async runSpecialist(specialist, input, onProgress, options) {
      const sandbox = options?.sandbox ?? "workspace-write";
      const output = await runCommand(buildSpecialistPrompt(specialist, input, sandbox), onProgress, {
        sandbox,
        signal: options?.signal,
      });
      const report = output.trim();

      if (!report) {
        throw new CodexCliRunError(`${specialist.displayName} did not return output.`, {}, output);
      }

      return {
        model: getCodexModelLabel(),
        rawResponse: output,
        report,
      };
    },
    async synthesize(input, reports, onProgress, options) {
      const sandbox = options?.sandbox ?? "workspace-write";
      const output = await runCommand(buildSynthesisPrompt(input, reports, sandbox), onProgress, {
        sandbox,
        signal: options?.signal,
      });
      const finalOutput = output.trim();

      if (!finalOutput) {
        throw new CodexCliRunError("Luma did not return final output.", reports, output);
      }

      return {
        finalOutput,
        model: getCodexModelLabel(),
        rawResponse: output,
      };
    },
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

type CodexQueueItem =
  | {
      kind: "progress";
      agentId: AgentEvent["agentId"];
      message: string;
      progress: CodexExecutionProgress;
    }
  | {
      kind: "specialistResult";
      result: CodexSpecialistResult;
      specialist: (typeof REQUIRED_SPECIALISTS)[number];
    }
  | {
      error: unknown;
      kind: "specialistError";
      specialist: (typeof REQUIRED_SPECIALISTS)[number];
    };

function createAsyncQueue<T>() {
  const items: T[] = [];
  const resolvers: Array<(value: T | null) => void> = [];
  let closed = false;

  return {
    close() {
      closed = true;
      for (const resolver of resolvers.splice(0)) {
        resolver(null);
      }
    },
    next() {
      const item = items.shift();

      if (item) {
        return Promise.resolve(item);
      }

      if (closed) {
        return Promise.resolve(null);
      }

      return new Promise<T | null>((resolve) => {
        resolvers.push(resolve);
      });
    },
    push(item: T) {
      const resolver = resolvers.shift();

      if (resolver) {
        resolver(item);
        return;
      }

      items.push(item);
    },
  };
}

function requiredReportsFrom(reports: SpecialistReports): Required<SpecialistReports> {
  assertRequiredSpecialistsWereCalled(reports);

  return {
    argus: reports.argus!,
    neria: reports.neria!,
    orion: reports.orion!,
    quill: reports.quill!,
  };
}

function remainingSpecialistsForApprovalPause(
  requestingSpecialistId: SpecialistId,
  reportedSpecialists: Set<SpecialistId>,
  failedSpecialists: Set<SpecialistId>,
) {
  return REQUIRED_SPECIALISTS.filter(
    (specialist) =>
      specialist.id !== requestingSpecialistId && !reportedSpecialists.has(specialist.id) && !failedSpecialists.has(specialist.id),
  );
}

export async function* createCodexEvents(
  input: string,
  workflow: CodexWorkflowExecutors = createCodexCliWorkflow(),
  options: CodexExecutionOptions = {},
): AsyncIterable<AgentEvent> {
  const taskId = stableTaskId(input);
  let index = 1;
  const reportedSpecialists = new Set<SpecialistId>();
  const failedSpecialists = new Set<SpecialistId>();
  const currentSandbox = options.sandbox ?? "workspace-write";
  const codexDiagnostics = {
    backend: "connected",
    cliCommand: "codex exec",
    model: getCodexModelLabel(),
    runMode: "codex",
    sandbox: currentSandbox,
  };

  yield event(taskId, index++, "luma", "task.created", input, {
    ...codexDiagnostics,
    codexStatus: "calling",
  });
  yield event(taskId, index++, "luma", "agent.planning", "Luma prepares a Codex CLI orchestration prompt", {
    ...codexDiagnostics,
    codexStatus: "preparing prompt",
  });
  yield event(taskId, index++, "luma", "agent.delegated", "Luma routes the work to Orion, Neria, Quill, and Argus through Codex", {
    ...codexDiagnostics,
    codexStatus: "calling",
  });
  yield event(taskId, index++, "orion", "agent.working", "Orion starts a Codex research route", {
    ...codexDiagnostics,
    codexStatus: "calling",
    progress: "Orion Codex route started.",
  });
  yield event(taskId, index++, "neria", "agent.working", "Neria starts a Codex memory route", {
    ...codexDiagnostics,
    codexStatus: "calling",
    progress: "Neria Codex route started.",
  });
  yield event(taskId, index++, "quill", "agent.working", "Quill starts a Codex drafting route", {
    ...codexDiagnostics,
    codexStatus: "calling",
    progress: "Quill Codex route started.",
  });
  yield event(taskId, index++, "argus", "agent.reviewing", "Argus starts a Codex review route", {
    ...codexDiagnostics,
    codexStatus: "calling",
    progress: "Argus Codex route started.",
  });

  try {
    if (options.signal?.aborted) {
      throw abortError();
    }

    const queue = createAsyncQueue<CodexQueueItem>();
    const reports: SpecialistReports = {};
    let openSpecialistRoutes = REQUIRED_SPECIALISTS.length;
    let firstError: unknown;
    let permissionRequested = false;
    let permissionRequestingSpecialistId: SpecialistId | null = null;
    const routeAbortController = new AbortController();
    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, routeAbortController.signal])
      : routeAbortController.signal;
    const routeExecutions: Array<Promise<void>> = [];

    for (const specialist of REQUIRED_SPECIALISTS) {
      const routeExecution = workflow
        .runSpecialist(specialist, input, (progress) => {
          queue.push({
            agentId: specialist.id,
            kind: "progress",
            message: `${specialist.displayName} Codex CLI is streaming output`,
            progress,
          });
        }, { sandbox: currentSandbox, signal: combinedSignal })
        .then((result) => {
          queue.push({ kind: "specialistResult", result, specialist });
        })
        .catch((error: unknown) => {
          queue.push({ error, kind: "specialistError", specialist });
        })
        .finally(() => {
          openSpecialistRoutes -= 1;

          if (openSpecialistRoutes === 0) {
            queue.close();
          }
        });
      routeExecutions.push(routeExecution);
    }

    while (true) {
      const item = await queue.next();

      if (options.signal?.aborted) {
        throw abortError();
      }

      if (!item) {
        break;
      }

      if (item.kind === "progress") {
        yield event(taskId, index++, item.agentId, "agent.working", item.message, {
          ...codexDiagnostics,
          codexStatus: "streaming",
          progress: `${item.message}.`,
          rawChunk: item.progress.rawChunk,
          stderrChunk: item.progress.stderrChunk,
        });
        continue;
      }

      if (item.kind === "specialistError") {
        const permissionRequest = permissionRequestFromError(item.error, currentSandbox);

        if (permissionRequest) {
          permissionRequested = true;
          permissionRequestingSpecialistId = item.specialist.id;
          routeAbortController.abort();
          yield event(
            taskId,
            index++,
            item.specialist.id,
            "approval.requested",
            `${item.specialist.displayName} requests ${permissionRequest.sandbox} permission: ${permissionRequest.reason}`,
            {
              ...codexDiagnostics,
              blockedAction: permissionRequest.blockedAction,
              codexStatus: "waiting-approval",
              rawResponse: rawResponseFromError(item.error),
              reason: permissionRequest.reason,
              requestedSandbox: permissionRequest.sandbox,
            },
          );
          break;
        }

        firstError ??= item.error;
        failedSpecialists.add(item.specialist.id);
        yield event(taskId, index++, item.specialist.id, "agent.failed", messageFromError(item.error), {
          ...codexDiagnostics,
          codexStatus: "failed",
          rawResponse: rawResponseFromError(item.error),
        });
        continue;
      }

      const report = item.result.report.trim();
      const permissionRequest =
        extractPermissionRequest(item.result.rawResponse ?? "", currentSandbox) ?? extractPermissionRequest(report, currentSandbox);

      if (permissionRequest) {
        permissionRequested = true;
        permissionRequestingSpecialistId = item.specialist.id;
        routeAbortController.abort();
        yield event(
          taskId,
          index++,
          item.specialist.id,
          "approval.requested",
          `${item.specialist.displayName} requests ${permissionRequest.sandbox} permission: ${permissionRequest.reason}`,
          {
            ...codexDiagnostics,
            blockedAction: permissionRequest.blockedAction,
            codexStatus: "waiting-approval",
            rawResponse: item.result.rawResponse,
            reason: permissionRequest.reason,
            requestedSandbox: permissionRequest.sandbox,
          },
        );
        break;
      }

      if (report) {
        reports[item.specialist.id] = report;
        yield event(taskId, index++, item.specialist.id, "agent.reporting", reportingMessages[item.specialist.id], {
          ...codexDiagnostics,
          codexStatus: "completed",
          model: item.result.model ?? getCodexModelLabel(),
          rawResponse: item.result.rawResponse,
          report,
        });
        reportedSpecialists.add(item.specialist.id);
      }
    }

    if (permissionRequested) {
      await Promise.allSettled(routeExecutions);

      if (permissionRequestingSpecialistId) {
        for (const specialist of remainingSpecialistsForApprovalPause(permissionRequestingSpecialistId, reportedSpecialists, failedSpecialists)) {
          yield event(
            taskId,
            index++,
            specialist.id,
            "agent.paused",
            `${specialist.displayName}'s route pauses while approval is pending`,
            {
              ...codexDiagnostics,
              codexStatus: "waiting-approval",
            },
          );
        }
      }

      return;
    }

    if (firstError) {
      throw new CodexCliRunError(messageFromError(firstError), reports);
    }

    if (options.signal?.aborted) {
      throw abortError();
    }

    const requiredReports = requiredReportsFrom(reports);
    yield event(taskId, index++, "luma", "agent.working", "Luma starts Codex synthesis", {
      ...codexDiagnostics,
      codexStatus: "calling",
      progress: "Luma Codex synthesis route started.",
    });

    const synthesisQueue = createAsyncQueue<CodexExecutionProgress>();
    const synthesisExecution = workflow
      .synthesize(input, requiredReports, (progress) => {
        synthesisQueue.push(progress);
      }, { sandbox: currentSandbox, signal: combinedSignal })
      .then(
        (value) => ({ type: "result" as const, value }),
        (error: unknown) => ({ error, type: "error" as const }),
      )
      .finally(() => {
        synthesisQueue.close();
      });

    while (true) {
      const progress = await synthesisQueue.next();

      if (options.signal?.aborted) {
        await synthesisExecution;
        throw abortError();
      }

      if (!progress) {
        break;
      }

      yield event(taskId, index++, "luma", "agent.working", "Luma Codex CLI is streaming synthesis", {
        ...codexDiagnostics,
        codexStatus: "streaming",
        progress: "Luma Codex CLI is streaming synthesis.",
        rawChunk: progress.rawChunk,
        stderrChunk: progress.stderrChunk,
      });
    }

    const synthesisOutcome = await synthesisExecution;

    if (synthesisOutcome.type === "error") {
      const permissionRequest = permissionRequestFromError(synthesisOutcome.error, currentSandbox);

      if (permissionRequest) {
        yield event(taskId, index++, "luma", "approval.requested", `Luma requests ${permissionRequest.sandbox} permission: ${permissionRequest.reason}`, {
          ...codexDiagnostics,
          blockedAction: permissionRequest.blockedAction,
          codexStatus: "waiting-approval",
          rawResponse: rawResponseFromError(synthesisOutcome.error),
          reason: permissionRequest.reason,
          requestedSandbox: permissionRequest.sandbox,
        });
        return;
      }

      throw synthesisOutcome.error;
    }

    const result = synthesisOutcome.value;
    const finalRawResponse = result.rawResponse;
    const rawResponsePermissionRequest = finalRawResponse ? extractPermissionRequest(finalRawResponse, currentSandbox) : null;
    const finalOutputPermissionRequest = rawResponsePermissionRequest
      ? null
      : extractPermissionRequest(result.finalOutput, currentSandbox);
    const synthesisPermissionRequest = rawResponsePermissionRequest ?? finalOutputPermissionRequest;

    if (synthesisPermissionRequest) {
      yield event(taskId, index++, "luma", "approval.requested", `Luma requests ${synthesisPermissionRequest.sandbox} permission: ${synthesisPermissionRequest.reason}`, {
        ...codexDiagnostics,
        blockedAction: synthesisPermissionRequest.blockedAction,
        codexStatus: "waiting-approval",
        rawResponse: finalOutputPermissionRequest ? result.finalOutput : finalRawResponse,
        reason: synthesisPermissionRequest.reason,
        requestedSandbox: synthesisPermissionRequest.sandbox,
      });
      return;
    }

    try {
      const finalOutput = requireFinalOutput(result.finalOutput);

      yield event(taskId, index++, "luma", "agent.reporting", "Luma raises the blue approval lantern");
      yield event(taskId, index++, "orion", "agent.done", "Orion returns to the star-map balcony");
      yield event(taskId, index++, "neria", "agent.done", "Neria closes the archive ledger");
      yield event(taskId, index++, "quill", "agent.done", "Quill shelves the illuminated draft");
      yield event(taskId, index++, "argus", "agent.done", "Argus lowers the review lantern");
      yield event(taskId, index++, "luma", "agent.done", "Luma places the final summary on the central desk", {
        ...codexDiagnostics,
        codexStatus: "completed",
        finalOutput,
        model: result.model ?? getCodexModelLabel(),
        rawResponse: finalRawResponse,
      });
    } catch (error) {
      throw new CodexCliRunError(messageFromError(error), requiredReports, finalRawResponse);
    }
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
      if (!reportedSpecialists.has(specialist.id) && !failedSpecialists.has(specialist.id)) {
        yield event(taskId, index++, specialist.id, "agent.failed", `${specialist.displayName}'s route closes before a verified report`);
      }
    }

    yield event(taskId, index++, "luma", "agent.failed", messageFromError(error), {
      ...codexDiagnostics,
      codexStatus: "failed",
      rawResponse: rawResponseFromError(error),
    });
  }
}

export async function collectCodexEvents(
  input: string,
  workflow?: CodexWorkflowExecutors,
  options?: CodexExecutionOptions,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];

  for await (const item of createCodexEvents(input, workflow, options)) {
    events.push(item);
  }

  return events;
}
