import type { AgentEvent } from "../events/types";
import { validateAgentEvent } from "../events/validation";
import type { RunAdapter, RunAdapterOptions } from "./runAdapter";

type CodexRunAdapterOptions = {
  endpoint?: string;
  fetchImpl?: typeof fetch;
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

export function createCodexRunAdapter({ endpoint = "/api/runs", fetchImpl = fetch }: CodexRunAdapterOptions = {}): RunAdapter {
  return {
    async *startRun(input: string, options: RunAdapterOptions = {}) {
      const response = await fetchImpl(endpoint, {
        body: JSON.stringify({ input, ...(options.previousRun ? { previousRun: options.previousRun } : {}) }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: options.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Codex CLI run failed: ${await response.text()}`);
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
              sawTerminalEvent ||= event.agentId === "luma" && (event.type === "agent.done" || event.type === "agent.failed");
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
            sawTerminalEvent ||= event.agentId === "luma" && (event.type === "agent.done" || event.type === "agent.failed");
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
    },
  };
}
