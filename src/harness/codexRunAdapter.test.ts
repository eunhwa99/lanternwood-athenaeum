import { describe, expect, it, vi } from "vitest";
import { createCodexRunAdapter } from "./codexRunAdapter";

function sseEvent(data: unknown) {
  return `event: agent-event\ndata: ${JSON.stringify(data)}\n\n`;
}

const terminalEvent = {
  agentId: "luma",
  eventId: "evt-terminal",
  message: "Done",
  payload: { finalOutput: "Done" },
  taskId: "task-1",
  timestamp: "2026-05-26T00:00:01.000Z",
  type: "agent.done",
};

describe("codex run adapter", () => {
  it("streams agent events from the backend SSE response", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${sseEvent({
              agentId: "luma",
              eventId: "evt-1",
              message: "Task",
              taskId: "task-1",
              timestamp: "2026-05-26T00:00:00.000Z",
              type: "task.created",
            })}${sseEvent(terminalEvent)}`,
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock });
    const events = [];

    for await (const event of adapter.startRun("Draft a plan")) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({
        body: JSON.stringify({ input: "Draft a plan" }),
        method: "POST",
      }),
    );
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("task.created");
  });

  it("forwards abort signals and previous run context to the backend", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseEvent(terminalEvent)));
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock });
    const controller = new AbortController();
    const previousRun = {
      delegatedAgents: ["Orion", "Neria"],
      finalOutput: "Previous answer",
      prompt: "Previous prompt",
      taskId: "task-previous",
      timeline: ["Luma prompted Orion", "Orion reported"],
    };

    for await (const event of adapter.startRun("Who worked on that?", { previousRun, signal: controller.signal })) {
      expect(event).toBeDefined();
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({
        body: JSON.stringify({ input: "Who worked on that?", previousRun }),
        signal: controller.signal,
      }),
    );
  });

  it("rejects malformed SSE events before yielding them", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseEvent({
              agentId: "unknown",
              eventId: "evt-1",
              message: "Task",
              taskId: "task-1",
              timestamp: "2026-05-26T00:00:00.000Z",
              type: "task.created",
            }),
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock });

    await expect(async () => {
      for await (const event of adapter.startRun("Draft a plan")) {
        expect(event).toBeDefined();
      }
    }).rejects.toThrow("Invalid AgentEvent from Codex SSE");
  });

  it("rejects malformed SSE JSON with the runtime validation message", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: agent-event\ndata: {bad json}\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock });

    await expect(async () => {
      for await (const event of adapter.startRun("Draft a plan")) {
        expect(event).toBeDefined();
      }
    }).rejects.toThrow("Invalid AgentEvent from Codex SSE");
  });

  it("throws when abort cancellation closes the SSE reader", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock });
    const run = (async () => {
      for await (const event of adapter.startRun("Draft a plan", { signal: controller.signal })) {
        expect(event).toBeDefined();
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(run).rejects.toThrow("Run aborted");
  });

  it("throws a useful error when the backend is unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("No Codex login", { status: 503 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock });

    await expect(async () => {
      for await (const event of adapter.startRun("Draft a plan")) {
        expect(event).toBeDefined();
      }
    }).rejects.toThrow("Codex CLI run failed: No Codex login");
  });

  it("rejects an SSE stream that closes before a terminal Luma event", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseEvent({
              agentId: "orion",
              eventId: "evt-1",
              message: "Orion is working",
              taskId: "task-1",
              timestamp: "2026-05-26T00:00:00.000Z",
              type: "agent.working",
            }),
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock });

    await expect(async () => {
      for await (const event of adapter.startRun("Draft a plan")) {
        expect(event).toBeDefined();
      }
    }).rejects.toThrow("Codex SSE stream ended before terminal event");
  });

  it("rejects an SSE stream that ends with an incomplete terminal frame", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseEvent(terminalEvent).trimEnd()));
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock });

    await expect(async () => {
      for await (const event of adapter.startRun("Draft a plan")) {
        expect(event).toBeDefined();
      }
    }).rejects.toThrow("Codex SSE stream ended with incomplete event");
  });
});
