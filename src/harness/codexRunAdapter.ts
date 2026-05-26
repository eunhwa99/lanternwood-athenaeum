import type { AgentEvent } from "../events/types";
import type { RunAdapter } from "./runAdapter";

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

  return data.length > 0 ? (JSON.parse(data) as AgentEvent) : null;
}

export function createCodexRunAdapter({ endpoint = "/api/runs", fetchImpl = fetch }: CodexRunAdapterOptions = {}): RunAdapter {
  return {
    async *startRun(input: string) {
      const response = await fetchImpl(endpoint, {
        body: JSON.stringify({ input }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok || !response.body) {
        throw new Error(`Codex CLI run failed: ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseMessages(buffer);
        buffer = parsed.remaining;

        for (const message of parsed.messages) {
          const event = parseAgentEvent(message);
          if (event) {
            yield event;
          }
        }
      }

      buffer += decoder.decode();
      const finalParsed = parseSseMessages(buffer);
      for (const message of [...finalParsed.messages, finalParsed.remaining].filter(Boolean)) {
        const event = parseAgentEvent(message);
        if (event) {
          yield event;
        }
      }
    },
  };
}
