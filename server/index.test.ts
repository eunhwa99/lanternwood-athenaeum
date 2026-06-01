import { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/events/types";
import { createLanternwoodServer } from "./index";

const allowedOrigin = "http://127.0.0.1:5173";

function event(type: AgentEvent["type"], payload?: AgentEvent["payload"]): AgentEvent {
  return {
    agentId: "luma",
    eventId: `event-${type}`,
    message: type,
    payload,
    taskId: "task-1",
    timestamp: "2026-05-31T00:00:00.000Z",
    type,
  } as AgentEvent;
}

function collectSseEvents(text: string): AgentEvent[] {
  return text
    .split("\n\n")
    .flatMap((message) =>
      message
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice("data:".length).trimStart()) as AgentEvent),
    );
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;

      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

describe("Lanternwood Codex server", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => close(server)));
  });

  async function startServer(createEvents: NonNullable<Parameters<typeof createLanternwoodServer>[0]>["createEvents"]) {
    const server = createLanternwoodServer({ createEvents });
    servers.push(server);
    const baseUrl = await listen(server);

    return `${baseUrl}/api/runs`;
  }

  it("does not expose the request token through health checks", async () => {
    const server = createLanternwoodServer({ healthToken: "dev-token" });
    servers.push(server);
    const baseUrl = await listen(server);

    const unauthenticatedResponse = await fetch(`${baseUrl}/api/health`);

    expect(unauthenticatedResponse.status).toBe(403);
    expect(await unauthenticatedResponse.text()).not.toContain("dev-token");

    const authenticatedResponse = await fetch(`${baseUrl}/api/health`, {
      headers: { "X-Lanternwood-Codex-Token": "dev-token" },
    });

    expect(authenticatedResponse.status).toBe(200);
    expect(await authenticatedResponse.json()).toEqual({ ok: true });
  });

  it("rejects cross-site run requests before starting Codex execution", async () => {
    const createEvents = vi.fn(async function* () {
      yield event("task.created");
    });
    const endpoint = await startServer(createEvents);

    const response = await fetch(endpoint, {
      body: JSON.stringify({ input: "Draft a plan" }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden origin");
    expect(createEvents).not.toHaveBeenCalled();
  });

  it("rejects Sec-Fetch-Site cross-site run requests even with an allowed origin", async () => {
    const createEvents = vi.fn(async function* () {
      yield event("task.created");
    });
    const endpoint = await startServer(createEvents);

    const response = await fetch(endpoint, {
      body: JSON.stringify({ input: "Draft a plan" }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
        "Sec-Fetch-Site": "cross-site",
      },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden origin");
    expect(createEvents).not.toHaveBeenCalled();
  });

  it("rejects non-JSON run requests before starting Codex execution", async () => {
    const createEvents = vi.fn(async function* () {
      yield event("task.created");
    });
    const endpoint = await startServer(createEvents);

    const response = await fetch(endpoint, {
      body: JSON.stringify({ input: "Draft a plan" }),
      headers: {
        "Content-Type": "text/plain",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(response.status).toBe(415);
    expect(await response.text()).toBe("Content-Type must be application/json");
    expect(createEvents).not.toHaveBeenCalled();
  });

  it("rejects danger-full-access retries without a matching approval token", async () => {
    const createEvents = vi.fn(async function* () {
      yield event("task.created");
    });
    const endpoint = await startServer(createEvents);

    const response = await fetch(endpoint, {
      body: JSON.stringify({ input: "Draft a plan", sandboxMode: "danger-full-access" }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Sandbox escalation requires a matching approval token");
    expect(createEvents).not.toHaveBeenCalled();
  });

  it("rejects invalid queued agent-job requests before starting SSE", async () => {
    const createAgentJobEvents = vi.fn(async function* () {
      yield event("agent.done");
    });
    const server = createLanternwoodServer({ createAgentJobEvents });
    servers.push(server);
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/agent-jobs`, {
      body: JSON.stringify({ input: "Draft a plan", taskId: "task-1" }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Missing or invalid agentId");
    expect(createAgentJobEvents).not.toHaveBeenCalled();

    const unknownAgentResponse = await fetch(`${baseUrl}/api/agent-jobs`, {
      body: JSON.stringify({ agentId: "not-real-agent", input: "Draft a plan", taskId: "task-1" }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(unknownAgentResponse.status).toBe(400);
    expect(await unknownAgentResponse.text()).toBe("Missing or invalid agentId");
    expect(createAgentJobEvents).not.toHaveBeenCalled();
  });

  it("injects one-use approval tokens and accepts an approved danger-full-access retry", async () => {
    const createEvents = vi.fn(async function* (_input, _workflow, options) {
      if (options?.sandboxMode === "danger-full-access") {
        yield event("agent.done", { sandboxMode: options.sandboxMode });
        return;
      }

      yield event("approval.requested", {
        reason: "Need broader access.",
        requestedSandbox: "danger-full-access",
      });
    });
    const endpoint = await startServer(createEvents);

    const firstResponse = await fetch(endpoint, {
      body: JSON.stringify({ input: "Draft a plan" }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });
    const firstEvents = collectSseEvents(await firstResponse.text());
    const approvalToken = firstEvents[0].payload?.approvalToken;

    expect(firstResponse.status).toBe(200);
    expect(approvalToken).toEqual(
      expect.stringMatching(/^approval-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    );

    const retryResponse = await fetch(endpoint, {
      body: JSON.stringify({
        approvalAgentId: "luma",
        approvalToken,
        input: "Draft a plan",
        sandboxMode: "danger-full-access",
        taskId: "task-1",
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(retryResponse.status).toBe(200);
    expect(collectSseEvents(await retryResponse.text())[0]).toMatchObject({
      payload: {
        sandboxMode: "danger-full-access",
      },
      type: "agent.done",
    });
    expect(createEvents).toHaveBeenLastCalledWith(
      "Draft a plan",
      undefined,
      expect.objectContaining({ sandboxMode: "danger-full-access" }),
    );

    const reusedTokenResponse = await fetch(endpoint, {
      body: JSON.stringify({
        approvalAgentId: "luma",
        approvalToken,
        input: "Draft a plan",
        sandboxMode: "danger-full-access",
        taskId: "task-1",
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(reusedTokenResponse.status).toBe(403);
  });

  it("rejects approved danger-full-access retries with the wrong approval scope", async () => {
    const createEvents = vi.fn(async function* () {
      yield event("approval.requested", {
        reason: "Need broader access.",
        requestedSandbox: "danger-full-access",
      });
    });
    const endpoint = await startServer(createEvents);

    const firstResponse = await fetch(endpoint, {
      body: JSON.stringify({ input: "Draft a plan" }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });
    const approvalToken = collectSseEvents(await firstResponse.text())[0].payload?.approvalToken;

    const wrongTaskResponse = await fetch(endpoint, {
      body: JSON.stringify({
        approvalAgentId: "luma",
        approvalToken,
        input: "Draft a plan",
        sandboxMode: "danger-full-access",
        taskId: "task-2",
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(wrongTaskResponse.status).toBe(403);

    const wrongAgentResponse = await fetch(endpoint, {
      body: JSON.stringify({
        approvalAgentId: "orion",
        approvalToken,
        input: "Draft a plan",
        sandboxMode: "danger-full-access",
        taskId: "task-1",
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(wrongAgentResponse.status).toBe(403);
  });

  it("rejects approval tokens on the wrong Codex route", async () => {
    const createAgentJobEvents = vi.fn(async function* () {
      yield event("approval.requested", {
        reason: "Need broader access.",
        requestedSandbox: "danger-full-access",
      });
    });
    const createEvents = vi.fn(async function* () {
      yield event("agent.done");
    });
    const server = createLanternwoodServer({ createAgentJobEvents, createEvents });
    servers.push(server);
    const baseUrl = await listen(server);

    const firstResponse = await fetch(`${baseUrl}/api/agent-jobs`, {
      body: JSON.stringify({
        agentId: "orion",
        input: "Draft a plan",
        selectedAgentIds: ["orion"],
        taskId: "task-1",
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });
    const approvalToken = collectSseEvents(await firstResponse.text())[0].payload?.approvalToken;

    const wrongRouteResponse = await fetch(`${baseUrl}/api/runs`, {
      body: JSON.stringify({
        approvalAgentId: "orion",
        approvalToken,
        input: "Draft a plan",
        sandboxMode: "danger-full-access",
        taskId: "task-1",
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(wrongRouteResponse.status).toBe(403);
    expect(createEvents).not.toHaveBeenCalled();
  });
});
