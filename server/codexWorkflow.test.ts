import { describe, expect, it } from "vitest";
import {
  collectCodexEvents,
  createCodexCliExecutor,
  createCodexCliWorkflow,
  getCodexConfigPath,
  readActiveModelFromCodexConfig,
  readTopLevelModelFromCodexConfig,
  type CodexWorkflowExecutors,
} from "./codexWorkflow";

function workflowFixture({
  finalOutput = "Synthesized answer",
  reports = {
    argus: "Review complete",
    neria: "Memory checked",
    orion: "Research complete",
    quill: "Draft prepared",
  },
  rawResponse = "Synthesized answer",
}: {
  finalOutput?: string;
  reports?: Partial<Record<"argus" | "neria" | "orion" | "quill", string>>;
  rawResponse?: string;
} = {}): CodexWorkflowExecutors {
  return {
    async runSpecialist(specialist) {
      const report = reports[specialist.id] ?? "";

      return {
        rawResponse: report,
        report,
      };
    },
    async synthesize() {
      return {
        finalOutput,
        rawResponse,
      };
    },
  };
}

describe("codex cli workflow", () => {
  it("maps a successful Codex CLI orchestration result to UI events and final output", async () => {
    const events = await collectCodexEvents(
      "Draft a plan",
      workflowFixture({ rawResponse: "{\"finalOutput\":\"Synthesized answer\"}" }),
    );

    expect(events.at(-1)?.payload?.finalOutput).toBe("Synthesized answer");
    expect(events.at(-1)?.payload?.rawResponse).toBe("{\"finalOutput\":\"Synthesized answer\"}");
    expect(events.find((event) => event.type === "task.created")?.payload).toMatchObject({
      backend: "connected",
      cliCommand: "codex exec",
      codexStatus: "calling",
      runMode: "codex",
    });
    expect(events.find((event) => event.agentId === "orion" && event.type === "agent.reporting")?.payload).toEqual({
      backend: "connected",
      cliCommand: "codex exec",
      codexStatus: "completed",
      model: expect.any(String),
      rawResponse: "Research complete",
      report: "Research complete",
      runMode: "codex",
    });
  });

  it("fails missing specialist reports without discarding reports that were present", async () => {
    const events = await collectCodexEvents(
      "Draft a plan",
      workflowFixture({
        reports: {
          orion: "Research complete",
        },
      }),
    );

    expect(events.find((event) => event.agentId === "orion" && event.type === "agent.reporting")?.payload).toMatchObject({
      report: "Research complete",
    });
    expect(events.at(-1)).toMatchObject({
      agentId: "luma",
      message: "Codex CLI result did not include required specialist reports: Neria, Quill, Argus",
      type: "agent.failed",
    });
  });

  it("streams Codex raw progress on the specialist route before the final report", async () => {
    const events = await collectCodexEvents("Draft a plan", {
      ...workflowFixture(),
      async runSpecialist(specialist, _input, onProgress) {
        if (specialist.id === "orion") {
          onProgress?.({ rawChunk: "{\"event\":\"turn.started\"}\n" });
        }

        return {
          rawResponse: `${specialist.displayName} response`,
          report: `${specialist.displayName} complete`,
        };
      },
    });

    const progressEvent = events.find((event) => event.agentId === "orion" && event.message === "Orion Codex CLI is streaming output");
    const firstReportIndex = events.findIndex((event) => event.type === "agent.reporting");
    const progressIndex = events.findIndex((event) => event.eventId === progressEvent?.eventId);

    expect(progressEvent?.payload).toMatchObject({
      codexStatus: "streaming",
      progress: "Orion Codex CLI is streaming output.",
      rawChunk: "{\"event\":\"turn.started\"}\n",
    });
    expect(progressIndex).toBeGreaterThan(0);
    expect(progressIndex).toBeLessThan(firstReportIndex);
  });

  it("reads the displayed Codex model from runtime environment values", async () => {
    const originalModel = process.env.LANTERNWOOD_CODEX_MODEL;
    process.env.LANTERNWOOD_CODEX_MODEL = "gpt-5.3-codex";

    try {
      const events = await collectCodexEvents("Draft a plan", workflowFixture());

      expect(events.find((event) => event.type === "task.created")?.payload?.model).toBe("gpt-5.3-codex");
    } finally {
      if (originalModel === undefined) {
        delete process.env.LANTERNWOOD_CODEX_MODEL;
      } else {
        process.env.LANTERNWOOD_CODEX_MODEL = originalModel;
      }
    }
  });

  it("reads the active Codex config model from top-level or selected profile settings", () => {
    expect(readTopLevelModelFromCodexConfig("[profiles.fast]\nmodel = \"profile-only-model\"\n")).toBeUndefined();
    expect(readTopLevelModelFromCodexConfig("model = \"root-model\"\n[profiles.fast]\nmodel = \"profile-only-model\"\n")).toBe("root-model");
    expect(readTopLevelModelFromCodexConfig("model = \"root-model\" # default\n[profiles.fast]\nmodel = \"profile-only-model\"\n")).toBe("root-model");
    expect(readTopLevelModelFromCodexConfig("  model = \"root-model\"\n[profiles.fast]\nmodel = \"profile-only-model\"\n")).toBe("root-model");
    expect(readActiveModelFromCodexConfig("profile = \"fast\"\n[profiles.fast]\nmodel = \"profile-model\"\n")).toBe("profile-model");
    expect(readActiveModelFromCodexConfig("model = \"root-model\"\nprofile = \"fast\"\n[profiles.fast]\nmodel = \"profile-model\"\n")).toBe("profile-model");
    expect(readActiveModelFromCodexConfig("model = \"root-model\"\nprofile = \"fast\"\n[profiles.fast]\napproval_policy = \"never\"\n")).toBe("root-model");
    expect(readActiveModelFromCodexConfig("profile = \"gpt-5.3-codex\"\n[profiles.\"gpt-5.3-codex\"] # active\nmodel = \"quoted-profile-model\"\n")).toBe("quoted-profile-model");
    expect(readActiveModelFromCodexConfig("profile = \"fast profile\"\n[profiles.'fast profile'] # active\nmodel = \"literal-profile-model\"\n")).toBe("literal-profile-model");
  });

  it("uses CODEX_HOME when resolving the Codex config path", () => {
    const originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = "/tmp/lanternwood-codex-home";

    try {
      expect(getCodexConfigPath()).toBe("/tmp/lanternwood-codex-home/config.toml");
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("passes abort signals into Codex CLI route execution", async () => {
    const controller = new AbortController();
    const seenSignals: Array<AbortSignal | undefined> = [];
    const workflow = createCodexCliWorkflow({
      runCommand: async (_prompt, _onProgress, options) => {
        seenSignals.push(options?.signal);
        controller.abort();
        throw new Error("aborted route");
      },
    });
    const events = await collectCodexEvents("Draft a plan", workflow, { signal: controller.signal });

    expect(seenSignals.length).toBeGreaterThan(0);
    expect(seenSignals.every((signal) => signal === controller.signal)).toBe(true);
    expect(events.at(-1)).toMatchObject({
      agentId: "luma",
      message: "Codex CLI run aborted.",
      type: "agent.failed",
    });
  });

  it("handles an aborting synthesis route without leaking the route rejection", async () => {
    const controller = new AbortController();
    let synthesisObserved = false;
    const events = await collectCodexEvents(
      "Draft a plan",
      {
        ...workflowFixture(),
        async synthesize(_input, _reports, onProgress, options) {
          onProgress?.({ rawChunk: "{\"event\":\"synthesis.started\"}\n" });
          controller.abort();
          synthesisObserved = options?.signal === controller.signal;
          throw new Error("synthesis stopped");
        },
      },
      { signal: controller.signal },
    );

    expect(synthesisObserved).toBe(true);
    expect(events.at(-1)).toMatchObject({
      agentId: "luma",
      message: "Codex CLI run aborted.",
      type: "agent.failed",
    });
  });

  it("drains buffered Codex progress before finalizing the run", async () => {
    const events = await collectCodexEvents(
      "Draft a plan",
      {
        ...workflowFixture(),
        runSpecialist: (specialist, _input, onProgress) =>
          new Promise((resolve) => {
            if (specialist.id !== "orion") {
              resolve({
                rawResponse: `${specialist.displayName} response`,
                report: `${specialist.displayName} complete`,
              });
              return;
            }

            setTimeout(() => {
              onProgress?.({ rawChunk: "{\"event\":\"first\"}\n" });
              onProgress?.({ rawChunk: "{\"event\":\"second\"}\n" });
              resolve({
                rawResponse: "Orion response",
                report: "Orion complete",
              });
            }, 0);
          }),
      },
    );

    expect(events.filter((event) => event.payload?.rawChunk).map((event) => event.payload?.rawChunk)).toEqual([
      "{\"event\":\"first\"}\n",
      "{\"event\":\"second\"}\n",
    ]);
  });

  it("keeps raw last-message output visible when parsed Codex output fails validation", async () => {
    const events = await collectCodexEvents(
      "Draft a plan",
      {
        ...workflowFixture(),
        async synthesize() {
          return {
            finalOutput: "",
            rawResponse: "{\"orion\":\"Research complete\",\"finalOutput\":\"\"}",
          };
        },
      },
    );

    expect(events.at(-1)).toMatchObject({
      agentId: "luma",
      payload: {
        codexStatus: "failed",
        rawResponse: "{\"orion\":\"Research complete\",\"finalOutput\":\"\"}",
      },
      type: "agent.failed",
    });
  });

  it("does not overwrite a specialist Codex failure with a generic missing-report failure", async () => {
    const events = await collectCodexEvents("Draft a plan", {
      ...workflowFixture(),
      async runSpecialist(specialist) {
        if (specialist.id === "orion") {
          throw new Error("Orion Codex route failed");
        }

        return {
          rawResponse: `${specialist.displayName} response`,
          report: `${specialist.displayName} complete`,
        };
      },
    });
    const orionFailures = events.filter((event) => event.agentId === "orion" && event.type === "agent.failed");

    expect(orionFailures).toHaveLength(1);
    expect(orionFailures[0].message).toBe("Orion Codex route failed");
  });

  it("does not relabel specialist failure raw output as a Luma raw response", async () => {
    const events = await collectCodexEvents("Draft a plan", {
      ...workflowFixture(),
      async runSpecialist(specialist) {
        if (specialist.id === "orion") {
          return Promise.reject(new Error("Orion Codex route failed"));
        }

        return {
          rawResponse: `${specialist.displayName} response`,
          report: `${specialist.displayName} complete`,
        };
      },
    });

    expect(events.find((event) => event.agentId === "luma" && event.type === "agent.failed")?.payload?.rawResponse).toBeUndefined();
  });

  it("parses the final JSON object from the Codex CLI last-message output", async () => {
    const originalModel = process.env.LANTERNWOOD_CODEX_MODEL;
    process.env.LANTERNWOOD_CODEX_MODEL = "gpt-5.3-codex";
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

    try {
      await expect(execute("Draft a plan")).resolves.toMatchObject({
        finalOutput: "Synthesized answer",
        model: "gpt-5.3-codex",
        rawResponse: expect.stringContaining("\"finalOutput\":\"Synthesized answer\""),
        specialistReports: {
          argus: "Review complete",
          neria: "Memory checked",
          orion: "Research complete",
          quill: "Draft prepared",
        },
      });
    } finally {
      if (originalModel === undefined) {
        delete process.env.LANTERNWOOD_CODEX_MODEL;
      } else {
        process.env.LANTERNWOOD_CODEX_MODEL = originalModel;
      }
    }
  });
});
