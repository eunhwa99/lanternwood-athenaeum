import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockRunAdapter } from "../harness/mockRunAdapter";
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

    await waitFor(() => {
      expect(screen.getAllByText("done")).toHaveLength(4);
    });
    expect(screen.getByText("scene-luma-done")).toBeInTheDocument();
    expect(screen.getByText("scene-events-13")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
  });
});
