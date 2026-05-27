import { createServer, type IncomingMessage } from "node:http";
import type { PreviousRunContext } from "../src/events/types";
import { validateAgentEvent } from "../src/events/validation";
import { createTaskId } from "../src/harness/taskIds";
import { createCodexEvents } from "./codexWorkflow";
import { loadDotEnvFile } from "./env";
import { validatePreviousRun } from "./requestValidation";
import { encodeAgentEvent } from "./sse";

loadDotEnvFile();

const port = Number(process.env.LANTERNWOOD_CODEX_PORT ?? 8787);
const healthToken = process.env.LANTERNWOOD_CODEX_HEALTH_TOKEN;
const maxBodyBytes = 128 * 1024;

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

  return JSON.parse(body) as { input?: unknown; previousRun?: unknown };
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

  if (request.method !== "POST" || request.url !== "/api/runs") {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
    return;
  }

  let input = "";
  let previousRun: PreviousRunContext | undefined;
  try {
    const body = await readJsonBody(request);
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
    for await (const event of createCodexEvents(input, undefined, { previousRun, signal: abortController.signal })) {
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
