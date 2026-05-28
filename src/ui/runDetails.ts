import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import { taskLabelFor } from "../events/taskLabels";
import type { AgentEvent, RunState } from "../events/types";

export type RunDetailsTab = "routing" | "reports" | "prompts" | "workload" | "log";

export type AgentReportDetail = {
  agentId: AgentId;
  displayName: string;
  eventId: string;
  report: string;
  taskId: string;
  taskLabel: string;
  taskPrompt: string;
};

export type PromptDetail = {
  prompt: string;
  promptExcerpt: string;
  recipientAgentId: AgentId;
  recipientName: string;
  senderAgentId: AgentId;
  senderName: string;
  speechBubble: string;
  taskId: string;
  taskLabel: string;
  taskPrompt: string;
};

export type RawCodexDetail = {
  agentId: AgentId;
  displayName: string;
  rawResponse: string;
};

export type RoutingDetail = {
  selectedAgentIds: AgentId[];
  selectedNames: string[];
  skippedAgentIds: AgentId[];
  skippedNames: string[];
  rationale: string;
  confidence: "low" | "medium" | "high";
  taskId: string;
  taskLabel: string;
  taskPrompt: string;
};

export type RunDetails = {
  agentReports: AgentReportDetail[];
  finalOutput: string | null;
  prompts: PromptDetail[];
  rawCodex: string;
  rawCodexByAgent: RawCodexDetail[];
  runLog: string[];
  routing: RoutingDetail[];
  selectedTaskLabel?: string;
};

function agentDisplayName(agentId: AgentId) {
  return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
}

function stringPayload(event: AgentEvent, key: string): string | undefined {
  const payload = event.payload as Record<string, unknown> | undefined;
  const value = payload?.[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function rawStringPayload(event: AgentEvent, key: string): string | undefined {
  const payload = event.payload as Record<string, unknown> | undefined;
  const value = payload?.[key];

  return typeof value === "string" ? value : undefined;
}

export function sanitizeRawOutput(raw: string, maxLength = 4_000): string {
  const normalizedRaw = raw.replace(/\\\//g, "/");
  const secretKey = /(?:api[\s_-]*key|secret[\s_-]*key|token|secret|password|authorization|bearer)/i;
  const redactedSecretPairs = normalizedRaw.replace(
    /(["']?)([A-Z0-9_\s-]*(?:api[\s_-]*key|secret[\s_-]*key|token|secret|password|authorization|bearer)[A-Z0-9_\s-]*)\1\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\n\r,}\]]+)/gi,
    (match, _quote: string, key: string) => (secretKey.test(key) ? "[redacted-secret]" : match),
  );
  const redacted = redactedSecretPairs
    .replace(/\/Users\/[^"'\n\r`]+/g, "[redacted-path]")
    .replace(/\/home\/[^"'\n\r`]+/g, "[redacted-path]")
    .replace(/\/private\/[^"'\n\r`]+/g, "[redacted-path]")
    .replace(/~\/[^"'\n\r`]+/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\Users\\[^"'\n\r`]+/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\\\Users\\\\[^"'\n\r`]+/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\[^"'\n\r`]+/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\\\[^"'\n\r`]+/g, "[redacted-path]")
    .replace(/\bghp_[A-Za-z0-9_]{20,}\b/g, "[redacted-secret]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted-secret]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted-secret]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/+-]+/g, "[redacted-secret]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-secret]")
    .replace(/\bASIA[0-9A-Z]{16}\b/g, "[redacted-secret]")
    .replace(/\bsk_(?:live|test)_[A-Za-z0-9]{12,}\b/g, "[redacted-secret]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted-secret]")
    .replace(/\bglpat-[0-9A-Za-z_-]{20,}\b/g, "[redacted-secret]")
    .replace(/\bnpm_[0-9A-Za-z]{20,}\b/g, "[redacted-secret]")
    .replace(/\bhf_[0-9A-Za-z]{20,}\b/g, "[redacted-secret]")
    .replace(/\bauthorization\b\s*[:=]\s*bearer\s+[^\n\r]+/gi, "[redacted-secret]")
    .replace(/\bbearer\s+[^\n\r]+/gi, "[redacted-secret]")
    .replace(/\bauthorization\b\s*[:=]\s*bearer\s+[^"'\s]+/gi, "[redacted-secret]")
    .replace(/["']?\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\b["']?\s*[:=]\s*"[^"]*"/gi, "[redacted-secret]")
    .replace(/["']?\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\b["']?\s*[:=]\s*'[^']*'/gi, "[redacted-secret]")
    .replace(/["']?\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\b["']?\s*[:=]\s*["']?[^"',}\]\s]+["']?/gi, "[redacted-secret]")
    .replace(/\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\b\s*[:=]\s*["']?[^"'\s]+/gi, "[redacted-secret]")
    .replace(/\bbearer\s+[A-Za-z0-9._-]+/gi, "[redacted-secret]")
    .replace(/\b(?:sk|rk|pk|ak)-[A-Za-z0-9._-]{12,}/g, "[redacted-secret]")
    .replace(/\b(?:api[_-]?key|token|secret|password|authorization|bearer)\b\s*[:=]\s*["']?[^"'\s]+/gi, "[redacted-secret]");

  if (redacted.length <= maxLength) {
    return redacted;
  }

  const remaining = redacted.length - maxLength;

  return `${redacted.slice(0, maxLength)}[truncated ${remaining} chars]`;
}

export function previewText(value: string | null | undefined, maxLength = 180): string {
  const text = value?.trim();

  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function createRunDetails(state: RunState, selectedTaskId?: string): RunDetails {
  let rawStream = "";
  const finalRawParts: string[] = [];
  const rawByAgent = new Map<AgentId, string>();
  const agentReports: AgentReportDetail[] = [];
  const prompts: PromptDetail[] = [];
  const routing: RoutingDetail[] = [];
  const runLog: string[] = [];
  const events = selectedTaskId ? state.timeline.filter((event) => event.taskId === selectedTaskId) : state.timeline;
  const selectedTask = selectedTaskId ? state.tasks.find((task) => task.taskId === selectedTaskId) : undefined;
  const scopedTasks = selectedTaskId ? state.tasks.filter((task) => task.taskId === selectedTaskId) : state.tasks;

  function eventTaskMeta(event: AgentEvent) {
    return {
      taskId: event.taskId,
      taskLabel: taskLabelFor(state.tasks, event.taskId),
      taskPrompt: state.tasks.find((task) => task.taskId === event.taskId)?.prompt ?? event.message,
    };
  }

  function logPrefix(event: AgentEvent) {
    return `${taskLabelFor(state.tasks, event.taskId)} ·`;
  }

  function appendRawForAgent(agentId: AgentId, chunk: string) {
    rawByAgent.set(agentId, `${rawByAgent.get(agentId) ?? ""}${chunk}`);
  }

  for (const event of events) {
    const rawChunk = rawStringPayload(event, "rawChunk");
    const stderrChunk = rawStringPayload(event, "stderrChunk");
    const payload = event.payload as Record<string, unknown> | undefined;
    const rawResponse = typeof payload?.rawResponse === "string" ? payload.rawResponse : undefined;
    const report = stringPayload(event, "report");
    const speechBubble = stringPayload(event, "speechBubble");

    if (rawChunk) {
      rawStream += rawChunk;
      appendRawForAgent(event.agentId, rawChunk);
    }

    if (stderrChunk) {
      rawStream += stderrChunk;
      appendRawForAgent(event.agentId, stderrChunk);
    }

    if (rawResponse) {
      const displayName = agentDisplayName(event.agentId);
      finalRawParts.push(`--- ${displayName} final response ---\n${rawResponse}`);
      appendRawForAgent(
        event.agentId,
        `${rawByAgent.has(event.agentId) ? "\n" : ""}--- ${displayName} final response ---\n${rawResponse}`,
      );
    }

    if (event.type !== "agent.prompted" && event.type !== "route.planned" && !report && event.type !== "permission.reviewed") {
      const payloadProgress = stringPayload(event, "progress");
      runLog.push(`${logPrefix(event)} ${agentDisplayName(event.agentId)} ${event.type}: ${payloadProgress ?? event.message}`);
    }

    if (event.type === "route.planned" && event.payload) {
      const selectedNames = event.payload.selectedAgentIds.map(agentDisplayName);
      const skippedNames = event.payload.skippedAgentIds.map(agentDisplayName);
      routing.push({
        confidence: event.payload.confidence,
        rationale: event.payload.rationale,
        selectedAgentIds: event.payload.selectedAgentIds,
        selectedNames,
        skippedAgentIds: event.payload.skippedAgentIds,
        skippedNames,
        ...eventTaskMeta(event),
      });
      runLog.push(
        `${logPrefix(event)} Routing Decision: selected ${selectedNames.join(", ") || "none"}; skipped ${skippedNames.join(", ") || "none"}; confidence ${event.payload.confidence}; reason ${event.payload.rationale}`,
      );
    }

    if (event.type === "agent.prompted" && event.payload) {
      prompts.push({
        prompt: event.payload.prompt,
        promptExcerpt: event.payload.promptExcerpt,
        recipientAgentId: event.payload.recipientAgentId,
        recipientName: agentDisplayName(event.payload.recipientAgentId),
        senderAgentId: event.payload.senderAgentId,
        senderName: agentDisplayName(event.payload.senderAgentId),
        speechBubble: event.payload.speechBubble,
        ...eventTaskMeta(event),
      });
      runLog.push(`${logPrefix(event)} ${agentDisplayName(event.payload.senderAgentId)} -> ${agentDisplayName(event.payload.recipientAgentId)}: ${event.payload.prompt}`);
    }

    if (report) {
      agentReports.push({
        agentId: event.agentId,
        displayName: agentDisplayName(event.agentId),
        eventId: event.eventId,
        report,
        ...eventTaskMeta(event),
      });
      runLog.push(`${logPrefix(event)} ${agentDisplayName(event.agentId)} report: ${speechBubble ?? report}`);
    }

    if (event.type === "permission.reviewed" && event.payload) {
      runLog.push(`${logPrefix(event)} Coordinator ${event.payload.decision}: ${event.payload.action} (${event.payload.reason})`);
    }
  }

  for (const task of scopedTasks) {
    const finalOutput = state.finalOutputs[task.taskId] ?? task.finalOutput;

    if (!finalOutput) {
      continue;
    }

    agentReports.push({
      agentId: "luma",
      displayName: agentDisplayName("luma"),
      eventId: `${task.taskId}-luma-final-output`,
      report: finalOutput,
      taskId: task.taskId,
      taskLabel: taskLabelFor(state.tasks, task.taskId),
      taskPrompt: task.prompt,
    });
  }

  return {
    agentReports,
    finalOutput: selectedTaskId ? (state.finalOutputs[selectedTaskId] ?? selectedTask?.finalOutput ?? null) : state.finalOutput,
    prompts,
    rawCodex: sanitizeRawOutput([rawStream, ...finalRawParts].filter(Boolean).join("\n")),
    rawCodexByAgent: Array.from(rawByAgent.entries()).map(([agentId, rawResponse]) => ({
      agentId,
      displayName: agentDisplayName(agentId),
      rawResponse: sanitizeRawOutput(rawResponse),
    })),
    runLog,
    routing,
    selectedTaskLabel: selectedTask ? taskLabelFor(state.tasks, selectedTask.taskId) : undefined,
  };
}
