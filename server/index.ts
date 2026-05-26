import { createServer, type IncomingMessage } from "node:http";
import { createAgentsSdkEvents } from "./agentsSdkWorkflow";
import { loadDotEnvFile } from "./env";
import { encodeAgentEvent } from "./sse";

loadDotEnvFile();

const port = Number(process.env.LANTERNWOOD_AGENTS_PORT ?? 8787);

async function readJsonBody(request: IncomingMessage) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
  }

  return JSON.parse(body) as { input?: unknown };
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
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method !== "POST" || request.url !== "/api/runs") {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
    return;
  }

  let input = "";
  try {
    const body = await readJsonBody(request);
    input = typeof body.input === "string" ? body.input.trim() : "";
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

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });

  for await (const event of createAgentsSdkEvents(input)) {
    response.write(encodeAgentEvent(event));
  }

  response.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Lanternwood Agents SDK server listening on http://127.0.0.1:${port}`);
});
