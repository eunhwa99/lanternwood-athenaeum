import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import type { AgentEvent, RunState } from "../events/types";

export type RunDetailsTab = "final" | "reports" | "prompts" | "raw" | "log";

export type AgentReportDetail = {
  agentId: AgentId;
  displayName: string;
  report: string;
};

export type PromptDetail = {
  prompt: string;
  promptExcerpt: string;
  recipientAgentId: AgentId;
  recipientName: string;
  senderAgentId: AgentId;
  senderName: string;
  speechBubble: string;
};

export type RawCodexDetail = {
  agentId: AgentId;
  displayName: string;
  rawResponse: string;
};

export type RunDetails = {
  agentReports: AgentReportDetail[];
  finalOutput: string | null;
  prompts: PromptDetail[];
  rawCodex: string;
  rawCodexByAgent: RawCodexDetail[];
  runLog: string[];
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

export function createRunDetails(state: RunState): RunDetails {
  let rawStream = "";
  const finalRawParts: string[] = [];
  const rawByAgent = new Map<AgentId, string>();
  const agentReports: AgentReportDetail[] = [];
  const prompts: PromptDetail[] = [];
  const runLog: string[] = [];

  function appendRawForAgent(agentId: AgentId, chunk: string) {
    rawByAgent.set(agentId, `${rawByAgent.get(agentId) ?? ""}${chunk}`);
  }

  for (const event of state.timeline) {
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

    if (event.type !== "agent.prompted" && !report && event.type !== "permission.reviewed") {
      const payloadProgress = stringPayload(event, "progress");
      runLog.push(`${agentDisplayName(event.agentId)} ${event.type}: ${payloadProgress ?? event.message}`);
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
      });
      runLog.push(`${agentDisplayName(event.payload.senderAgentId)} -> ${agentDisplayName(event.payload.recipientAgentId)}: ${event.payload.prompt}`);
    }

    if (report) {
      agentReports.push({
        agentId: event.agentId,
        displayName: agentDisplayName(event.agentId),
        report,
      });
      runLog.push(`${agentDisplayName(event.agentId)} report: ${speechBubble ?? report}`);
    }

    if (event.type === "permission.reviewed" && event.payload) {
      runLog.push(`Coordinator ${event.payload.decision}: ${event.payload.action} (${event.payload.reason})`);
    }
  }

  return {
    agentReports,
    finalOutput: state.finalOutput,
    prompts,
    rawCodex: sanitizeRawOutput([rawStream, ...finalRawParts].filter(Boolean).join("\n")),
    rawCodexByAgent: Array.from(rawByAgent.entries()).map(([agentId, rawResponse]) => ({
      agentId,
      displayName: agentDisplayName(agentId),
      rawResponse: sanitizeRawOutput(rawResponse),
    })),
    runLog,
  };
}
