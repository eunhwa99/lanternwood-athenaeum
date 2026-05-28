
 import { useMemo, useRef, useState, type CSSProperties } from "react";
 import { AGENTS } from "../agents/registry";
 import type { AgentId } from "../agents/types";
 import { createInitialRunState, enqueueAgentJob, enqueueTask, reduceAgentEvent, updateAgentJob, updateTask } from "../events/reducer";
 import { taskLabelFor } from "../events/taskLabels";
 import {
   SPECIALIST_AGENT_IDS,
   type AgentEvent,
   type AgentJob,
   type AgentStatus,
   type PreviousRunContext,
   type RunState,
   type SpecialistAgentId,
   type TaskRecord,
 } from "../events/types";
 import { createCodexRunAdapter } from "../harness/codexRunAdapter";
 import { createMockRunAdapter } from "../harness/mockRunAdapter";
 import { planRoute } from "../harness/routePlanning";
 import type { AgentJobRequest, RunAdapter, RunAdapterOptions, SynthesisTaskRequest } from "../harness/runAdapter";
 import { createTaskId } from "../harness/taskIds";
 import { LanternwoodScene } from "../world/LanternwoodScene";
 import { LiveRunInspector } from "./LiveRunInspector";
 import { RunDetailDrawer } from "./RunDetailDrawer";
 import { TaskInput } from "./TaskInput";
 import { previewText } from "./runDetails";
 import type { RunDetailsTab } from "./runDetails";

 declare global {
   interface Window {
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
     return createCodexRunAdapter();
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

 type TaskRuntime = {
   completedAgentIds: Set<SpecialistAgentId>;
   failedAgentIds: Set<SpecialistAgentId>;
   finalizing: boolean;
   prompt: string;
   reports: Partial<Record<AgentId, string>>;
   selectedAgentIds: SpecialistAgentId[];
   skippedAgentIds: SpecialistAgentId[];
   synthesisQueued: boolean;
   taskId: string;
 };

 const defaultRunAdapter = createDefaultRunAdapter();
 const defaultRunMode = import.meta.env.VITE_RUN_ADAPTER === "codex" ? "codex" : "mock";
 const COMPLETED_TASK_PREVIEW_LIMIT = 5;
 const specialistAgentIds = SPECIALIST_AGENT_IDS;
 const emptySpecialistQueues = () =>
   Object.fromEntries(specialistAgentIds.map((agentId) => [agentId, []])) as unknown as Record<SpecialistAgentId, AgentJobRequest[]>;

 const delegatedPrompts: Record<SpecialistAgentId, string> = {
   argus: "Argus, review the plan for risk and completion criteria.",
   neria: "Neria, keep recommendations concrete and repo-grounded.",
   orion: "Orion, focus the plan around the highest-risk milestone first.",
   quill: "Quill, turn the findings into a short milestone plan.",
 };

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
             : `${agentLaneCount} agent lane${agentLaneCount === 1 ? "" : "s"} assigned`}
         </p>
       </div>
       <button
         aria-label={`Open final output for ${label} ${task.prompt}`}
         disabled={!task.finalOutput}
         onClick={() => onOpenFinalOutput(task.taskId)}
         type="button"
       >
         Open final
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
   const completedTasks = tasks.filter(isCompletedTask).slice().reverse();
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

 export function AppShell({ runAdapter = defaultRunAdapter, runMode = defaultRunMode }: AppShellProps) {
   const initialState = useMemo(() => createInitialRunState(AGENTS), []);
   const [runState, setRunState] = useState<RunState>(initialState);
   const [runEpoch, setRunEpoch] = useState(0);
   const [isRunning, setIsRunning] = useState(false);
   const [drawer, setDrawer] = useState<DrawerState>({
     isOpen: false,
     tab: "reports",
   });
   const runStateRef = useRef<RunState>(initialState);
   const abortControllerRef = useRef<AbortController | null>(null);
   const queueAbortControllersRef = useRef<Set<AbortController>>(new Set());
   const activeRunRef = useRef<symbol | null>(null);
   const activeSpecialistsRef = useRef<Record<SpecialistAgentId, boolean>>({
     argus: false,
     neria: false,
     orion: false,
     quill: false,
   });
   const specialistQueuesRef = useRef<Record<SpecialistAgentId, AgentJobRequest[]>>(emptySpecialistQueues());
   const synthesisActiveRef = useRef(false);
   const synthesisQueueRef = useRef<string[]>([]);
   const taskEventsRef = useRef<Map<string, AgentEvent[]>>(new Map());
   const taskIdCounterRef = useRef(0);
   const taskRuntimeRef = useRef<Map<string, TaskRuntime>>(new Map());
   const previousRunRef = useRef<PreviousRunContext | null>(null);
   const queuedRunAdapter = supportsQueuedRuns(runAdapter) ? runAdapter : null;
   const hasQueuedWork =
     runState.tasks.some(isTaskInFlight) ||
     Object.values(runState.agentQueues).some((jobs) => jobs.some((job) => job.status === "queued" || job.status === "running"));
   const inputIsRunning = isRunning || hasQueuedWork;

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

   function createQueuedTaskId(prompt: string) {
     taskIdCounterRef.current += 1;

     return `${createTaskId(prompt)}-${taskIdCounterRef.current}`;
   }

   function queueSynthesis(taskId: string) {
     const runtime = taskRuntimeRef.current.get(taskId);

     if (!runtime || runtime.synthesisQueued) {
       return;
     }

     runtime.synthesisQueued = true;
     synthesisQueueRef.current.push(taskId);
     setRunStateSynced((current) =>
       enqueueAgentJob(updateTask(current, taskId, { status: "synthesizing" }), {
         agentId: "luma",
         jobId: `${taskId}-luma-synthesis`,
         prompt: runtime.prompt,
         queuedAt: new Date().toISOString(),
         taskId,
       }),
     );
     void runSynthesisQueue();
   }

   function maybeQueueSynthesis(taskId: string) {
     const runtime = taskRuntimeRef.current.get(taskId);

     if (!runtime || runtime.synthesisQueued || runtime.finalizing) {
       return;
     }

     if (runtime.failedAgentIds.size > 0) {
       setRunStateSynced((current) =>
         updateTask(current, taskId, {
           completedAt: new Date().toISOString(),
           error: "One or more delegated agent jobs failed.",
           status: "failed",
         }),
       );
       return;
     }

     if (runtime.selectedAgentIds.every((agentId) => runtime.completedAgentIds.has(agentId))) {
       queueSynthesis(taskId);
     }
   }

   async function runSynthesisQueue() {
     if (!queuedRunAdapter || synthesisActiveRef.current) {
       return;
     }

     const taskId = synthesisQueueRef.current[0];
     const runtime = taskRuntimeRef.current.get(taskId);

     if (!taskId || !runtime) {
       return;
     }

     const jobId = `${taskId}-luma-synthesis`;
     const abortController = new AbortController();
     synthesisActiveRef.current = true;
     runtime.finalizing = true;
     queueAbortControllersRef.current.add(abortController);
     setRunStateSynced((current) =>
       updateAgentJob(updateTask(current, taskId, { status: "synthesizing" }), jobId, {
         lastMessage: "Luma is synthesizing the task result",
         startedAt: new Date().toISOString(),
         status: "running",
       }),
     );

     const request: SynthesisTaskRequest = {
       prompt: runtime.prompt,
       reports: runtime.reports,
       selectedAgentIds: runtime.selectedAgentIds,
       skippedAgentIds: runtime.skippedAgentIds,
       taskId,
     };
     const options: RunAdapterOptions = {
       previousRun: previousRunRef.current ?? undefined,
       signal: abortController.signal,
       taskId,
     };

     try {
       for await (const event of queuedRunAdapter.synthesizeTask(request, options)) {
         if (abortController.signal.aborted) {
           throw new Error("Run aborted");
         }

         commitEvent(event, (state) => updateAgentJob(state, jobId, { lastMessage: event.message }));
       }

       if (abortController.signal.aborted) {
         throw new Error("Run aborted");
       }

       setRunStateSynced((current) =>
         updateAgentJob(current, jobId, {
           completedAt: new Date().toISOString(),
           lastMessage: "Synthesis complete",
           status: "done",
         }),
       );
     } catch (error) {
       const message = messageFromError(error);
       commitEvent(createClientEvent(taskId, runStateRef.current.timeline.length + 1, "luma", "agent.failed", message), (state) =>
         updateAgentJob(
           updateTask(state, taskId, {
             completedAt: new Date().toISOString(),
             error: message,
             status: "failed",
           }),
           jobId,
           {
             completedAt: new Date().toISOString(),
             error: message,
             lastMessage: message,
             status: "failed",
           },
         ),
       );
     } finally {
       queueAbortControllersRef.current.delete(abortController);
       synthesisQueueRef.current.shift();
       runtime.finalizing = false;
       synthesisActiveRef.current = false;
       void runSynthesisQueue();
     }
   }

   async function runSpecialistQueue(agentId: SpecialistAgentId) {
     if (!queuedRunAdapter || activeSpecialistsRef.current[agentId]) {
       return;
     }

     const job = specialistQueuesRef.current[agentId][0];

     if (!job) {
       return;
     }

     const jobId = `${job.taskId}-${agentId}`;
     const abortController = new AbortController();
     let report: string | undefined;
     activeSpecialistsRef.current[agentId] = true;
     queueAbortControllersRef.current.add(abortController);
     setRunStateSynced((current) =>
       updateAgentJob(updateTask(current, job.taskId, { status: "running" }), jobId, {
         lastMessage: `${agentDisplayName(agentId)} is working`,
         startedAt: new Date().toISOString(),
         status: "running",
       }),
     );

     try {
       for await (const event of queuedRunAdapter.startAgentJob(job, {
         previousRun: previousRunRef.current ?? undefined,
         signal: abortController.signal,
         taskId: job.taskId,
       })) {
         if (abortController.signal.aborted) {
           throw new Error("Run aborted");
         }

         const payload = event.payload as Record<string, unknown> | undefined;

         if (event.type === "agent.reporting" && typeof payload?.report === "string") {
           report = payload.report;
           taskRuntimeRef.current.get(job.taskId)!.reports[agentId] = payload.report;
         }

         commitEvent(event, (state) =>
           updateAgentJob(state, jobId, {
             lastMessage: event.message,
             output: report,
           }),
         );
       }

       if (abortController.signal.aborted) {
         throw new Error("Run aborted");
       }

       taskRuntimeRef.current.get(job.taskId)?.completedAgentIds.add(agentId);
       setRunStateSynced((current) =>
         updateAgentJob(current, jobId, {
           completedAt: new Date().toISOString(),
           lastMessage: report ?? "Agent job complete",
           output: report,
           status: "done",
         }),
       );
       maybeQueueSynthesis(job.taskId);
     } catch (error) {
       const message = messageFromError(error);
       taskRuntimeRef.current.get(job.taskId)?.failedAgentIds.add(agentId);
       commitEvent(createClientEvent(job.taskId, runStateRef.current.timeline.length + 1, agentId, "agent.failed", message), (state) =>
         updateAgentJob(
           updateTask(state, job.taskId, {
             completedAt: new Date().toISOString(),
             error: message,
             status: "failed",
           }),
           jobId,
           {
             completedAt: new Date().toISOString(),
             error: message,
             lastMessage: message,
             status: "failed",
           },
         ),
       );
     } finally {
       queueAbortControllersRef.current.delete(abortController);
       specialistQueuesRef.current[agentId].shift();
       activeSpecialistsRef.current[agentId] = false;
       void runSpecialistQueue(agentId);
     }
   }

 function queueRun(prompt: string) {
     if (!queuedRunAdapter) {
       void startRun(prompt);
       return;
     }

     const taskId = createQueuedTaskId(prompt);
     const createdAt = new Date().toISOString();
     const routePlan = planRoute(prompt);
     const selectedAgentIds = routePlan.selectedAgentIds;
     const skippedAgentIds = routePlan.skippedAgentIds;
     taskRuntimeRef.current.set(taskId, {
       completedAgentIds: new Set(),
       failedAgentIds: new Set(),
       finalizing: false,
       prompt,
       reports: {},
       selectedAgentIds,
       skippedAgentIds,
       synthesisQueued: false,
       taskId,
     });
     taskEventsRef.current.set(taskId, []);
     setRunEpoch((current) => current + 1);
     setRunStateSynced((current) =>
       enqueueTask(current, {
         createdAt,
         prompt,
         selectedAgentIds,
         skippedAgentIds,
         taskId,
       }),
     );

     commitEvent(createClientEvent(taskId, 1, "luma", "task.created", prompt));
     commitEvent(createClientEvent(taskId, 2, "luma", "agent.planning", "Luma is arranging the reading lamps"));
     commitEvent(createClientEvent(taskId, 3, "luma", "route.planned", "Luma selected a specialist route", routePlan));

     if (selectedAgentIds.length > 0) {
       commitEvent(
         createClientEvent(
           taskId,
           4,
           "luma",
           "agent.delegated",
           `Luma selected: ${selectedAgentIds.map((agentId) => agentDisplayName(agentId)).join(", ")}`,
         ),
       );
     }

     selectedAgentIds.forEach((agentId, index) => {
       const delegatedPrompt = delegatedPrompts[agentId];
       const job: AgentJobRequest = {
         agentId,
         delegatedPrompt,
         prompt,
         selectedAgentIds,
         skippedAgentIds,
         taskId,
       };
       specialistQueuesRef.current[agentId].push(job);
       commitEvent(
         createClientEvent(taskId, 5 + index, "luma", "agent.prompted", `Luma prompts ${agentId}`, {
           prompt: delegatedPrompt,
           promptExcerpt: delegatedPrompt,
           recipientAgentId: agentId,
           senderAgentId: "luma",
           speechBubble: delegatedPrompt,
         }),
       );
       setRunStateSynced((current) =>
         enqueueAgentJob(updateTask(current, taskId, { status: "running" }), {
           agentId,
           jobId: `${taskId}-${agentId}`,
           prompt,
           queuedAt: new Date().toISOString(),
           taskId,
         }),
       );
       void runSpecialistQueue(agentId);
     });

     if (selectedAgentIds.length === 0) {
       queueSynthesis(taskId);
     }
   }

   async function startRun(prompt: string) {
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
     let sawTaskCreated = false;
     const runEvents: AgentEvent[] = [];
     let finalOutput: string | null = null;

     try {
       for await (const event of runAdapter.startRun(prompt, {
         previousRun: previousRunRef.current ?? undefined,
         signal: abortController.signal,
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

           if (event.agentId === "luma" && event.type === "agent.failed") {
             return failUnfinishedSpecialists(next, event.taskId, "Route closed after Luma reported a run failure");
           }

           return next;
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
     for (const abortController of queueAbortControllersRef.current) {
       abortController.abort();
     }
     specialistQueuesRef.current = emptySpecialistQueues();
     synthesisQueueRef.current = [];
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

       return next;
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
         <TaskInput isRunning={inputIsRunning} onStop={stopRun} onSubmit={submitTask} />
         <WorkQueuePanel
           onOpenFinalOutput={(taskId) => setDrawer({ agentId: "luma", isOpen: true, tab: "reports", taskId })}
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
