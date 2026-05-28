import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockRunAdapter } from "../harness/mockRunAdapter";
import type { RunAdapter } from "../harness/runAdapter";
import { renderApp } from "../test/render";
import { AppShell } from "./AppShell";

vi.mock("../world/LanternwoodScene", () => ({
  LanternwoodScene: ({
    runEpoch,
    state,
  }: {
    runEpoch: number;
    state: { agents: { luma: { status: string } }; timeline: unknown[] };
  }) => (
    <div data-testid="lanternwood-scene">
      <span>scene-luma-{state.agents.luma.status}</span>
      <span>scene-events-{state.timeline.length}</span>
      <span>scene-run-{runEpoch}</span>
    </div>
  ),
}));

describe("AppShell", () => {
  it("shows compact Codex diagnostics without the old visible timeline", () => {
    renderApp(<AppShell runAdapter={mockRunAdapter} runMode="codex" />);

    const inspector = screen.getByRole("region", { name: "Live run inspector" });
    expect(inspector).toHaveTextContent(/Mode\s*codex/);
    expect(inspector).toHaveTextContent(/Codex\s*idle/);
    expect(inspector).toHaveTextContent(/Events\s*0/);
    expect(screen.queryByRole("region", { name: "Event timeline" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Final output" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agents summary")).toHaveTextContent("Luma: idle");
    expect(screen.getByText("Luma: idle")).toHaveStyle({ "--agent-color": "#f2c66d" });

    fireEvent.click(screen.getByRole("button", { name: "Open raw Codex details" }));
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent(
      "No raw response captured for this run.",
    );
  });

  it("surfaces Codex backend diagnostics when the live adapter fails before streaming", async () => {
    const failingRunAdapter: RunAdapter = {
      startRun: () =>
        ({
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                throw new Error("Codex CLI run failed: backend unavailable");
              },
            };
          },
        }),
    };

    renderApp(<AppShell runAdapter={failingRunAdapter} runMode="codex" />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Draft a focused project plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      const inspector = screen.getByRole("region", { name: "Live run inspector" });
      expect(inspector).toHaveTextContent(/Backend\s*unavailable/);
      expect(inspector).toHaveTextContent(/CLI\s*codex exec/);
      expect(inspector).toHaveTextContent(/Model\s*Codex CLI backend unavailable/);
    });
  });

  it("runs the mock flow through compact cards and opens final/log details", async () => {
    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Review this code and verify risky edge cases" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await screen.findAllByText("Here is the focused plan synthesized from Orion and Argus.");

    expect(screen.getByText("scene-events-14")).toBeInTheDocument();
    expect(screen.getByLabelText("Agents summary")).toHaveTextContent("Argus: done");
    expect(screen.getByRole("region", { name: "Routing decision" })).toHaveTextContent("Luma selected: Orion, Argus");
    expect(screen.getByRole("region", { name: "Routing decision" })).toHaveTextContent("Skipped: Neria, Quill");
    expect(screen.getByRole("region", { name: "Live run inspector" })).toHaveTextContent(
      "Research brief: focus the plan around the highest-risk milestone first.",
    );
    expect(screen.getByRole("button", { name: "View Orion details" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Orion details" }));
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("Orion Details");
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent(
      "Research brief: focus the plan around the highest-risk milestone first.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Open full final output" }));
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent(
      "Here is the focused plan synthesized from Orion and Argus.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Open run log" }));
    fireEvent.click(screen.getByRole("tab", { name: "Routing" }));
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("Selected agents: Orion, Argus");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Open run log" }));
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent(
      "Luma -> Orion: Orion, focus the plan around the highest-risk milestone first.",
    );
  });

  it("stores successful run context and forwards it to the next run", async () => {
    const seenPreviousRuns: unknown[] = [];
    const contextRunAdapter: RunAdapter = {
      async *startRun(input, options) {
        seenPreviousRuns.push(options?.previousRun);
        yield {
          agentId: "luma",
          eventId: `${input}-1`,
          message: input,
          taskId: `task-${input}`,
          timestamp: "2026-05-26T00:00:00.000Z",
          type: "task.created",
        };
        yield {
          agentId: "orion",
          eventId: `${input}-2`,
          message: "Orion returns research findings",
          payload: { report: "Research complete" },
          taskId: `task-${input}`,
          timestamp: "2026-05-26T00:00:01.000Z",
          type: "agent.reporting",
        };
        yield {
          agentId: "argus",
          eventId: `${input}-3`,
          message: "Argus returns review notes",
          payload: { report: "Review complete" },
          taskId: `task-${input}`,
          timestamp: "2026-05-26T00:00:02.000Z",
          type: "agent.reporting",
        };
        yield {
          agentId: "luma",
          eventId: `${input}-4`,
          message: "Luma places the final summary on the central desk",
          payload: { finalOutput: `Final for ${input}` },
          taskId: `task-${input}`,
          timestamp: "2026-05-26T00:00:03.000Z",
          type: "agent.done",
        };
      },
    };

    renderApp(<AppShell runAdapter={contextRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "First prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));
    await screen.findAllByText("Final for First prompt");

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Who worked on that?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      expect(seenPreviousRuns[1]).toMatchObject({
        delegatedAgents: ["Orion", "Argus"],
        finalOutput: "Final for First prompt",
        prompt: "First prompt",
        taskId: "task-First prompt",
      });
    });
  });

  it("increments the scene run epoch even when the same prompt is submitted again", async () => {
    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "What is Luma?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));
    await screen.findAllByText("This request is simple enough for Luma to answer directly without specialist routing.");
    expect(screen.getByText("scene-run-1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "What is Luma?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => expect(screen.getByText("scene-run-2")).toBeInTheDocument());
  });

  it("marks active specialists failed when a stream throws while preserving reported output", async () => {
    const reportingThenFailingRunAdapter: RunAdapter = {
      async *startRun() {
        yield {
          agentId: "luma",
          eventId: "task-1-client-1",
          message: "Draft a focused project plan",
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:00.000Z",
          type: "task.created",
        };
        yield {
          agentId: "orion",
          eventId: "task-1-client-2",
          message: "Orion returns research findings",
          payload: { report: "Research complete" },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:01.000Z",
          type: "agent.reporting",
        };
        yield {
          agentId: "neria",
          eventId: "task-1-client-3",
          message: "Neria is working",
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:02.000Z",
          type: "agent.working",
        };
        throw new Error("Stream interrupted");
      },
    };

    renderApp(<AppShell runAdapter={reportingThenFailingRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Draft a focused project plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      expect(screen.getAllByText("Stream interrupted").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Research complete")).toBeInTheDocument();
    expect(screen.queryByText("Orion's route closed after the stream failed")).not.toBeInTheDocument();
    expect(screen.getAllByText("Route closed after the stream failed").length).toBeGreaterThan(0);
  });

  it("marks unfinished specialists failed when the backend sends terminal Luma failure", async () => {
    const terminalFailureRunAdapter: RunAdapter = {
      async *startRun() {
        yield {
          agentId: "luma",
          eventId: "task-1-client-1",
          message: "Draft a focused project plan",
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:00.000Z",
          type: "task.created",
        };
        yield {
          agentId: "orion",
          eventId: "task-1-client-2",
          message: "Orion returns research findings",
          payload: { report: "Research complete" },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:01.000Z",
          type: "agent.reporting",
        };
        yield {
          agentId: "neria",
          eventId: "task-1-client-3",
          message: "Neria is working",
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:02.000Z",
          type: "agent.working",
        };
        yield {
          agentId: "luma",
          eventId: "task-1-client-4",
          message: "Codex workflow stream failed",
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:03.000Z",
          type: "agent.failed",
        };
      },
    };

    renderApp(<AppShell runAdapter={terminalFailureRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Draft a focused project plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      expect(screen.getAllByText("Route closed after Luma reported a run failure").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Research complete")).toBeInTheDocument();
  });

  it("lets the user stop an in-flight run through the adapter abort signal", async () => {
    let seenSignal: AbortSignal | undefined;
    const stoppingRunAdapter: RunAdapter = {
      async *startRun(_input, options) {
        seenSignal = options?.signal;
        yield {
          agentId: "luma",
          eventId: "task-stop-1",
          message: "Draft a focused project plan",
          taskId: "task-stop",
          timestamp: "2026-05-26T00:00:00.000Z",
          type: "task.created",
        };
        yield {
          agentId: "orion",
          eventId: "task-stop-2",
          message: "Orion is working",
          taskId: "task-stop",
          timestamp: "2026-05-26T00:00:01.000Z",
          type: "agent.working",
        };
        await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
        throw new Error("Run aborted");
      },
    };

    renderApp(<AppShell runAdapter={stoppingRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Draft a focused project plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await screen.findByText("Orion is working");
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));

    await waitFor(() => {
      expect(seenSignal?.aborted).toBe(true);
      expect(screen.getAllByText("Run aborted").length).toBeGreaterThan(0);
    });
  });

  it("opens raw Codex details from streamed diagnostics", async () => {
    const diagnosticRunAdapter: RunAdapter = {
      async *startRun() {
        yield {
          agentId: "luma",
          eventId: "task-1-client-1",
          message: "Draft a focused project plan",
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:00.000Z",
          type: "task.created",
        };
        yield {
          agentId: "orion",
          eventId: "task-1-client-2",
          message: "Orion returns research findings",
          payload: {
            rawResponse: "Raw /Users/eunhwa/private/output",
            report: "Research output from Orion",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:01.000Z",
          type: "agent.reporting",
        };
      },
    };

    renderApp(<AppShell runAdapter={diagnosticRunAdapter} runMode="codex" />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Draft a focused project plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await screen.findByText("Research output from Orion");
    fireEvent.click(screen.getByRole("button", { name: "Open raw Codex details" }));

    const drawer = screen.getByRole("dialog", { name: "Run details" });
    expect(drawer).toHaveTextContent("[redacted-path]");
    expect(drawer).not.toHaveTextContent("/Users/eunhwa/private");
  });
});
