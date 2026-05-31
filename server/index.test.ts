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
  };
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
      body: JSON.stringify({ input: "Draft a plan", sandbox: "danger-full-access" }),
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

  it("injects one-use approval tokens and accepts an approved danger-full-access retry", async () => {
    const createEvents = vi.fn(async function* (_input, _workflow, options) {
      if (options?.sandbox === "danger-full-access") {
        yield event("agent.done", { sandbox: options.sandbox });
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
        approvalToken,
        input: "Draft a plan",
        sandbox: "danger-full-access",
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
        sandbox: "danger-full-access",
      },
      type: "agent.done",
    });
    expect(createEvents).toHaveBeenLastCalledWith(
      "Draft a plan",
      undefined,
      expect.objectContaining({ sandbox: "danger-full-access" }),
    );

    const reusedTokenResponse = await fetch(endpoint, {
      body: JSON.stringify({
        approvalToken,
        input: "Draft a plan",
        sandbox: "danger-full-access",
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: allowedOrigin,
      },
      method: "POST",
    });

    expect(reusedTokenResponse.status).toBe(403);
  });
});
