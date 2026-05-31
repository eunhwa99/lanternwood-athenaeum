import type { AgentDefinition, AgentId } from "../agents/types";
import type { AgentEvent, AgentJob, AgentStatus, RunState, TaskRecord } from "./types";

const eventStatus: Partial<Record<AgentEvent["type"], AgentStatus>> = {
  "agent.planning": "planning",
  "agent.delegated": "planning",
  "agent.prompted": "moving",
  "agent.moving": "moving",
  "agent.working": "working",
  "agent.reporting": "reporting",
  "agent.reviewing": "reviewing",
  "agent.done": "done",
  "agent.failed": "failed",
  "approval.requested": "waitingApproval",
  "permission.reviewed": "reviewing",
  "route.planned": "planning",
};

export function createInitialRunState(agents: AgentDefinition[]): RunState {
  return {
    currentTask: null,
    agents: Object.fromEntries(
      agents.map((agent) => [
        agent.id,
        {
          definition: agent,
          status: "idle",
          lastMessage: "Waiting in the stacks",
        },
      ]),
    ) as RunState["agents"],
    agentQueues: Object.fromEntries(agents.map((agent) => [agent.id, []])) as unknown as RunState["agentQueues"],
    finalOutput: null,
    finalOutputs: {},
    tasks: [],
    timeline: [],
  };
}

function upsertTask(tasks: TaskRecord[], nextTask: TaskRecord): TaskRecord[] {
  const taskIndex = tasks.findIndex((task) => task.taskId === nextTask.taskId);

  if (taskIndex < 0) {
    return [...tasks, nextTask];
  }

  return tasks.map((task, index) => (index === taskIndex ? { ...task, ...nextTask } : task));
}

function patchTask(tasks: TaskRecord[], taskId: string, patch: Partial<TaskRecord>): TaskRecord[] {
  return tasks.map((task) => (task.taskId === taskId ? { ...task, ...patch } : task));
}

export function enqueueTask(
  state: RunState,
  task: {
    createdAt: string;
    prompt: string;
    selectedAgentIds?: AgentId[];
    skippedAgentIds?: AgentId[];
    taskId: string;
  },
): RunState {
  const nextTask: TaskRecord = {
    createdAt: task.createdAt,
    finalOutput: null,
    prompt: task.prompt,
    selectedAgentIds: task.selectedAgentIds ?? [],
    skippedAgentIds: task.skippedAgentIds ?? [],
    status: "queued",
    taskId: task.taskId,
  };

  return {
    ...state,
    currentTask: state.currentTask ?? { prompt: task.prompt, taskId: task.taskId },
    tasks: upsertTask(state.tasks, nextTask),
  };
}

export function updateTask(state: RunState, taskId: string, patch: Partial<TaskRecord>): RunState {
  return {
    ...state,
    currentTask:
      patch.status && ["running", "routing", "synthesizing"].includes(patch.status)
        ? { prompt: patch.prompt ?? state.tasks.find((task) => task.taskId === taskId)?.prompt ?? state.currentTask?.prompt ?? "", taskId }
        : state.currentTask,
    tasks: patchTask(state.tasks, taskId, patch),
  };
}

export function enqueueAgentJob(
  state: RunState,
  job: {
    agentId: AgentId;
    jobId: string;
    prompt: string;
    queuedAt: string;
    taskId: string;
  },
): RunState {
  const nextJob: AgentJob = {
    agentId: job.agentId,
    jobId: job.jobId,
    lastMessage: "Queued",
    prompt: job.prompt,
    queuedAt: job.queuedAt,
    status: "queued",
    taskId: job.taskId,
  };

  return {
    ...state,
    agentQueues: {
      ...state.agentQueues,
      [job.agentId]: [...state.agentQueues[job.agentId], nextJob],
    },
  };
}

export function updateAgentJob(state: RunState, jobId: string, patch: Partial<AgentJob>): RunState {
  const agentEntry = Object.entries(state.agentQueues).find(([, jobs]) => jobs.some((job) => job.jobId === jobId));

  if (!agentEntry) {
    return state;
  }

  const [agentId, jobs] = agentEntry as [AgentId, AgentJob[]];
  const nextJobs = jobs.map((job) => (job.jobId === jobId ? { ...job, ...patch } : job));
  const currentJob = nextJobs.find((job) => job.jobId === jobId);
  const nextAgent =
    currentJob && patch.status === "running"
      ? {
          ...state.agents[agentId],
          currentJobId: jobId,
          lastMessage: patch.lastMessage ?? state.agents[agentId].lastMessage,
          status: agentId === "argus" ? ("reviewing" as const) : ("working" as const),
        }
      : currentJob && (patch.status === "done" || patch.status === "failed")
        ? {
            ...state.agents[agentId],
            currentJobId: undefined,
            lastMessage: patch.lastMessage ?? state.agents[agentId].lastMessage,
            status: patch.status === "failed" ? ("failed" as const) : ("done" as const),
          }
        : state.agents[agentId];

  return {
    ...state,
    agents: {
      ...state.agents,
      [agentId]: nextAgent,
    },
    agentQueues: {
      ...state.agentQueues,
      [agentId]: nextJobs,
    },
  };
}

export function reduceAgentEvent(state: RunState, event: AgentEvent): RunState {
  const nextStatus = eventStatus[event.type] ?? state.agents[event.agentId as AgentId].status;
  const isTerminalManagerEvent = event.type === "agent.done" && event.agentId === "luma";
  const finalOutput =
    event.type === "task.created"
      ? state.finalOutput
      : isTerminalManagerEvent && typeof event.payload?.finalOutput === "string"
        ? event.payload.finalOutput
        : state.finalOutput;
  const currentTask =
    event.type === "task.created"
      ? { taskId: event.taskId, prompt: event.message }
      : state.currentTask;

  const existingEventTask = state.tasks.find((task) => task.taskId === event.taskId);
  const nextTasks =
    event.type === "task.created"
      ? upsertTask(state.tasks, {
          createdAt: event.timestamp,
          finalOutput: existingEventTask?.finalOutput ?? null,
          prompt: event.message,
          selectedAgentIds: existingEventTask?.selectedAgentIds ?? [],
          skippedAgentIds: existingEventTask?.skippedAgentIds ?? [],
          status: "routing",
          taskId: event.taskId,
        })
      : isTerminalManagerEvent && typeof event.payload?.finalOutput === "string"
        ? upsertTask(state.tasks, {
            completedAt: event.timestamp,
            createdAt: existingEventTask?.createdAt ?? event.timestamp,
            finalOutput: event.payload.finalOutput,
            prompt: existingEventTask?.prompt ?? state.currentTask?.prompt ?? event.message,
            selectedAgentIds: existingEventTask?.selectedAgentIds ?? [],
            skippedAgentIds: existingEventTask?.skippedAgentIds ?? [],
            status: "done",
            taskId: event.taskId,
          })
        : event.type === "agent.failed" && event.agentId === "luma"
          ? upsertTask(state.tasks, {
              completedAt: event.timestamp,
              createdAt: existingEventTask?.createdAt ?? event.timestamp,
              error: event.message,
              finalOutput: existingEventTask?.finalOutput ?? null,
              prompt: existingEventTask?.prompt ?? state.currentTask?.prompt ?? event.message,
              selectedAgentIds: existingEventTask?.selectedAgentIds ?? [],
              skippedAgentIds: existingEventTask?.skippedAgentIds ?? [],
              status: "failed",
              taskId: event.taskId,
            })
          : state.tasks;
  const nextFinalOutputs =
    isTerminalManagerEvent && typeof event.payload?.finalOutput === "string"
      ? { ...state.finalOutputs, [event.taskId]: event.payload.finalOutput }
      : state.finalOutputs;

  return {
    currentTask,
    agents: {
      ...state.agents,
      [event.agentId]: {
        ...state.agents[event.agentId as AgentId],
        status: nextStatus,
        lastMessage: event.message,
      },
    },
    agentQueues: state.agentQueues,
    finalOutput,
    finalOutputs: nextFinalOutputs,
    tasks: nextTasks,
    timeline: [...state.timeline, event],
  };
}
