import type { AgentEvent } from "../events/types";
import { validateAgentEvent } from "../events/validation";
import type { AgentJobRequest, RunAdapter, RunAdapterOptions, SynthesisTaskRequest } from "./runAdapter";

type CodexRunAdapterOptions = {
  agentJobEndpoint?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  synthesisEndpoint?: string;
};

function parseSseMessages(buffer: string): { messages: string[]; remaining: string } {
  const parts = buffer.split("\n\n");
  const remaining = parts.pop() ?? "";

  return {
    messages: parts,
    remaining,
  };
}

function parseAgentEvent(message: string): AgentEvent | null {
  const data = message
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");

  if (data.length === 0) {
    return null;
  }

  try {
    return validateAgentEvent(JSON.parse(data), "Invalid AgentEvent from Codex SSE");
  } catch {
    throw new Error("Invalid AgentEvent from Codex SSE");
  }
}

function endpointSibling(endpoint: string, sibling: string) {
  return endpoint.endsWith("/runs") ? `${endpoint.slice(0, -"/runs".length)}/${sibling}` : `/${sibling}`;
}

async function* streamEvents(
  fetchImpl: typeof fetch,
  endpoint: string,
  body: Record<string, unknown>,
  options: RunAdapterOptions,
  isTerminalEvent: (event: AgentEvent) => boolean,
) {
  const response = await fetchImpl(endpoint, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const responseText = await response.text();
    const routeHint =
      response.status === 404
        ? ` Endpoint ${endpoint} was not found. Restart the Codex API server so it picks up the queue endpoints.`
        : "";

    throw new Error(`Codex CLI run failed (${response.status} ${response.statusText || "error"} at ${endpoint}): ${responseText}${routeHint}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminalEvent = false;

  const abort = () => {
    void reader.cancel();
  };

  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    while (true) {
      if (options.signal?.aborted) {
        throw new Error("Run aborted");
      }

      const { done, value } = await reader.read();

      if (options.signal?.aborted) {
        throw new Error("Run aborted");
      }

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseMessages(buffer);
      buffer = parsed.remaining;

      for (const message of parsed.messages) {
        const event = parseAgentEvent(message);
        if (event) {
          sawTerminalEvent ||= isTerminalEvent(event);
          yield event;
        }
      }
    }

    buffer += decoder.decode();
    const finalParsed = parseSseMessages(buffer);
    if (finalParsed.remaining.trim()) {
      throw new Error("Codex SSE stream ended with incomplete event");
    }

    for (const message of finalParsed.messages.filter(Boolean)) {
      const event = parseAgentEvent(message);
      if (event) {
        sawTerminalEvent ||= isTerminalEvent(event);
        yield event;
      }
    }

    if (!sawTerminalEvent) {
      throw new Error("Codex SSE stream ended before terminal event");
    }
  } finally {
    options.signal?.removeEventListener("abort", abort);
    try {
      await reader.cancel();
    } catch {
      // Reader may already be closed after a normal stream completion.
    }
  }
}

export function createCodexRunAdapter({
  agentJobEndpoint,
  endpoint = "/api/runs",
  fetchImpl = fetch,
  synthesisEndpoint,
}: CodexRunAdapterOptions = {}): RunAdapter {
  const resolvedAgentJobEndpoint = agentJobEndpoint ?? endpointSibling(endpoint, "agent-jobs");
  const resolvedSynthesisEndpoint = synthesisEndpoint ?? endpointSibling(endpoint, "synthesis");

  return {
    async *startRun(input: string, options: RunAdapterOptions = {}) {
      yield* streamEvents(
        fetchImpl,
        endpoint,
        { input, ...(options.previousRun ? { previousRun: options.previousRun } : {}) },
        options,
        (event) => event.agentId === "luma" && (event.type === "agent.done" || event.type === "agent.failed"),
      );
    },

    async *startAgentJob(job: AgentJobRequest, options: RunAdapterOptions = {}) {
      yield* streamEvents(
        fetchImpl,
        resolvedAgentJobEndpoint,
        {
          agentId: job.agentId,
          delegatedPrompt: job.delegatedPrompt,
          input: job.prompt,
          ...(options.previousRun ? { previousRun: options.previousRun } : {}),
          selectedAgentIds: job.selectedAgentIds,
          skippedAgentIds: job.skippedAgentIds,
          taskId: job.taskId,
        },
        options,
        (event) => event.agentId === job.agentId && (event.type === "agent.reporting" || event.type === "agent.failed"),
      );
    },

    async *synthesizeTask(task: SynthesisTaskRequest, options: RunAdapterOptions = {}) {
      yield* streamEvents(
        fetchImpl,
        resolvedSynthesisEndpoint,
        {
          input: task.prompt,
          ...(options.previousRun ? { previousRun: options.previousRun } : {}),
          reports: task.reports,
          selectedAgentIds: task.selectedAgentIds,
          skippedAgentIds: task.skippedAgentIds,
          taskId: task.taskId,
        },
        options,
        (event) => event.agentId === "luma" && (event.type === "agent.done" || event.type === "agent.failed"),
      );
    },
  };
}
