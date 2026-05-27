import { describe, expect, it } from "vitest";
import type { AgentEvent, RunState } from "../events/types";
import { createRunDetails, sanitizeRawOutput } from "./runDetails";

const baseEvent = {
  taskId: "task-1",
  timestamp: "2026-05-26T00:00:00.000Z",
} satisfies Pick<AgentEvent, "taskId" | "timestamp">;

function stateWith(events: AgentEvent[], finalOutput: string | null = null): RunState {
  return {
    agents: {
      argus: { definition: {} as never, lastMessage: "", status: "idle" },
      luma: { definition: {} as never, lastMessage: "", status: "idle" },
      neria: { definition: {} as never, lastMessage: "", status: "idle" },
      orion: { definition: {} as never, lastMessage: "", status: "idle" },
      quill: { definition: {} as never, lastMessage: "", status: "idle" },
    },
    currentTask: { prompt: "Prompt", taskId: "task-1" },
    finalOutput,
    timeline: events,
  };
}

describe("run details", () => {
  it("redacts home-like paths and truncates long raw output", () => {
    const raw = `/Users/eunhwa/private project/.env\n/home/eunhwa/project/.env\n/private/var/folders/secret/.env\n\\/Users\\/eunhwa\\/.ssh\\/id_rsa\n\\/home\\/eunhwa\\/.aws\\/credentials\n\\/private\\/var\\/folders\\/secret\n~/secret/file\nC:\\Users\\eunhwa\\private\\.env\nC:\\\\Users\\\\eunhwa\\\\private\\\\.env\nD:\\work\\project\\.env\nD:\\\\work\\\\project\\\\.env\nAuthorization: Bearer hunter two\nsecret key: hunter two\nOPENAI_API_KEY=sk-live-secret-value\nBearer sk-standalone-secret-value\nghp_123456789012345678901234567890123456\nxoxb-1234567890-abcdefghi\nhttps://hooks.slack.com/services/T000/B000/abcdef\nhttps:\\/\\/hooks.slack.com\\/services\\/T000\\/B000\\/escaped\nAKIA1234567890ABCDEF\nsk_live_1234567890abcdefghijklmnop\nAIza1234567890abcdefghijklmnop\nglpat-1234567890abcdefghijklmnop\nnpm_1234567890abcdefghijklmnop\nhf_1234567890abcdefghijklmnop\n{"password":"hunter two","token":"plain token","authorization":"Bearer hunter two","bearer":"alpha beta gamma","Bearer":"sk-1234567890123456 extra","api key":"secret value","secret key":"hunter two","OPENAI API KEY":"sk spaced value"}\n${"x".repeat(4_050)}`;
    const sanitized = sanitizeRawOutput(raw, 4_000);

    expect(sanitized).toContain("[redacted-path]");
    expect(sanitized).not.toContain("/Users/eunhwa/private");
    expect(sanitized).not.toContain("/home/eunhwa/project");
    expect(sanitized).not.toContain("/private/var/folders");
    expect(sanitized).not.toContain("/Users/eunhwa/.ssh");
    expect(sanitized).not.toContain("/home/eunhwa/.aws");
    expect(sanitized).not.toContain("/private/var");
    expect(sanitized).not.toContain("C:\\Users\\eunhwa");
    expect(sanitized).not.toContain("C:\\\\Users\\\\eunhwa");
    expect(sanitized).not.toContain("D:\\work");
    expect(sanitized).not.toContain("D:\\\\work");
    expect(sanitized).not.toContain("sk-live-secret-value");
    expect(sanitized).not.toContain("sk-standalone-secret-value");
    expect(sanitized).not.toContain("hunter two");
    expect(sanitized).not.toContain("plain token");
    expect(sanitized).not.toContain("secret value");
    expect(sanitized).not.toContain("sk spaced value");
    expect(sanitized).not.toContain("alpha beta gamma");
    expect(sanitized).not.toContain("sk-1234567890123456 extra");
    expect(sanitized).not.toContain("ghp_");
    expect(sanitized).not.toContain("xoxb-");
    expect(sanitized).not.toContain("hooks.slack.com");
    expect(sanitized).not.toContain("AKIA");
    expect(sanitized).not.toContain("sk_live_");
    expect(sanitized).not.toContain("AIza");
    expect(sanitized).not.toContain("glpat-");
    expect(sanitized).not.toContain("npm_");
    expect(sanitized).not.toContain("hf_");
    expect(sanitized).not.toContain("Bearer hunter two");
    expect(sanitized).not.toContain(" two");
    expect(sanitized).toContain("[redacted-secret]");
    expect(sanitized).toMatch(/\[truncated \d+ chars\]$/);
  });

  it("extracts prompts, reports, raw output, and durable run log entries", () => {
    const details = createRunDetails(
      stateWith(
        [
          {
            ...baseEvent,
            agentId: "luma",
            eventId: "evt-1",
            message: "Luma prompts Orion",
            payload: {
              prompt: "Research this",
              promptExcerpt: "Research this",
              recipientAgentId: "orion",
              senderAgentId: "luma",
              speechBubble: "Research this",
            },
            type: "agent.prompted",
          },
          {
            ...baseEvent,
            agentId: "orion",
            eventId: "evt-2",
            message: "Orion reports",
            payload: {
              rawResponse: "Raw /Users/eunhwa/secret/output",
              report: "Research report",
              speechBubble: "Research report",
            },
            type: "agent.reporting",
          },
        ],
        "Final answer",
      ),
    );

    expect(details.finalOutput).toBe("Final answer");
    expect(details.prompts[0]).toMatchObject({ prompt: "Research this", recipientAgentId: "orion" });
    expect(details.agentReports[0]).toMatchObject({ agentId: "orion", report: "Research report" });
    expect(details.rawCodex).toContain("[redacted-path]");
    expect(details.rawCodexByAgent[0]).toMatchObject({ agentId: "orion", rawResponse: expect.stringContaining("[redacted-path]") });
    expect(details.runLog).toEqual([
      "Luma -> Orion: Research this",
      "Orion report: Research report",
    ]);
  });

  it("preserves streamed raw chunk boundaries without inserting newlines", () => {
    const details = createRunDetails(
      stateWith([
        {
          ...baseEvent,
          agentId: "orion",
          eventId: "evt-1",
          message: "raw 1",
          payload: { rawChunk: "hel" },
          type: "agent.working",
        },
        {
          ...baseEvent,
          agentId: "orion",
          eventId: "evt-2",
          message: "raw 2",
          payload: { rawChunk: "\n\nlo" },
          type: "agent.working",
        },
      ]),
    );

    expect(details.rawCodex).toContain("hel\n\nlo");
    expect(details.rawCodexByAgent[0]).toMatchObject({
      agentId: "orion",
      rawResponse: "hel\n\nlo",
    });
  });
});
