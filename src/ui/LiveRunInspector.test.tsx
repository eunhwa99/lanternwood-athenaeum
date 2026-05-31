import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import type { RunState } from "../events/types";
import { renderApp } from "../test/render";
import { LiveRunInspector } from "./LiveRunInspector";
import type { RunDetailsTab } from "./runDetails";

const state = {
  agentQueues: {
    argus: [],
    luma: [],
    neria: [],
    orion: [],
    quill: [],
  },
  agents: {
    argus: { definition: AGENTS.find((agent) => agent.id === "argus")!, lastMessage: "Argus is idle", status: "idle" },
    luma: { definition: AGENTS.find((agent) => agent.id === "luma")!, lastMessage: "Luma is done", status: "done" },
    neria: { definition: AGENTS.find((agent) => agent.id === "neria")!, lastMessage: "Neria is idle", status: "idle" },
    orion: {
      definition: AGENTS.find((agent) => agent.id === "orion")!,
      lastMessage: "Orion has a report",
      status: "reporting",
    },
    quill: { definition: AGENTS.find((agent) => agent.id === "quill")!, lastMessage: "Quill is idle", status: "idle" },
  },
  currentTask: { prompt: "Review this code", taskId: "task-1" },
  finalOutput: "Final answer preview",
  finalOutputs: { "task-1": "Final answer preview" },
  tasks: [
    {
      completedAt: "2026-05-28T00:00:01.000Z",
      createdAt: "2026-05-28T00:00:00.000Z",
      finalOutput: "Final answer preview",
      prompt: "Review this code",
      selectedAgentIds: ["orion"],
      skippedAgentIds: ["neria", "quill", "argus"],
      status: "done",
      taskId: "task-1",
    },
  ],
  timeline: [
    {
      agentId: "orion",
      eventId: "evt-1",
      message: "Orion reports",
      payload: { report: "Research brief: focus on the risky edge first." },
      taskId: "task-1",
      timestamp: "2026-05-28T00:00:00.000Z",
      type: "agent.reporting",
    },
  ],
} satisfies RunState;

const groupedState = {
  ...state,
  agents: {
    ...state.agents,
    argus: { ...state.agents.argus, status: "idle" },
    luma: { ...state.agents.luma, status: "reporting" },
    neria: { ...state.agents.neria, status: "waitingApproval" },
    orion: { ...state.agents.orion, status: "working" },
    quill: { ...state.agents.quill, status: "done" },
  },
} satisfies RunState;

const workloadState = {
  ...state,
  agentQueues: {
    ...state.agentQueues,
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
      {
        agentId: "orion",
        jobId: "task-3-orion",
        lastMessage: "Queued",
        prompt: "Research third topic",
        queuedAt: "2026-05-28T00:00:03.000Z",
        status: "queued",
        taskId: "task-3",
      },
      {
        agentId: "orion",
        jobId: "task-4-orion",
        lastMessage: "Queued",
        prompt: "Research fourth topic",
        queuedAt: "2026-05-28T00:00:04.000Z",
        status: "queued",
        taskId: "task-4",
      },
    ],
  },
  agents: {
    ...state.agents,
    orion: {
      ...state.agents.orion,
      currentJobId: "task-1-orion",
      status: "working",
    },
  },
  currentTask: { prompt: "Research current sources", taskId: "task-1" },
  tasks: [
    {
      createdAt: "2026-05-28T00:00:00.000Z",
      finalOutput: null,
      prompt: "Research current sources",
      selectedAgentIds: ["orion"],
      skippedAgentIds: ["neria", "quill", "argus"],
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
      createdAt: "2026-05-28T00:00:03.000Z",
      finalOutput: null,
      prompt: "Research third topic",
      selectedAgentIds: ["orion"],
      skippedAgentIds: ["neria", "quill", "argus"],
      status: "queued",
      taskId: "task-3",
    },
    {
      createdAt: "2026-05-28T00:00:04.000Z",
      finalOutput: null,
      prompt: "Research fourth topic",
      selectedAgentIds: ["orion"],
      skippedAgentIds: ["neria", "quill", "argus"],
      status: "queued",
      taskId: "task-4",
    },
  ],
} satisfies RunState;

describe("LiveRunInspector", () => {
  it("renders every agent as a compact roster row with the existing detail action", () => {
    const onOpenDetails = vi.fn<(tab: RunDetailsTab, agentId?: AgentId) => void>();
    renderApp(<LiveRunInspector onOpenDetails={onOpenDetails} state={state} />);

    const roster = screen.getByRole("region", { name: "Agent roster" });
    const rows = within(roster).getAllByRole("listitem");
    const rowFor = (agentName: string) => {
      const row = rows.find((candidate) => within(candidate).queryByRole("heading", { name: agentName }));

      if (!row) {
        throw new Error(`Missing ${agentName} roster row`);
      }

      return row;
    };

    expect(rows).toHaveLength(AGENTS.length);
    AGENTS.forEach((agent) => {
      const row = rowFor(agent.displayName);

      expect(row).toHaveTextContent(agent.displayName);
      expect(row).toHaveTextContent(state.agents[agent.id].status);
      expect(within(row).getByRole("button", { name: `View ${agent.displayName} details` })).toBeInTheDocument();
    });
    expect(roster.querySelectorAll(".agent-output-card")).toHaveLength(0);

    fireEvent.click(within(rowFor("Orion")).getByRole("button", { name: "View Orion details" }));

    expect(onOpenDetails).toHaveBeenCalledWith("reports", "orion");

    fireEvent.click(within(rowFor("Luma")).getByRole("button", { name: "View Luma details" }));

    expect(onOpenDetails).toHaveBeenCalledWith("reports", "luma");
  });

  it("keeps task badges outside the clipped preview text for specialist and Luma outputs", () => {
    renderApp(<LiveRunInspector state={state} />);

    const roster = screen.getByRole("region", { name: "Agent roster" });
    const orionRow = within(roster)
      .getAllByRole("listitem")
      .find((candidate) => within(candidate).queryByRole("heading", { name: "Orion" }));

    expect(orionRow).toBeDefined();
    const preview = orionRow!.querySelector(".agent-roster-preview");

    expect(preview).toHaveClass("agent-roster-preview-with-badge");
    expect(preview?.querySelector(".task-badge")).toHaveTextContent("T1");
    expect(preview).toHaveTextContent("Research brief: focus on the risky edge first.");

    const lumaRow = within(roster)
      .getAllByRole("listitem")
      .find((candidate) => within(candidate).queryByRole("heading", { name: "Luma" }));
    const lumaPreview = lumaRow?.querySelector(".agent-roster-preview");

    expect(lumaRow).toBeDefined();
    expect(lumaPreview).toHaveClass("agent-roster-preview-with-badge");
    expect(lumaPreview?.querySelector(".task-badge")).toHaveTextContent("T1");
    expect(lumaPreview).toHaveTextContent("Final answer preview");
  });

  it("groups the compact roster by agent status with low-priority groups collapsed", () => {
    renderApp(<LiveRunInspector state={groupedState} />);

    const activeGroup = screen.getByRole("region", { name: "Active agents" });
    const reviewGroup = screen.getByRole("region", { name: "Needs review agents" });
    const doneGroup = screen.getByRole("region", { name: "Done agents" });
    const idleGroup = screen.getByRole("region", { name: "Idle agents" });

    expect(activeGroup).toHaveTextContent(/Active\s*2/);
    expect(activeGroup).toHaveTextContent("Luma");
    expect(activeGroup).toHaveTextContent("Orion");
    expect(reviewGroup).toHaveTextContent(/Needs review\s*1/);
    expect(reviewGroup).toHaveTextContent("Neria");
    expect(doneGroup).toHaveTextContent(/Done\s*1/);
    expect(doneGroup).toHaveTextContent("Quill");
    expect(idleGroup).toHaveTextContent(/Idle\s*1/);
    expect(idleGroup).toHaveTextContent("Argus");

    expect(activeGroup.querySelector("details")).toHaveAttribute("open");
    expect(reviewGroup.querySelector("details")).toHaveAttribute("open");
    expect(doneGroup.querySelector("details")).not.toHaveAttribute("open");
    expect(idleGroup.querySelector("details")).not.toHaveAttribute("open");
  });

  it("keeps agent queues compact with Details as the only row action", () => {
    const onOpenDetails = vi.fn();
    renderApp(<LiveRunInspector onOpenDetails={onOpenDetails} state={workloadState} />);

    const roster = screen.getByRole("region", { name: "Agent roster" });
    const orionRow = within(roster)
      .getAllByRole("listitem")
      .find((candidate) => within(candidate).queryByRole("heading", { name: "Orion" }));

    expect(orionRow).toBeDefined();
    const workload = within(orionRow!).getByRole("region", { name: "Orion workload" });

    expect(workload).toHaveTextContent("Now");
    expect(workload).toHaveTextContent("T1");
    expect(workload).toHaveTextContent("Research current sources");
    expect(workload).toHaveTextContent("Queue");
    expect(workload).toHaveTextContent("3 queued");
    expect(workload).not.toHaveTextContent("Research second topic");

    expect(within(orionRow!).queryByRole("button", { name: "Open Orion workload" })).not.toBeInTheDocument();

    fireEvent.click(within(orionRow!).getByRole("button", { name: "View Orion details" }));

    expect(onOpenDetails).toHaveBeenCalledWith("reports", "orion");
  });
});
