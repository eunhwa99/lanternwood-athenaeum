import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import { createInitialRunState, reduceAgentEvent, updateTask } from "../events/reducer";
import type { AgentEvent } from "../events/types";
import { mockRunAdapter } from "../harness/mockRunAdapter";
import type { RunAdapter } from "../harness/runAdapter";
import { renderApp } from "../test/render";
import { AppShell } from "./AppShell";
import { latestPermissionRequest } from "./permissionRequests";

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

 afterEach(() => {
   window.localStorage.clear();
   vi.unstubAllGlobals();
 });

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
  function workspaceDiscoveryResponse() {
    return {
      currentWorkspace: "/home/eunhwapark/IdeaProjects/lanternwood-athenaeum",
      roots: ["/home/eunhwapark/IdeaProjects"],
      workspaces: [
        { name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" },
        {
          name: "lanternwood-athenaeum",
          path: "/home/eunhwapark/IdeaProjects/lanternwood-athenaeum",
          root: "/home/eunhwapark/IdeaProjects",
        },
      ],
    };
  }

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

   it("disables the task input while a non-queued adapter run is active", async () => {
     const gate = deferred();
     const runAdapter: RunAdapter = {
       async *startRun(input) {
         yield event(`task-${input}`, 1, "luma", "task.created", input);
         await gate.promise;
         yield event(`task-${input}`, 2, "luma", "agent.done", "Done", { finalOutput: "Done" });
       },
     };

     renderApp(<AppShell runAdapter={runAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Draft a focused project plan" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await screen.findByRole("button", { name: "Stop run" });
     expect(screen.getByLabelText("Task request")).toBeDisabled();
     expect(screen.getByRole("button", { name: "Send to Queue" })).toBeDisabled();

     gate.resolve();
     await screen.findByText("Done");
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
       "Luma -> Orion: Orion, identify research context, assumptions, uncertainty, and source-checking needs.",
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

   it("forwards the selected workspace path to the run adapter", async () => {
     const seenWorkspaces: unknown[] = [];
     const workspaceRunAdapter: RunAdapter = {
       async *startRun(input, options) {
         seenWorkspaces.push(options?.workspacePath);
         yield event(`task-${input}`, 1, "luma", "task.created", input);
         yield event(`task-${input}`, 2, "luma", "agent.done", "Done", { finalOutput: "Done" });
       },
     };

     renderApp(<AppShell runAdapter={workspaceRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Target workspace"), {
       target: { value: "/home/eunhwapark/IdeaProjects/drive" },
     });
     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Inspect this repo" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await screen.findByText("Done");
     expect(seenWorkspaces).toEqual(["/home/eunhwapark/IdeaProjects/drive"]);
   });

  it("selects discovered workspaces from the launcher without typing the full path", async () => {
     const seenWorkspaces: unknown[] = [];
     const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
       new Response(
         JSON.stringify({
           currentWorkspace: "/home/eunhwapark/IdeaProjects/lanternwood-athenaeum",
           roots: ["/home/eunhwapark/IdeaProjects"],
           workspaces: [
             { name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" },
             {
               name: "lanternwood-athenaeum",
               path: "/home/eunhwapark/IdeaProjects/lanternwood-athenaeum",
               root: "/home/eunhwapark/IdeaProjects",
             },
           ],
         }),
         { status: 200 },
       ),
     );
     const workspaceRunAdapter: RunAdapter = {
       async *startRun(input, options) {
         seenWorkspaces.push(options?.workspacePath);
         yield event(`task-${input}`, 1, "luma", "task.created", input);
         yield event(`task-${input}`, 2, "luma", "agent.done", "Done", { finalOutput: "Done" });
       },
     };
     vi.stubGlobal("fetch", fetchMock);

     renderApp(<AppShell runAdapter={workspaceRunAdapter} />);

     fireEvent.click(await screen.findByRole("button", { name: "Select workspace drive" }));
     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Inspect this repo" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

    await screen.findByText("Done");
    expect(screen.getAllByText("/home/eunhwapark/IdeaProjects/drive").length).toBeGreaterThan(0);
    expect(seenWorkspaces).toEqual(["/home/eunhwapark/IdeaProjects/drive"]);
    expect(JSON.parse(window.localStorage.getItem("lanternwood.recentWorkspaces") ?? "[]")).toEqual([
      {
        name: "drive",
        path: "/home/eunhwapark/IdeaProjects/drive",
        repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
        repositoryVerified: true,
      },
    ]);
  });

  it("launches a branch worktree via POST /api/worktrees/launch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/branch-launcher",
              created: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
              statusMessage: "Created new worktree for feature/branch-launcher",
              workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByText("Branch launcher"));
    fireEvent.change(await screen.findByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/drive" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/branch-launcher" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/worktrees/launch",
        expect.objectContaining({
          body: JSON.stringify({
            branch: "feature/branch-launcher",
            repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("stores the launched worktree path in the workspace launcher UI", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/branch-launcher",
              created: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
              statusMessage: "Created new worktree for feature/branch-launcher",
              workspacePath: launchedWorkspacePath,
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByText("Branch launcher"));
    fireEvent.change(await screen.findByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/drive" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/branch-launcher" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    expect((await screen.findAllByText(launchedWorkspacePath)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Target workspace")).toHaveValue(launchedWorkspacePath);
  });

  it("does not prefill the repository field from a current workspace outside the discovered roots", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          currentWorkspace: "/home/eunhwapark/.codex/worktrees/1313/lanternwood-athenaeum",
          roots: ["/home/eunhwapark/IdeaProjects"],
          workspaces: [
            { name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" },
            {
              name: "lanternwood-athenaeum",
              path: "/home/eunhwapark/IdeaProjects/lanternwood-athenaeum",
              root: "/home/eunhwapark/IdeaProjects",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    expect(await screen.findByLabelText("Target workspace")).toHaveValue("");
    fireEvent.click(await screen.findByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("");
  });

  it("restores current managed workspace provenance from the server response", async () => {
    const currentManagedWorkspace = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "feature-branch-launcher-def456",
          path: currentManagedWorkspace,
          repositoryPath: "/home/eunhwapark/IdeaProjects/archive-drive",
        },
      ]),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          currentWorkspace: currentManagedWorkspace,
          currentWorkspaceLabel: "drive:feature/branch-launcher",
          currentWorkspaceRepositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          roots: ["/home/eunhwapark/IdeaProjects"],
          workspaces: [{ name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    expect(await screen.findByText("drive:feature/branch-launcher")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Selected workspace label")).toHaveTextContent("drive:feature/branch-launcher");
      expect(screen.getByLabelText("Target workspace")).toHaveValue(currentManagedWorkspace);
    });
    fireEvent.click(screen.getByText("Branch launcher"));
    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
    });
  });

  it("keeps the verified repository when reselecting the current managed workspace", async () => {
    const currentManagedWorkspace = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          currentWorkspace: currentManagedWorkspace,
          currentWorkspaceLabel: "drive:feature/branch-launcher",
          currentWorkspaceRepositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          roots: ["/home/eunhwapark/IdeaProjects"],
          workspaces: [],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    expect(await screen.findByText("drive:feature/branch-launcher")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select workspace drive:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
    });
  });

  it("does not restore a current managed workspace repository from stale recent storage when the server cannot verify it", async () => {
    const currentManagedWorkspace = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: currentManagedWorkspace,
          repositoryPath: "/home/eunhwapark/IdeaProjects/archive-drive",
        },
      ]),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          currentWorkspace: currentManagedWorkspace,
          currentWorkspaceLabel: "drive:feature/branch-launcher",
          roots: ["/home/eunhwapark/IdeaProjects"],
          workspaces: [{ name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Target workspace")).toHaveValue("");
    });
    expect(await screen.findByText("drive:feature/branch-launcher")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    fireEvent.click(await screen.findByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("");
  });

  it("falls back to the allowed source repository when the current workspace is outside the roots", async () => {
    const currentManagedWorkspace = "/home/eunhwapark/.codex/worktrees/1313/lanternwood-athenaeum";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          currentWorkspace: currentManagedWorkspace,
          currentWorkspaceLabel: "drive:feature/branch-launcher",
          currentWorkspaceRepositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          roots: ["/home/eunhwapark/IdeaProjects"],
          workspaces: [{ name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Target workspace")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
    });
    expect(screen.getByLabelText("Selected workspace label")).toHaveTextContent("drive");
    expect(screen.queryByText(currentManagedWorkspace)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select workspace drive" }));
    expect(screen.getByLabelText("Target workspace")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
  });

  it("keeps the source repository when relaunching from a recent worktree selection", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: launchedWorkspacePath,
          repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          repositoryVerified: true,
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/next",
              created: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
              statusMessage: "Created new worktree for feature/next",
              workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-next-def789",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/next" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/worktrees/launch",
        expect.objectContaining({
          body: JSON.stringify({
            branch: "feature/next",
            repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("preserves the recent source repository when selected before workspace discovery resolves", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: launchedWorkspacePath,
          repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
        },
      ]),
    );

    let resolveWorkspaces!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return new Promise<Response>((resolve) => {
          resolveWorkspaces = resolve;
        });
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/next",
              created: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
              statusMessage: "Created new worktree for feature/next",
              workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-next-def789",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("");

    resolveWorkspaces(
      new Response(JSON.stringify(workspaceDiscoveryResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    await screen.findByText("2 found");
    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
    });

    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/next" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/worktrees/launch",
        expect.objectContaining({
          body: JSON.stringify({
            branch: "feature/next",
            repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("restores server-verified provenance for the current managed workspace after delayed discovery", async () => {
    const currentManagedWorkspace = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: currentManagedWorkspace,
        },
      ]),
    );

    let resolveWorkspaces!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return new Promise<Response>((resolve) => {
          resolveWorkspaces = resolve;
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("");

    resolveWorkspaces(
      new Response(
        JSON.stringify({
          currentWorkspace: currentManagedWorkspace,
          currentWorkspaceLabel: "drive:feature/branch-launcher",
          currentWorkspaceRepositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          roots: ["/home/eunhwapark/IdeaProjects"],
          workspaces: [],
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );

    await screen.findByText("0 found");
    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
    });
  });

  it("ignores an out-of-root saved repository path and restores the managed-worktree hint instead", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: launchedWorkspacePath,
          repositoryPath: "/home/eunhwapark/.codex/worktrees/legacy-drive",
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
  });

  it("derives the repository field from a legacy recent worktree label when repositoryPath is missing", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: launchedWorkspacePath,
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
  });

  it("derives the repository field from a legacy recent worktree path when the saved label is only the worktree dirname", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/mcpcontentsearch-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "feature-branch-launcher-def456",
          path: launchedWorkspacePath,
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              roots: ["/home/eunhwapark/IdeaProjects"],
              workspaces: [
                {
                  name: "MCPContentSearch",
                  path: "/home/eunhwapark/IdeaProjects/MCPContentSearch",
                  root: "/home/eunhwapark/IdeaProjects",
                },
              ],
            }),
            {
            headers: { "Content-Type": "application/json" },
            status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace feature-branch-launcher-def456" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/MCPContentSearch");
  });

  it("does not guess a repository for a legacy recent worktree when multiple allowed repos share the same basename", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: launchedWorkspacePath,
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          roots: ["/home/eunhwapark/IdeaProjects", "/home/eunhwapark/archive"],
          workspaces: [
            { name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" },
            { name: "drive", path: "/home/eunhwapark/archive/drive", root: "/home/eunhwapark/archive" },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("");
  });

  it("does not trust a stale but allowed saved repository path when a managed-worktree hint is ambiguous", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: launchedWorkspacePath,
          repositoryPath: "/home/eunhwapark/archive/drive",
          repositoryVerified: true,
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          roots: ["/home/eunhwapark/IdeaProjects", "/home/eunhwapark/archive"],
          workspaces: [
            { name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" },
            { name: "drive", path: "/home/eunhwapark/archive/drive", root: "/home/eunhwapark/archive" },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("");
  });

  it("keeps a verified recent managed repository path when it is allowed but not rediscovered", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/typed-demo-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "typed-demo:feature/branch-launcher",
          path: launchedWorkspacePath,
          repositoryPath: "/home/eunhwapark/IdeaProjects/nested/typed-demo",
          repositoryVerified: true,
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          roots: ["/home/eunhwapark/IdeaProjects"],
          workspaces: [{ name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace typed-demo:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/nested/typed-demo");
  });

  it("reconciles a legacy recent worktree repository after workspace discovery finishes", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/mcpcontentsearch-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "feature-branch-launcher-def456",
          path: launchedWorkspacePath,
        },
      ]),
    );

    let resolveWorkspaces!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return new Promise<Response>((resolve) => {
          resolveWorkspaces = resolve;
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace feature-branch-launcher-def456" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("");

    resolveWorkspaces(
      new Response(
        JSON.stringify({
          roots: ["/home/eunhwapark/IdeaProjects"],
          workspaces: [
            {
              name: "MCPContentSearch",
              path: "/home/eunhwapark/IdeaProjects/MCPContentSearch",
              root: "/home/eunhwapark/IdeaProjects",
            },
          ],
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/MCPContentSearch");
    });
  });

  it("reconciles a legacy recent plain repository after workspace discovery finishes", async () => {
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive",
          path: "/home/eunhwapark/IdeaProjects/drive",
        },
      ]),
    );

    let resolveWorkspaces!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return new Promise<Response>((resolve) => {
          resolveWorkspaces = resolve;
        });
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/next",
              created: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
              statusMessage: "Created new worktree for feature/next",
              workspacePath: "/home/eunhwapark/IdeaProjects/drive/.lanternwood-worktrees/drive-abc123/feature-next-def789",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/next" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/worktrees/launch"))).toHaveLength(0);
    expect(screen.getAllByText("Loading workspaces").length).toBeGreaterThan(0);

    resolveWorkspaces(
      new Response(JSON.stringify(workspaceDiscoveryResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/worktrees/launch",
        expect.objectContaining({
          body: JSON.stringify({
            branch: "feature/next",
            repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("recovers a plain recent repository from its workspace path when the saved repositoryPath is stale", async () => {
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive",
          path: "/home/eunhwapark/IdeaProjects/drive",
          repositoryPath: "/home/eunhwapark/archive/drive",
        },
      ]),
    );

    let resolveWorkspaces!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return new Promise<Response>((resolve) => {
          resolveWorkspaces = resolve;
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");

    resolveWorkspaces(
      new Response(JSON.stringify(workspaceDiscoveryResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
    });
  });

  it("does not launch a recent worktree branch before workspace discovery validates a stale saved repository path", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/mcpcontentsearch-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "MCPContentSearch:feature/branch-launcher",
          path: launchedWorkspacePath,
          repositoryPath: "/home/eunhwapark/.codex/worktrees/legacy-mcpcontentsearch",
        },
      ]),
    );

    let resolveWorkspaces!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return new Promise<Response>((resolve) => {
          resolveWorkspaces = resolve;
        });
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/next",
              created: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/MCPContentSearch",
              statusMessage: "Created new worktree for feature/next",
              workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/mcpcontentsearch-abc123/feature-next-def789",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace MCPContentSearch:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/next" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/worktrees/launch"))).toHaveLength(0);
    expect(screen.getAllByText("Loading workspaces").length).toBeGreaterThan(0);

    resolveWorkspaces(
      new Response(
        JSON.stringify({
          roots: ["/home/eunhwapark/IdeaProjects"],
          workspaces: [
            {
              name: "MCPContentSearch",
              path: "/home/eunhwapark/IdeaProjects/MCPContentSearch",
              root: "/home/eunhwapark/IdeaProjects",
            },
          ],
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/MCPContentSearch");
    });
  });

  it("lets a manual repository override bypass delayed workspace discovery for a recent managed worktree", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/mcpcontentsearch-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "MCPContentSearch:feature/branch-launcher",
          path: launchedWorkspacePath,
          repositoryPath: "/home/eunhwapark/.codex/worktrees/legacy-mcpcontentsearch",
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return new Promise<Response>(() => {});
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/next",
              created: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/MCPContentSearch",
              statusMessage: "Created new worktree for feature/next",
              workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/mcpcontentsearch-abc123/feature-next-def789",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace MCPContentSearch:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    fireEvent.change(screen.getByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/MCPContentSearch" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/next" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/worktrees/launch",
        expect.objectContaining({
          body: JSON.stringify({
            branch: "feature/next",
            repositoryPath: "/home/eunhwapark/IdeaProjects/MCPContentSearch",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("prefers the managed-worktree hint over a stale but allowed saved repository path", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: launchedWorkspacePath,
          repositoryPath: "/home/eunhwapark/IdeaProjects/archive-drive",
          repositoryVerified: true,
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(workspaceDiscoveryResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
  });

  it("prefers the selected plain repository path over a stale saved repositoryPath", async () => {
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive",
          path: "/home/eunhwapark/IdeaProjects/drive",
          repositoryPath: "/home/eunhwapark/IdeaProjects/archive-drive",
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(workspaceDiscoveryResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive" }));
    fireEvent.click(screen.getByText("Branch launcher"));
    expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
  });

  it("shows reuse and create launch status text", async () => {
    const launchResponses = [
      {
        branch: "feature/existing",
        created: false,
        repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
        statusMessage: "Reused existing worktree for feature/existing",
        workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-existing-def111",
      },
      {
        branch: "feature/new",
        created: true,
        repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
        statusMessage: "Created new worktree for feature/new",
        workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-new-def222",
      },
    ];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        const nextResponse = launchResponses.shift();

        if (!nextResponse) {
          throw new Error("Unexpected extra launch request");
        }

        return Promise.resolve(
          new Response(JSON.stringify(nextResponse), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByText("Branch launcher"));
    fireEvent.change(await screen.findByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/drive" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/existing" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));
    await screen.findByText("Reused existing worktree for feature/existing");

    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/new" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));
    await screen.findByText("Created new worktree for feature/new");
  });

  it("ignores duplicate launch clicks while a launch request is still in flight", async () => {
    let resolveLaunch!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return new Promise<Response>((resolve) => {
          resolveLaunch = resolve;
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByText("Branch launcher"));
    fireEvent.change(await screen.findByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/drive" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/existing" } });

    const launchButton = screen.getByRole("button", { name: "Launch worktree" });
    fireEvent.click(launchButton);
    fireEvent.click(launchButton);

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/worktrees/launch"))).toHaveLength(1);
    expect(launchButton).toBeDisabled();

    resolveLaunch(
      new Response(
        JSON.stringify({
          branch: "feature/existing",
          created: false,
          repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
          statusMessage: "Reused existing worktree for feature/existing",
          workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-existing-def111",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );

    await screen.findByText("Reused existing worktree for feature/existing");
    expect(launchButton).not.toBeDisabled();
  });

  it("labels a detached launched worktree as detached", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/existing",
              created: true,
              detached: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
              statusMessage: "Created detached worktree for feature/existing because it is already checked out elsewhere",
              workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-existing-def111",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByText("Branch launcher"));
    fireEvent.change(await screen.findByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/drive" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/existing" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    await screen.findByText("Created detached worktree for feature/existing because it is already checked out elsewhere");
    expect(screen.getByLabelText("Selected workspace label")).toHaveTextContent("drive:feature/existing (detached)");
  });

  it("keeps the detached label when reusing an existing detached worktree", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/existing",
              created: false,
              detached: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
              statusMessage: "Reused existing worktree for feature/existing",
              workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-existing-def111",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByText("Branch launcher"));
    fireEvent.change(await screen.findByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/drive" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/existing" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    await screen.findByText("Reused existing worktree for feature/existing");
    expect(screen.getByLabelText("Selected workspace label")).toHaveTextContent("drive:feature/existing (detached)");
  });

  it("clears the launched worktree path when a later launch fails", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-existing-def111";
    let launchCount = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        launchCount += 1;
        if (launchCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                branch: "feature/existing",
                created: false,
                repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
                statusMessage: "Reused existing worktree for feature/existing",
                workspacePath: launchedWorkspacePath,
              }),
              {
                headers: { "Content-Type": "application/json" },
                status: 200,
              },
            ),
          );
        }

        return Promise.resolve(new Response("Repository is not a git repository", { status: 400 }));
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByText("Branch launcher"));
    fireEvent.change(await screen.findByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/drive" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/existing" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    expect(await screen.findByLabelText("Launched worktree path")).toHaveTextContent(launchedWorkspacePath);

    fireEvent.change(screen.getByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/not-a-repo" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/fail" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    await screen.findByText("Repository is not a git repository");
    expect(screen.queryByLabelText("Launched worktree path")).not.toBeInTheDocument();
  });

  it("clears previously inspected workspace context after a successful launch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/workspace-metadata")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metadata: {
                agentContextFiles: ["AGENTS.md"],
                changedFiles: [],
                gitStatus: "",
                packageScripts: [],
                workspacePath: "/home/eunhwapark/IdeaProjects/drive",
              },
              skills: [{ description: "Use for build tasks", name: "build-helper", path: "/tmp/build-helper/SKILL.md" }],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/next",
              created: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
              statusMessage: "Created new worktree for feature/next",
              workspacePath: "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-next-def789",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Target workspace"), {
      target: { value: "/home/eunhwapark/IdeaProjects/drive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect workspace" }));
    await screen.findByText("AGENTS.md");

    fireEvent.click(screen.getByText("Branch launcher"));
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/next" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

    await screen.findByText("Created new worktree for feature/next");
    expect(screen.getByRole("region", { name: "Workspace context" })).toHaveTextContent("Not inspected");
    expect(screen.getByRole("region", { name: "Workspace context" })).not.toHaveTextContent("AGENTS.md");
    expect(screen.getByRole("region", { name: "Skill discovery" })).not.toHaveTextContent("build-helper");
  });

  it("does not assign the previously launched repository to an unrelated inspected workspace", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              currentWorkspace: "/home/eunhwapark/IdeaProjects/lanternwood-athenaeum",
              roots: ["/home/eunhwapark/IdeaProjects"],
              workspaces: [
                { name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" },
                { name: "demo", path: "/home/eunhwapark/IdeaProjects/demo", root: "/home/eunhwapark/IdeaProjects" },
              ],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      if (url.endsWith("/api/worktrees/launch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branch: "feature/branch-launcher",
              created: true,
              repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
              statusMessage: "Created new worktree for feature/branch-launcher",
              workspacePath: launchedWorkspacePath,
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      if (url.endsWith("/api/workspace-metadata")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metadata: {
                agentContextFiles: ["AGENTS.md"],
                changedFiles: [],
                gitStatus: "",
                packageScripts: [],
                repositoryPath: "/home/eunhwapark/IdeaProjects/demo",
                workspacePath: "/home/eunhwapark/IdeaProjects/demo",
              },
              skills: [],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.click(await screen.findByText("Branch launcher"));
    fireEvent.change(await screen.findByLabelText("Repository"), {
      target: { value: "/home/eunhwapark/IdeaProjects/drive" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/branch-launcher" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));
    await screen.findByText("Created new worktree for feature/branch-launcher");

    fireEvent.change(screen.getByLabelText("Target workspace"), {
      target: { value: "/home/eunhwapark/IdeaProjects/demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect workspace" }));

    await screen.findByText("AGENTS.md");
    expect(JSON.parse(window.localStorage.getItem("lanternwood.recentWorkspaces") ?? "[]")).toEqual([
      {
        name: "demo",
        path: "/home/eunhwapark/IdeaProjects/demo",
        repositoryPath: "/home/eunhwapark/IdeaProjects/demo",
        repositoryVerified: true,
      },
      {
        name: "drive:feature/branch-launcher",
        path: launchedWorkspacePath,
        repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
        repositoryVerified: true,
      },
    ]);
  });

  it("does not mark a non-repository inspected directory as verified provenance", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/workspace-metadata")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metadata: {
                agentContextFiles: [],
                changedFiles: [],
                gitStatus: "",
                packageScripts: [],
                workspacePath: "/home/eunhwapark/IdeaProjects/notes",
              },
              skills: [],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Target workspace"), {
      target: { value: "/home/eunhwapark/IdeaProjects/notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect workspace" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("");
    });
    expect(JSON.parse(window.localStorage.getItem("lanternwood.recentWorkspaces") ?? "[]")).toEqual([
      {
        name: "notes",
        path: "/home/eunhwapark/IdeaProjects/notes",
        repositoryVerified: false,
      },
    ]);
  });

  it("stores managed worktree provenance returned by workspace inspection", async () => {
    const managedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "feature-branch-launcher-def456",
          path: managedWorkspacePath,
          repositoryPath: "/home/eunhwapark/IdeaProjects/archive-drive",
        },
      ]),
    );
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return Promise.resolve(
          new Response(JSON.stringify(workspaceDiscoveryResponse()), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }

      if (url.endsWith("/api/workspace-metadata")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metadata: {
                agentContextFiles: ["AGENTS.md"],
                changedFiles: [],
                gitStatus: "",
                packageScripts: [],
                repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
                workspaceLabel: "drive:feature/branch-launcher",
                workspacePath: managedWorkspacePath,
              },
              skills: [],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Target workspace"), {
      target: { value: managedWorkspacePath },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect workspace" }));

    await screen.findByText("AGENTS.md");
    expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/IdeaProjects/drive");
    expect(screen.getByLabelText("Selected workspace label")).toHaveTextContent("drive:feature/branch-launcher");
    expect(JSON.parse(window.localStorage.getItem("lanternwood.recentWorkspaces") ?? "[]")).toEqual([
      {
        name: "drive:feature/branch-launcher",
        path: managedWorkspacePath,
        repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
        repositoryVerified: true,
      },
    ]);
  });

  it("revalidates inspected managed-worktree provenance after workspace roots load", async () => {
    const managedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    let resolveWorkspaces!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/workspaces")) {
        return new Promise<Response>((resolve) => {
          resolveWorkspaces = resolve;
        });
      }

      if (url.endsWith("/api/workspace-metadata")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metadata: {
                agentContextFiles: ["AGENTS.md"],
                changedFiles: [],
                gitStatus: "",
                packageScripts: [],
                repositoryPath: "/home/eunhwapark/.codex/worktrees/legacy-drive",
                workspaceLabel: "drive:feature/branch-launcher",
                workspacePath: managedWorkspacePath,
              },
              skills: [],
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    fireEvent.change(screen.getByLabelText("Target workspace"), {
      target: { value: managedWorkspacePath },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect workspace" }));

    await screen.findByText("AGENTS.md");
    expect(screen.getByLabelText("Repository")).toHaveValue("/home/eunhwapark/.codex/worktrees/legacy-drive");

    resolveWorkspaces(
      new Response(JSON.stringify(workspaceDiscoveryResponse()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Repository")).toHaveValue("");
    });
  });

  it("posts generated agent definitions from a single description", async () => {
     const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
       const url = String(input);

       return Promise.resolve(
         new Response(JSON.stringify(url.endsWith("/api/agents") ? { id: "react-ui-implementation" } : { workspaces: [] }), {
           headers: { "Content-Type": "application/json" },
           status: url.endsWith("/api/agents") ? 201 : 200,
         }),
       );
     });
     vi.stubGlobal("fetch", fetchMock);

     renderApp(<AppShell runAdapter={mockRunAdapter} />);

     fireEvent.click(screen.getByText("Agent Library"));
     fireEvent.change(screen.getByLabelText("Agent description"), {
       target: { value: "React UI implementation and e2e repair specialist" },
     });
     await screen.findByText("react-ui-implementation");
     fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

     await screen.findByText("Agent react-ui-implementation created. Reload to activate.");
     expect(fetchMock).toHaveBeenCalledWith(
       "/api/agents",
       expect.objectContaining({
         body: JSON.stringify({
           color: "#7aa2f7",
           displayName: "React UI Implementation",
           id: "react-ui-implementation",
           persona:
             "Specialist focused on React UI implementation and e2e repair specialist. Keep notes concrete, scoped, and ready for Luma to synthesize.",
           promptInstruction:
             "Handle tasks related to React UI implementation and e2e repair specialist. Return concise specialist notes only.",
           routingKeywords: ["react", "ui", "implementation", "e2e", "repair", "specialist"],
           routingReason: "React UI implementation and e2e repair specialist work",
           worldRole: "React UI Implementation specialist",
         }),
         method: "POST",
       }),
     );
   });

   it("uses Codex to draft an agent but still requires create approval before files are written", async () => {
     const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
       const url = String(input);
       const body = url.endsWith("/api/agents/draft")
         ? {
             draft: {
               color: "#9ece6a",
               displayName: "React E2E Steward",
               id: "react-e2e-steward",
               persona: "Keeps React implementation and e2e repair work concrete.",
               promptInstruction: "Implement React UI and e2e repair tasks with concise evidence.",
               routingKeywords: ["react", "e2e", "ui"],
               routingReason: "React UI and e2e repair work",
               worldRole: "Interface steward",
             },
           }
         : url.endsWith("/api/agents")
           ? { id: "react-e2e-steward" }
           : { workspaces: [] };

       return Promise.resolve(
         new Response(JSON.stringify(body), {
           headers: { "Content-Type": "application/json" },
           status: url.endsWith("/api/agents") ? 201 : 200,
         }),
       );
     });
     vi.stubGlobal("fetch", fetchMock);

     renderApp(<AppShell runAdapter={mockRunAdapter} />);

     fireEvent.click(screen.getByText("Agent Library"));
     fireEvent.change(screen.getByLabelText("Agent description"), {
       target: { value: "React UI implementation and e2e repair specialist" },
     });
     fireEvent.click(screen.getByRole("button", { name: "Generate with Codex" }));

     await screen.findByText("React E2E Steward");
     expect(fetchMock).toHaveBeenCalledWith(
       "/api/agents/draft",
       expect.objectContaining({
         body: JSON.stringify({ description: "React UI implementation and e2e repair specialist" }),
         method: "POST",
       }),
     );
     expect(fetchMock).not.toHaveBeenCalledWith("/api/agents", expect.anything());

     fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

     await screen.findByText("Agent react-e2e-steward created. Reload to activate.");
     expect(fetchMock).toHaveBeenCalledWith(
       "/api/agents",
       expect.objectContaining({
         body: JSON.stringify({
           color: "#9ece6a",
           displayName: "React E2E Steward",
           id: "react-e2e-steward",
           persona: "Keeps React implementation and e2e repair work concrete.",
           promptInstruction: "Implement React UI and e2e repair tasks with concise evidence.",
           routingKeywords: ["react", "e2e", "ui"],
           routingReason: "React UI and e2e repair work",
           worldRole: "Interface steward",
         }),
         method: "POST",
       }),
     );
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
     expect(screen.getByRole("region", { name: "Queued tasks" })).toHaveTextContent("T2");
     expect(screen.getByRole("region", { name: "Queued tasks" })).toHaveTextContent("Research second topic");
     expect(screen.getByRole("region", { name: "Active tasks" })).not.toHaveTextContent("T2");
     const firstOrionJob = startedJobs.find((job) => job.startsWith("orion:"));
     expect(firstOrionJob).toBeDefined();
     gates.get(firstOrionJob!)?.resolve();

     await waitFor(() => expect(startedJobs.filter((job) => job.startsWith("orion:"))).toHaveLength(2));
   });

   it("starts queued Argus review after primary specialist reports are available", async () => {
     const startedJobs: string[] = [];
     const argusReportContexts: unknown[] = [];
     const queueRunAdapter = {
       startRun() {
         throw new Error("legacy single-run adapter should not be used in queue mode");
       },
       async *startAgentJob(job: { agentId: AgentId; specialistReports?: Partial<Record<AgentId, string>>; taskId: string }) {
         startedJobs.push(`${job.agentId}:${job.taskId}`);

         if (job.agentId === "argus") {
           argusReportContexts.push(job.specialistReports);
           yield event(job.taskId, 1, "argus", "agent.reviewing", "Argus reviews the task");
           yield event(job.taskId, 2, "argus", "agent.reporting", "Argus reports", { report: "Argus review report" });
           return;
         }

         yield event(job.taskId, 1, job.agentId, "agent.working", `${job.agentId} starts ${job.taskId}`);
         yield event(job.taskId, 2, job.agentId, "agent.reporting", `${job.agentId} reports ${job.taskId}`, {
           report: `${job.agentId} report`,
         });
       },
       async *synthesizeTask(task: { prompt: string; taskId: string }) {
         yield event(task.taskId, 3, "luma", "agent.done", `Luma completes ${task.taskId}`, {
           finalOutput: `Final for ${task.prompt}`,
         });
       },
     } as RunAdapter;

     renderApp(<AppShell runAdapter={queueRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), {
       target: { value: "Review this code and verify risky edge cases" },
     });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await waitFor(() => {
       expect(startedJobs.some((job) => job.startsWith("orion:"))).toBe(true);
       expect(startedJobs.some((job) => job.startsWith("argus:"))).toBe(true);
       expect(argusReportContexts[0]).toMatchObject({ orion: "orion report" });
       expect(startedJobs.findIndex((job) => job.startsWith("argus:"))).toBeGreaterThan(
         startedJobs.findIndex((job) => job.startsWith("orion:")),
       );
     });
   });

   it("keeps a queued specialist failure from completing the job or starting synthesis", async () => {
     const synthesizeTask = vi.fn(async function* () {
       throw new Error("synthesis should not run after specialist failure");
       yield event("unreachable", 1, "luma", "agent.failed", "unreachable");
     });
     const queueRunAdapter = {
       startRun() {
         throw new Error("legacy single-run adapter should not be used in queue mode");
       },
       async *startAgentJob(job: { agentId: AgentId; taskId: string }) {
         yield event(job.taskId, 1, job.agentId, "agent.failed", `${job.agentId} route failed`);
       },
       synthesizeTask,
     } as RunAdapter;

     renderApp(<AppShell runAdapter={queueRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research current sources" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await waitFor(() => {
       expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("failed");
       expect(synthesizeTask).not.toHaveBeenCalled();
     });
     expect(screen.queryByText("Agent job complete")).not.toBeInTheDocument();
   });

   it("does not start remaining queued specialist jobs after the task has failed", async () => {
     const releaseWarmup = deferred();
     const startedJobs: string[] = [];
     const queueRunAdapter = {
       startRun() {
         throw new Error("legacy single-run adapter should not be used in queue mode");
       },
       async *startAgentJob(job: { agentId: AgentId; prompt: string; taskId: string }) {
         startedJobs.push(`${job.agentId}:${job.prompt}`);

         if (job.prompt === "Rewrite warmup paragraph") {
           yield event(job.taskId, 1, job.agentId, "agent.working", "Quill starts warmup");
           await releaseWarmup.promise;
           yield event(job.taskId, 2, job.agentId, "agent.reporting", "Quill reports warmup", {
             report: "Warmup draft",
           });
           return;
         }

         if (job.agentId === "orion") {
           yield event(job.taskId, 1, job.agentId, "agent.failed", "Orion route failed");
           return;
         }

         yield event(job.taskId, 1, job.agentId, "agent.reporting", `${job.agentId} should not run`, {
           report: "unexpected",
         });
       },
       async *synthesizeTask(task: { prompt: string; taskId: string }) {
         yield event(task.taskId, 3, "luma", "agent.done", `Luma completes ${task.taskId}`, {
           finalOutput: `Final for ${task.prompt}`,
         });
       },
     } as RunAdapter;

     renderApp(<AppShell runAdapter={queueRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Rewrite warmup paragraph" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
     await waitFor(() => expect(startedJobs).toContain("quill:Rewrite warmup paragraph"));

     fireEvent.change(screen.getByLabelText("Task request"), {
       target: { value: "Research and draft this risky code review plan" },
     });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await waitFor(() => {
       expect(startedJobs).toContain("orion:Research and draft this risky code review plan");
       expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("Orion route failed");
     });

     releaseWarmup.resolve();
     await screen.findAllByText(/Final for Rewrite warmup paragraph/);

     expect(startedJobs).not.toContain("quill:Research and draft this risky code review plan");
   });

   it("keeps a queued synthesis failure from completing the Luma synthesis job", async () => {
     const queueRunAdapter = {
       startRun() {
         throw new Error("legacy single-run adapter should not be used in queue mode");
       },
       async *startAgentJob(job: { agentId: AgentId; taskId: string }) {
         yield event(job.taskId, 1, job.agentId, "agent.reporting", `${job.agentId} reports ${job.taskId}`, {
           report: `${job.agentId} report`,
         });
       },
       async *synthesizeTask(task: { taskId: string }) {
         yield event(task.taskId, 2, "luma", "agent.failed", "Synthesis route failed");
       },
     } as RunAdapter;

     renderApp(<AppShell runAdapter={queueRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research current sources" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await waitFor(() => {
       expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("failed");
       expect(screen.getByRole("region", { name: "Live run inspector" })).toHaveTextContent("Synthesis route failed");
     });
     expect(screen.getByRole("region", { name: "Live run inspector" })).not.toHaveTextContent("Synthesis complete");
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
       expect(screen.getByLabelText("Agents summary")).toHaveTextContent("Luma: failed");
     });
   });

   it("opens failed task details when partial specialist reports exist", async () => {
     const queueRunAdapter = {
       startRun() {
         throw new Error("legacy single-run adapter should not be used in queue mode");
       },
       async *startAgentJob(job: { agentId: AgentId; taskId: string }) {
         yield event(job.taskId, 1, job.agentId, "agent.working", `${job.agentId} starts ${job.taskId}`);
         yield event(job.taskId, 2, job.agentId, "agent.reporting", `${job.agentId} reports ${job.taskId}`, {
           report: `${job.agentId} partial report`,
         });
         yield event(job.taskId, 3, job.agentId, "agent.failed", `${job.agentId} route failed`);
       },
       async *synthesizeTask(task: { taskId: string }) {
         throw new Error(`synthesis should not run for ${task.taskId}`);
         yield event(task.taskId, 1, "luma", "agent.failed", "unreachable");
       },
     } as RunAdapter;

     renderApp(<AppShell runAdapter={queueRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research current sources" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await waitFor(() => expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("failed"));
     const detailsButton = screen.getByRole("button", { name: /Open details for T1 Research current sources/ });

     expect(detailsButton).toBeEnabled();
     fireEvent.click(detailsButton);

     const drawer = screen.getByRole("dialog", { name: "Run details" });
     expect(drawer).toHaveTextContent("orion partial report");
     expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("orion route failed");
   });

   it("opens the run log for failed task details when no reports exist", async () => {
     const queueRunAdapter = {
       startRun() {
         throw new Error("legacy single-run adapter should not be used in queue mode");
       },
       async *startAgentJob(job: { agentId: AgentId; taskId: string }) {
         yield event(job.taskId, 1, job.agentId, "agent.failed", `${job.agentId} failed before reporting`);
       },
       async *synthesizeTask(task: { taskId: string }) {
         throw new Error(`synthesis should not run for ${task.taskId}`);
         yield event(task.taskId, 1, "luma", "agent.failed", "unreachable");
       },
     } as RunAdapter;

     renderApp(<AppShell runAdapter={queueRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research current sources" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await waitFor(() => expect(screen.getByRole("region", { name: "Work queue" })).toHaveTextContent("failed before reporting"));
     fireEvent.click(screen.getByRole("button", { name: /Open details for T1 Research current sources/ }));

     const drawer = screen.getByRole("dialog", { name: "Run details" });

     expect(screen.getByRole("tab", { name: "Run log" })).toHaveAttribute("aria-selected", "true");
     expect(drawer).toHaveTextContent("failed before reporting");
   });

   it("uses the previous-run snapshot from queue time for delayed queued work", async () => {
     const gates = new Map<string, ReturnType<typeof deferred>>();
     const seenPreviousRuns: unknown[] = [];
     const queueRunAdapter = {
       startRun() {
         throw new Error("legacy single-run adapter should not be used in queue mode");
       },
       async *startAgentJob(job: { agentId: AgentId; prompt: string; taskId: string }, options?: { previousRun?: unknown }) {
         seenPreviousRuns.push(options?.previousRun);
         const gate = deferred();
         gates.set(`${job.agentId}:${job.prompt}`, gate);
         yield event(job.taskId, 1, job.agentId, "agent.working", `${job.agentId} starts ${job.prompt}`);
         await gate.promise;
         yield event(job.taskId, 2, job.agentId, "agent.reporting", `${job.agentId} reports ${job.prompt}`, {
           report: `${job.agentId} report for ${job.prompt}`,
         });
       },
       async *synthesizeTask(task: { prompt: string; reports: Partial<Record<AgentId, string>>; taskId: string }, options?: { previousRun?: unknown }) {
         seenPreviousRuns.push(options?.previousRun);
         yield event(task.taskId, 3, "luma", "agent.done", `Luma completes ${task.prompt}`, {
           finalOutput: `Final for ${task.prompt}: ${Object.values(task.reports).join(" | ")}`,
         });
       },
     } as RunAdapter;

     renderApp(<AppShell runAdapter={queueRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "What is Luma baseline?" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
     await screen.findAllByText(/Final for What is Luma baseline/);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research first topic" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research second topic" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await waitFor(() => expect(gates.has("orion:Research first topic")).toBe(true));
     gates.get("orion:Research first topic")?.resolve();
     await screen.findAllByText(/Final for Research first topic/);
     await waitFor(() => expect(gates.has("orion:Research second topic")).toBe(true));

     expect(seenPreviousRuns.at(-1)).toMatchObject({
       finalOutput: expect.stringContaining("Final for What is Luma baseline"),
       prompt: "What is Luma baseline?",
     });
     expect(seenPreviousRuns.at(-1)).not.toMatchObject({
       prompt: "Research first topic",
     });
   });

   it("orders completed queue items by completion time instead of creation time", async () => {
     const gates = new Map<string, ReturnType<typeof deferred>>();
     let completionIndex = 0;
     const queueRunAdapter = {
       startRun() {
         throw new Error("legacy single-run adapter should not be used in queue mode");
       },
       async *startAgentJob(job: { agentId: AgentId; taskId: string }) {
         const gate = deferred();
         gates.set(`${job.agentId}:${job.taskId}`, gate);
         yield event(job.taskId, 1, job.agentId, "agent.working", `${job.agentId} starts ${job.taskId}`);
         await gate.promise;
         yield event(job.taskId, 2, job.agentId, "agent.reporting", `${job.agentId} reports ${job.taskId}`, {
           report: `${job.agentId} report`,
         });
       },
       async *synthesizeTask(task: { prompt: string; taskId: string }) {
         completionIndex += 1;
         yield {
           ...event(task.taskId, 3, "luma", "agent.done", `Luma completes ${task.taskId}`, {
             finalOutput: `Final for ${task.prompt}`,
           }),
           timestamp: `2026-05-28T00:00:0${completionIndex}.000Z`,
         };
       },
     } as RunAdapter;

     renderApp(<AppShell runAdapter={queueRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research first topic" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));
     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Rewrite this paragraph" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await waitFor(() => {
       expect(Array.from(gates.keys()).some((key) => key.startsWith("orion:"))).toBe(true);
       expect(Array.from(gates.keys()).some((key) => key.startsWith("quill:"))).toBe(true);
     });
     gates.get(Array.from(gates.keys()).find((key) => key.startsWith("quill:"))!)?.resolve();
     await screen.findAllByText(/Final for Rewrite this paragraph/);
     gates.get(Array.from(gates.keys()).find((key) => key.startsWith("orion:"))!)?.resolve();
     await screen.findAllByText(/Final for Research first topic/);

     const completedItems = within(screen.getByRole("region", { name: "Completed tasks" })).getAllByRole("listitem");

     expect(completedItems[0]).toHaveTextContent("Research first topic");
     expect(completedItems[1]).toHaveTextContent("Rewrite this paragraph");
   });

   it("does not let an aborted worker remove a newly submitted same-agent job", async () => {
     const releaseAbortedWorker = deferred();
     const startedJobs: string[] = [];
     const queueRunAdapter = {
       startRun() {
         throw new Error("legacy single-run adapter should not be used in queue mode");
       },
       async *startAgentJob(job: { agentId: AgentId; taskId: string }, options?: { signal?: AbortSignal }) {
         startedJobs.push(`${job.agentId}:${job.taskId}`);
         yield event(job.taskId, 1, job.agentId, "agent.working", `${job.agentId} starts ${job.taskId}`);
         await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
         await releaseAbortedWorker.promise;
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

     await waitFor(() => expect(startedJobs.filter((job) => job.startsWith("orion:"))).toHaveLength(1));
     fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research second topic" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     releaseAbortedWorker.resolve();

     await waitFor(() => expect(startedJobs.filter((job) => job.startsWith("orion:"))).toHaveLength(2));
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
       expect(currentTask).not.toHaveTextContent("Argus");
     });

     gates.get(Array.from(gates.keys()).find((key) => key.startsWith("orion:"))!)?.resolve();

     await waitFor(() => {
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

   it("forwards workspace-write mode by default", async () => {
     const seenSandboxModes: unknown[] = [];
     const workspaceRunAdapter: RunAdapter = {
       async *startRun(input, options) {
         seenSandboxModes.push(options?.sandboxMode);
         yield event(`task-${input}`, 1, "luma", "task.created", input);
         yield event(`task-${input}`, 2, "luma", "agent.done", "Done", { finalOutput: "Done" });
       },
     };

     renderApp(<AppShell runAdapter={workspaceRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Write a file" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await screen.findByText("Done");
     expect(seenSandboxModes).toEqual(["workspace-write"]);
   });

  it("surfaces permission requests and retries with the approval token", async () => {
     const seenOptions: unknown[] = [];
     const approvalRunAdapter: RunAdapter = {
       async *startRun(input, options) {
         seenOptions.push(options);
         const taskId = `task-${seenOptions.length}`;

         yield event(taskId, 1, "luma", "task.created", input);

         if (options?.approvalToken === "approval-1" && options.sandboxMode === "danger-full-access") {
           yield event(taskId, 2, "luma", "agent.done", "Done after approval", {
             finalOutput: "Approved retry completed with danger-full-access.",
           });
           return;
         }

         yield event(taskId, 2, "orion", "approval.requested", "Orion requests danger-full-access permission", {
           approvalToken: "approval-1",
           blockedAction: "write /Users/eunhwa/shared/report.md",
           reason: "Needs a file outside the workspace.",
           requestedSandbox: "danger-full-access",
         });
       },
     };

     renderApp(<AppShell runAdapter={approvalRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Target workspace"), { target: { value: "/workspace/original" } });
     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Write outside workspace" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     const permissionPanel = await screen.findByRole("region", { name: "Permission request" });
     expect(permissionPanel).toHaveTextContent("Orion requests danger-full-access");
     expect(permissionPanel).toHaveTextContent("Needs a file outside the workspace.");
     expect(permissionPanel).toHaveTextContent("write /Users/eunhwa/shared/report.md");

     fireEvent.change(screen.getByLabelText("Target workspace"), { target: { value: "/workspace/changed" } });
     fireEvent.click(within(permissionPanel).getByRole("button", { name: "Approve and retry" }));

     await screen.findAllByText("Approved retry completed with danger-full-access.");
     expect(seenOptions[0]).toMatchObject({ sandboxMode: "workspace-write", workspacePath: "/workspace/original" });
     expect(seenOptions[1]).toMatchObject({
       approvalAgentId: "orion",
       approvalToken: "approval-1",
       sandboxMode: "danger-full-access",
       taskId: "task-1",
       workspacePath: "/workspace/original",
     });
   });

   it("preserves the repository default workspace when retrying a non-queued approval", async () => {
     const seenOptions: unknown[] = [];
     const approvalRunAdapter: RunAdapter = {
       async *startRun(input, options) {
         seenOptions.push(options);
         const taskId = "task-1";

         yield event(taskId, 1, "luma", "task.created", input);

         if (options?.approvalToken === "approval-1") {
           yield event(taskId, 3, "luma", "agent.done", "Done after approval", {
             finalOutput: "Default workspace approval retry completed.",
           });
           return;
         }

         yield event(taskId, 2, "orion", "approval.requested", "Orion requests danger-full-access permission", {
           approvalToken: "approval-1",
           reason: "Needs broader access.",
           requestedSandbox: "danger-full-access",
         });
       },
     };

     renderApp(<AppShell runAdapter={approvalRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Use repo default workspace" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     const permissionPanel = await screen.findByRole("region", { name: "Permission request" });
     fireEvent.change(screen.getByLabelText("Target workspace"), { target: { value: "/workspace/changed" } });
     fireEvent.click(within(permissionPanel).getByRole("button", { name: "Approve and retry" }));

     await screen.findAllByText("Default workspace approval retry completed.");
     expect(seenOptions[0]).toMatchObject({ workspacePath: undefined });
     expect(seenOptions[1]).toMatchObject({
       approvalAgentId: "orion",
       approvalToken: "approval-1",
       sandboxMode: "danger-full-access",
       taskId: "task-1",
       workspacePath: undefined,
     });
   });

   it("keeps approval retries on the queued workbench path when the adapter supports queues", async () => {
     const startRun = vi.fn(async function* () {
       const shouldYield = Date.now() < 0;
       if (shouldYield) {
         yield event("unexpected", 1, "luma", "agent.failed", "Unexpected startRun");
       }
       throw new Error("startRun should not handle queued approval retries");
     });
     const seenAgentOptions: unknown[] = [];
     const queuedApprovalRunAdapter: RunAdapter = {
       startRun,
       async *startAgentJob(job, options) {
         seenAgentOptions.push(options);

         if (options?.approvalToken === "approval-1" && options.sandboxMode === "danger-full-access") {
           yield event(job.taskId, 2, job.agentId, "agent.reporting", "Orion reports after approval", {
             report: "Approved specialist report",
           });
           return;
         }

         yield event(job.taskId, 1, job.agentId, "approval.requested", "Orion requests danger-full-access permission", {
           approvalToken: "approval-1",
           blockedAction: "write /Users/eunhwa/shared/report.md",
           reason: "Needs a file outside the workspace.",
           requestedSandbox: "danger-full-access",
         });
       },
       async *synthesizeTask(task) {
         yield event(task.taskId, 3, "luma", "agent.done", "Done after queued approval", {
           finalOutput: "Queued approval retry completed.",
         });
       },
     };

     renderApp(<AppShell runAdapter={queuedApprovalRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research outside workspace" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     const permissionPanel = await screen.findByRole("region", { name: "Permission request" });
     expect(permissionPanel).toHaveTextContent("Orion requests danger-full-access");

     fireEvent.click(within(permissionPanel).getByRole("button", { name: "Approve and retry" }));

     await screen.findAllByText("Queued approval retry completed.");
     expect(startRun).not.toHaveBeenCalled();
     expect(screen.queryByRole("region", { name: "Permission request" })).not.toBeInTheDocument();
     expect(seenAgentOptions[0]).toMatchObject({ sandboxMode: "workspace-write" });
     expect(seenAgentOptions[1]).toMatchObject({ approvalToken: "approval-1", sandboxMode: "danger-full-access" });
   });

   it("retries the requesting review agent after primary reports are ready", async () => {
     const seenAgentCalls: Array<{ agentId: AgentId; approvalToken?: string; sandboxMode?: unknown }> = [];
     const queuedApprovalRunAdapter: RunAdapter = {
       startRun() {
         throw new Error("queued adapter should not call startRun");
       },
       async *startAgentJob(job, options) {
         seenAgentCalls.push({
           agentId: job.agentId,
           approvalToken: options?.approvalToken,
           sandboxMode: options?.sandboxMode,
         });

         if (job.agentId === "orion") {
           yield event(job.taskId, 1, "orion", "agent.reporting", "Orion reports before review", {
             report: "Primary research report",
           });
           return;
         }

         if (job.agentId === "argus" && options?.approvalToken === "approval-1") {
           yield event(job.taskId, 3, "argus", "agent.reporting", "Argus reports after approval", {
             report: "Approved review report",
           });
           return;
         }

         yield event(job.taskId, 2, "argus", "approval.requested", "Argus requests danger-full-access permission", {
           approvalToken: "approval-1",
           reason: "Needs broader access to complete review.",
           requestedSandbox: "danger-full-access",
         });
       },
       async *synthesizeTask(task) {
         yield event(task.taskId, 4, "luma", "agent.done", "Done after review approval", {
           finalOutput: "Queued review approval retry completed.",
         });
       },
     };

     renderApp(<AppShell runAdapter={queuedApprovalRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Review this code and verify risky edge cases" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     const permissionPanel = await screen.findByRole("region", { name: "Permission request" });
     expect(permissionPanel).toHaveTextContent("Argus requests danger-full-access");

     fireEvent.click(within(permissionPanel).getByRole("button", { name: "Approve and retry" }));

     await screen.findAllByText("Queued review approval retry completed.");
     expect(seenAgentCalls).toEqual([
       { agentId: "orion", approvalToken: undefined, sandboxMode: "workspace-write" },
       { agentId: "argus", approvalToken: undefined, sandboxMode: "workspace-write" },
       { agentId: "argus", approvalToken: "approval-1", sandboxMode: "danger-full-access" },
     ]);
   });

   it("scopes queued approval tokens to the requesting specialist when paused siblings resume", async () => {
     const quillStarted = deferred();
     const releaseOriginalQuill = deferred();
     const seenAgentCalls: Array<{ agentId: AgentId; approvalToken?: string; sandboxMode?: unknown }> = [];
     const queuedApprovalRunAdapter: RunAdapter = {
       startRun() {
         throw new Error("queued adapter should not call startRun");
       },
       async *startAgentJob(job, options) {
         seenAgentCalls.push({
           agentId: job.agentId,
           approvalToken: options?.approvalToken,
           sandboxMode: options?.sandboxMode,
         });

         if (job.agentId === "quill" && !options?.approvalToken && seenAgentCalls.filter((call) => call.agentId === "quill").length === 1) {
           quillStarted.resolve();
           await releaseOriginalQuill.promise;
           yield event(job.taskId, 2, "quill", "agent.reporting", "Original Quill report should be ignored after abort", {
             report: "Ignored original Quill report",
           });
           return;
         }

         if (job.agentId === "orion" && !options?.approvalToken) {
           await quillStarted.promise;
           yield event(job.taskId, 1, "orion", "approval.requested", "Orion requests danger-full-access permission", {
             approvalToken: "approval-1",
             reason: "Needs a file outside the workspace.",
             requestedSandbox: "danger-full-access",
           });
           return;
         }

         if (job.agentId === "orion") {
           yield event(job.taskId, 3, "orion", "agent.reporting", "Orion reports after approval", {
             report: "Approved Orion report",
           });
           return;
         }

         yield event(job.taskId, 4, "quill", "agent.reporting", "Quill reports after being resumed", {
           report: "Workspace-write Quill report",
         });
       },
       async *synthesizeTask(task) {
         yield event(task.taskId, 5, "luma", "agent.done", "Done after scoped approval", {
           finalOutput: "Scoped approval retry completed.",
         });
       },
     };

     renderApp(<AppShell runAdapter={queuedApprovalRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research and draft outside workspace" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     const permissionPanel = await screen.findByRole("region", { name: "Permission request" });
     expect(permissionPanel).toHaveTextContent("Orion requests danger-full-access");

     fireEvent.click(within(permissionPanel).getByRole("button", { name: "Approve and retry" }));
     fireEvent.click(within(permissionPanel).getByRole("button", { name: "Approve and retry" }));
     releaseOriginalQuill.resolve();

     await screen.findAllByText("Scoped approval retry completed.");
     expect(seenAgentCalls).toEqual([
       { agentId: "orion", approvalToken: undefined, sandboxMode: "workspace-write" },
       { agentId: "quill", approvalToken: undefined, sandboxMode: "workspace-write" },
       { agentId: "orion", approvalToken: "approval-1", sandboxMode: "danger-full-access" },
       { agentId: "quill", approvalToken: undefined, sandboxMode: "workspace-write" },
     ]);
   });

   it("keeps a queued permission request visible when a sibling specialist finishes later", async () => {
     const gates = new Map<string, ReturnType<typeof deferred>>();
     const queuedApprovalRunAdapter: RunAdapter = {
       startRun() {
         throw new Error("queued adapter should not call startRun");
       },
       async *startAgentJob(job) {
         if (job.agentId === "orion") {
           yield event(job.taskId, 1, "orion", "approval.requested", "Orion requests danger-full-access permission", {
             approvalToken: "approval-1",
             reason: "Needs a file outside the workspace.",
             requestedSandbox: "danger-full-access",
           });
           return;
         }

         const gate = deferred();
         gates.set(job.agentId, gate);
         await gate.promise;
         yield event(job.taskId, 2, job.agentId, "agent.failed", `${job.agentId} failed after approval was requested`);
       },
       async *synthesizeTask() {
         const shouldYield = Date.now() < 0;
         if (shouldYield) {
           yield event("unexpected", 1, "luma", "agent.failed", "Unexpected synthesis");
         }
         throw new Error("synthesis should not run while approval is pending");
       },
     };

     renderApp(<AppShell runAdapter={queuedApprovalRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research and draft outside workspace" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     const permissionPanel = await screen.findByRole("region", { name: "Permission request" });
     expect(permissionPanel).toHaveTextContent("Orion requests danger-full-access");

     for (const gate of gates.values()) {
       gate.resolve();
     }

     await waitFor(() => expect(screen.getByLabelText("Agents summary")).toHaveTextContent("Quill: waitingApproval"));
     expect(screen.queryByText("quill failed after approval was requested")).not.toBeInTheDocument();
     expect(screen.getByRole("region", { name: "Permission request" })).toHaveTextContent("Orion requests danger-full-access");
   });

   it("hides queued permission requests after stopping the run", async () => {
     const queuedApprovalRunAdapter: RunAdapter = {
       startRun() {
         throw new Error("queued adapter should not call startRun");
       },
       async *startAgentJob(job) {
         yield event(job.taskId, 1, job.agentId, "approval.requested", "Orion requests danger-full-access permission", {
           approvalToken: "approval-1",
           reason: "Needs a file outside the workspace.",
           requestedSandbox: "danger-full-access",
         });
       },
       async *synthesizeTask() {
         const shouldYield = Date.now() < 0;
         if (shouldYield) {
           yield event("unexpected", 1, "luma", "agent.failed", "Unexpected synthesis");
         }
       },
     };

     renderApp(<AppShell runAdapter={queuedApprovalRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Task request"), { target: { value: "Research outside workspace" } });
     fireEvent.click(screen.getByRole("button", { name: "Send to Queue" }));

     await screen.findByRole("region", { name: "Permission request" });
     fireEvent.click(screen.getByRole("button", { name: "Stop run" }));

     await waitFor(() => {
       expect(screen.queryByRole("region", { name: "Permission request" })).not.toBeInTheDocument();
     });
   });

  it("continues past stale approval events from completed tasks", () => {
     const pendingTaskCreated = event("task-pending", 1, "luma", "task.created", "Pending task");
     const pendingApproval = event("task-pending", 2, "orion", "approval.requested", "Orion requests pending approval", {
       approvalToken: "approval-pending",
       reason: "Pending approval.",
       requestedSandbox: "danger-full-access",
     });
     const doneTaskCreated = event("task-done", 3, "luma", "task.created", "Completed task");
     const staleApproval = event("task-done", 4, "orion", "approval.requested", "Orion requests stale approval", {
       approvalToken: "approval-stale",
       reason: "Stale approval.",
       requestedSandbox: "danger-full-access",
     });
     const withEvents = [pendingTaskCreated, pendingApproval, doneTaskCreated, staleApproval].reduce(
       (state, item) => reduceAgentEvent(state, item),
       createInitialRunState(AGENTS),
     );
     const state = updateTask(withEvents, "task-done", {
       completedAt: "2026-05-28T00:00:05.000Z",
       finalOutput: "Done",
       status: "done",
     });

  expect(latestPermissionRequest(state)).toMatchObject({
       approvalToken: "approval-pending",
       taskId: "task-pending",
     });
  });

     const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
       const url = String(input);
       const body = url.endsWith("/api/workspaces")
         ? {
             currentWorkspace: "/home/eunhwapark/IdeaProjects/lanternwood-athenaeum",
             roots: ["/home/eunhwapark/IdeaProjects"],
             workspaces: [],
           }
         : {
           metadata: {
             agentContextFiles: ["AGENTS.md", ".agents/lanternwood/agents/build-scribe/agent.json"],
             changedFiles: ["src/App.tsx"],
             diffExcerpt: "diff --git a/src/App.tsx b/src/App.tsx",
             gitStatus: " M src/App.tsx",
             packageScripts: [{ command: "vitest run", name: "test" }],
             verification: { command: "npm test", exitCode: 0, output: "Tests passed" },
             workspacePath: "/home/eunhwapark/IdeaProjects/demo",
           },
           skills: [
             {
               description: "Use for build tasks",
               name: "build-helper",
               path: "/home/eunhwapark/.codex/skills/build-helper/SKILL.md",
             },
           ],
         };

       return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
     });
     vi.stubGlobal("fetch", fetchMock);

     renderApp(<AppShell runAdapter={mockRunAdapter} />);

     fireEvent.change(screen.getByLabelText("Target workspace"), {
       target: { value: "/home/eunhwapark/IdeaProjects/demo" },
     });
     fireEvent.click(screen.getByRole("button", { name: "Inspect workspace" }));

     await screen.findByText("AGENTS.md");
     expect(screen.getByRole("region", { name: "Workspace context" })).toHaveTextContent(
       ".agents/lanternwood/agents/build-scribe/agent.json",
     );
     expect(screen.getByRole("region", { name: "Run results" })).toHaveTextContent("src/App.tsx");
     expect(screen.getByRole("region", { name: "Skill discovery" })).toHaveTextContent("build-helper");
   });

  it("preserves the recent repo:branch label when inspecting a launched worktree", async () => {
    const launchedWorkspacePath = "/home/eunhwapark/IdeaProjects/.lanternwood-worktrees/drive-abc123/feature-branch-launcher-def456";
    window.localStorage.setItem(
      "lanternwood.recentWorkspaces",
      JSON.stringify([
        {
          name: "drive:feature/branch-launcher",
          path: launchedWorkspacePath,
          repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
        },
      ]),
    );

    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);
      const body = url.endsWith("/api/workspaces")
        ? {
            currentWorkspace: "/home/eunhwapark/IdeaProjects/lanternwood-athenaeum",
            roots: ["/home/eunhwapark/IdeaProjects"],
            workspaces: [{ name: "drive", path: "/home/eunhwapark/IdeaProjects/drive", root: "/home/eunhwapark/IdeaProjects" }],
          }
        : {
            metadata: {
              agentContextFiles: ["AGENTS.md"],
              changedFiles: [],
              gitStatus: "",
              packageScripts: [],
              workspacePath: launchedWorkspacePath,
            },
            skills: [],
          };

      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp(<AppShell runAdapter={mockRunAdapter} />);

    await screen.findByText("1 found");
    fireEvent.click(await screen.findByRole("button", { name: "Select recent workspace drive:feature/branch-launcher" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Selected workspace label")).toHaveTextContent("drive:feature/branch-launcher");
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect workspace" }));

    await screen.findByText("AGENTS.md");
    expect(screen.getByLabelText("Selected workspace label")).toHaveTextContent("drive:feature/branch-launcher");
    expect(JSON.parse(window.localStorage.getItem("lanternwood.recentWorkspaces") ?? "[]")).toEqual([
      {
        name: "drive:feature/branch-launcher",
        path: launchedWorkspacePath,
        repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
        repositoryVerified: true,
      },
    ]);
  });

 });
