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
    expect(finalOutput).toHaveTextContent("Here is the focused plan synthesized from Orion, Neria, and Argus.");

    await waitFor(() => {
      expect(screen.getAllByText("done")).toHaveLength(4);
    });
    expect(screen.getByText("scene-luma-done")).toBeInTheDocument();
    expect(screen.getByText("scene-events-13")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("recovers the task input and shows a failed manager state when the run adapter throws", async () => {
    const failingRunAdapter: RunAdapter = {
      async *startRun() {
        yield await Promise.reject(new Error("Agents backend unavailable"));
      },
    };

    renderApp(<AppShell runAdapter={failingRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Draft a focused project plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Luma" }));

    await screen.findByText("Agents backend unavailable");

    expect(screen.getByRole("button", { name: "Send to Luma" })).toBeEnabled();
    expect(screen.getByLabelText("Task request")).toBeEnabled();
    expect(screen.getByText("scene-luma-failed")).toBeInTheDocument();
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

    await screen.findByText("Stream interrupted");

    expect(screen.getByRole("button", { name: "Send to Luma" })).toBeEnabled();
    expect(screen.getByText("scene-luma-failed")).toBeInTheDocument();
    expect(screen.getByText("Orion's route closed after the stream failed")).toBeInTheDocument();
    expect(screen.getByText("Stream interrupted")).toBeInTheDocument();
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

    await screen.findByText("Stream interrupted");

    expect(screen.getByText("Orion returns research findings")).toBeInTheDocument();
    expect(screen.queryByText("Orion's route closed after the stream failed")).not.toBeInTheDocument();
    expect(screen.getByText("scene-luma-failed")).toBeInTheDocument();
  });
});
