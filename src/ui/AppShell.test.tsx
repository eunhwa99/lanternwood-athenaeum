import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockRunAdapter } from "../harness/mockRunAdapter";
import type { RunAdapter } from "../harness/runAdapter";
import { renderApp } from "../test/render";
import { AppShell } from "./AppShell";

vi.mock("../world/LanternwoodScene", () => ({
  LanternwoodScene: ({ state }: { state: { agents: { luma: { status: string } }; timeline: unknown[] } }) => (
    <div data-testid="lanternwood-scene">
      <span>scene-luma-{state.agents.luma.status}</span>
      <span>scene-events-{state.timeline.length}</span>
    </div>
  ),
}));

describe("AppShell", () => {
  it("shows idle Codex diagnostics before the first Codex run starts", () => {
    renderApp(<AppShell runAdapter={mockRunAdapter} runMode="codex" />);

    const inspector = screen.getByRole("region", { name: "Live run inspector" });
    expect(inspector).toHaveTextContent(/Mode\s*codex/);
    expect(inspector).toHaveTextContent(/Backend\s*not connected/);
    expect(inspector).toHaveTextContent(/CLI\s*codex exec/);
    expect(inspector).toHaveTextContent(/Model\s*awaiting Codex backend/);
    expect(inspector).toHaveTextContent(/Codex\s*idle/);
  });

  it("runs the mock agent flow from task input through panels and timeline", async () => {
    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await screen.findByText("Luma places the final summary on the central desk");

    expect(screen.getAllByText("Draft a focused project plan").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Orion returns to the star-map balcony")).toBeInTheDocument();
    expect(screen.getByText("Neria closes the archive ledger")).toBeInTheDocument();
    expect(screen.getByText("Argus lowers the review lantern")).toBeInTheDocument();
    expect(screen.getByText("Luma raises the blue approval lantern")).toBeInTheDocument();
    const finalOutput = screen.getByRole("region", { name: "Final output" });
    expect(finalOutput).toHaveAttribute("aria-live", "polite");
    expect(finalOutput).toHaveAttribute("aria-atomic", "true");
    expect(finalOutput).toHaveTextContent("Here is the focused plan synthesized from Orion, Neria, Quill, and Argus.");

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Agent status" }).querySelectorAll("strong")).toHaveLength(5);
    });
    expect(screen.getByRole("region", { name: "Agent status" })).toHaveTextContent("Luma");
    const agentStatus = screen.getByRole("region", { name: "Agent status" });
    expect(screen.getByText("scene-luma-done")).toBeInTheDocument();
    expect(screen.getByText("scene-events-16")).toBeInTheDocument();
    expect(Array.from(agentStatus.querySelectorAll("strong")).map((item) => item.textContent)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(screen.getByRole("region", { name: "Live run inspector" })).toHaveTextContent("Draft note: turn the findings into a short milestone plan.");
    expect(screen.getByRole("region", { name: "Live run inspector" })).toHaveTextContent("done");
  });

  it("recovers the task input and shows a failed manager state when the run adapter throws", async () => {
    const failingRunAdapter: RunAdapter = {
      async *startRun() {
        yield await Promise.reject(new Error("Codex backend unavailable"));
      },
    };

    renderApp(<AppShell runAdapter={failingRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      expect(screen.getAllByText("Codex backend unavailable").length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("button", { name: "Send to Luma" })).toBeEnabled();
    expect(screen.getByLabelText("Task request")).toBeEnabled();
    expect(screen.getByText("scene-luma-failed")).toBeInTheDocument();
  });

  it("keeps Codex diagnostics visible when the Codex backend fails before streaming events", async () => {
    const failingRunAdapter: RunAdapter = {
      async *startRun() {
        yield await Promise.reject(new Error("Codex backend unavailable"));
      },
    };

    renderApp(<AppShell runAdapter={failingRunAdapter} runMode="codex" />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      expect(screen.getAllByText("Codex backend unavailable").length).toBeGreaterThan(0);
    });

    const inspector = screen.getByRole("region", { name: "Live run inspector" });
    expect(inspector).toHaveTextContent(/Mode\s*codex/);
    expect(inspector).toHaveTextContent(/Backend\s*unavailable/);
    expect(inspector).toHaveTextContent(/CLI\s*codex exec/);
    expect(inspector).toHaveTextContent(/Model\s*Codex CLI backend unavailable \(model unresolved\)/);
    expect(inspector).toHaveTextContent(/Codex\s*failed/);
  });

  it("does not overwrite server Codex diagnostics when a connected stream fails", async () => {
    const connectedThenFailingRunAdapter: RunAdapter = {
      async *startRun() {
        yield {
          agentId: "luma",
          eventId: "task-1-client-1",
          message: "Draft a focused project plan",
          payload: {
            backend: "connected",
            cliCommand: "codex exec",
            codexStatus: "streaming",
            model: "gpt-5.3-codex",
            runMode: "codex",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:00.000Z",
          type: "task.created",
        };
        throw new Error("Stream interrupted");
      },
    };

    renderApp(<AppShell runAdapter={connectedThenFailingRunAdapter} runMode="codex" />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      expect(screen.getAllByText("Stream interrupted").length).toBeGreaterThan(0);
    });

    const inspector = screen.getByRole("region", { name: "Live run inspector" });
    expect(inspector).toHaveTextContent(/Mode\s*codex/);
    expect(inspector).toHaveTextContent(/Backend\s*connected/);
    expect(inspector).toHaveTextContent(/CLI\s*codex exec/);
    expect(inspector).toHaveTextContent(/Model\s*gpt-5\.3-codex/);
    expect(inspector).toHaveTextContent(/Codex\s*failed/);
  });

  it("marks in-progress specialists failed when the stream throws mid-run", async () => {
    const midStreamFailingRunAdapter: RunAdapter = {
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
          message: "Orion is working",
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:01.000Z",
          type: "agent.working",
        };
        throw new Error("Stream interrupted");
      },
    };

    renderApp(<AppShell runAdapter={midStreamFailingRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      expect(screen.getAllByText("Stream interrupted").length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("button", { name: "Send to Luma" })).toBeEnabled();
    expect(screen.getByText("scene-luma-failed")).toBeInTheDocument();
    expect(screen.getAllByText("Orion's route closed after the stream failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Stream interrupted").length).toBeGreaterThan(0);
  });

  it("preserves already reported specialists when the stream throws before Luma finishes", async () => {
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
        throw new Error("Stream interrupted");
      },
    };

    renderApp(<AppShell runAdapter={reportingThenFailingRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      expect(screen.getAllByText("Stream interrupted").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Orion returns research findings")).toBeInTheDocument();
    expect(screen.queryByText("Orion's route closed after the stream failed")).not.toBeInTheDocument();
    expect(screen.getByText("scene-luma-failed")).toBeInTheDocument();
  });

  it("shows per-agent outputs and Codex run diagnostics from streamed events", async () => {
    const diagnosticRunAdapter: RunAdapter = {
      async *startRun() {
        yield {
          agentId: "luma",
          eventId: "task-1-client-1",
          message: "Draft a focused project plan",
          payload: {
            backend: "connected",
            cliCommand: "codex exec --output-schema server/codexOutputSchema.json --output-last-message <temp>",
            codexStatus: "calling",
            model: "gpt-5.3-codex",
            runMode: "codex",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:00.000Z",
          type: "task.created",
        };
        yield {
          agentId: "orion",
          eventId: "task-1-client-2",
          message: "Orion Codex CLI is streaming output",
          payload: {
            codexStatus: "streaming",
            progress: "Orion Codex CLI is streaming output.",
            rawChunk: "{\"event\":\"turn.started\"}\n",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:01.000Z",
          type: "agent.working",
        };
        yield {
          agentId: "orion",
          eventId: "task-1-client-3",
          message: "Orion returns research findings",
          payload: {
            rawResponse: "Orion raw final",
            report: "Research output from Orion",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:02.000Z",
          type: "agent.reporting",
        };
        yield {
          agentId: "neria",
          eventId: "task-1-client-4",
          message: "Neria returns memory context",
          payload: {
            rawResponse: "Neria raw final",
            report: "Memory output from Neria",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:03.000Z",
          type: "agent.reporting",
        };
        yield {
          agentId: "luma",
          eventId: "task-1-client-5",
          message: "Luma places the final summary on the central desk",
          payload: {
            codexStatus: "completed",
            finalOutput: "Final synthesis",
            rawResponse: "Luma raw final",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:04.000Z",
          type: "agent.done",
        };
      },
    };

    renderApp(<AppShell runAdapter={diagnosticRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await screen.findByText("Research output from Orion");

    const inspector = screen.getByRole("region", { name: "Live run inspector" });
    expect(inspector).toHaveTextContent(/Mode\s*codex/);
    expect(inspector).toHaveTextContent(/Backend\s*connected/);
    expect(inspector).toHaveTextContent(/CLI\s*codex exec --output-schema server\/codexOutputSchema\.json --output-last-message <temp>/);
    expect(inspector).toHaveTextContent(/Model\s*gpt-5\.3-codex/);
    expect(inspector).toHaveTextContent(/Codex\s*completed/);
    expect(inspector).toHaveTextContent("Orion");
    expect(inspector).toHaveTextContent("Research output from Orion");
    expect(inspector).toHaveTextContent("Codex Raw Response");
    expect(inspector).toHaveTextContent("\"event\":\"turn.started\"");
    expect(inspector).toHaveTextContent("Orion raw final");
    expect(inspector).toHaveTextContent("Neria raw final");
    expect(inspector).toHaveTextContent("Luma raw final");
  });

  it("does not show specialist completion as global Codex completion while Luma is still running", async () => {
    const activeSpecialistRunAdapter: RunAdapter = {
      async *startRun() {
        yield {
          agentId: "luma",
          eventId: "task-1-client-1",
          message: "Draft a focused project plan",
          payload: {
            backend: "connected",
            cliCommand: "codex exec",
            codexStatus: "calling",
            model: "gpt-5.3-codex",
            runMode: "codex",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:00.000Z",
          type: "task.created",
        };
        yield {
          agentId: "orion",
          eventId: "task-1-client-2",
          message: "Orion returns research findings",
          payload: {
            codexStatus: "completed",
            report: "Research output from Orion",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:01.000Z",
          type: "agent.reporting",
        };
      },
    };

    renderApp(<AppShell runAdapter={activeSpecialistRunAdapter} runMode="codex" />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    const inspector = await screen.findByRole("region", { name: "Live run inspector" });
    await waitFor(() => {
      expect(inspector).toHaveTextContent(/Codex\s*running/);
    });
  });

  it("shows a failed specialist's latest failure message instead of stale progress", async () => {
    const failingSpecialistRunAdapter: RunAdapter = {
      async *startRun() {
        yield {
          agentId: "luma",
          eventId: "task-1-client-1",
          message: "Draft a focused project plan",
          payload: {
            backend: "connected",
            cliCommand: "codex exec",
            codexStatus: "calling",
            model: "gpt-5.3-codex",
            runMode: "codex",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:00.000Z",
          type: "task.created",
        };
        yield {
          agentId: "orion",
          eventId: "task-1-client-2",
          message: "Orion Codex CLI is streaming output",
          payload: {
            progress: "Orion Codex CLI is streaming output.",
            rawChunk: "{\"event\":\"turn.started\"}\n",
          },
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:01.000Z",
          type: "agent.working",
        };
        yield {
          agentId: "orion",
          eventId: "task-1-client-3",
          message: "Orion route failed with Codex timeout",
          taskId: "task-1",
          timestamp: "2026-05-26T00:00:02.000Z",
          type: "agent.failed",
        };
      },
    };

    renderApp(<AppShell runAdapter={failingSpecialistRunAdapter} runMode="codex" />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await waitFor(() => {
      expect(screen.getAllByText("Orion route failed with Codex timeout").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("region", { name: "Live run inspector" })).not.toHaveTextContent(
      /Live status: Orion Codex CLI is streaming output/,
    );
  });
});
