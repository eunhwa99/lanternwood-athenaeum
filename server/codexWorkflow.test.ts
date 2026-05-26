import { describe, expect, it } from "vitest";
import { collectCodexEvents, createCodexCliExecutor } from "./codexWorkflow";

describe("codex cli workflow", () => {
  it("maps a successful Codex CLI orchestration result to UI events and final output", async () => {
    const events = await collectCodexEvents("Draft a plan", async () => ({
      finalOutput: "Synthesized answer",
      specialistReports: {
        argus: "Review complete",
        neria: "Memory checked",
        orion: "Research complete",
        quill: "Draft prepared",
      },
    }));

    expect(events.at(-1)?.payload?.finalOutput).toBe("Synthesized answer");
    expect(events.find((event) => event.agentId === "orion" && event.type === "agent.reporting")?.payload).toEqual({
      report: "Research complete",
    });
  });

  it("fails missing specialist reports without discarding reports that were present", async () => {
    const events = await collectCodexEvents("Draft a plan", async () => ({
      finalOutput: "Synthesized answer",
      specialistReports: {
        orion: "Research complete",
      },
    }));

    expect(events.find((event) => event.agentId === "orion" && event.type === "agent.reporting")?.payload).toEqual({
      report: "Research complete",
    });
    expect(events.at(-1)).toMatchObject({
      agentId: "luma",
      message: "Codex CLI result did not include required specialist reports: Neria, Quill, Argus",
      type: "agent.failed",
    });
  });

  it("parses the final JSON object from the Codex CLI last-message output", async () => {
    const execute = createCodexCliExecutor({
      runCommand: async () =>
        JSON.stringify({
          argus: "Review complete",
          finalOutput: "Synthesized answer",
          neria: "Memory checked",
          orion: "Research complete",
          quill: "Draft prepared",
        }),
    });

    await expect(execute("Draft a plan")).resolves.toEqual({
      finalOutput: "Synthesized answer",
      specialistReports: {
        argus: "Review complete",
        neria: "Memory checked",
        orion: "Research complete",
        quill: "Draft prepared",
      },
    });
  });
});
