import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
 import { createInitialRunState, reduceAgentEvent, updateAgentJob, updateTask } from "../events/reducer";
 import { taskLabelFor } from "../events/taskLabels";
 import {
   type AgentEvent,
   type AgentJob,
   type AgentStatus,
   type PreviousRunContext,
   type RunState,
   type TaskRecord,
 } from "../events/types";
 import { createCodexRunAdapter } from "../harness/codexRunAdapter";
 import { createMockApprovalRunAdapter, createMockRunAdapter } from "../harness/mockRunAdapter";
 import type { RunAdapter, RunAdapterOptions } from "../harness/runAdapter";
 import { createTaskId } from "../harness/taskIds";
 import { LanternwoodScene } from "../world/LanternwoodScene";
 import { LiveRunInspector } from "./LiveRunInspector";
 import { RunDetailDrawer } from "./RunDetailDrawer";
import { TaskInput } from "./TaskInput";
import { latestPermissionRequest, type PermissionRequestView } from "./permissionRequests";
import { previewText } from "./runDetails";
 import type { RunDetailsTab } from "./runDetails";
 import { useQueuedRunOrchestrator } from "./useQueuedRunOrchestrator";

	 declare global {
	   interface Window {
	     __LANTERNWOOD_APPROVAL_TEST_FLOW__?: boolean;
	     __LANTERNWOOD_EVENT_DELAY_MS__?: number;
	   }
	 }

 function getVisibleEventDelayMs() {
   if (typeof window !== "undefined" && Number.isFinite(window.__LANTERNWOOD_EVENT_DELAY_MS__)) {
     return window.__LANTERNWOOD_EVENT_DELAY_MS__;
   }

   return 800;
 }

 const visibleMockRunAdapter = createMockRunAdapter({ eventDelayMs: getVisibleEventDelayMs() });

 function createDefaultRunAdapter() {
	   if (import.meta.env.VITE_RUN_ADAPTER === "codex") {
	     return createCodexRunAdapter({ requestToken: import.meta.env.VITE_LANTERNWOOD_CODEX_REQUEST_TOKEN });
	   }

	   if (typeof window !== "undefined" && window.__LANTERNWOOD_APPROVAL_TEST_FLOW__ === true) {
	     return createMockApprovalRunAdapter({ eventDelayMs: getVisibleEventDelayMs() });
	   }

	   return visibleMockRunAdapter;
	 }

 type AppShellProps = {
   runAdapter?: RunAdapter;
   runMode?: "codex" | "mock";
 };

 type DrawerState = {
   agentId?: AgentId;
   isOpen: boolean;
   tab: RunDetailsTab;
   taskId?: string;
 };

 type WorkspaceMetadata = {
   agentContextFiles: string[];
   changedFiles: string[];
   diffExcerpt?: string;
   gitStatus: string;
   packageScripts: Array<{ command: string; name: string }>;
   repositoryPath?: string;
   verification?: {
     command: string;
     exitCode: number;
     output: string;
   };
   workspacePath: string;
   workspaceLabel?: string;
 };

 type CodexSkillSummary = {
   description: string;
   name: string;
   path: string;
 };

 type WorkspaceOption = {
   name: string;
   path: string;
   root?: string;
 };

type RecentWorkspaceOption = WorkspaceOption & {
  repositoryPath?: string;
  repositoryVerified?: boolean;
};

 type WorkspaceMetadataResponse = {
   metadata: WorkspaceMetadata;
   skills: CodexSkillSummary[];
 };

type WorkspaceDiscoveryResponse = {
  currentWorkspaceLabel?: string;
  currentWorkspaceRepositoryPath?: string;
  currentWorkspace?: string;
  roots?: string[];
  workspaces?: WorkspaceOption[];
};

 type BranchWorktreeLaunchResponse = {
   branch: string;
   created: boolean;
   detached?: boolean;
   repositoryPath: string;
   statusMessage?: string;
   workspacePath: string;
 };

 const defaultRunAdapter = createDefaultRunAdapter();
 const defaultRunMode = import.meta.env.VITE_RUN_ADAPTER === "codex" ? "codex" : "mock";
 const COMPLETED_TASK_PREVIEW_LIMIT = 5;
 const RECENT_WORKSPACES_STORAGE_KEY = "lanternwood.recentWorkspaces";
 const preferredWorkspaceNames = ["lanternwood-athenaeum", "drive", "code", "MCPContentSearch"];

 function createClientEvent(
   taskId: string,
   index: number,
   agentId: AgentId,
   type: AgentEvent["type"],
   message: string,
   payload?: AgentEvent["payload"],
 ): AgentEvent {
   return {
     agentId,
     eventId: `${taskId}-client-${index}`,
     message,
     payload,
     taskId,
     timestamp: new Date().toISOString(),
     type,
   } as AgentEvent;
 }

 function messageFromError(error: unknown) {
   return error instanceof Error ? error.message : "Run adapter failed";
 }

 function isUnfinishedActiveStatus(status: AgentStatus) {
   return !["done", "failed", "idle", "reporting"].includes(status);
 }

 function clientDiagnostics(runMode: "codex" | "mock") {
   if (runMode === "mock") {
     return undefined;
   }

   return {
     backend: "unavailable",
     cliCommand: "codex exec",
     codexStatus: "failed",
     model: "Codex CLI backend unavailable (model unresolved)",
     runMode: "codex",
   };
 }

 function clientFailureDiagnostics(runMode: "codex" | "mock", hasServerDiagnostics: boolean) {
   if (runMode === "mock") {
     return undefined;
   }

   return hasServerDiagnostics ? { codexStatus: "failed" } : clientDiagnostics(runMode);
 }

 function agentDisplayName(agentId: AgentId) {
   return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
 }

function workspaceNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function normalizedWorkspaceName(name: string) {
  return name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function repositoryNameFromManagedWorkspacePath(path: string) {
  const pathSegments = path.split(/[\\/]/).filter(Boolean);
  const managedRootIndex = pathSegments.lastIndexOf(".lanternwood-worktrees");
  const repositoryDirectory = managedRootIndex >= 0 ? pathSegments[managedRootIndex + 1] : undefined;

  if (!repositoryDirectory) {
    return undefined;
  }

  const match = repositoryDirectory.match(/^(.*)-[0-9a-f]{6,}$/);
  return match?.[1] || undefined;
}

function repositoryPathFromWorkspaceHint(
  workspace: Pick<WorkspaceOption | RecentWorkspaceOption, "name" | "path">,
  workspaceOptions: WorkspaceOption[],
) {
  return repositoryPathHintResolution(workspace, workspaceOptions).path;
}

function repositoryPathHintResolution(
  workspace: Pick<WorkspaceOption | RecentWorkspaceOption, "name" | "path">,
  workspaceOptions: WorkspaceOption[],
) {
  if (isManagedWorktreePath(workspace.path)) {
    const repositoryNameFromPath = repositoryNameFromManagedWorkspacePath(workspace.path);

    if (!repositoryNameFromPath) {
      return { ambiguous: false, path: undefined };
    }

    const matches = workspaceOptions.filter((candidate) => normalizedWorkspaceName(candidate.name) === repositoryNameFromPath);

    if (matches.length === 1) {
      return { ambiguous: false, path: matches[0]?.path };
    }

    return { ambiguous: matches.length > 1, path: undefined };
  }

  const repositoryName = workspace.name.split(":")[0]?.trim();

  if (repositoryName && repositoryName !== workspace.name) {
    const matches = workspaceOptions.filter((candidate) => {
      return candidate.name === repositoryName || normalizedWorkspaceName(candidate.name) === normalizedWorkspaceName(repositoryName);
    });

    if (matches.length === 1) {
      return { ambiguous: false, path: matches[0]?.path };
    }

    if (matches.length > 1) {
      return { ambiguous: true, path: undefined };
    }
  }

  return { ambiguous: false, path: undefined };
}

function isManagedWorktreePath(path: string) {
  return /[\\/]\.lanternwood-worktrees[\\/]/.test(path);
}

function unverifiedManagedWorkspaceLabel(path: string) {
  return workspaceNameFromPath(path);
}

function managedWorkspaceDisplayLabel(repositoryPath: string, branch: string, detached?: boolean) {
  return `${workspaceNameFromPath(repositoryPath)}:${branch}${detached ? " (detached)" : ""}`;
}

function isPathInsideRoot(path: string, root: string) {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

 function readRecentWorkspaces() {
   if (typeof window === "undefined") {
     return [] as RecentWorkspaceOption[];
   }

   try {
     const parsed = JSON.parse(window.localStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY) ?? "[]") as unknown;

     return Array.isArray(parsed)
       ? parsed
           .filter(
             (item): item is RecentWorkspaceOption =>
               typeof item === "object" &&
               item !== null &&
               typeof (item as RecentWorkspaceOption).name === "string" &&
               typeof (item as RecentWorkspaceOption).path === "string" &&
               (typeof (item as RecentWorkspaceOption).repositoryPath === "string" ||
                 typeof (item as RecentWorkspaceOption).repositoryPath === "undefined") &&
               (typeof (item as RecentWorkspaceOption).repositoryVerified === "boolean" ||
                 typeof (item as RecentWorkspaceOption).repositoryVerified === "undefined"),
           )
           .slice(0, 5)
       : [];
   } catch {
     return [];
   }
 }

 function writeRecentWorkspaces(workspaces: RecentWorkspaceOption[]) {
   if (typeof window !== "undefined") {
     window.localStorage.setItem(RECENT_WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces.slice(0, 5)));
   }
 }

 function createPreviousRunContext(events: AgentEvent[], finalOutput: string): PreviousRunContext | null {
   const taskCreated = events.find((event) => event.type === "task.created");

   if (!taskCreated) {
     return null;
   }

   const delegatedAgents = Array.from(
     new Set(
       events
         .filter((event) => event.agentId !== "luma" && (event.type === "agent.reporting" || event.type === "agent.done"))
         .map((event) => agentDisplayName(event.agentId)),
     ),
   );

   return {
     delegatedAgents,
     finalOutput,
     prompt: taskCreated.message,
     taskId: taskCreated.taskId,
     timeline: events.slice(-12).map((event) => event.message),
   };
 }

 function failUnfinishedSpecialists(state: RunState, taskId: string, reason: string): RunState {
   return AGENTS.filter((agent) => agent.id !== "luma" && isUnfinishedActiveStatus(state.agents[agent.id].status)).reduce(
     (current, agent) =>
       reduceAgentEvent(
         current,
         createClientEvent(taskId, current.timeline.length + 1, agent.id, "agent.failed", reason),
       ),
     state,
   );
 }

	 function supportsQueuedRuns(runAdapter: RunAdapter): runAdapter is RunAdapter & {
	   startAgentJob: NonNullable<RunAdapter["startAgentJob"]>;
	   synthesizeTask: NonNullable<RunAdapter["synthesizeTask"]>;
	 } {
	   return typeof runAdapter.startAgentJob === "function" && typeof runAdapter.synthesizeTask === "function";
	 }

	 function PermissionRequestPanel({
	   disabled,
	   onApprove,
	   request,
	 }: {
	   disabled: boolean;
	   onApprove: (request: PermissionRequestView) => void;
	   request: PermissionRequestView;
	 }) {
	   return (
	     <section className="permission-request-panel" aria-label="Permission request">
	       <div>
	         <h2>{request.agentName} requests {request.requestedSandbox}</h2>
	         <p>{request.reason}</p>
	         {request.blockedAction ? <p className="permission-blocked-action">{request.blockedAction}</p> : null}
	       </div>
	       <button disabled={disabled} onClick={() => onApprove(request)} type="button">
	         Approve and retry
	       </button>
	     </section>
	   );
	 }

	 function isTaskInFlight(task: TaskRecord) {
   return !["done", "failed"].includes(task.status);
 }

 function isActiveTask(task: TaskRecord) {
   return task.status === "routing" || task.status === "running" || task.status === "synthesizing";
 }

 function isCompletedTask(task: TaskRecord) {
   return task.status === "done" || task.status === "failed";
 }

 function TaskBadge({ label }: { label: string }) {
   return <span className="task-badge">{label}</span>;
 }

 function currentTaskJobs(state: RunState, taskId: string) {
   return AGENTS.flatMap((agent) =>
     state.agentQueues[agent.id]
       .filter((job) => job.taskId === taskId)
       .map((job) => ({
         agent,
         job,
       })),
   );
 }

 function displayJobStatus(state: RunState, job: AgentJob) {
   return job.status === "running" ? state.agents[job.agentId].status : job.status;
 }

 function CurrentTaskPanel({
   onOpenWorkload,
   state,
 }: {
   onOpenWorkload: (taskId: string) => void;
   state: RunState;
 }) {
   const task = state.tasks.find(isTaskInFlight);
   const activeTaskCount = state.tasks.filter(isTaskInFlight).length;

   if (!task) {
     return (
       <section aria-label="Current task" className="task-summary">
         <header className="task-summary-header">
           <span className="task-summary-label">Current task</span>
         </header>
         <p className="task-summary-prompt">No active task</p>
       </section>
     );
   }

   const label = taskLabelFor(state.tasks, task.taskId);
   const jobs = currentTaskJobs(state, task.taskId);

   return (
     <section aria-label="Current task" className="task-summary">
       <header className="task-summary-header">
         <span className="task-summary-label">Current task</span>
         <button aria-label="View current task activity" onClick={() => onOpenWorkload(task.taskId)} type="button">
           View activity
         </button>
         <span className="task-summary-state">{activeTaskCount > 1 ? `${activeTaskCount} active` : task.status}</span>
       </header>
       <p className="task-summary-prompt">
         <TaskBadge label={label} />
         <span>{task.prompt}</span>
       </p>
       {jobs.length > 0 ? (
         <ul className="task-summary-lanes" aria-label={`${label} agent progress`}>
           {jobs.map(({ agent, job }) => (
             <li key={job.jobId}>
               <span className="task-summary-agent" style={{ "--agent-color": agent.color } as CSSProperties}>
                 {agent.displayName}
               </span>
               <span>{displayJobStatus(state, job)}</span>
             </li>
           ))}
         </ul>
       ) : (
         <p className="task-summary-empty">Luma is handling this directly.</p>
       )}
     </section>
   );
}
 function WorkQueueItem({
   onOpenFinalOutput,
   task,
   tasks,
 }: {
   onOpenFinalOutput: (taskId: string) => void;
   task: TaskRecord;
   tasks: TaskRecord[];
 }) {
   const label = taskLabelFor(tasks, task.taskId);
   const agentLaneCount = task.selectedAgentIds.length || 1;
   const canOpenDetails = Boolean(task.finalOutput || task.error);
   const actionLabel = task.finalOutput ? "Open final" : "Open details";
   const actionDescription = task.finalOutput ? "final output" : "details";

   return (
     <li className="work-queue-item">
       <div>
         <div className="work-queue-item-header">
           <h3>
             <TaskBadge label={label} />
             <span className="work-queue-prompt">{task.prompt}</span>
           </h3>
           <span className="work-queue-status">{task.status}</span>
         </div>
         <p>
           {task.finalOutput
             ? previewText(task.finalOutput, 140)
             : task.error
               ? previewText(task.error, 140)
             : `${agentLaneCount} agent lane${agentLaneCount === 1 ? "" : "s"} assigned`}
         </p>
       </div>
       <button
         aria-label={`Open ${actionDescription} for ${label} ${task.prompt}`}
         disabled={!canOpenDetails}
         onClick={() => onOpenFinalOutput(task.taskId)}
         type="button"
       >
         {actionLabel}
       </button>
     </li>
   );
 }
 function WorkQueueSection({
   emptyMessage,
   label,
   onOpenFinalOutput,
   tasks,
   allTasks,
 }: {
   allTasks: TaskRecord[];
   emptyMessage: string;
   label: string;
   onOpenFinalOutput: (taskId: string) => void;
   tasks: TaskRecord[];
 }) {
   return (
     <section aria-label={label} className="work-queue-section">
       <header className="work-queue-section-header">
         <h3>{label.replace(" tasks", "")}</h3>
         <span>{tasks.length}</span>
       </header>
       {tasks.length > 0 ? (
         <ol className="work-queue-list">
           {tasks.map((task) => (
             <WorkQueueItem
               key={task.taskId}
               onOpenFinalOutput={onOpenFinalOutput}
               task={task}
               tasks={allTasks}
             />
           ))}
         </ol>
       ) : (
         <p className="work-queue-empty">{emptyMessage}</p>
       )}
     </section>
   );
 }

 function WorkQueuePanel({
   onOpenFinalOutput,
   tasks,
 }: {
   onOpenFinalOutput: (taskId: string) => void;
   tasks: TaskRecord[];
 }) {
   const [showAllCompleted, setShowAllCompleted] = useState(false);
   if (tasks.length === 0) {
     return null;
   }

   const activeTasks = tasks.filter(isActiveTask);
   const queuedTasks = tasks.filter((task) => task.status === "queued");
   const completedTasks = tasks
     .map((task, index) => ({ index, task }))
     .filter(({ task }) => isCompletedTask(task))
     .sort((left, right) => {
       const completedDelta =
         Date.parse(right.task.completedAt ?? right.task.createdAt) - Date.parse(left.task.completedAt ?? left.task.createdAt);
       const createdDelta = Date.parse(right.task.createdAt) - Date.parse(left.task.createdAt);

       return completedDelta || createdDelta || right.index - left.index;
     })
     .map(({ task }) => task);
   const visibleCompletedTasks = showAllCompleted
     ? completedTasks
     : completedTasks.slice(0, COMPLETED_TASK_PREVIEW_LIMIT);
   const hiddenCompletedCount = completedTasks.length - visibleCompletedTasks.length;

   return (
     <section aria-label="Work queue" className="work-queue">
       <header className="work-queue-header">
         <h2>Work queue</h2>
         <span>{tasks.filter(isTaskInFlight).length} active</span>
       </header>
       <WorkQueueSection
         allTasks={tasks}
         emptyMessage="No active work."
         label="Active tasks"
         onOpenFinalOutput={onOpenFinalOutput}
         tasks={activeTasks}
       />
       <WorkQueueSection
         allTasks={tasks}
         emptyMessage="No queued work."
         label="Queued tasks"
         onOpenFinalOutput={onOpenFinalOutput}
         tasks={queuedTasks}
       />
       <WorkQueueSection
         allTasks={tasks}
         emptyMessage="No completed tasks yet."
         label="Completed tasks"
         onOpenFinalOutput={onOpenFinalOutput}
         tasks={visibleCompletedTasks}
       />
       {hiddenCompletedCount > 0 ? (
         <button
           aria-label="Show all completed tasks"
           className="work-queue-history-button"
           onClick={() => setShowAllCompleted(true)}
           type="button"
         >
           Show all completed tasks ({hiddenCompletedCount} older)
         </button>
       ) : null}
     </section>
   );
 }

 type AgentLibraryFormState = {
   color: string;
   description: string;
   displayName: string;
   id: string;
   persona: string;
   promptInstruction: string;
   routingKeywords: string;
   routingReason: string;
   worldRole: string;
 };

 type AgentDraftResponse = {
   draft?: {
     color?: string;
     displayName?: string;
     id?: string;
     persona?: string;
     promptInstruction?: string;
     routingKeywords?: string[];
     routingReason?: string;
     worldRole?: string;
   };
 };

const initialAgentLibraryForm: AgentLibraryFormState = {
  color: "#7aa2f7",
   description: "",
   displayName: "",
   id: "",
   persona: "",
   promptInstruction: "",
   routingKeywords: "",
   routingReason: "",
   worldRole: "",
 };

 const agentDescriptionStopWords = new Set([
   "a",
   "an",
   "and",
   "for",
   "from",
   "into",
   "of",
   "the",
   "this",
   "that",
   "to",
   "with",
 ]);

 function titleCaseToken(token: string) {
   return token.length <= 3 ? token.toUpperCase() : `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
 }

 function agentDescriptionTokens(description: string) {
   return Array.from(new Set(description.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [])).filter(
     (token) => token.length > 1 && !agentDescriptionStopWords.has(token),
   );
 }

 function generatedAgentId(description: string, tokens: string[]) {
   if (tokens.length > 0) {
     return tokens.slice(0, 3).join("-");
   }

   let hash = 0;
   for (const character of description) {
     hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
   }

   return `agent-${hash.toString(36).slice(0, 6) || "draft"}`;
 }

 function draftAgentFromDescription(description: string): AgentLibraryFormState {
   const trimmedDescription = description.trim();
   const tokens = agentDescriptionTokens(trimmedDescription);
   const id = generatedAgentId(trimmedDescription, tokens);
   const displayName = id.split("-").map(titleCaseToken).join(" ");
   const summary = trimmedDescription || "general specialist tasks";

  return {
    color: "#7aa2f7",
     description,
     displayName,
     id,
     persona: `Specialist focused on ${summary}. Keep notes concrete, scoped, and ready for Luma to synthesize.`,
     promptInstruction: `Handle tasks related to ${summary}. Return concise specialist notes only.`,
     routingKeywords: tokens.slice(0, 8).join(", "),
     routingReason: `${summary} work`,
     worldRole: `${displayName} specialist`,
   };
 }

 function AgentLibraryPanel() {
   const [form, setForm] = useState<AgentLibraryFormState>(initialAgentLibraryForm);
   const [status, setStatus] = useState<string>("Ready");
   const [isDrafting, setIsDrafting] = useState(false);
   const [isSubmitting, setIsSubmitting] = useState(false);

   function updateField(field: keyof AgentLibraryFormState, value: string) {
     setForm((current) => ({ ...current, [field]: value }));
   }

   function updateDescription(value: string) {
     setForm(draftAgentFromDescription(value));
   }

   async function generateCodexDraft() {
     const description = form.description.trim();

     if (!description) {
       setStatus("Agent description is required");
       return;
     }

     setIsDrafting(true);
     setStatus("Generating with Codex");

     try {
       const response = await fetch("/api/agents/draft", {
         body: JSON.stringify({ description }),
         headers: {
           "Content-Type": "application/json",
           ...(import.meta.env.VITE_LANTERNWOOD_CODEX_REQUEST_TOKEN
             ? { "X-Lanternwood-Codex-Token": import.meta.env.VITE_LANTERNWOOD_CODEX_REQUEST_TOKEN }
             : {}),
         },
         method: "POST",
       });

       if (!response.ok) {
         throw new Error(await response.text());
       }

       const result = (await response.json()) as AgentDraftResponse;
       const draft = result.draft;

       if (!draft?.id) {
         throw new Error("Codex did not return an agent draft");
       }

      setForm((current) => ({
        color: (draft.color ?? current.color).toLocaleLowerCase(),
         description: current.description,
         displayName: draft.displayName ?? current.displayName,
         id: draft.id ?? current.id,
         persona: draft.persona ?? current.persona,
         promptInstruction: draft.promptInstruction ?? current.promptInstruction,
         routingKeywords: Array.isArray(draft.routingKeywords) ? draft.routingKeywords.join(", ") : current.routingKeywords,
         routingReason: draft.routingReason ?? current.routingReason,
         worldRole: draft.worldRole ?? current.worldRole,
       }));
       setStatus("Codex draft ready. Review before creating.");
     } catch (error) {
       setStatus(messageFromError(error));
     } finally {
       setIsDrafting(false);
     }
   }
   async function submitAgent(event: FormEvent<HTMLFormElement>) {
     event.preventDefault();
     setIsSubmitting(true);
     setStatus("Creating agent");

     try {
       const response = await fetch("/api/agents", {
         body: JSON.stringify({
           color: form.color,
           displayName: form.displayName,
           id: form.id,
           persona: form.persona,
           promptInstruction: form.promptInstruction,
           routingKeywords: form.routingKeywords.split(",").map((keyword) => keyword.trim()),
           routingReason: form.routingReason,
           worldRole: form.worldRole,
         }),
         headers: {
           "Content-Type": "application/json",
           ...(import.meta.env.VITE_LANTERNWOOD_CODEX_REQUEST_TOKEN
             ? { "X-Lanternwood-Codex-Token": import.meta.env.VITE_LANTERNWOOD_CODEX_REQUEST_TOKEN }
             : {}),
         },
         method: "POST",
       });

       if (!response.ok) {
         throw new Error(await response.text());
       }

       const created = (await response.json()) as { id?: string };
       setStatus(`Agent ${created.id ?? form.id} created. Reload to activate.`);
       setForm(initialAgentLibraryForm);
     } catch (error) {
       setStatus(messageFromError(error));
     } finally {
       setIsSubmitting(false);
     }
   }

   return (
     <details aria-label="Agent Library" className="agent-library">
       <summary className="agent-library-header">
         <h2>Agent Library</h2>
         <span>{status}</span>
       </summary>
       <form className="agent-library-form" noValidate onSubmit={submitAgent}>
         <label className="agent-library-wide">
           <span>Agent description</span>
           <textarea
             aria-label="Agent description"
             onChange={(event) => updateDescription(event.target.value)}
             placeholder="React UI 구현을 맡고 화면 깨짐과 e2e 실패를 잘 고치는 agent"
             required
             rows={3}
             value={form.description}
           />
         </label>
         {form.id ? (
           <section aria-label="Agent draft preview" className="agent-draft-preview">
             <h3>Preview</h3>
             <dl>
               <div>
                 <dt>ID</dt>
                 <dd>{form.id}</dd>
               </div>
               <div>
                 <dt>Name</dt>
                 <dd>{form.displayName}</dd>
               </div>
               <div>
                 <dt>Keywords</dt>
                 <dd>{form.routingKeywords}</dd>
               </div>
             </dl>
           </section>
         ) : null}
         <details className="agent-library-advanced">
           <summary>Advanced fields</summary>
           <div className="agent-library-advanced-grid">
             <label>
               <span>Agent id</span>
               <input
                 aria-label="Agent id"
                 onChange={(event) => updateField("id", event.target.value)}
                 placeholder="build-scribe"
                 required
                 value={form.id}
               />
             </label>
             <label>
               <span>Display name</span>
               <input
                 aria-label="Agent display name"
                 onChange={(event) => updateField("displayName", event.target.value)}
                 placeholder="Build Scribe"
                 required
                 value={form.displayName}
               />
             </label>
             <label>
               <span>World role</span>
               <input
                 aria-label="Agent world role"
                 onChange={(event) => updateField("worldRole", event.target.value)}
                 placeholder="Workshop steward"
                 required
                 value={form.worldRole}
               />
             </label>
             <label>
               <span>Color</span>
               <input
                 aria-label="Agent color"
                 onChange={(event) => updateField("color", event.target.value)}
                 pattern="#[0-9a-fA-F]{6}"
                 required
                 value={form.color}
               />
             </label>
             <label>
               <span>Routing keywords</span>
               <input
                 aria-label="Agent routing keywords"
                 onChange={(event) => updateField("routingKeywords", event.target.value)}
                 placeholder="build, implement"
                 required
                 value={form.routingKeywords}
               />
             </label>
             <label>
               <span>Routing reason</span>
               <input
                 aria-label="Agent routing reason"
                 onChange={(event) => updateField("routingReason", event.target.value)}
                 placeholder="implementation and build work"
                 required
                 value={form.routingReason}
               />
             </label>
             <label className="agent-library-wide">
               <span>Prompt instruction</span>
               <textarea
                 aria-label="Agent prompt instruction"
                 onChange={(event) => updateField("promptInstruction", event.target.value)}
                 required
                 rows={2}
                 value={form.promptInstruction}
               />
             </label>
             <label className="agent-library-wide">
               <span>Persona</span>
               <textarea
                 aria-label="Agent persona"
                 onChange={(event) => updateField("persona", event.target.value)}
                 required
                 rows={3}
                 value={form.persona}
               />
             </label>
           </div>
         </details>
         <div className="agent-library-actions">
           <button
             disabled={isDrafting || isSubmitting || !form.description.trim()}
             onClick={() => void generateCodexDraft()}
             type="button"
           >
             Generate with Codex
           </button>
           <button disabled={isSubmitting || isDrafting} type="submit">
             Create agent
           </button>
         </div>
       </form>
     </details>
   );
 }

 function WorkspaceContextPanel({
   metadata,
   status,
 }: {
   metadata: WorkspaceMetadata | null;
   status: string;
 }) {
   return (
     <section aria-label="Workspace context" className="workspace-context-panel">
       <header>
         <h2>Workspace Context</h2>
         <span>{status}</span>
       </header>
       {metadata ? (
         <>
           <p>{metadata.workspacePath}</p>
           <div className="workspace-context-grid">
             <section>
               <h3>Context files</h3>
               {metadata.agentContextFiles.length > 0 ? (
                 <ul>
                   {metadata.agentContextFiles.slice(0, 8).map((path) => (
                     <li key={path}>{path}</li>
                   ))}
                 </ul>
               ) : (
                 <p>No AGENTS.md or .agents files found.</p>
               )}
             </section>
             <section>
               <h3>Package scripts</h3>
               {metadata.packageScripts.length > 0 ? (
                 <ul>
                   {metadata.packageScripts.slice(0, 8).map((script) => (
                     <li key={script.name}>
                       <span>{script.name}</span>
                       <code>{script.command}</code>
                     </li>
                   ))}
                 </ul>
               ) : (
                 <p>No package scripts found.</p>
               )}
             </section>
           </div>
         </>
       ) : (
         <p>Inspect a target workspace to load repo context.</p>
       )}
     </section>
   );
 }

 function RunResultsPanel({ metadata }: { metadata: WorkspaceMetadata | null }) {
   return (
     <section aria-label="Run results" className="run-results-panel">
       <header>
         <h2>Run Results</h2>
         <span>{metadata?.changedFiles.length ?? 0} changed</span>
       </header>
       {metadata ? (
         <>
           <pre>{metadata.gitStatus || "Clean git status"}</pre>
           {metadata.changedFiles.length > 0 ? (
             <ul>
               {metadata.changedFiles.map((path) => (
                 <li key={path}>{path}</li>
               ))}
             </ul>
           ) : null}
           {metadata.diffExcerpt ? <pre>{metadata.diffExcerpt}</pre> : null}
           {metadata.verification ? (
             <section>
               <h3>{metadata.verification.command}</h3>
               <pre>{metadata.verification.output}</pre>
             </section>
           ) : null}
         </>
       ) : (
         <p>No result snapshot loaded yet.</p>
       )}
     </section>
   );
 }

 function skillMatchesPrompt(skill: CodexSkillSummary, prompt: string) {
   const haystack = `${skill.name} ${skill.description}`.toLocaleLowerCase();

   return prompt
     .toLocaleLowerCase()
     .split(/\s+/)
     .filter((token) => token.length >= 4)
     .some((token) => haystack.includes(token));
 }

 function SkillDiscoveryPanel({ prompt, skills }: { prompt: string; skills: CodexSkillSummary[] }) {
   const hintedSkills = prompt ? skills.filter((skill) => skillMatchesPrompt(skill, prompt)) : [];

   return (
     <section aria-label="Skill discovery" className="skill-discovery-panel">
       <header>
         <h2>Skill Discovery</h2>
         <span>{skills.length}</span>
       </header>
       {hintedSkills.length > 0 ? (
         <p>Likely skills: {hintedSkills.map((skill) => skill.name).join(", ")}</p>
       ) : (
         <p>No task skill hint selected.</p>
       )}
       {skills.length > 0 ? (
         <ul>
           {skills.slice(0, 8).map((skill) => (
             <li key={skill.path}>
               <strong>{skill.name}</strong>
               <span>{skill.description}</span>
             </li>
           ))}
         </ul>
       ) : (
         <p>No global Codex skills discovered.</p>
       )}
     </section>
   );
 }

 export function AppShell({ runAdapter = defaultRunAdapter, runMode = defaultRunMode }: AppShellProps) {
   const initialState = useMemo(() => createInitialRunState(AGENTS), []);
   const [runState, setRunState] = useState<RunState>(initialState);
  const [runEpoch, setRunEpoch] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>([]);
  const [currentWorkspaceLabel, setCurrentWorkspaceLabel] = useState<string | undefined>();
  const [currentWorkspaceRepositoryPath, setCurrentWorkspaceRepositoryPath] = useState<string | undefined>();
  const [currentWorkspace, setCurrentWorkspace] = useState<string | undefined>();
  const [workspaceDiscoveryStatus, setWorkspaceDiscoveryStatus] = useState("Loading workspaces");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [pendingSelectedRepositoryPath, setPendingSelectedRepositoryPath] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [isLaunchingWorktree, setIsLaunchingWorktree] = useState(false);
  const [worktreeLaunchStatus, setWorktreeLaunchStatus] = useState("");
  const [launchedWorktree, setLaunchedWorktree] = useState<BranchWorktreeLaunchResponse | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspaceOption[]>(readRecentWorkspaces);
  const [allowWorkspaceWrite, setAllowWorkspaceWrite] = useState(true);
  const [workspaceMetadata, setWorkspaceMetadata] = useState<WorkspaceMetadata | null>(null);
  const [workspaceContextStatus, setWorkspaceContextStatus] = useState("Not inspected");
  const [discoveredSkills, setDiscoveredSkills] = useState<CodexSkillSummary[]>([]);
  const [pendingSelectedWorkspaceHint, setPendingSelectedWorkspaceHint] = useState<RecentWorkspaceOption | null>(null);
   const [drawer, setDrawer] = useState<DrawerState>({
     isOpen: false,
     tab: "reports",
   });
  const runStateRef = useRef<RunState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef<symbol | null>(null);
  const hasExplicitRepositorySelectionRef = useRef(false);
  const isLaunchingWorktreeRef = useRef(false);
  const taskEventsRef = useRef<Map<string, AgentEvent[]>>(new Map());
  const previousRunRef = useRef<PreviousRunContext | null>(null);
   const queuedRunAdapter = supportsQueuedRuns(runAdapter) ? runAdapter : null;
	   const { approveQueuedRequest, queueRun, stopQueuedRuns } = useQueuedRunOrchestrator({
     commitEvent,
     getPreviousRun: () => previousRunRef.current,
     getRunState: () => runStateRef.current,
     getSandboxMode: selectedSandboxMode,
     getTaskEventCount: (taskId) => taskEventsRef.current.get(taskId)?.length ?? 0,
     getWorkspacePath: selectedWorkspacePath,
     onRunEpoch: () => setRunEpoch((current) => current + 1),
     queuedRunAdapter,
     setRunStateSynced,
   });
  const hasQueuedWork =
    runState.tasks.some(isTaskInFlight) ||
    Object.values(runState.agentQueues).some((jobs) => jobs.some((job) => job.status === "queued" || job.status === "running"));
  const inputIsRunning = isRunning || hasQueuedWork;
  const permissionRequest = latestPermissionRequest(runState);

  const repositoryPathForCurrentWorkspace = useMemo(() => {
    if (!currentWorkspace) {
      return undefined;
    }

    const discoveredRepositoryPath =
      currentWorkspaceRepositoryPath &&
      !isManagedWorktreePath(currentWorkspaceRepositoryPath) &&
      workspaceRoots.some((root) => isPathInsideRoot(currentWorkspaceRepositoryPath, root))
        ? currentWorkspaceRepositoryPath
        : undefined;

    if (discoveredRepositoryPath) {
      return discoveredRepositoryPath;
    }

    const recentRepositoryPath = !isManagedWorktreePath(currentWorkspace)
      ? recentWorkspaces.find((workspace) => workspace.path === currentWorkspace)?.repositoryPath
      : undefined;

    if (recentRepositoryPath && workspaceRoots.some((root) => isPathInsideRoot(recentRepositoryPath, root))) {
      return recentRepositoryPath;
    }

    return workspaceOptions.some((workspace) => workspace.path === currentWorkspace) ? currentWorkspace : undefined;
  }, [currentWorkspace, currentWorkspaceRepositoryPath, recentWorkspaces, workspaceOptions, workspaceRoots]);

  const currentWorkspaceIsAllowed = useMemo(() => {
    if (!currentWorkspace) {
      return false;
    }

    if (isManagedWorktreePath(currentWorkspace)) {
      return Boolean(repositoryPathForCurrentWorkspace);
    }

    return workspaceRoots.some((root) => isPathInsideRoot(currentWorkspace, root));
  }, [currentWorkspace, repositoryPathForCurrentWorkspace, workspaceRoots]);

  const currentWorkspaceSelectionPath = useMemo(() => {
    if (!currentWorkspace) {
      return undefined;
    }

    return currentWorkspaceIsAllowed ? currentWorkspace : repositoryPathForCurrentWorkspace;
  }, [currentWorkspace, currentWorkspaceIsAllowed, repositoryPathForCurrentWorkspace]);

  const currentWorkspaceSelectionLabel = useMemo(() => {
    if (!currentWorkspaceSelectionPath) {
      return undefined;
    }

    if (currentWorkspaceSelectionPath === currentWorkspace) {
      return currentWorkspaceLabel ?? workspaceNameFromPath(currentWorkspaceSelectionPath);
    }

    if (isManagedWorktreePath(currentWorkspaceSelectionPath)) {
      return unverifiedManagedWorkspaceLabel(currentWorkspaceSelectionPath);
    }

    return (
      recentWorkspaces.find((workspace) => workspace.path === currentWorkspaceSelectionPath)?.name ??
      workspaceOptions.find((workspace) => workspace.path === currentWorkspaceSelectionPath)?.name ??
      workspaceNameFromPath(currentWorkspaceSelectionPath)
    );
  }, [currentWorkspace, currentWorkspaceLabel, currentWorkspaceSelectionPath, recentWorkspaces, workspaceOptions]);

  const pinnedWorkspaces = useMemo(() => {
    const selected = new Map<string, WorkspaceOption | RecentWorkspaceOption>();

    if (currentWorkspaceSelectionPath) {
      selected.set(currentWorkspaceSelectionPath, {
        name: currentWorkspaceSelectionLabel ?? workspaceNameFromPath(currentWorkspaceSelectionPath),
        path: currentWorkspaceSelectionPath,
        repositoryPath:
          currentWorkspaceSelectionPath === currentWorkspace ? repositoryPathForCurrentWorkspace : undefined,
      });
    }

    for (const preferredName of preferredWorkspaceNames) {
      const option = workspaceOptions.find((workspace) => workspace.name === preferredName);

      if (option) {
        selected.set(option.path, option);
      }
    }

    return Array.from(selected.values()).slice(0, 6);
  }, [
    currentWorkspace,
    currentWorkspaceSelectionLabel,
    currentWorkspaceSelectionPath,
    repositoryPathForCurrentWorkspace,
    workspaceOptions,
  ]);

  const filteredWorkspaceOptions = useMemo(() => {
    const search = workspaceSearch.trim().toLocaleLowerCase();
    const options = search
      ? workspaceOptions.filter((workspace) => `${workspace.name} ${workspace.path}`.toLocaleLowerCase().includes(search))
      : [];

    return options.slice(0, 8);
  }, [workspaceOptions, workspaceSearch]);

  const activeWorkspaceLabel = useMemo(() => {
    const selectedPath = workspacePath.trim() || undefined;

    if (!selectedPath) {
      return undefined;
    }

    if (currentWorkspaceLabel && selectedPath === currentWorkspace) {
      return currentWorkspaceLabel;
    }

    if (workspaceMetadata?.workspacePath === selectedPath && workspaceMetadata.workspaceLabel) {
      return workspaceMetadata.workspaceLabel;
    }

    const selectedRecentWorkspace =
      recentWorkspaces.find((workspace) => workspace.path === selectedPath) ??
      pinnedWorkspaces.find((workspace) => workspace.path === selectedPath);
    const verifiedManagedRecentLabel =
      recentWorkspaces.find((workspace) => workspace.path === selectedPath && workspace.repositoryVerified)?.name ??
      pinnedWorkspaces.find((workspace) => workspace.path === selectedPath && "repositoryVerified" in workspace && workspace.repositoryVerified)?.name;
    const resolvedManagedRecentLabel =
      selectedRecentWorkspace &&
      repositoryPath.trim() &&
      repositoryPathFromWorkspaceHint(selectedRecentWorkspace, workspaceOptions) === repositoryPath.trim()
        ? selectedRecentWorkspace.name
        : undefined;

    if (isManagedWorktreePath(selectedPath) && launchedWorktree?.workspacePath !== selectedPath) {
      return verifiedManagedRecentLabel ?? resolvedManagedRecentLabel ?? unverifiedManagedWorkspaceLabel(selectedPath);
    }

    return (
      recentWorkspaces.find((workspace) => workspace.path === selectedPath)?.name ??
      pinnedWorkspaces.find((workspace) => workspace.path === selectedPath)?.name ??
      workspaceOptions.find((workspace) => workspace.path === selectedPath)?.name ??
      (launchedWorktree?.workspacePath === selectedPath
        ? managedWorkspaceDisplayLabel(launchedWorktree.repositoryPath, launchedWorktree.branch, launchedWorktree.detached)
        : undefined)
    );
  }, [
    currentWorkspace,
    currentWorkspaceLabel,
      launchedWorktree,
      pinnedWorkspaces,
      repositoryPath,
      recentWorkspaces,
    workspaceMetadata,
    workspaceOptions,
    workspacePath,
  ]);

  function selectedWorkspacePath() {
    return workspacePath.trim() || undefined;
  }

  function selectedSandboxMode(): RunAdapterOptions["sandboxMode"] {
    return allowWorkspaceWrite ? "workspace-write" : "read-only";
  }

  const allowedRepositoryPath = useCallback(
    (candidate: string | undefined) => {
      if (!candidate || isManagedWorktreePath(candidate)) {
        return undefined;
      }

      return workspaceRoots.some((root) => isPathInsideRoot(candidate, root)) ? candidate : undefined;
    },
    [workspaceRoots],
  );

  const codexRequestHeaders = useCallback(() => {
    return {
      "Content-Type": "application/json",
      ...(import.meta.env.VITE_LANTERNWOOD_CODEX_REQUEST_TOKEN
        ? { "X-Lanternwood-Codex-Token": import.meta.env.VITE_LANTERNWOOD_CODEX_REQUEST_TOKEN }
        : {}),
    };
  }, []);

  function rememberWorkspace(workspace: RecentWorkspaceOption) {
    const existingWorkspace = recentWorkspaces.find((candidate) => candidate.path === workspace.path);
    const nextName =
      isManagedWorktreePath(workspace.path) && !workspace.repositoryPath
        ? existingWorkspace?.name ?? workspace.name
        : workspace.name;
    const nextWorkspace = {
      ...workspace,
      name: nextName,
      repositoryPath: workspace.repositoryPath ?? existingWorkspace?.repositoryPath,
      repositoryVerified: workspace.repositoryVerified ?? existingWorkspace?.repositoryVerified,
    };
    const nextRecent = [nextWorkspace, ...recentWorkspaces.filter((candidate) => candidate.path !== workspace.path)].slice(0, 5);
    setRecentWorkspaces(nextRecent);
    writeRecentWorkspaces(nextRecent);
  }

  function selectWorkspace(workspace: WorkspaceOption | RecentWorkspaceOption) {
    const managedWorkspace = isManagedWorktreePath(workspace.path);
    const hintResolution = managedWorkspace ? repositoryPathHintResolution(workspace, workspaceOptions) : { ambiguous: false, path: undefined };
    const rootsReady = workspaceRoots.length > 0;
    const persistedVerifiedRepositoryPath =
      managedWorkspace && "repositoryVerified" in workspace && workspace.repositoryVerified && workspace.path !== currentWorkspace
        ? workspace.repositoryPath
        : undefined;
    const verifiedManagedRepositoryPath = managedWorkspace
      ? workspace.path === currentWorkspace
        ? rootsReady
          ? allowedRepositoryPath(repositoryPathForCurrentWorkspace)
          : repositoryPathForCurrentWorkspace
        : undefined
      : undefined;
    const repositoryPathForWorkspace = managedWorkspace
      ? workspace.path === currentWorkspace
        ? verifiedManagedRepositoryPath
        : hintResolution.path ??
          verifiedManagedRepositoryPath ??
          (!hintResolution.ambiguous ? persistedVerifiedRepositoryPath : undefined)
      : workspace.path;
    const nextRepositoryPath = managedWorkspace
      ? allowedRepositoryPath(repositoryPathForWorkspace) ?? ""
      : allowedRepositoryPath(workspace.path) ?? "";
    hasExplicitRepositorySelectionRef.current = true;
    setPendingSelectedWorkspaceHint(rootsReady ? null : { name: workspace.name, path: workspace.path, repositoryPath: repositoryPathForWorkspace });
    setPendingSelectedRepositoryPath(rootsReady ? null : repositoryPathForWorkspace ?? null);
    setRepositoryPath(rootsReady ? nextRepositoryPath : repositoryPathForWorkspace ?? "");
    setWorkspacePath(workspace.path);
    rememberWorkspace({
      name: workspace.name,
      path: workspace.path,
      repositoryPath: rootsReady ? nextRepositoryPath || undefined : repositoryPathForWorkspace,
      repositoryVerified:
        managedWorkspace
          ? workspace.path === currentWorkspace
            ? Boolean(verifiedManagedRepositoryPath)
            : "repositoryVerified" in workspace && workspace.repositoryVerified === true && Boolean(rootsReady ? nextRepositoryPath : repositoryPathForWorkspace)
          : Boolean(rootsReady ? nextRepositoryPath : repositoryPathForWorkspace),
    });
  }

  const loadWorkspaceOptions = useCallback(async () => {
    setWorkspaceDiscoveryStatus("Loading workspaces");

    try {
      const response = await fetch("/api/workspaces", {
        body: JSON.stringify({}),
        headers: codexRequestHeaders(),
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = (await response.json()) as WorkspaceDiscoveryResponse;
      const discovered = Array.isArray(result.workspaces) ? result.workspaces : [];
      const roots = Array.isArray(result.roots) ? result.roots.filter((root): root is string => typeof root === "string") : [];
      setWorkspaceOptions(discovered);
      setWorkspaceRoots(roots);
      setCurrentWorkspaceLabel(typeof result.currentWorkspaceLabel === "string" ? result.currentWorkspaceLabel : undefined);
      setCurrentWorkspaceRepositoryPath(
        typeof result.currentWorkspaceRepositoryPath === "string" ? result.currentWorkspaceRepositoryPath : undefined,
      );
      setCurrentWorkspace(typeof result.currentWorkspace === "string" ? result.currentWorkspace : undefined);
      setWorkspaceDiscoveryStatus(`${discovered.length} found`);
    } catch (error) {
      setWorkspaceDiscoveryStatus(messageFromError(error));
    }
  }, [codexRequestHeaders]);

  useEffect(() => {
    void loadWorkspaceOptions();
  }, [loadWorkspaceOptions]);

  useEffect(() => {
    if (!hasExplicitRepositorySelectionRef.current && !repositoryPath.trim() && repositoryPathForCurrentWorkspace) {
      setRepositoryPath(repositoryPathForCurrentWorkspace);
    }
  }, [repositoryPath, repositoryPathForCurrentWorkspace]);

  useEffect(() => {
    if (!workspacePath.trim() && currentWorkspaceSelectionPath) {
      setWorkspacePath(currentWorkspaceSelectionPath);
    }
  }, [currentWorkspaceSelectionPath, workspacePath]);

  useEffect(() => {
    const pendingCurrentManagedRepositoryPath =
      pendingSelectedWorkspaceHint &&
      isManagedWorktreePath(pendingSelectedWorkspaceHint.path) &&
      pendingSelectedWorkspaceHint.path === currentWorkspace
        ? workspaceRoots.length === 0
          ? repositoryPathForCurrentWorkspace
          : allowedRepositoryPath(repositoryPathForCurrentWorkspace)
        : undefined;

    if (!pendingSelectedRepositoryPath || workspaceRoots.length === 0) {
      if (!pendingSelectedWorkspaceHint || workspaceRoots.length === 0) {
        return;
      }

      const recoveredRepositoryPath =
        (isManagedWorktreePath(pendingSelectedWorkspaceHint.path)
          ? pendingCurrentManagedRepositoryPath ?? repositoryPathFromWorkspaceHint(pendingSelectedWorkspaceHint, workspaceOptions)
          : allowedRepositoryPath(pendingSelectedWorkspaceHint.repositoryPath) ?? allowedRepositoryPath(pendingSelectedWorkspaceHint.path)) ??
        "";
      setRepositoryPath((currentRepositoryPath) =>
        currentRepositoryPath === "" || currentRepositoryPath === (pendingSelectedWorkspaceHint.repositoryPath ?? "")
          ? recoveredRepositoryPath
          : currentRepositoryPath,
      );
      setPendingSelectedWorkspaceHint(null);
      return;
    }

    const validatedRepositoryPath =
      (pendingSelectedWorkspaceHint
        ? isManagedWorktreePath(pendingSelectedWorkspaceHint.path)
          ? pendingCurrentManagedRepositoryPath ?? repositoryPathFromWorkspaceHint(pendingSelectedWorkspaceHint, workspaceOptions) ?? ""
          : allowedRepositoryPath(pendingSelectedWorkspaceHint.path) ?? allowedRepositoryPath(pendingSelectedRepositoryPath) ?? ""
        : allowedRepositoryPath(pendingSelectedRepositoryPath) ?? "");
    setRepositoryPath((currentRepositoryPath) =>
      currentRepositoryPath === pendingSelectedRepositoryPath || currentRepositoryPath === "" ? validatedRepositoryPath : currentRepositoryPath,
    );
    setPendingSelectedRepositoryPath(null);
    setPendingSelectedWorkspaceHint(null);
  }, [
    allowedRepositoryPath,
    currentWorkspace,
    pendingSelectedRepositoryPath,
    pendingSelectedWorkspaceHint,
    repositoryPathForCurrentWorkspace,
    workspaceOptions,
    workspaceRoots,
  ]);

  async function launchWorktree() {
    if (isLaunchingWorktreeRef.current) {
      return;
    }

    if (workspaceRoots.length === 0 && (pendingSelectedRepositoryPath !== null || pendingSelectedWorkspaceHint)) {
      setWorktreeLaunchStatus("Loading workspaces");
      return;
    }

    isLaunchingWorktreeRef.current = true;
    setIsLaunchingWorktree(true);
    setWorktreeLaunchStatus("Launching");
    setLaunchedWorktree(null);
    setPendingSelectedRepositoryPath(null);

    try {
      const response = await fetch("/api/worktrees/launch", {
        body: JSON.stringify({ branch: branchName, repositoryPath }),
        headers: codexRequestHeaders(),
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = (await response.json()) as BranchWorktreeLaunchResponse;
      setLaunchedWorktree(result);
      hasExplicitRepositorySelectionRef.current = true;
      setRepositoryPath(result.repositoryPath);
      setWorkspacePath(result.workspacePath);
      setWorkspaceMetadata(null);
      setDiscoveredSkills([]);
      setWorkspaceContextStatus("Not inspected");
      rememberWorkspace({
        name: managedWorkspaceDisplayLabel(result.repositoryPath, result.branch, result.detached),
        path: result.workspacePath,
        repositoryPath: result.repositoryPath,
        repositoryVerified: true,
      });
      setWorktreeLaunchStatus(
        result.statusMessage ?? (result.created ? `Created new worktree for ${result.branch}` : `Reused existing worktree for ${result.branch}`),
      );
    } catch (error) {
      setLaunchedWorktree(null);
      setWorktreeLaunchStatus(messageFromError(error));
    } finally {
      isLaunchingWorktreeRef.current = false;
      setIsLaunchingWorktree(false);
    }
  }

  async function inspectWorkspace() {
    setWorkspaceContextStatus("Inspecting");

    try {
      const response = await fetch("/api/workspace-metadata", {
        body: JSON.stringify({ workspacePath: selectedWorkspacePath() }),
        headers: codexRequestHeaders(),
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = (await response.json()) as WorkspaceMetadataResponse;
      setWorkspaceMetadata(result.metadata);
      setDiscoveredSkills(result.skills);
      setWorkspacePath(result.metadata.workspacePath);
      const existingWorkspace = recentWorkspaces.find((workspace) => workspace.path === result.metadata.workspacePath);
      const selectedRepositoryValue = repositoryPath.trim();
      const selectedManagedRepositoryPath =
        result.metadata.workspacePath === selectedWorkspacePath()
          ? allowedRepositoryPath(selectedRepositoryValue) ?? (workspaceRoots.length === 0 ? selectedRepositoryValue || undefined : undefined)
          : undefined;
      const verifiedMetadataRepositoryPath = allowedRepositoryPath(result.metadata.repositoryPath);
      const pendingVerifiedMetadataRepositoryPath =
        !verifiedMetadataRepositoryPath && workspaceRoots.length === 0 ? result.metadata.repositoryPath : undefined;
      const verifiedExistingRepositoryPath =
        !isManagedWorktreePath(result.metadata.workspacePath) && existingWorkspace?.repositoryVerified
          ? allowedRepositoryPath(existingWorkspace.repositoryPath)
          : undefined;
      const inspectedRepositoryPath =
        verifiedMetadataRepositoryPath ??
        (isManagedWorktreePath(result.metadata.workspacePath) ? selectedManagedRepositoryPath : undefined) ??
        pendingVerifiedMetadataRepositoryPath ??
        verifiedExistingRepositoryPath;
      const inspectedRepositoryVerified = Boolean(
        verifiedMetadataRepositoryPath ??
          pendingVerifiedMetadataRepositoryPath ??
          (isManagedWorktreePath(result.metadata.workspacePath) ? selectedManagedRepositoryPath : undefined) ??
          verifiedExistingRepositoryPath,
      );
      hasExplicitRepositorySelectionRef.current = true;
      setPendingSelectedRepositoryPath(workspaceRoots.length === 0 ? inspectedRepositoryPath ?? null : null);
      setRepositoryPath(inspectedRepositoryPath ?? "");
      rememberWorkspace({
        name:
          result.metadata.workspaceLabel ??
          (isManagedWorktreePath(result.metadata.workspacePath) ? existingWorkspace?.name : existingWorkspace?.name) ??
          workspaceNameFromPath(result.metadata.workspacePath),
        path: result.metadata.workspacePath,
        repositoryPath: inspectedRepositoryPath,
        repositoryVerified: inspectedRepositoryVerified,
      });
      setWorkspaceContextStatus("Loaded");
    } catch (error) {
      setWorkspaceContextStatus(messageFromError(error));
    }
  }

   function setRunStateSynced(nextState: RunState | ((current: RunState) => RunState)) {
     setRunState((current) => {
       const next = typeof nextState === "function" ? nextState(current) : nextState;
       runStateRef.current = next;
       return next;
     });
   }

   function recordTaskEvent(event: AgentEvent) {
     taskEventsRef.current.set(event.taskId, [...(taskEventsRef.current.get(event.taskId) ?? []), event]);
   }

   function commitEvent(event: AgentEvent, transform?: (state: RunState) => RunState) {
     recordTaskEvent(event);
     setRunStateSynced((current) => {
       const reduced = reduceAgentEvent(current, event);

       return transform ? transform(reduced) : reduced;
     });

     if (event.type === "agent.done" && event.agentId === "luma" && typeof event.payload?.finalOutput === "string") {
       previousRunRef.current = createPreviousRunContext(taskEventsRef.current.get(event.taskId) ?? [], event.payload.finalOutput);
     }
   }

   async function startRun(
     prompt: string,
     runOptions: Pick<RunAdapterOptions, "approvalAgentId" | "approvalToken" | "sandboxMode" | "taskId" | "workspacePath"> = {},
   ) {
     const runToken = Symbol("run");
     activeRunRef.current = runToken;
     const nextInitialState = createInitialRunState(AGENTS);
     runStateRef.current = nextInitialState;
     setRunState(nextInitialState);
     setRunEpoch((current) => current + 1);
     setIsRunning(true);

     const abortController = new AbortController();
     abortControllerRef.current = abortController;
     let taskId = createTaskId(prompt);
     const workspacePath = Object.hasOwn(runOptions, "workspacePath") ? runOptions.workspacePath : selectedWorkspacePath();
     let sawTaskCreated = false;
     const runEvents: AgentEvent[] = [];
     let finalOutput: string | null = null;

	     try {
	     for await (const event of runAdapter.startRun(prompt, {
	       approvalAgentId: runOptions.approvalAgentId,
	       approvalToken: runOptions.approvalToken,
	       previousRun: previousRunRef.current ?? undefined,
	       sandboxMode: runOptions.sandboxMode ?? selectedSandboxMode(),
	       signal: abortController.signal,
	       taskId: runOptions.taskId,
	       workspacePath,
	     })) {
         if (activeRunRef.current !== runToken) {
           return;
         }

         if (event.type === "task.created") {
           taskId = event.taskId;
           sawTaskCreated = true;
         }

         runEvents.push(event);
         recordTaskEvent(event);
         if (event.type === "agent.done" && event.agentId === "luma" && typeof event.payload?.finalOutput === "string") {
           finalOutput = event.payload.finalOutput;
         }
         setRunStateSynced((current) => {
           const next = reduceAgentEvent(current, event);
           const nextWithWorkspace =
             event.type === "task.created" && workspacePath ? updateTask(next, event.taskId, { workspacePath }) : next;

           if (event.agentId === "luma" && event.type === "agent.failed") {
             return failUnfinishedSpecialists(nextWithWorkspace, event.taskId, "Route closed after Luma reported a run failure");
           }

           return nextWithWorkspace;
         });
       }

       if (abortController.signal.aborted) {
         throw new Error("Run aborted");
       }

       if (finalOutput) {
         previousRunRef.current = createPreviousRunContext(runEvents, finalOutput);
       }
     } catch (error) {
       if (activeRunRef.current !== runToken) {
         return;
       }

       setRunStateSynced((current) => {
         const withTask = sawTaskCreated
           ? current
           : reduceAgentEvent(
               current,
               createClientEvent(taskId, current.timeline.length + 1, "luma", "task.created", prompt, clientDiagnostics(runMode)),
             );
         const failedSpecialists = failUnfinishedSpecialists(withTask, taskId, "Route closed after the stream failed");

         return reduceAgentEvent(
           failedSpecialists,
           createClientEvent(
             taskId,
             failedSpecialists.timeline.length + 1,
             "luma",
             "agent.failed",
             messageFromError(error),
             clientFailureDiagnostics(runMode, sawTaskCreated),
           ),
         );
       });
     } finally {
       if (activeRunRef.current === runToken) {
         activeRunRef.current = null;
       }
       if (abortControllerRef.current === abortController) {
         abortControllerRef.current = null;
       }
       if (activeRunRef.current === null) {
         setIsRunning(false);
       }
     }
   }

   function stopRun() {
     abortControllerRef.current?.abort();
     stopQueuedRuns();
     setRunStateSynced((current) => {
       const now = new Date().toISOString();
       let next = current;

       for (const task of current.tasks.filter(isTaskInFlight)) {
         next = updateTask(next, task.taskId, {
           completedAt: now,
           error: "Run aborted",
           status: "failed",
         });
       }

       for (const jobs of Object.values(current.agentQueues)) {
         for (const job of jobs.filter((item) => item.status === "queued" || item.status === "running")) {
           next = updateAgentJob(next, job.jobId, {
             completedAt: now,
             error: "Run aborted",
             lastMessage: "Run aborted",
             status: "failed",
           });
         }
       }

       return {
         ...next,
         currentTask: null,
         agents: {
           ...next.agents,
           luma: {
             ...next.agents.luma,
             lastMessage: "Run aborted",
             status: "failed",
           },
         },
       };
     });
   }

   function submitTask(prompt: string) {
     if (queuedRunAdapter) {
       queueRun(prompt);
       return;
     }

     void startRun(prompt);
   }

   return (
     <main className="dashboard">
       <section className="library-stage">
         <header className="dashboard-top">
           <div>
             <p className="eyebrow">The Lanternwood Athenaeum</p>
             <h1>Living Library Dashboard</h1>
           </div>
           <CurrentTaskPanel
             onOpenWorkload={(taskId) => setDrawer({ isOpen: true, tab: "workload", taskId })}
             state={runState}
           />
           <div className="agents-summary" aria-label="Agents summary">
             {AGENTS.map((agent) => (
               <span key={agent.id} style={{ "--agent-color": agent.color } as CSSProperties}>
                 {agent.displayName}: {runState.agents[agent.id].status}
               </span>
             ))}
           </div>
         </header>
         <div className="scene-frame">
           <LanternwoodScene runEpoch={runEpoch} state={runState} />
         </div>
         <section aria-label="Workspace" className="workspace-panel">
           <header>
             <h2>Workspace Launcher</h2>
             <span>{workspaceDiscoveryStatus}</span>
           </header>
           {activeWorkspaceLabel ? <p aria-label="Selected workspace label">{activeWorkspaceLabel}</p> : null}
           {workspacePath.trim() ? <p>{workspacePath.trim()}</p> : null}
           {pinnedWorkspaces.length > 0 ? (
             <div className="workspace-picker-group">
               <h3>Pinned</h3>
               <div className="workspace-chip-row">
                 {pinnedWorkspaces.map((workspace) => (
                   <button
                     aria-label={`Select workspace ${workspace.name}`}
                     key={workspace.path}
                     onClick={() => selectWorkspace(workspace)}
                     type="button"
                   >
                     <span>{workspace.name}</span>
                     <small>{workspace.path}</small>
                   </button>
                 ))}
               </div>
             </div>
           ) : null}
           {recentWorkspaces.length > 0 ? (
             <div className="workspace-picker-group">
               <h3>Recent</h3>
               <div className="workspace-chip-row">
                 {recentWorkspaces.map((workspace) => (
                   <button
                     aria-label={`Select recent workspace ${workspace.name}`}
                     key={workspace.path}
                     onClick={() => selectWorkspace(workspace)}
                     type="button"
                   >
                     <span>{workspace.name}</span>
                     <small>{workspace.path}</small>
                   </button>
                 ))}
               </div>
             </div>
           ) : null}
           <details className="workspace-launcher-controls">
             <summary>Branch launcher</summary>
             <div className="workspace-launch-fields">
               <label>
                 <span>Repository</span>
                <input
                  aria-label="Repository"
                  onChange={(event) => {
                    hasExplicitRepositorySelectionRef.current = true;
                    setPendingSelectedRepositoryPath(null);
                    setPendingSelectedWorkspaceHint(null);
                    setRepositoryPath(event.target.value);
                  }}
                  placeholder="~/IdeaProjects/drive"
                  value={repositoryPath}
                />
               </label>
               <label>
                 <span>Branch name</span>
                 <input
                   aria-label="Branch name"
                   onChange={(event) => setBranchName(event.target.value)}
                   placeholder="feature/branch-launcher"
                   value={branchName}
                 />
               </label>
             </div>
             {worktreeLaunchStatus ? <p>{worktreeLaunchStatus}</p> : null}
             {launchedWorktree ? <p aria-label="Launched worktree path">{launchedWorktree.workspacePath}</p> : null}
             <label>
               <span>Workspace search</span>
               <input
                 aria-label="Workspace search"
                 onChange={(event) => setWorkspaceSearch(event.target.value)}
                 placeholder="drive, code, MCPContentSearch"
                 value={workspaceSearch}
               />
             </label>
             {filteredWorkspaceOptions.length > 0 ? (
               <div className="workspace-chip-row workspace-search-results">
                 {filteredWorkspaceOptions.map((workspace) => (
                   <button
                     aria-label={`Select workspace ${workspace.name}`}
                     key={workspace.path}
                     onClick={() => selectWorkspace(workspace)}
                     type="button"
                   >
                     <span>{workspace.name}</span>
                     <small>{workspace.path}</small>
                   </button>
                 ))}
               </div>
             ) : null}
             <details className="workspace-advanced">
               <summary>Advanced path</summary>
               <label>
                 <span>Target workspace</span>
                 <input
                   aria-label="Target workspace"
                   placeholder="~/IdeaProjects/drive"
                   value={workspacePath}
                   onChange={(event) => setWorkspacePath(event.target.value)}
                 />
               </label>
             </details>
             <label className="workspace-write-toggle">
               <input
                 aria-label="Allow workspace writes"
                 checked={allowWorkspaceWrite}
                 onChange={(event) => setAllowWorkspaceWrite(event.target.checked)}
                 type="checkbox"
               />
               <span>Allow workspace writes</span>
             </label>
             <div className="workspace-actions">
               <button disabled={isLaunchingWorktree} onClick={() => void launchWorktree()} type="button">
                 Launch worktree
               </button>
               <button onClick={() => void loadWorkspaceOptions()} type="button">
                 Refresh workspaces
               </button>
             </div>
           </details>
           <div className="workspace-actions workspace-actions-primary">
             <button onClick={() => void inspectWorkspace()} type="button">
               Inspect workspace
             </button>
           </div>
	         </section>
	         <WorkspaceContextPanel metadata={workspaceMetadata} status={workspaceContextStatus} />
	         <RunResultsPanel metadata={workspaceMetadata} />
	         <SkillDiscoveryPanel prompt={runState.tasks.at(-1)?.prompt ?? ""} skills={discoveredSkills} />
	         <AgentLibraryPanel />
	         <TaskInput disabled={!queuedRunAdapter && inputIsRunning} isRunning={inputIsRunning} onStop={stopRun} onSubmit={submitTask} />
	         {permissionRequest ? (
	           <PermissionRequestPanel
	             disabled={isRunning}
	             onApprove={(request) => {
	               setAllowWorkspaceWrite(true);
	               if (
	                 queuedRunAdapter &&
	                 approveQueuedRequest(request.taskId, request.agentId, request.requestedSandbox, request.approvalToken)
	               ) {
	                 return;
	               }
	               void startRun(request.prompt, {
	                 approvalAgentId: request.agentId,
	                 approvalToken: request.approvalToken,
	                 sandboxMode: request.requestedSandbox,
	                 taskId: request.taskId,
	                 workspacePath: request.workspacePath,
	               });
	             }}
	             request={permissionRequest}
	           />
	         ) : null}
	         <WorkQueuePanel
           onOpenFinalOutput={(taskId) => {
             const task = runState.tasks.find((candidate) => candidate.taskId === taskId);
             const hasReports = runState.timeline.some((event) => event.taskId === taskId && event.type === "agent.reporting");

             setDrawer({
               agentId: task?.finalOutput ? "luma" : undefined,
               isOpen: true,
               tab: task?.finalOutput || hasReports ? "reports" : "log",
               taskId,
             });
           }}
           tasks={runState.tasks}
         />
         <LiveRunInspector
           onOpenDetails={(tab, agentId) => setDrawer({ agentId, isOpen: true, tab })}
           runMode={runMode}
           state={runState}
         />
       </section>
       {drawer.isOpen ? (
         <RunDetailDrawer
           initialTab={drawer.tab}
           isOpen
           key={`${drawer.tab}-${drawer.agentId ?? "all"}-${drawer.taskId ?? "latest"}`}
           onClose={() => setDrawer((current) => ({ ...current, isOpen: false }))}
           runMode={runMode}
           selectedAgentId={drawer.agentId}
           selectedTaskId={drawer.taskId}
           state={runState}
         />
       ) : null}
     </main>
   );
 }
