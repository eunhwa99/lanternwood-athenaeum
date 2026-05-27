import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunState } from "../events/types";
import { renderApp } from "../test/render";
import { RunDetailDrawer } from "./RunDetailDrawer";

const state = {
  agents: {
    argus: { definition: {} as never, lastMessage: "", status: "idle" },
    luma: { definition: {} as never, lastMessage: "", status: "done" },
    neria: { definition: {} as never, lastMessage: "", status: "idle" },
    orion: { definition: {} as never, lastMessage: "", status: "reporting" },
    quill: { definition: {} as never, lastMessage: "", status: "idle" },
  },
  currentTask: { prompt: "Prompt", taskId: "task-1" },
  finalOutput: "Full final answer",
  timeline: [
    {
      agentId: "luma",
      eventId: "evt-1",
      message: "Luma prompts Orion",
      payload: {
        prompt: "Research this",
        promptExcerpt: "Research this",
        recipientAgentId: "orion",
        senderAgentId: "luma",
        speechBubble: "Research this",
      },
      taskId: "task-1",
      timestamp: "2026-05-26T00:00:00.000Z",
      type: "agent.prompted",
    },
    {
      agentId: "orion",
      eventId: "evt-2",
      message: "Orion reports",
      payload: { report: "Research report", rawResponse: "Raw Codex final" },
      taskId: "task-1",
      timestamp: "2026-05-26T00:00:01.000Z",
      type: "agent.reporting",
    },
  ],
} satisfies RunState;

describe("RunDetailDrawer", () => {
  it("renders final output, run log, prompts, reports, and raw Codex tabs", () => {
    renderApp(<RunDetailDrawer initialTab="final" isOpen onClose={() => undefined} runMode="codex" state={state} />);

    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("Full final answer");

    fireEvent.click(screen.getByRole("tab", { name: "Run log" }));
    expect(screen.getByText("Luma -> Orion: Research this")).toBeInTheDocument();
    expect(screen.getByText("Orion report: Research report")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Coordinator prompts" }));
    expect(screen.getByText("Research this")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Agent reports" }));
    expect(screen.getByText("Research report")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Raw Codex" }));
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("Raw Codex final");
  });

  it("targets selected agent details and closes with Escape", async () => {
    const onClose = vi.fn();
    renderApp(<RunDetailDrawer initialTab="reports" isOpen onClose={onClose} selectedAgentId="orion" state={state} />);

    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("Orion Details");
    expect(screen.getByText("Research report")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Run details" }), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());
  });

  it("shows an empty raw message when no raw response exists", () => {
    renderApp(<RunDetailDrawer initialTab="raw" isOpen onClose={() => undefined} runMode="mock" state={{ ...state, timeline: [] }} />);

    expect(screen.getByText("No raw response captured for this run.")).toBeInTheDocument();
  });

  it("shows copy success and failure feedback", async () => {
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    renderApp(<RunDetailDrawer initialTab="final" isOpen onClose={() => undefined} state={state} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await screen.findByText("Copied final output.");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await screen.findByText("Copy failed.");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  });
});
