import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunState } from "../events/types";
import { renderApp } from "../test/render";
import { RunDetailDrawer } from "./RunDetailDrawer";

const state = {
  agentQueues: {
    argus: [],
    luma: [],
    neria: [],
    orion: [],
    quill: [],
  },
  agents: {
    argus: { definition: {} as never, lastMessage: "", status: "idle" },
    luma: { definition: {} as never, lastMessage: "", status: "done" },
    neria: { definition: {} as never, lastMessage: "", status: "idle" },
    orion: { definition: {} as never, lastMessage: "", status: "reporting" },
    quill: { definition: {} as never, lastMessage: "", status: "idle" },
  },
  currentTask: { prompt: "Prompt", taskId: "task-1" },
  finalOutput: "Full final answer",
  finalOutputs: { "task-1": "Full final answer" },
  tasks: [
    {
      completedAt: "2026-05-26T00:00:02.000Z",
      createdAt: "2026-05-26T00:00:00.000Z",
      finalOutput: "Full final answer",
      prompt: "Prompt",
      selectedAgentIds: ["orion"],
      skippedAgentIds: ["neria", "quill", "argus"],
      status: "done",
      taskId: "task-1",
    },
  ],
  timeline: [
    {
      agentId: "luma",
      eventId: "evt-0",
      message: "Luma selected a specialist route",
      payload: {
        confidence: "high",
        rationale: "Needs research only",
        selectedAgentIds: ["orion"],
        skippedAgentIds: ["neria", "quill", "argus"],
      },
      taskId: "task-1",
      timestamp: "2026-05-26T00:00:00.000Z",
      type: "route.planned",
    },
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
    {
      agentId: "quill",
      eventId: "evt-3",
      message: "Quill reports",
      payload: {
        report:
          "Writing report with a longer body that should be read in the report reader instead of a tiny nested scroll box.",
        rawResponse: "Raw Codex final from Quill",
      },
      taskId: "task-1",
      timestamp: "2026-05-26T00:00:02.000Z",
      type: "agent.reporting",
    },
  ],
} satisfies RunState;

const workloadState = {
  ...state,
  agentQueues: {
    ...state.agentQueues,
    argus: [
      {
        agentId: "argus",
        jobId: "task-1-argus",
        lastMessage: "Queued",
        prompt: "Research current sources",
        queuedAt: "2026-05-28T00:00:01.000Z",
        status: "queued",
        taskId: "task-1",
      },
    ],
    orion: [
      {
        agentId: "orion",
        jobId: "task-1-orion",
        lastMessage: "Orion is checking sources",
        prompt: "Research current sources",
        queuedAt: "2026-05-28T00:00:00.000Z",
        startedAt: "2026-05-28T00:00:01.000Z",
        status: "running",
        taskId: "task-1",
      },
      {
        agentId: "orion",
        jobId: "task-2-orion",
        lastMessage: "Queued",
        prompt: "Research second topic",
        queuedAt: "2026-05-28T00:00:02.000Z",
        status: "queued",
        taskId: "task-2",
      },
    ],
  },
  agents: {
    ...state.agents,
    argus: { ...state.agents.argus, status: "idle" },
    orion: { ...state.agents.orion, currentJobId: "task-1-orion", status: "working" },
  },
  currentTask: { prompt: "Research current sources", taskId: "task-1" },
  finalOutput: "Completed plan",
  finalOutputs: { "task-3": "Completed plan" },
  tasks: [
    {
      createdAt: "2026-05-28T00:00:00.000Z",
      finalOutput: null,
      prompt: "Research current sources",
      selectedAgentIds: ["orion", "argus"],
      skippedAgentIds: ["neria", "quill"],
      status: "running",
      taskId: "task-1",
    },
    {
      createdAt: "2026-05-28T00:00:02.000Z",
      finalOutput: null,
      prompt: "Research second topic",
      selectedAgentIds: ["orion"],
      skippedAgentIds: ["neria", "quill", "argus"],
      status: "queued",
      taskId: "task-2",
    },
    {
      completedAt: "2026-05-28T00:00:04.000Z",
      createdAt: "2026-05-28T00:00:03.000Z",
      finalOutput: "Completed plan",
      prompt: "Rewrite release note",
      selectedAgentIds: ["quill"],
      skippedAgentIds: ["orion", "neria", "argus"],
      status: "done",
      taskId: "task-3",
    },
  ],
} satisfies RunState;

describe("RunDetailDrawer", () => {
  it("renders run log, prompts, and report reader tabs without final/raw Codex tabs", () => {
    renderApp(<RunDetailDrawer initialTab="reports" isOpen onClose={() => undefined} runMode="codex" state={state} />);

    expect(screen.getByRole("dialog", { name: "Run details" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Final output" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Raw Codex" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Run log" }));
    expect(screen.getByText("T1 · Luma -> Orion: Research this")).toBeInTheDocument();
    expect(screen.getByText("T1 · Orion report: Research report")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Routing" }));
    expect(screen.getByText(/Selected agents: Orion/)).toBeInTheDocument();
    expect(screen.getByText(/Skipped agents: Neria, Quill, Argus/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Coordinator prompts" }));
    expect(screen.getByText("Research this")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Agent reports" }));
    const reportList = screen.getByRole("list", { name: "Agent report list" });
    expect(within(reportList).getByRole("button", { name: "Select T1 Quill report" })).toBeInTheDocument();
    expect(within(reportList).getByRole("button", { name: "Select T1 Orion report" })).toBeInTheDocument();

    const reader = screen.getByRole("article", { name: "Selected agent report" });
    expect(reader).toHaveTextContent("T1");
    expect(reader).toHaveTextContent("Luma");
    expect(reader).toHaveTextContent("Full final answer");

    fireEvent.click(within(reportList).getByRole("button", { name: "Select T1 Quill report" }));

    expect(reader).toHaveTextContent("Quill");
    expect(reader).toHaveTextContent("Writing report with a longer body");

    fireEvent.click(within(reportList).getByRole("button", { name: "Select T1 Orion report" }));

    expect(reader).toHaveTextContent("Orion");
    expect(reader).toHaveTextContent("Research report");
  });

  it("shows Luma final outputs as task-scoped agent reports", () => {
    renderApp(<RunDetailDrawer initialTab="reports" isOpen onClose={() => undefined} selectedAgentId="luma" state={state} />);

    expect(screen.queryByRole("tab", { name: "Final output" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("Luma Details");

    const reportList = screen.getByRole("list", { name: "Agent report list" });
    expect(within(reportList).getByRole("button", { name: "Select T1 Luma report" })).toBeInTheDocument();

    const reader = screen.getByRole("article", { name: "Selected agent report" });
    expect(reader).toHaveTextContent("T1");
    expect(reader).toHaveTextContent("Luma");
    expect(reader).toHaveTextContent("Full final answer");
  });

  it("targets selected agent details and closes with Escape", async () => {
    const onClose = vi.fn();
    renderApp(<RunDetailDrawer initialTab="reports" isOpen onClose={onClose} selectedAgentId="orion" state={state} />);

    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("Orion Details");
    expect(screen.getByRole("article", { name: "Selected agent report" })).toHaveTextContent("Research report");

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Run details" }), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());
  });

  it("shows an empty report reader message when no reports exist", () => {
    renderApp(
      <RunDetailDrawer
        initialTab="reports"
        isOpen
        onClose={() => undefined}
        runMode="mock"
        state={{
          ...state,
          finalOutput: null,
          finalOutputs: {},
          tasks: state.tasks.map((task) => ({ ...task, finalOutput: null, status: "running" })),
          timeline: [],
        }}
      />,
    );

    expect(screen.getByText("No agent reports captured for this run.")).toBeInTheDocument();
  });

  it("shows workload details by current task, agent, and all tasks", () => {
    renderApp(<RunDetailDrawer initialTab="workload" isOpen onClose={() => undefined} state={workloadState} />);

    expect(screen.getByRole("tab", { name: "Workload" })).toHaveAttribute("aria-selected", "true");

    const currentTask = screen.getByRole("region", { name: "Current task workload" });
    expect(currentTask).toHaveTextContent("T1");
    expect(currentTask).toHaveTextContent("Research current sources");
    expect(currentTask).toHaveTextContent("Orion");
    expect(currentTask).toHaveTextContent("working");
    expect(currentTask).toHaveTextContent("Argus");
    expect(currentTask).toHaveTextContent("queued");

    fireEvent.click(screen.getByRole("button", { name: "By agent" }));
    const agentWorkload = screen.getByRole("region", { name: "Agent workload" });
    const orionWorkload = within(agentWorkload).getByRole("article", { name: "Orion workload" });
    expect(orionWorkload).toHaveTextContent("Now");
    expect(orionWorkload).toHaveTextContent("T1");
    expect(orionWorkload).toHaveTextContent("Research current sources");
    expect(orionWorkload).toHaveTextContent("Queue");
    expect(orionWorkload).toHaveTextContent("T2");
    expect(orionWorkload).toHaveTextContent("Research second topic");

    fireEvent.click(screen.getByRole("button", { name: "All tasks" }));
    const taskWorkload = screen.getByRole("region", { name: "All task workload" });
    expect(taskWorkload).toHaveTextContent("T1");
    expect(taskWorkload).toHaveTextContent("running");
    expect(taskWorkload).toHaveTextContent("T2");
    expect(taskWorkload).toHaveTextContent("queued");
    expect(taskWorkload).toHaveTextContent("T3");
    expect(taskWorkload).toHaveTextContent("done");
  });

  it("uses the active task for unscoped current workload when currentTask points to a newer queued task", () => {
    renderApp(
      <RunDetailDrawer
        initialTab="workload"
        isOpen
        onClose={() => undefined}
        state={{
          ...workloadState,
          currentTask: { prompt: "Research second topic", taskId: "task-2" },
        }}
      />,
    );

    const currentTask = screen.getByRole("region", { name: "Current task workload" });
    expect(currentTask).toHaveTextContent("T1");
    expect(currentTask).toHaveTextContent("Research current sources");
    expect(currentTask).not.toHaveTextContent("Research second topic");
  });

  it("keeps the selected report stable while unrelated live events arrive", () => {
    const { rerender } = renderApp(<RunDetailDrawer initialTab="reports" isOpen onClose={() => undefined} state={state} />);
    const reportList = screen.getByRole("list", { name: "Agent report list" });

    fireEvent.click(within(reportList).getByRole("button", { name: "Select T1 Orion report" }));
    expect(screen.getByRole("article", { name: "Selected agent report" })).toHaveTextContent("Orion");

    rerender(
      <RunDetailDrawer
        initialTab="reports"
        isOpen
        onClose={() => undefined}
        state={{
          ...state,
          timeline: [
            ...state.timeline,
            {
              agentId: "luma",
              eventId: "evt-extra",
              message: "Luma keeps working",
              taskId: "task-1",
              timestamp: "2026-05-26T00:00:03.000Z",
              type: "agent.working",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("article", { name: "Selected agent report" })).toHaveTextContent("Orion");
  });
});