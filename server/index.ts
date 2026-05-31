import { createServer, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import type { AgentEvent } from "../src/events/types";
import { isSandboxMode, type SandboxMode } from "../src/harness/permissions";
import { ApprovalGate } from "./approvalGate";
import { createCodexEvents } from "./codexWorkflow";
import { loadDotEnvFile } from "./env";
import { encodeAgentEvent } from "./sse";

loadDotEnvFile();

const port = Number(process.env.LANTERNWOOD_CODEX_PORT ?? 8787);
const defaultAllowedOrigin = "http://127.0.0.1:5173";

type CreateEvents = (
  input: string,
  workflow: undefined,
  options: { sandbox?: SandboxMode; signal: AbortSignal },
) => AsyncIterable<AgentEvent>;

type LanternwoodServerOptions = {
  allowedOrigin?: string;
  approvalGate?: ApprovalGate;
  createEvents?: CreateEvents;
};

async function readJsonBody(request: IncomingMessage) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
  }

  return JSON.parse(body) as { approvalToken?: unknown; input?: unknown; sandbox?: unknown };
}

function hasTrustedOrigin(request: IncomingMessage, allowedOrigin: string) {
  const origin = request.headers.origin;
  const fetchSite = request.headers["sec-fetch-site"];

  if (fetchSite === "cross-site") {
    return false;
  }

  return !origin || origin === allowedOrigin;
}

function hasJsonContentType(request: IncomingMessage) {
  const contentType = request.headers["content-type"];

  return typeof contentType === "string" && contentType.toLowerCase().split(";")[0].trim() === "application/json";
}

export function createLanternwoodServer({
  allowedOrigin = defaultAllowedOrigin,
  approvalGate = new ApprovalGate(),
  createEvents = createCodexEvents,
}: LanternwoodServerOptions = {}) {
  return createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/api/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method !== "POST" || request.url !== "/api/runs") {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
      return;
    }

    if (!hasTrustedOrigin(request, allowedOrigin)) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Forbidden origin");
      return;
    }

    if (!hasJsonContentType(request)) {
      response.writeHead(415, { "Content-Type": "text/plain" });
      response.end("Content-Type must be application/json");
      return;
    }

    let input = "";
    let approvalToken: string | undefined = undefined;
    let sandbox: SandboxMode | undefined = undefined;
    try {
      const body = await readJsonBody(request);
      input = typeof body.input === "string" ? body.input.trim() : "";
      approvalToken = typeof body.approvalToken === "string" ? body.approvalToken.trim() : undefined;
      if (body.sandbox !== undefined) {
        if (!isSandboxMode(body.sandbox)) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end("Invalid sandbox");
          return;
        }

        sandbox = body.sandbox;
      }
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Invalid JSON body");
      return;
    }

    if (!input) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Missing input");
      return;
    }

    if (sandbox) {
      const approval = approvalGate.approveRequest(input, sandbox, approvalToken);

      if (!approval.ok) {
        response.writeHead(403, { "Content-Type": "text/plain" });
        response.end(approval.error);
        return;
      }
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
      for await (const event of createEvents(input, undefined, { sandbox, signal: abortController.signal })) {
        if (abortController.signal.aborted) {
          break;
        }

        if (event.type === "approval.requested" && typeof event.payload?.requestedSandbox === "string") {
          const requestedSandbox = event.payload.requestedSandbox;

          if (isSandboxMode(requestedSandbox)) {
            const token = approvalGate.createApproval(input, requestedSandbox);
            event.payload.approvalToken = token;
          }
        }

        response.write(encodeAgentEvent(event));
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
