import { createServer, type IncomingMessage } from "node:http";
import type { PreviousRunContext } from "../src/events/types";
import { validateAgentEvent } from "../src/events/validation";
import { createTaskId } from "../src/harness/taskIds";
import { createCodexAgentJobEvents, createCodexEvents, createCodexSynthesisEvents } from "./codexWorkflow";
import { loadDotEnvFile } from "./env";
import { validatePreviousRun } from "./requestValidation";
import { encodeAgentEvent } from "./sse";

loadDotEnvFile();

const port = Number(process.env.LANTERNWOOD_CODEX_PORT ?? 8787);
const healthToken = process.env.LANTERNWOOD_CODEX_HEALTH_TOKEN;
const maxBodyBytes = 128 * 1024;

type SpecialistId = "argus" | "neria" | "orion" | "quill";

const specialistIds = new Set<SpecialistId>(["argus", "neria", "orion", "quill"]);
const codexRoutes = new Set(["/api/runs", "/api/agent-jobs", "/api/synthesis"]);

function requestPath(url: string | undefined) {
  return url?.split("?")[0]?.replace(/\/+$/, "") || "/";
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > maxBodyBytes) {
      throw new Error("Request body too large");
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");

  return JSON.parse(body) as Record<string, unknown>;
}

function validateSpecialistId(value: unknown): SpecialistId | undefined {
  return typeof value === "string" && specialistIds.has(value as SpecialistId) ? (value as SpecialistId) : undefined;
}

function validateSpecialistIds(value: unknown): SpecialistId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is SpecialistId => validateSpecialistId(item) !== undefined);
}

function validateReports(value: unknown): Partial<Record<SpecialistId, string>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  const reports: Partial<Record<SpecialistId, string>> = {};

  for (const agentId of specialistIds) {
    const report = record[agentId];

    if (typeof report === "string") {
      reports[agentId] = report;
    }
  }

  return reports;
}

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/api/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, token: healthToken }));
    return;
  }

  const path = requestPath(request.url);

  if (request.method !== "POST" || !codexRoutes.has(path)) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
    return;
  }

  let input = "";
  let previousRun: PreviousRunContext | undefined;
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
    input = typeof body.input === "string" ? body.input.trim() : "";
    previousRun = validatePreviousRun(body.previousRun);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end("Invalid JSON body or previousRun");
    return;
  }

  if (!input) {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end("Missing input");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });

  const abortController = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const taskId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : createTaskId(input);
    const events =
      path === "/api/agent-jobs"
        ? (() => {
            const agentId = validateSpecialistId(body.agentId);

            if (!agentId) {
              throw new Error("Missing or invalid agentId");
            }

            return createCodexAgentJobEvents(
              {
                agentId,
                input,
                taskId,
              },
              undefined,
              { previousRun, signal: abortController.signal },
            );
          })()
        : path === "/api/synthesis"
          ? createCodexSynthesisEvents(
              {
                input,
                reports: validateReports(body.reports),
                selectedAgentIds: validateSpecialistIds(body.selectedAgentIds),
                taskId,
              },
              undefined,
              { previousRun, signal: abortController.signal },
            )
          : createCodexEvents(input, undefined, { previousRun, signal: abortController.signal, taskId });

    for await (const event of events) {
      if (abortController.signal.aborted) {
        break;
      }

      response.write(encodeAgentEvent(validateAgentEvent(event, "Invalid AgentEvent from Codex workflow")));
    }
  } catch (error) {
    if (!abortController.signal.aborted && !response.destroyed) {
      response.write(
        encodeAgentEvent(
          validateAgentEvent(
            {
              agentId: "luma",
              eventId: `${createTaskId(input)}-server-error`,
              message: error instanceof Error ? error.message : "Codex workflow stream failed",
              payload: {
                backend: "connected",
                cliCommand: "codex exec",
                codexStatus: "failed",
                runMode: "codex",
              },
              taskId: createTaskId(input),
              timestamp: new Date().toISOString(),
              type: "agent.failed",
            },
            "Invalid AgentEvent from Codex workflow",
          ),
        ),
      );
    }
  } finally {
    if (!response.writableEnded && !response.destroyed) {
      response.end();
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Lanternwood Codex CLI server listening on http://127.0.0.1:${port}`);
});
