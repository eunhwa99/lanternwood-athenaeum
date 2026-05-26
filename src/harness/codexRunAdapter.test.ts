import { describe, expect, it, vi } from "vitest";
import { createCodexRunAdapter } from "./codexRunAdapter";

function sseEvent(data: unknown) {
  return `event: agent-event\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("codex run adapter", () => {
  it("streams agent events from the backend SSE response", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sseEvent({
              agentId: "luma",
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
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("task.created");
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
});
