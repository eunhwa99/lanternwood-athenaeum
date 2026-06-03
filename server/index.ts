import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PreviousRunContext } from "../src/events/types";
import { validateAgentEvent } from "../src/events/validation";
import { isSandboxMode, type SandboxMode } from "../src/harness/permissions";
import { createTaskId } from "../src/harness/taskIds";
import { createAgentDefinition, loadAgentDefinitions } from "./agentCatalog";
import { createAgentDraftWithCodex } from "./agentDraft";
import { ApprovalGate } from "./approvalGate";
import { createCodexAgentJobEvents, createCodexEvents, createCodexServerFailureEvent, createCodexSynthesisEvents } from "./codexWorkflow";
import { loadDotEnvFile } from "./env";
import { codexRequestTokenHeader, dashboardCorsOrigin, validateCodexPostRequest } from "./httpGuards";
import { loadGlobalAgents } from "./globalAgents";
import { validatePreviousRun } from "./requestValidation";
import { discoverCodexSkills } from "./skills";
import { encodeAgentEvent } from "./sse";
import { readWorkspaceMetadata } from "./workspaceMetadata";
import { discoverWorkspaceOptions, resolveWorkspacePath } from "./workspaces";

loadDotEnvFile();

const port = Number(process.env.LANTERNWOOD_CODEX_PORT ?? 8787);
const healthToken = process.env.LANTERNWOOD_CODEX_HEALTH_TOKEN;
const maxBodyBytes = 128 * 1024;

type SpecialistId = string;

const agentIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const codexRoutes = new Set(["/api/runs", "/api/agent-jobs", "/api/synthesis"]);
const agentAuthoringRoutes = new Set(["/api/agents", "/api/agents/draft"]);
const workspaceRoutes = new Set(["/api/workspace-metadata", "/api/workspaces"]);

type LanternwoodServerOptions = {
  approvalGate?: ApprovalGate;
  createAgentJobEvents?: typeof createCodexAgentJobEvents;
  createEvents?: typeof createCodexEvents;
  createSynthesisEvents?: typeof createCodexSynthesisEvents;
  healthToken?: string;
};

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
  return typeof value === "string" && value !== "luma" && agentIdPattern.test(value) ? value : undefined;
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

  for (const [agentId, report] of Object.entries(record)) {

    if (validateSpecialistId(agentId) && typeof report === "string") {
      reports[agentId] = report;
    }
  }

  return reports;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function approvalAgentIdFor(path: string, body: Record<string, unknown>) {
  if (path === "/api/agent-jobs") {
    return validateSpecialistId(body.agentId);
  }

  if (path === "/api/synthesis") {
    return "luma";
  }

  return stringValue(body.approvalAgentId);
}

export function createLanternwoodServer({
  approvalGate = new ApprovalGate(),
  createAgentJobEvents = createCodexAgentJobEvents,
  createEvents = createCodexEvents,
  createSynthesisEvents = createCodexSynthesisEvents,
  healthToken: serverHealthToken = healthToken,
}: LanternwoodServerOptions = {}) {
  return createServer(async (request, response) => {
  const requestOrigin = request.headers.origin;

  response.setHeader("Access-Control-Allow-Headers", `Content-Type, X-Lanternwood-Codex-Token`);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Origin", dashboardCorsOrigin(requestOrigin));
  response.setHeader("Vary", "Origin");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/api/health") {
    if (serverHealthToken && request.headers[codexRequestTokenHeader] !== serverHealthToken) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  const path = requestPath(request.url);

  if (request.method !== "POST" || (!codexRoutes.has(path) && !agentAuthoringRoutes.has(path) && !workspaceRoutes.has(path))) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
    return;
  }

  const guard = validateCodexPostRequest({
    contentType: request.headers["content-type"],
    expectedToken: serverHealthToken,
    fetchSite: typeof request.headers["sec-fetch-site"] === "string" ? request.headers["sec-fetch-site"] : undefined,
    origin: requestOrigin,
    token: request.headers[codexRequestTokenHeader] as string | undefined,
  });

  if (!guard.ok) {
    response.writeHead(guard.status, { "Content-Type": "text/plain" });
    response.end(guard.message);
    return;
  }

  let input = "";
  let approvalToken: string | undefined;
  let previousRun: PreviousRunContext | undefined;
  let body: Record<string, unknown>;
  let sandboxMode: SandboxMode = "workspace-write";
  let workspacePath: string | undefined;
  let globalAgents: Awaited<ReturnType<typeof loadGlobalAgents>> | undefined;
  let agents: Awaited<ReturnType<typeof loadAgentDefinitions>> | undefined;
  try {
    body = await readJsonBody(request);
    if (path === "/api/agents/draft") {
      const description = typeof body.description === "string" ? body.description : "";
      const agents = await loadAgentDefinitions();
      const draft = await createAgentDraftWithCodex(description, {
        existingAgentIds: agents.map((agent) => agent.id),
        workspacePath: process.cwd(),
      });

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ draft }));
      return;
    }

    if (path === "/api/agents") {
      const created = await createAgentDefinition(join(process.cwd(), ".agents", "lanternwood", "agents"), {
        color: typeof body.color === "string" ? body.color : "",
        displayName: typeof body.displayName === "string" ? body.displayName : "",
        id: typeof body.id === "string" ? body.id : "",
        persona: typeof body.persona === "string" ? body.persona : "",
        promptInstruction: typeof body.promptInstruction === "string" ? body.promptInstruction : "",
        routingKeywords: Array.isArray(body.routingKeywords)
          ? body.routingKeywords.filter((keyword): keyword is string => typeof keyword === "string")
          : [],
        routingReason: typeof body.routingReason === "string" ? body.routingReason : "",
        worldRole: typeof body.worldRole === "string" ? body.worldRole : "",
      });

      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify(created));
      return;
    }

    if (path === "/api/workspaces") {
      globalAgents = await loadGlobalAgents();
      const discovered = await discoverWorkspaceOptions(globalAgents.automationPolicy.allowRoots);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          ...discovered,
          currentWorkspace: process.cwd(),
        }),
      );
      return;
    }

    if (path === "/api/workspace-metadata") {
      globalAgents = await loadGlobalAgents();
      const requestedWorkspacePath =
        typeof body.workspacePath === "string" && body.workspacePath.trim() ? body.workspacePath : process.cwd();
      const resolvedWorkspacePath = await resolveWorkspacePath(requestedWorkspacePath, globalAgents.automationPolicy.allowRoots);
      const [metadata, skills] = await Promise.all([readWorkspaceMetadata(resolvedWorkspacePath), discoverCodexSkills()]);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ metadata, skills }));
      return;
    }

    input = typeof body.input === "string" ? body.input.trim() : "";
    approvalToken = typeof body.approvalToken === "string" ? body.approvalToken.trim() : undefined;
    previousRun = validatePreviousRun(body.previousRun);
    if (body.sandboxMode !== undefined) {
      if (!isSandboxMode(body.sandboxMode)) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("Invalid sandboxMode");
        return;
      }

      sandboxMode = body.sandboxMode;
    }
    if (typeof body.workspacePath === "string" && body.workspacePath.trim()) {
      globalAgents = await loadGlobalAgents();
      workspacePath = await resolveWorkspacePath(body.workspacePath, globalAgents.automationPolicy.allowRoots);
    }
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end("Invalid JSON body, previousRun, or workspacePath");
    return;
  }

  if (!input) {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end("Missing input");
    return;
  }

  if (path === "/api/agent-jobs" && !validateSpecialistId(body.agentId)) {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end("Missing or invalid agentId");
    return;
  }

  if (path === "/api/agent-jobs") {
    agents = await loadAgentDefinitions();

    if (!agents.some((agent) => agent.id === body.agentId && agent.id !== "luma")) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Missing or invalid agentId");
      return;
    }
  }

  const taskId = stringValue(body.taskId) ?? createTaskId(input);
  const approval = approvalGate.approveRequest(input, sandboxMode, approvalToken, {
    agentId: approvalAgentIdFor(path, body),
    route: path,
    taskId,
    workspacePath,
  });

  if (!approval.ok) {
    response.writeHead(403, { "Content-Type": "text/plain" });
    response.end(approval.error);
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
	    agents ??= await loadAgentDefinitions();
	    const events =
      path === "/api/agent-jobs"
        ? (() => {
            const agentId = validateSpecialistId(body.agentId);

            if (!agentId) {
              throw new Error("Missing or invalid agentId");
            }

            return createAgentJobEvents(
              {
                agentId,
                input,
                selectedAgentIds: Array.isArray(body.selectedAgentIds) ? validateSpecialistIds(body.selectedAgentIds) : undefined,
                specialistReports: validateReports(body.reports),
                taskId,
              },
              undefined,
              { agents, globalAgents, previousRun, sandboxMode, signal: abortController.signal, workspacePath },
            );
          })()
        : path === "/api/synthesis"
          ? createSynthesisEvents(
              {
                input,
                reports: validateReports(body.reports),
                selectedAgentIds: validateSpecialistIds(body.selectedAgentIds),
                taskId,
              },
              undefined,
              { agents, globalAgents, previousRun, sandboxMode, signal: abortController.signal, workspacePath },
            )
          : createEvents(input, undefined, {
              approvalAgentId: approvalAgentIdFor(path, body),
              agents,
              globalAgents,
              previousRun,
              sandboxMode,
              signal: abortController.signal,
              taskId,
              workspacePath,
            });

    for await (const event of events) {
      if (abortController.signal.aborted) {
        break;
      }

      if (event.type === "approval.requested" && typeof event.payload?.requestedSandbox === "string") {
        const requestedSandbox = event.payload.requestedSandbox;

        if (isSandboxMode(requestedSandbox)) {
          event.payload.approvalToken = approvalGate.createApproval(input, requestedSandbox, {
            agentId: event.agentId,
            route: path,
            taskId: event.taskId,
            workspacePath,
          });
        }
      }

      response.write(encodeAgentEvent(validateAgentEvent(event, "Invalid AgentEvent from Codex workflow")));
    }
  } catch (error) {
    if (!abortController.signal.aborted && !response.destroyed) {
      response.write(
        encodeAgentEvent(
          validateAgentEvent(createCodexServerFailureEvent(taskId, error), "Invalid AgentEvent from Codex workflow"),
        ),
      );
    }
  } finally {
    if (!response.writableEnded && !response.destroyed) {
      response.end();
    }
  }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createLanternwoodServer();

  server.listen(port, "127.0.0.1", () => {
    console.log(`Lanternwood Codex CLI server listening on http://127.0.0.1:${port}`);
  });
}
