import { describe, expect, it } from "vitest";
import { AgentsSdkRunError, collectAgentsSdkEvents } from "./agentsSdkWorkflow";

describe("agents sdk workflow", () => {
  it("maps a successful Luma orchestration run to UI events and final output", async () => {
    const events = await collectAgentsSdkEvents("Draft a plan", async () => ({
      finalOutput: "Synthesized answer",
      specialistReports: {
        argus: "Review complete",
        neria: "Memory checked",
        orion: "Research complete",
        quill: "Draft prepared",
      },
    }));

    expect(events.map((event) => event.type)).toEqual([
      "task.created",
      "agent.planning",
      "agent.delegated",
      "agent.working",
      "agent.working",
      "agent.working",
      "agent.reviewing",
      "agent.reporting",
      "agent.reporting",
      "agent.reporting",
      "agent.reporting",
      "approval.requested",
      "agent.done",
      "agent.done",
      "agent.done",
      "agent.done",
      "agent.done",
    ]);
    expect(events.at(-1)?.payload?.finalOutput).toBe("Synthesized answer");
    expect(events.find((event) => event.agentId === "orion" && event.type === "agent.reporting")?.payload).toEqual({
      report: "Research complete",
    });
  });

  it("emits a failed manager event when the SDK run fails", async () => {
    const events = await collectAgentsSdkEvents("Draft a plan", async () => {
      throw new Error("Missing OPENAI_API_KEY");
    });

    expect(events.at(-1)).toMatchObject({
      agentId: "luma",
      type: "agent.failed",
      message: "Missing OPENAI_API_KEY",
    });
  });

  it("fails the manager event when Luma skips a required specialist tool", async () => {
    const events = await collectAgentsSdkEvents("Draft a plan", async () => ({
      finalOutput: "Synthesized answer",
      specialistReports: {
        orion: "Research complete",
      },
    }));

    expect(events.at(-1)).toMatchObject({
      agentId: "luma",
      type: "agent.failed",
      message: "Luma did not call required specialist tools: Neria, Quill, Argus",
    });
    expect(events.find((event) => event.agentId === "orion" && event.type === "agent.reporting")?.payload).toEqual({
      report: "Research complete",
    });
  });

  it("fails the manager event when Luma does not return final output", async () => {
    const events = await collectAgentsSdkEvents("Draft a plan", async () => ({
      finalOutput: "   ",
      specialistReports: {
        argus: "Review complete",
        neria: "Memory checked",
        orion: "Research complete",
        quill: "Draft prepared",
      },
    }));

    expect(events.at(-1)).toMatchObject({
      agentId: "luma",
      type: "agent.failed",
      message: "Luma did not return a final output.",
    });
    expect(events.find((event) => event.agentId === "quill" && event.type === "agent.reporting")?.payload).toEqual({
      report: "Draft prepared",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({
        agentId: "orion",
        type: "agent.failed",
      }),
    );
  });

  it("preserves partial reports when the SDK run throws after specialist tools execute", async () => {
    const events = await collectAgentsSdkEvents("Draft a plan", async () => {
      throw new AgentsSdkRunError("SDK stream failed", {
        argus: "Review complete",
        orion: "Research complete",
      });
    });

    expect(events.find((event) => event.agentId === "orion" && event.type === "agent.reporting")?.payload).toEqual({
      report: "Research complete",
    });
    expect(events.find((event) => event.agentId === "argus" && event.type === "agent.reporting")?.payload).toEqual({
      report: "Review complete",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        agentId: "neria",
        type: "agent.failed",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      agentId: "luma",
      type: "agent.failed",
      message: "SDK stream failed",
    });
  });
});
