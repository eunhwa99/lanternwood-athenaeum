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
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock, requestToken: "dev-token" });
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
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock, requestToken: "dev-token" });
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

  it("forwards the selected workspace path to all Codex backend POST routes", async () => {
    const sharedTerminalEvent = {
      agentId: "luma",
      eventId: "evt-failed",
      message: "Done",
      taskId: "task-1",
      timestamp: "2026-05-26T00:00:01.000Z",
      type: "agent.failed",
    };
    const responseWithTerminalEvent = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent(sharedTerminalEvent)));
            controller.close();
          },
        }),
        { status: 200 },
      );
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => responseWithTerminalEvent());
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock, requestToken: "dev-token" });
    const workspacePath = "/home/eunhwapark/IdeaProjects/drive";

    for await (const event of adapter.startRun("Draft a plan", { workspacePath })) {
      expect(event).toBeDefined();
    }
    for await (const event of adapter.startAgentJob!(
      {
        agentId: "orion",
        delegatedPrompt: "Orion, research this.",
        prompt: "Research this",
        selectedAgentIds: ["orion"],
        skippedAgentIds: ["neria", "quill", "argus"],
        taskId: "task-1",
      },
      { workspacePath },
    )) {
      expect(event).toBeDefined();
    }
    for await (const event of adapter.synthesizeTask!(
      {
        prompt: "Research this",
        reports: { orion: "Research report" },
        selectedAgentIds: ["orion"],
        skippedAgentIds: ["neria", "quill", "argus"],
        taskId: "task-1",
      },
      { workspacePath },
    )) {
      expect(event).toBeDefined();
    }

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/runs",
      expect.objectContaining({
        body: JSON.stringify({ input: "Draft a plan", workspacePath }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/agent-jobs",
      expect.objectContaining({
        body: expect.stringContaining(`"workspacePath":"${workspacePath}"`),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/synthesis",
      expect.objectContaining({
        body: expect.stringContaining(`"workspacePath":"${workspacePath}"`),
      }),
    );
  });

  it("forwards approval tokens and workspace-write sandbox mode to Codex backend POST routes", async () => {
    const responseWithTerminalEvent = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseEvent(terminalEvent)));
            controller.close();
          },
        }),
        { status: 200 },
      );
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => responseWithTerminalEvent());
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock });

    for await (const event of adapter.startRun("Write files", { approvalToken: "approval-1", sandboxMode: "workspace-write" })) {
      expect(event).toBeDefined();
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({
        body: JSON.stringify({ input: "Write files", approvalToken: "approval-1", sandboxMode: "workspace-write" }),
      }),
    );
  });

  it("adds the configured request token to the run backend POST route", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseEvent(terminalEvent)));
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock, requestToken: "dev-token" });

    for await (const event of adapter.startRun("Draft a plan")) {
      expect(event).toBeDefined();
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Lanternwood-Codex-Token": "dev-token",
        }),
      }),
    );
  });

  it("streams queued specialist jobs through the agent-job endpoint", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseEvent({
              agentId: "orion",
              eventId: "evt-report",
              message: "Orion reports",
              payload: { report: "Research report" },
              taskId: "task-1",
              timestamp: "2026-05-26T00:00:01.000Z",
              type: "agent.reporting",
            }),
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock, requestToken: "dev-token" });
    const events = [];

    for await (const event of adapter.startAgentJob!({
      agentId: "orion",
      delegatedPrompt: "Orion, research this.",
      prompt: "Research this",
      selectedAgentIds: ["orion"],
      skippedAgentIds: ["neria", "quill", "argus"],
      taskId: "task-1",
    })) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-jobs",
      expect.objectContaining({
        body: JSON.stringify({
          agentId: "orion",
          delegatedPrompt: "Orion, research this.",
          input: "Research this",
          previousRun: undefined,
          selectedAgentIds: ["orion"],
          skippedAgentIds: ["neria", "quill", "argus"],
          taskId: "task-1",
        }),
        headers: expect.objectContaining({
          "X-Lanternwood-Codex-Token": "dev-token",
        }),
        method: "POST",
      }),
    );
    expect(events[0]).toMatchObject({ agentId: "orion", type: "agent.reporting" });
  });

  it("passes available specialist reports to queued Argus jobs", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseEvent({
              agentId: "argus",
              eventId: "evt-report",
              message: "Argus reports",
              payload: { report: "Review report" },
              taskId: "task-1",
              timestamp: "2026-05-26T00:00:01.000Z",
              type: "agent.reporting",
            }),
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock, requestToken: "dev-token" });

    for await (const event of adapter.startAgentJob!({
      agentId: "argus",
      delegatedPrompt: "Argus, review this.",
      prompt: "Review this",
      selectedAgentIds: ["orion", "argus"],
      skippedAgentIds: ["neria", "quill"],
      specialistReports: { orion: "Research report" },
      taskId: "task-1",
    })) {
      expect(event).toBeDefined();
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-jobs",
      expect.objectContaining({
        body: JSON.stringify({
          agentId: "argus",
          delegatedPrompt: "Argus, review this.",
          input: "Review this",
          previousRun: undefined,
          reports: { orion: "Research report" },
          selectedAgentIds: ["orion", "argus"],
          skippedAgentIds: ["neria", "quill"],
          taskId: "task-1",
        }),
        headers: expect.objectContaining({
          "X-Lanternwood-Codex-Token": "dev-token",
        }),
        method: "POST",
      }),
    );
  });

  it("streams queued synthesis through the synthesis endpoint", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseEvent(terminalEvent)));
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const adapter = createCodexRunAdapter({ endpoint: "/api/runs", fetchImpl: fetchMock, requestToken: "dev-token" });
    const events = [];

    for await (const event of adapter.synthesizeTask!({
      prompt: "Research this",
      reports: { orion: "Research report" },
      selectedAgentIds: ["orion"],
      skippedAgentIds: ["neria", "quill", "argus"],
      taskId: "task-1",
    })) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/synthesis",
      expect.objectContaining({
        body: JSON.stringify({
          input: "Research this",
          previousRun: undefined,
          reports: { orion: "Research report" },
          selectedAgentIds: ["orion"],
          skippedAgentIds: ["neria", "quill", "argus"],
          taskId: "task-1",
        }),
        headers: expect.objectContaining({
          "X-Lanternwood-Codex-Token": "dev-token",
        }),
        method: "POST",
      }),
    );
    expect(events[0]).toMatchObject({ agentId: "luma", type: "agent.done" });
  });

  it("rejects malformed SSE events before yielding them", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseEvent({
              agentId: "Unknown Agent!",
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
    }).rejects.toThrow("Codex CLI run failed (503 error at /api/runs): No Codex login");
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
