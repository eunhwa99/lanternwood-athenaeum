import { useCallback, useEffect, useRef, useState } from "react";
import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import { enqueueAgentJob, enqueueTask, updateAgentJob, updateTask } from "../events/reducer";
import type { AgentEvent, PreviousRunContext, RunState, SpecialistAgentId } from "../events/types";
import { planRoute } from "../harness/routePlanning";
import type { AgentJobRequest, RunAdapter, RunAdapterOptions, SynthesisTaskRequest } from "../harness/runAdapter";
import { createTaskId } from "../harness/taskIds";

type QueuedRunAdapter = RunAdapter & {
  startAgentJob: NonNullable<RunAdapter["startAgentJob"]>;
  synthesizeTask: NonNullable<RunAdapter["synthesizeTask"]>;
};

type QueueAbortController = {
  agentId: AgentId;
  controller: AbortController;
  taskId: string;
};

type TaskRuntimeState = {
  approvedRetry?: {
    agentId: AgentId;
    approvalToken?: string;
    sandboxMode: RunAdapterOptions["sandboxMode"];
  };
  approvalPausedAgentIds: SpecialistAgentId[];
  approvalPendingAgentId?: AgentId;
  completedAgentIds: SpecialistAgentId[];
  failedAgentIds: SpecialistAgentId[];
  finalizing: boolean;
  previousRun?: PreviousRunContext;
  prompt: string;
  queuedAgentIds: SpecialistAgentId[];
  reports: Partial<Record<AgentId, string>>;
  sandboxMode: RunAdapterOptions["sandboxMode"];
  selectedAgentIds: SpecialistAgentId[];
  skippedAgentIds: SpecialistAgentId[];
  synthesisQueued: boolean;
  taskId: string;
  workspacePath?: string;
};

export type QueuedRunOrchestratorState = {
  activeSpecialists: Record<SpecialistAgentId, boolean>;
  specialistQueues: Record<SpecialistAgentId, AgentJobRequest[]>;
  synthesisActive: boolean;
  synthesisQueue: string[];
  taskRuntimes: Record<string, TaskRuntimeState>;
};

export type QueuedRunOrchestratorAction =
  | { type: "agentCompleted"; agentId: SpecialistAgentId; taskId: string }
  | { type: "agentFailed"; agentId: SpecialistAgentId; taskId: string }
  | { type: "clearTaskApprovalPausedAgent"; agentId: SpecialistAgentId; taskId: string }
  | { type: "clearPendingWork" }
  | { type: "dequeueSpecialist"; agentId: SpecialistAgentId; job: AgentJobRequest }
  | { type: "dequeueSynthesis"; taskId: string }
  | { type: "discardTaskQueuedJobs"; taskId: string; exceptJob?: AgentJobRequest }
  | { type: "enqueueSpecialist"; agentId: SpecialistAgentId; job: AgentJobRequest; taskId: string }
  | { type: "enqueueSynthesis"; taskId: string }
  | { type: "recordReport"; agentId: AgentId; report: string; taskId: string }
  | { type: "registerTask"; runtime: TaskRuntimeState }
  | { type: "retrySpecialist"; agentId: SpecialistAgentId; job: AgentJobRequest; taskId: string }
  | { type: "retrySynthesis"; taskId: string }
  | { type: "setSpecialistActive"; active: boolean; agentId: SpecialistAgentId }
  | { type: "setSynthesisActive"; active: boolean }
  | {
      type: "setTaskApproval";
      agentId: AgentId;
      approvalToken?: string;
      sandboxMode: RunAdapterOptions["sandboxMode"];
      taskId: string;
    }
  | { type: "setTaskApprovalPending"; agentId: AgentId; pausedAgentIds?: SpecialistAgentId[]; taskId: string }
  | { type: "setTaskFinalizing"; finalizing: boolean; taskId: string };

const specialistAgentIds = AGENTS.filter((agent) => agent.id !== "luma").map((agent) => agent.id);

const emptySpecialistQueues = () =>
  Object.fromEntries(specialistAgentIds.map((agentId) => [agentId, []])) as unknown as Record<SpecialistAgentId, AgentJobRequest[]>;

function addUniqueAgentId(agentIds: SpecialistAgentId[], agentId: SpecialistAgentId) {
  return agentIds.includes(agentId) ? agentIds : [...agentIds, agentId];
}

function updateRuntime(
  state: QueuedRunOrchestratorState,
  taskId: string,
  update: (runtime: TaskRuntimeState) => TaskRuntimeState,
) {
  const runtime = state.taskRuntimes[taskId];

  if (!runtime) {
    return state;
  }

  return {
    ...state,
    taskRuntimes: {
      ...state.taskRuntimes,
      [taskId]: update(runtime),
    },
  };
}

export function createInitialQueuedRunOrchestratorState(): QueuedRunOrchestratorState {
  return {
    activeSpecialists: Object.fromEntries(specialistAgentIds.map((agentId) => [agentId, false])) as Record<
      SpecialistAgentId,
      boolean
    >,
    specialistQueues: emptySpecialistQueues(),
    synthesisActive: false,
    synthesisQueue: [],
    taskRuntimes: {},
  };
}

export function queuedRunOrchestratorReducer(
  state: QueuedRunOrchestratorState,
  action: QueuedRunOrchestratorAction,
): QueuedRunOrchestratorState {
  switch (action.type) {
    case "agentCompleted":
      return updateRuntime(state, action.taskId, (runtime) => ({
        ...runtime,
        approvedRetry: runtime.approvedRetry?.agentId === action.agentId ? undefined : runtime.approvedRetry,
        approvalPausedAgentIds: runtime.approvalPausedAgentIds.filter((agentId) => agentId !== action.agentId),
        approvalPendingAgentId:
          runtime.approvalPendingAgentId === action.agentId ? undefined : runtime.approvalPendingAgentId,
        completedAgentIds: addUniqueAgentId(runtime.completedAgentIds, action.agentId),
      }));

    case "agentFailed":
      return updateRuntime(state, action.taskId, (runtime) => ({
        ...runtime,
        approvedRetry: runtime.approvedRetry?.agentId === action.agentId ? undefined : runtime.approvedRetry,
        approvalPausedAgentIds: runtime.approvalPausedAgentIds.filter((agentId) => agentId !== action.agentId),
        approvalPendingAgentId:
          runtime.approvalPendingAgentId === action.agentId ? undefined : runtime.approvalPendingAgentId,
        failedAgentIds: addUniqueAgentId(runtime.failedAgentIds, action.agentId),
      }));

    case "clearTaskApprovalPausedAgent":
      return updateRuntime(state, action.taskId, (runtime) => ({
        ...runtime,
        approvalPausedAgentIds: runtime.approvalPausedAgentIds.filter((agentId) => agentId !== action.agentId),
      }));

    case "clearPendingWork":
      return {
        ...state,
        specialistQueues: emptySpecialistQueues(),
        synthesisQueue: [],
        taskRuntimes: {},
      };

    case "dequeueSpecialist":
      return {
        ...state,
        specialistQueues: {
          ...state.specialistQueues,
          [action.agentId]:
            state.specialistQueues[action.agentId][0] === action.job
              ? state.specialistQueues[action.agentId].slice(1)
              : state.specialistQueues[action.agentId],
        },
      };

    case "dequeueSynthesis":
      return {
        ...state,
        synthesisQueue: state.synthesisQueue[0] === action.taskId ? state.synthesisQueue.slice(1) : state.synthesisQueue,
      };

    case "discardTaskQueuedJobs":
      return {
        ...state,
        specialistQueues: Object.fromEntries(
          specialistAgentIds.map((agentId) => [
            agentId,
            state.specialistQueues[agentId].filter((job) => job === action.exceptJob || job.taskId !== action.taskId),
          ]),
        ) as Record<SpecialistAgentId, AgentJobRequest[]>,
        synthesisQueue: state.synthesisQueue.filter((queuedTaskId) => queuedTaskId !== action.taskId),
      };

    case "enqueueSpecialist":
      return updateRuntime(
        {
          ...state,
          specialistQueues: {
            ...state.specialistQueues,
            [action.agentId]: [...state.specialistQueues[action.agentId], action.job],
          },
        },
        action.taskId,
        (runtime) => ({
          ...runtime,
          queuedAgentIds: addUniqueAgentId(runtime.queuedAgentIds, action.agentId),
        }),
      );

    case "enqueueSynthesis":
      return updateRuntime(
        {
          ...state,
          synthesisQueue: [...state.synthesisQueue, action.taskId],
        },
        action.taskId,
        (runtime) => ({
          ...runtime,
          synthesisQueued: true,
        }),
      );

    case "recordReport":
      return updateRuntime(state, action.taskId, (runtime) => ({
        ...runtime,
        reports: {
          ...runtime.reports,
          [action.agentId]: action.report,
        },
      }));

    case "registerTask":
      return {
        ...state,
        taskRuntimes: {
          ...state.taskRuntimes,
          [action.runtime.taskId]: action.runtime,
        },
      };

    case "retrySpecialist":
      return updateRuntime(
        {
          ...state,
          specialistQueues: {
            ...state.specialistQueues,
            [action.agentId]: [...state.specialistQueues[action.agentId], action.job],
          },
        },
        action.taskId,
        (runtime) => ({
          ...runtime,
          queuedAgentIds: addUniqueAgentId(runtime.queuedAgentIds, action.agentId),
        }),
      );

    case "retrySynthesis":
      return updateRuntime(
        {
          ...state,
          synthesisQueue: state.synthesisQueue.includes(action.taskId)
            ? state.synthesisQueue
            : [...state.synthesisQueue, action.taskId],
        },
        action.taskId,
        (runtime) => ({
          ...runtime,
          synthesisQueued: true,
        }),
      );

    case "setSpecialistActive":
      return {
        ...state,
        activeSpecialists: {
          ...state.activeSpecialists,
          [action.agentId]: action.active,
        },
      };

    case "setSynthesisActive":
      return {
        ...state,
        synthesisActive: action.active,
      };

    case "setTaskApproval":
      return updateRuntime(state, action.taskId, (runtime) => ({
        ...runtime,
        approvedRetry: {
          agentId: action.agentId,
          approvalToken: action.approvalToken,
          sandboxMode: action.sandboxMode,
        },
      }));

    case "setTaskApprovalPending":
      return updateRuntime(state, action.taskId, (runtime) => ({
        ...runtime,
        approvedRetry: undefined,
        approvalPausedAgentIds: [...new Set([...runtime.approvalPausedAgentIds, ...(action.pausedAgentIds ?? [])])],
        approvalPendingAgentId: action.agentId,
      }));

    case "setTaskFinalizing":
      return updateRuntime(state, action.taskId, (runtime) => ({
        ...runtime,
        finalizing: action.finalizing,
      }));
  }
}

type UseQueuedRunOrchestratorOptions = {
  commitEvent: (event: AgentEvent, transform?: (state: RunState) => RunState) => void;
  getPreviousRun: () => PreviousRunContext | null;
  getRunState: () => RunState;
  getSandboxMode: () => RunAdapterOptions["sandboxMode"];
  getTaskEventCount: (taskId: string) => number;
  getWorkspacePath: () => string | undefined;
  onRunEpoch: () => void;
  queuedRunAdapter: QueuedRunAdapter | null;
  setRunStateSynced: (nextState: RunState | ((current: RunState) => RunState)) => void;
};

function sentenceCaseAfterName(instruction: string) {
  return instruction.charAt(0).toLocaleLowerCase() + instruction.slice(1);
}

const delegatedPrompts = Object.fromEntries(
  AGENTS.filter((agent) => agent.id !== "luma").map((agent) => [
    agent.id,
    `${agent.displayName}, ${sentenceCaseAfterName(agent.promptInstruction)}`,
  ]),
) as Record<SpecialistAgentId, string>;

function isReviewAgent(agentId: AgentId) {
  return AGENTS.find((agent) => agent.id === agentId)?.systemRole === "ReviewAgent";
}

function isSpecialistAgentId(agentId: AgentId): agentId is SpecialistAgentId {
  return specialistAgentIds.includes(agentId as SpecialistAgentId);
}

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

function agentDisplayName(agentId: AgentId) {
  return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
}

function createSpecialistJob(runtime: TaskRuntimeState, agentId: SpecialistAgentId): AgentJobRequest {
  return {
    agentId,
    delegatedPrompt: delegatedPrompts[agentId],
    prompt: runtime.prompt,
    selectedAgentIds: runtime.selectedAgentIds,
    skippedAgentIds: runtime.skippedAgentIds,
    specialistReports: isReviewAgent(agentId) ? runtime.reports : undefined,
    taskId: runtime.taskId,
  };
}

function failQueuedStateJobsForTask(state: RunState, taskId: string, reason: string, completedAt: string, exceptJobId?: string) {
  return Object.values(state.agentQueues)
    .flat()
    .filter((job) => job.taskId === taskId && job.jobId !== exceptJobId && job.status === "queued")
    .reduce(
      (current, job) =>
        updateAgentJob(current, job.jobId, {
          completedAt,
          error: reason,
          lastMessage: reason,
          status: "failed",
        }),
      state,
    );
}

export function useQueuedRunOrchestrator({
  commitEvent,
  getPreviousRun,
  getRunState,
  getSandboxMode,
  getTaskEventCount,
  getWorkspacePath,
  onRunEpoch,
  queuedRunAdapter,
  setRunStateSynced,
}: UseQueuedRunOrchestratorOptions) {
  const [queueState, setQueueState] = useState(createInitialQueuedRunOrchestratorState);
  const queueStateRef = useRef(queueState);
  const queueAbortControllersRef = useRef<Set<QueueAbortController>>(new Set());
  const taskIdCounterRef = useRef(0);

  const dispatchQueue = useCallback((action: QueuedRunOrchestratorAction) => {
    const next = queuedRunOrchestratorReducer(queueStateRef.current, action);
    queueStateRef.current = next;
    setQueueState(next);

    return next;
  }, []);

  const createQueuedTaskId = useCallback((prompt: string) => {
    taskIdCounterRef.current += 1;

    return `${createTaskId(prompt)}-${taskIdCounterRef.current}`;
  }, []);

  const nextTaskEventIndex = useCallback((taskId: string) => getTaskEventCount(taskId) + 1, [getTaskEventCount]);

  const discardQueuedRuntimeJobsForTask = useCallback(
    (taskId: string, exceptJob?: AgentJobRequest) => {
      dispatchQueue({ exceptJob, taskId, type: "discardTaskQueuedJobs" });
    },
    [dispatchQueue],
  );

  const abortActiveSiblingJobsForTask = useCallback((taskId: string, requestingAgentId: AgentId) => {
    const abortedAgentIds: SpecialistAgentId[] = [];

    for (const entry of queueAbortControllersRef.current) {
      if (entry.taskId === taskId && entry.agentId !== requestingAgentId) {
        entry.controller.abort();
        if (isSpecialistAgentId(entry.agentId) && !abortedAgentIds.includes(entry.agentId)) {
          abortedAgentIds.push(entry.agentId);
        }
      }
    }

    return abortedAgentIds;
  }, []);

  const queueSynthesisRef = useRef<(taskId: string) => void>(() => undefined);
  const maybeQueueSynthesisRef = useRef<(taskId: string) => void>(() => undefined);
  const runSynthesisQueueRef = useRef<() => Promise<void>>(async () => undefined);
  const runSpecialistQueueRef = useRef<(agentId: SpecialistAgentId) => Promise<void>>(async () => undefined);

  const enqueueSpecialistJob = useCallback(
    (taskId: string, agentId: SpecialistAgentId) => {
      const runtime = queueStateRef.current.taskRuntimes[taskId];

      if (
        !runtime ||
        runtime.queuedAgentIds.includes(agentId) ||
        runtime.completedAgentIds.includes(agentId) ||
        runtime.failedAgentIds.includes(agentId)
      ) {
        return;
      }

      const delegatedPrompt = delegatedPrompts[agentId];
      const job = createSpecialistJob(runtime, agentId);

      dispatchQueue({ agentId, job, taskId, type: "enqueueSpecialist" });
      commitEvent(
        createClientEvent(taskId, nextTaskEventIndex(taskId), "luma", "agent.prompted", `Luma prompts ${agentId}`, {
          prompt: delegatedPrompt,
          promptExcerpt: delegatedPrompt,
          recipientAgentId: agentId,
          senderAgentId: "luma",
          speechBubble: delegatedPrompt,
        }),
      );
      setRunStateSynced((current) =>
        enqueueAgentJob(current, {
          agentId,
          jobId: `${taskId}-${agentId}`,
          prompt: runtime.prompt,
          queuedAt: new Date().toISOString(),
          taskId,
        }),
      );
      void runSpecialistQueueRef.current(agentId);
    },
    [commitEvent, dispatchQueue, nextTaskEventIndex, setRunStateSynced],
  );

  const queueSynthesis = useCallback(
    (taskId: string) => {
      const runtime = queueStateRef.current.taskRuntimes[taskId];

      if (!runtime || runtime.synthesisQueued) {
        return;
      }

      discardQueuedRuntimeJobsForTask(taskId);
      dispatchQueue({ taskId, type: "enqueueSynthesis" });
      setRunStateSynced((current) =>
        enqueueAgentJob(current, {
          agentId: "luma",
          jobId: `${taskId}-luma-synthesis`,
          prompt: runtime.prompt,
          queuedAt: new Date().toISOString(),
          taskId,
        }),
      );
      void runSynthesisQueueRef.current();
    },
    [discardQueuedRuntimeJobsForTask, dispatchQueue, setRunStateSynced],
  );
  const maybeQueueSynthesis = useCallback(
    (taskId: string) => {
      const runtime = queueStateRef.current.taskRuntimes[taskId];

      if (!runtime || runtime.synthesisQueued || runtime.finalizing) {
        return;
      }

      if (runtime.failedAgentIds.length > 0) {
        const now = new Date().toISOString();
        discardQueuedRuntimeJobsForTask(taskId);
        setRunStateSynced((current) =>
          failQueuedStateJobsForTask(
            updateTask(current, taskId, {
              completedAt: now,
              error: "One or more delegated agent jobs failed.",
              status: "failed",
            }),
            taskId,
            "One or more delegated agent jobs failed.",
            now,
          ),
        );
        return;
      }

      const reviewAgentId = runtime.selectedAgentIds.find(isReviewAgent);
      const primaryAgentIds = runtime.selectedAgentIds.filter((agentId) => agentId !== reviewAgentId);
      const primaryReportsComplete = primaryAgentIds.every((agentId) => runtime.completedAgentIds.includes(agentId));

      if (
        reviewAgentId &&
        primaryReportsComplete &&
        !runtime.queuedAgentIds.includes(reviewAgentId) &&
        !runtime.completedAgentIds.includes(reviewAgentId) &&
        !runtime.failedAgentIds.includes(reviewAgentId)
      ) {
        enqueueSpecialistJob(taskId, reviewAgentId);
        return;
      }

      if (runtime.selectedAgentIds.every((agentId) => runtime.completedAgentIds.includes(agentId))) {
        queueSynthesisRef.current(taskId);
      }
    },
    [discardQueuedRuntimeJobsForTask, enqueueSpecialistJob, setRunStateSynced],
  );
  const runSynthesisQueue = useCallback(async () => {
    const state = queueStateRef.current;

    if (!queuedRunAdapter || state.synthesisActive) {
      return;
    }

    const taskId = state.synthesisQueue[0];
    const runtime = taskId ? state.taskRuntimes[taskId] : undefined;

    if (!taskId || !runtime) {
      return;
    }

    const jobId = `${taskId}-luma-synthesis`;
    const abortController = new AbortController();
    const abortEntry: QueueAbortController = { agentId: "luma", controller: abortController, taskId };
    dispatchQueue({ active: true, type: "setSynthesisActive" });
    dispatchQueue({ finalizing: true, taskId, type: "setTaskFinalizing" });
    queueAbortControllersRef.current.add(abortEntry);
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
    const approvedSynthesisRetry = runtime.approvedRetry?.agentId === "luma" ? runtime.approvedRetry : undefined;
    const options: RunAdapterOptions = {
      previousRun: runtime.previousRun,
      approvalToken: approvedSynthesisRetry?.approvalToken,
      sandboxMode: approvedSynthesisRetry?.sandboxMode ?? runtime.sandboxMode,
      signal: abortController.signal,
      taskId,
      workspacePath: runtime.workspacePath,
    };
    let terminalApproval: AgentEvent | undefined;
    let terminalFailure: AgentEvent | undefined;

    try {
      for await (const event of queuedRunAdapter.synthesizeTask(request, options)) {
        if (abortController.signal.aborted) {
          throw new Error("Run aborted");
        }

        if (event.type === "agent.failed") {
          terminalFailure = event;
        }
      if (event.type === "approval.requested") {
        terminalApproval = event;
        dispatchQueue({ agentId: event.agentId, taskId, type: "setTaskApprovalPending" });
      }

        commitEvent(event, (current) =>
          event.type === "agent.failed"
            ? updateAgentJob(
                updateTask(current, taskId, {
                  completedAt: event.timestamp,
                  error: event.message,
                  status: "failed",
                }),
                jobId,
                {
                  completedAt: event.timestamp,
                  error: event.message,
                  lastMessage: event.message,
                  status: "failed",
                },
              )
            : updateAgentJob(current, jobId, { lastMessage: event.message }),
        );
      }

      if (abortController.signal.aborted) {
        throw new Error("Run aborted");
      }

      if (terminalFailure) {
        return;
      }
      if (terminalApproval) {
        return;
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
      const now = new Date().toISOString();
      commitEvent(createClientEvent(taskId, getRunState().timeline.length + 1, "luma", "agent.failed", message), (current) =>
        updateAgentJob(
          updateTask(current, taskId, {
            completedAt: now,
            error: message,
            status: "failed",
          }),
          jobId,
          {
            completedAt: now,
            error: message,
            lastMessage: message,
            status: "failed",
          },
        ),
      );
    } finally {
      queueAbortControllersRef.current.delete(abortEntry);
      dispatchQueue({ taskId, type: "dequeueSynthesis" });
      dispatchQueue({ finalizing: false, taskId, type: "setTaskFinalizing" });
      dispatchQueue({ active: false, type: "setSynthesisActive" });
      void runSynthesisQueueRef.current();
    }
  }, [commitEvent, dispatchQueue, getRunState, queuedRunAdapter, setRunStateSynced]);
  const runSpecialistQueue = useCallback(
    async (agentId: SpecialistAgentId) => {
      const state = queueStateRef.current;

      if (!queuedRunAdapter || state.activeSpecialists[agentId]) {
        return;
      }

      const job = state.specialistQueues[agentId][0];

      if (!job) {
        return;
      }

      const jobId = `${job.taskId}-${agentId}`;
      const task = getRunState().tasks.find((candidate) => candidate.taskId === job.taskId);

      if (task?.status === "failed" || task?.status === "done") {
        dispatchQueue({ agentId, job, type: "dequeueSpecialist" });
        setRunStateSynced((current) =>
          updateAgentJob(current, jobId, {
            completedAt: new Date().toISOString(),
            error: `Task already ${task.status}`,
            lastMessage: `Task already ${task.status}`,
            status: "failed",
          }),
        );
        void runSpecialistQueueRef.current(agentId);
        return;
      }

      const abortController = new AbortController();
      const abortEntry: QueueAbortController = { agentId, controller: abortController, taskId: job.taskId };
      let report: string | undefined;
      let terminalApproval: AgentEvent | undefined;
      let terminalFailure: AgentEvent | undefined;
      dispatchQueue({ active: true, agentId, type: "setSpecialistActive" });
      queueAbortControllersRef.current.add(abortEntry);
      setRunStateSynced((current) =>
        updateAgentJob(updateTask(current, job.taskId, { status: "running" }), jobId, {
          lastMessage: `${agentDisplayName(agentId)} is working`,
          startedAt: new Date().toISOString(),
          status: "running",
        }),
      );

      try {
        const runtime = queueStateRef.current.taskRuntimes[job.taskId];
        const approvedSpecialistRetry = runtime?.approvedRetry?.agentId === agentId ? runtime.approvedRetry : undefined;

        for await (const event of queuedRunAdapter.startAgentJob(job, {
          approvalToken: approvedSpecialistRetry?.approvalToken,
          previousRun: runtime?.previousRun,
          sandboxMode: approvedSpecialistRetry?.sandboxMode ?? runtime?.sandboxMode,
          signal: abortController.signal,
          taskId: job.taskId,
          workspacePath: runtime?.workspacePath,
        })) {
          if (abortController.signal.aborted) {
            throw new Error("Run aborted");
          }

          const payload = event.payload as Record<string, unknown> | undefined;

          if (event.type === "agent.reporting" && typeof payload?.report === "string") {
            report = payload.report;
            dispatchQueue({ agentId, report: payload.report, taskId: job.taskId, type: "recordReport" });
          }

          if (event.type === "agent.failed") {
            terminalFailure = event;
            discardQueuedRuntimeJobsForTask(job.taskId, job);
          }
          if (event.type === "approval.requested") {
            terminalApproval = event;
            discardQueuedRuntimeJobsForTask(job.taskId, job);
            const pausedAgentIds = abortActiveSiblingJobsForTask(job.taskId, event.agentId);
            dispatchQueue({ agentId: event.agentId, pausedAgentIds, taskId: job.taskId, type: "setTaskApprovalPending" });
          }

          commitEvent(event, (current) =>
            event.type === "agent.failed"
              ? failQueuedStateJobsForTask(
                  updateAgentJob(
                    updateTask(
                      event.agentId === agentId
                        ? current
                        : {
                            ...current,
                            agents: {
                              ...current.agents,
                              [agentId]: {
                                ...current.agents[agentId],
                                lastMessage: event.message,
                                status: "failed",
                              },
                            },
                          },
                      job.taskId,
                      {
                        completedAt: event.timestamp,
                        error: event.message,
                        status: "failed",
                      },
                    ),
                    jobId,
                    {
                      completedAt: event.timestamp,
                      error: event.message,
                      lastMessage: event.message,
                      output: report,
                      status: "failed",
                    },
                  ),
                  job.taskId,
                  event.message,
                  event.timestamp,
                  jobId,
                )
              : updateAgentJob(current, jobId, {
                  lastMessage: event.message,
                  output: report,
                }),
          );
        }

        if (abortController.signal.aborted) {
          throw new Error("Run aborted");
        }

        if (terminalFailure) {
          dispatchQueue({ agentId, taskId: job.taskId, type: "agentFailed" });
          return;
        }
        if (terminalApproval) {
          return;
        }

        dispatchQueue({ agentId, taskId: job.taskId, type: "agentCompleted" });
        setRunStateSynced((current) =>
          updateAgentJob(current, jobId, {
            completedAt: new Date().toISOString(),
            lastMessage: report ?? "Agent job complete",
            output: report,
            status: "done",
          }),
        );
        maybeQueueSynthesisRef.current(job.taskId);
      } catch (error) {
        const message = messageFromError(error);
        const now = new Date().toISOString();
        const runtime = queueStateRef.current.taskRuntimes[job.taskId];

        if (abortController.signal.aborted && runtime?.approvalPausedAgentIds.includes(agentId)) {
          dispatchQueue({ agentId, taskId: job.taskId, type: "clearTaskApprovalPausedAgent" });
          commitEvent(
            createClientEvent(
              job.taskId,
              getRunState().timeline.length + 1,
              agentId,
              "agent.paused",
              `${agentDisplayName(agentId)} paused while another agent waits for approval`,
            ),
            (current) =>
              updateAgentJob(current, jobId, {
                lastMessage: "Paused while another agent waits for approval",
                status: "queued",
              }),
          );
          return;
        }

        dispatchQueue({ agentId, taskId: job.taskId, type: "agentFailed" });
        discardQueuedRuntimeJobsForTask(job.taskId, job);
        commitEvent(createClientEvent(job.taskId, getRunState().timeline.length + 1, agentId, "agent.failed", message), (current) =>
          failQueuedStateJobsForTask(
            updateAgentJob(
              updateTask(current, job.taskId, {
                completedAt: now,
                error: message,
                status: "failed",
              }),
              jobId,
              {
                completedAt: now,
                error: message,
                lastMessage: message,
                status: "failed",
              },
            ),
            job.taskId,
            message,
            now,
            jobId,
          ),
        );
      } finally {
        queueAbortControllersRef.current.delete(abortEntry);
        dispatchQueue({ agentId, job, type: "dequeueSpecialist" });
        dispatchQueue({ active: false, agentId, type: "setSpecialistActive" });
        void runSpecialistQueueRef.current(agentId);
      }
    },
    [
      abortActiveSiblingJobsForTask,
      commitEvent,
      discardQueuedRuntimeJobsForTask,
      dispatchQueue,
      getRunState,
      queuedRunAdapter,
      setRunStateSynced,
    ],
  );
  const approveQueuedRequest = useCallback(
    (taskId: string, agentId: AgentId, sandboxMode: RunAdapterOptions["sandboxMode"], approvalToken?: string) => {
      const runtime = queueStateRef.current.taskRuntimes[taskId];

      if (!runtime || !sandboxMode) {
        return false;
      }

      if (runtime.approvedRetry?.agentId === agentId) {
        return true;
      }

      dispatchQueue({ agentId, approvalToken, sandboxMode, taskId, type: "setTaskApproval" });

      if (agentId === "luma") {
        dispatchQueue({ taskId, type: "retrySynthesis" });
        setRunStateSynced((current) =>
          updateAgentJob(updateTask(current, taskId, { status: "synthesizing" }), `${taskId}-luma-synthesis`, {
            lastMessage: "Approved retry queued",
            status: "queued",
          }),
        );
        void runSynthesisQueueRef.current();
        return true;
      }

      if (!runtime.selectedAgentIds.includes(agentId)) {
        return false;
      }

      const reviewAgentId = runtime.selectedAgentIds.find(isReviewAgent);
      const primaryAgentIds = runtime.selectedAgentIds.filter((candidateAgentId) => candidateAgentId !== reviewAgentId);
      const primaryReportsComplete = primaryAgentIds.every((candidateAgentId) =>
        runtime.completedAgentIds.includes(candidateAgentId),
      );
      const retryAgentIds = runtime.selectedAgentIds.filter((candidateAgentId) => {
        if (runtime.completedAgentIds.includes(candidateAgentId) || runtime.failedAgentIds.includes(candidateAgentId)) {
          return false;
        }

        return !isReviewAgent(candidateAgentId) || (candidateAgentId === agentId && primaryReportsComplete);
      });

      for (const specialistId of retryAgentIds) {
        dispatchQueue({
          agentId: specialistId,
          job: createSpecialistJob(runtime, specialistId),
          taskId,
          type: "retrySpecialist",
        });
      }
      setRunStateSynced((current) =>
        retryAgentIds.reduce(
          (next, specialistId) =>
            updateAgentJob(next, `${taskId}-${specialistId}`, {
              lastMessage: "Approved retry queued",
              status: "queued",
            }),
          updateTask(current, taskId, { status: "running" }),
        ),
      );
      for (const specialistId of retryAgentIds) {
        void runSpecialistQueueRef.current(specialistId);
      }
      return true;
    },
    [dispatchQueue, setRunStateSynced],
  );
  useEffect(() => {
    queueSynthesisRef.current = queueSynthesis;
    maybeQueueSynthesisRef.current = maybeQueueSynthesis;
    runSynthesisQueueRef.current = runSynthesisQueue;
    runSpecialistQueueRef.current = runSpecialistQueue;
  }, [maybeQueueSynthesis, queueSynthesis, runSpecialistQueue, runSynthesisQueue]);

  const queueRun = useCallback(
    (prompt: string) => {
      if (!queuedRunAdapter) {
        return false;
      }

      const taskId = createQueuedTaskId(prompt);
      const createdAt = new Date().toISOString();
      const routePlan = planRoute(prompt, AGENTS);
      const selectedAgentIds = routePlan.selectedAgentIds;
      const skippedAgentIds = routePlan.skippedAgentIds;
      dispatchQueue({
        runtime: {
          completedAgentIds: [],
          failedAgentIds: [],
          finalizing: false,
          approvalPausedAgentIds: [],
          previousRun: getPreviousRun() ?? undefined,
          prompt,
          queuedAgentIds: [],
          reports: {},
          sandboxMode: getSandboxMode(),
          selectedAgentIds,
          skippedAgentIds,
          synthesisQueued: false,
          taskId,
          workspacePath: getWorkspacePath(),
        },
        type: "registerTask",
      });
      onRunEpoch();
      setRunStateSynced((current) =>
        enqueueTask(current, {
          createdAt,
          prompt,
          selectedAgentIds,
          skippedAgentIds,
          taskId,
          workspacePath: getWorkspacePath(),
        }),
      );

      commitEvent(createClientEvent(taskId, 1, "luma", "task.created", prompt));
      commitEvent(createClientEvent(taskId, 2, "luma", "agent.planning", "Luma is arranging the reading lamps"));
      commitEvent(createClientEvent(taskId, 3, "luma", "route.planned", "Luma selected a specialist route", routePlan));
      setRunStateSynced((current) => updateTask(current, taskId, { status: "queued" }));

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

      const reviewAgentId = selectedAgentIds.find(isReviewAgent);
      const initialAgentIds =
        reviewAgentId && selectedAgentIds.some((agentId) => agentId !== reviewAgentId)
          ? selectedAgentIds.filter((agentId) => agentId !== reviewAgentId)
          : selectedAgentIds;

      initialAgentIds.forEach((agentId) => enqueueSpecialistJob(taskId, agentId));

      if (selectedAgentIds.length === 0) {
        queueSynthesisRef.current(taskId);
      }

      return true;
    },
    [
      commitEvent,
      createQueuedTaskId,
      dispatchQueue,
      enqueueSpecialistJob,
      getPreviousRun,
      getSandboxMode,
      getWorkspacePath,
      onRunEpoch,
      queuedRunAdapter,
      setRunStateSynced,
    ],
  );

  const stopQueuedRuns = useCallback(() => {
    for (const entry of queueAbortControllersRef.current) {
      entry.controller.abort();
    }
    dispatchQueue({ type: "clearPendingWork" });
  }, [dispatchQueue]);

  return {
    approveQueuedRequest,
    queueRun,
    queueState,
    stopQueuedRuns,
  };
}
