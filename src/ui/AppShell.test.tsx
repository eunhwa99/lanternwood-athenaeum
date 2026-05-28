import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentId } from "../agents/types";
import type { AgentEvent } from "../events/types";
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

function event(
  taskId: string,
  index: number,
  agentId: AgentEvent["agentId"],
  type: AgentEvent["type"],
  message: string,
  payload?: AgentEvent["payload"],
): AgentEvent {
  return {
    agentId,
    eventId: `${taskId}-test-${index}`,
    message,
    payload,
    taskId,
    timestamp: `2026-05-28T00:00:0${index}.000Z`,
    type,
  } as AgentEvent;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

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

    expect(screen.queryByRole("button", { name: "Open raw Codex details" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open run log" }));
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("No run log entries captured yet.");
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
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

    await screen.findAllByText("Here is the focused plan synthesized from Orion and Argus.");

    expect(screen.getByText("scene-events-14")).toBeInTheDocument();
    expect(screen.getByLabelText("Agents summary")).toHaveTextContent("Argus: done");
    expect(screen.queryByRole("region", { name: "Routing decision" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Live run inspector" })).toHaveTextContent(
      "Research brief: focus the plan around the highest-risk milestone first.",
    );
    expect(screen.getByRole("button", { name: "View Orion details" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Orion details" }));
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("Orion Details");
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("T1");
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent(
      "Research brief: focus the plan around the highest-risk milestone first.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("button", { name: "Open full final output" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("T1");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open final output for T1 Review this code and verify risky edge cases",
      }),
    );
    expect(screen.queryByRole("tab", { name: "Final output" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agent reports" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("Luma Details");
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent(
      "Here is the focused plan synthesized from Orion and Argus.",
    );
    expect(screen.getByRole("dialog", { name: "Run details" })).toHaveTextContent("T1");
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
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
    await screen.findAllByText("Final for First prompt");

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Who worked on that?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
    await screen.findAllByText("This request is simple enough for Luma to answer directly without specialist routing.");
    expect(screen.getByText("scene-run-1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "What is Luma?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

    await screen.findByText("Orion is working");
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));

    await waitFor(() => {
      expect(seenSignal?.aborted).toBe(true);
      expect(screen.getAllByText("Run aborted").length).toBeGreaterThan(0);
    });
  });

  it("keeps raw Codex responses out of the user-facing drawer", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

    await screen.findByText("Research output from Orion");
    expect(screen.queryByRole("button", { name: "Open raw Codex details" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Orion details" }));
    const drawer = screen.getByRole("dialog", { name: "Run details" });
    expect(drawer).toHaveTextContent("Research output from Orion");
    expect(drawer).not.toHaveTextContent("[redacted-path]");
    expect(drawer).not.toHaveTextContent("/Users/eunhwa/private");
  });

  it("queues new tasks while agents work and opens task-specific final outputs", async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const startedJobs: string[] = [];
    const queueRunAdapter = {
      startRun() {
        throw new Error("legacy single-run adapter should not be used in queue mode");
      },
      async *startAgentJob(job: { agentId: AgentId; taskId: string }) {
        const gate = deferred();
        gates.set(`${job.agentId}:${job.taskId}`, gate);
        startedJobs.push(`${job.agentId}:${job.taskId}`);
        yield event(job.taskId, 1, job.agentId, job.agentId === "argus" ? "agent.reviewing" : "agent.working", `${job.agentId} starts ${job.taskId}`);
        await gate.promise;
        yield event(job.taskId, 2, job.agentId, "agent.reporting", `${job.agentId} reports ${job.taskId}`, {
          report: `${job.agentId} report for ${job.taskId}`,
        });
      },
      async *synthesizeTask(task: { prompt: string; reports: Partial<Record<AgentId, string>>; taskId: string }) {
        yield event(task.taskId, 3, "luma", "agent.working", `Luma synthesizes ${task.taskId}`);
        yield event(task.taskId, 4, "luma", "agent.done", `Luma completes ${task.taskId}`, {
          finalOutput: `Final for ${task.prompt}: ${Object.values(task.reports).join(" | ")}`,
        });
      },
    } as RunAdapter;

    renderApp(<AppShell runAdapter={queueRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research current sources" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Rewrite this paragraph" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

    await waitFor(() => {
      expect(startedJobs.some((job) => job.startsWith("orion:"))).toBe(true);
      expect(startedJobs.some((job) => job.startsWith("quill:"))).toBe(true);
    });
    expect(screen.getByRole("button", { name: "Send to Queue" })).toBeEnabled();
    expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("Research current sources");
    expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("Rewrite this paragraph");
    expect(screen.getByRole("region", { name: "Active tasks" })).toHaveTextContent("T1");
    expect(screen.getByRole("region", { name: "Active tasks" })).toHaveTextContent("T2");

    for (const gate of gates.values()) {
      gate.resolve();
    }
    await screen.findAllByText(/Final for Research current sources/);
    await screen.findAllByText(/Final for Rewrite this paragraph/);
    expect(screen.getByRole("region", { name: "Completed tasks" })).toHaveTextContent("T1");
    expect(screen.getByRole("region", { name: "Completed tasks" })).toHaveTextContent("T2");

    fireEvent.click(screen.getByRole("button", { name: "Open final output for T2 Rewrite this paragraph" }));
    const drawer = screen.getByRole("dialog", { name: "Run details" });
    expect(screen.queryByRole("tab", { name: "Final output" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agent reports" })).toHaveAttribute("aria-selected", "true");
    expect(drawer).toHaveTextContent("Luma Details");
    expect(drawer).toHaveTextContent("Final for Rewrite this paragraph");
    expect(drawer).toHaveTextContent("T2");
    expect(drawer).not.toHaveTextContent("Final for Research current sources");
    expect(drawer).not.toHaveTextContent("orion report");
  });

  it("keeps completed queue items to a recent preview with an explicit history expansion", async () => {
    const queueRunAdapter = {
      startRun() {
        throw new Error("legacy single-run adapter should not be used in queue mode");
      },
      async *startAgentJob(job: { agentId: AgentId; taskId: string }) {
        throw new Error("direct Luma tasks should not start specialist jobs");
        yield event(job.taskId, 1, job.agentId, "agent.failed", "unreachable");
      },
      async *synthesizeTask(task: { prompt: string; taskId: string }) {
        yield event(task.taskId, 1, "luma", "agent.done", `Luma completes ${task.prompt}`, {
          finalOutput: `Final for ${task.prompt}`,
        });
      },
    } as RunAdapter;

    renderApp(<AppShell runAdapter={queueRunAdapter} />);

    for (let index = 1; index <= 6; index += 1) {
      fireEvent.change(screen.getByLabelText("Task request"), { target: { value: `What is Luma ${index}?` } });
      fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
    }

    await screen.findAllByText(/Final for What is Luma 6/);

    const completedTasks = screen.getByRole("region", { name: "Completed tasks" });
    expect(completedTasks).toHaveTextContent("T6");
    expect(completedTasks).toHaveTextContent("T2");
    expect(completedTasks).not.toHaveTextContent("T1");
    expect(screen.getByRole("button", { name: "Show all completed tasks" })).toHaveTextContent("1 older");

    fireEvent.click(screen.getByRole("button", { name: "Show all completed tasks" }));

    expect(completedTasks).toHaveTextContent("T1");
  });

  it("keeps same-agent jobs queued until that agent finishes its active job", async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const startedJobs: string[] = [];
    const queueRunAdapter = {
      startRun() {
        throw new Error("legacy single-run adapter should not be used in queue mode");
      },
      async *startAgentJob(job: { agentId: AgentId; taskId: string }) {
        const gate = deferred();
        gates.set(`${job.agentId}:${job.taskId}`, gate);
        startedJobs.push(`${job.agentId}:${job.taskId}`);
        yield event(job.taskId, 1, job.agentId, "agent.working", `${job.agentId} starts ${job.taskId}`);
        await gate.promise;
        yield event(job.taskId, 2, job.agentId, "agent.reporting", `${job.agentId} reports ${job.taskId}`, {
          report: `${job.agentId} report for ${job.taskId}`,
        });
      },
      async *synthesizeTask(task: { prompt: string; reports: Partial<Record<AgentId, string>>; taskId: string }) {
        yield event(task.taskId, 3, "luma", "agent.done", `Luma completes ${task.taskId}`, {
          finalOutput: `Final for ${task.prompt}`,
        });
      },
    } as RunAdapter;

    renderApp(<AppShell runAdapter={queueRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research first topic" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research second topic" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

    await waitFor(() => expect(startedJobs.filter((job) => job.startsWith("orion:"))).toHaveLength(1));
    const firstOrionJob = startedJobs.find((job) => job.startsWith("orion:"));
    expect(firstOrionJob).toBeDefined();
    gates.get(firstOrionJob!)?.resolve();

    await waitFor(() => expect(startedJobs.filter((job) => job.startsWith("orion:"))).toHaveLength(2));
  });

  it("stops queued work without starting the next same-agent job", async () => {
    const startedJobs: string[] = [];
    const queueRunAdapter = {
      startRun() {
        throw new Error("legacy single-run adapter should not be used in queue mode");
      },
      async *startAgentJob(job: { agentId: AgentId; taskId: string }, options?: { signal?: AbortSignal }) {
        startedJobs.push(`${job.agentId}:${job.taskId}`);
        yield event(job.taskId, 1, job.agentId, "agent.working", `${job.agentId} starts ${job.taskId}`);
        await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
        throw new Error("Run aborted");
      },
      async *synthesizeTask(task: { prompt: string; taskId: string }) {
        yield event(task.taskId, 3, "luma", "agent.done", `Luma completes ${task.taskId}`, {
          finalOutput: `Final for ${task.prompt}`,
        });
      },
    } as RunAdapter;

    renderApp(<AppShell runAdapter={queueRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research first topic" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
    fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research second topic" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

    await waitFor(() => expect(startedJobs.filter((job) => job.startsWith("orion:"))).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("failed");
      expect(startedJobs.filter((job) => job.startsWith("orion:"))).toHaveLength(1);
    });
  });

  it("summarizes the current task's active agent work in the dashboard header", async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const currentTaskRunAdapter = {
      startRun() {
        throw new Error("legacy single-run adapter should not be used in queue mode");
      },
      async *startAgentJob(job: { agentId: AgentId; taskId: string }) {
        const gate = deferred();
        gates.set(`${job.agentId}:${job.taskId}`, gate);
        yield event(
          job.taskId,
          1,
          job.agentId,
          job.agentId === "argus" ? "agent.reviewing" : "agent.working",
          `${job.agentId} starts ${job.taskId}`,
        );
        await gate.promise;
        yield event(job.taskId, 2, job.agentId, "agent.reporting", `${job.agentId} reports ${job.taskId}`, {
          report: `${job.agentId} report for ${job.taskId}`,
        });
      },
      async *synthesizeTask(task: { prompt: string; taskId: string }) {
        yield event(task.taskId, 3, "luma", "agent.done", `Luma completes ${task.taskId}`, {
          finalOutput: `Final for ${task.prompt}`,
        });
      },
    } as RunAdapter;

    renderApp(<AppShell runAdapter={currentTaskRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Task request"), {
      target: { value: "Review this code and verify risky edge cases" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

    const currentTask = screen.getByRole("region", { name: "Current task" });

    await waitFor(() => {
      expect(currentTask).toHaveTextContent("T1");
      expect(currentTask).toHaveTextContent("Review this code and verify risky edge cases");
      expect(currentTask).toHaveTextContent("Orion");
      expect(currentTask).toHaveTextContent("working");
      expect(currentTask).toHaveTextContent("Argus");
      expect(currentTask).toHaveTextContent("reviewing");
    });

    fireEvent.click(within(currentTask).getByRole("button", { name: "View current task activity" }));
    const drawer = screen.getByRole("dialog", { name: "Run details" });

    expect(screen.getByRole("tab", { name: "Workload" })).toHaveAttribute("aria-selected", "true");
    expect(within(drawer).getByRole("region", { name: "Current task workload" })).toHaveTextContent("T1");
    expect(drawer).toHaveTextContent("Orion");
    expect(drawer).toHaveTextContent("Argus");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    for (const gate of gates.values()) {
      gate.resolve();
    }

    await screen.findAllByText(/Final for Review this code and verify risky edge cases/);
  });
});
