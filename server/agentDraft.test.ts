import { describe, expect, it } from "vitest";
import { createAgentDraftWithCodex } from "./agentDraft";

describe("Codex-assisted agent drafts", () => {
  it("asks Codex for a read-only JSON draft and validates the returned agent definition", async () => {
    const calls: Array<{ prompt: string; sandboxMode?: string; workspacePath?: string }> = [];

    const draft = await createAgentDraftWithCodex("React UI implementation and e2e repair specialist", {
      existingAgentIds: ["luma", "orion"],
      runCommand: async (prompt, _onProgress, options) => {
        calls.push({ prompt, sandboxMode: options?.sandboxMode, workspacePath: options?.workspacePath });

        return JSON.stringify({
          color: "#7AA2F7",
          displayName: "React UI Builder",
          id: "react-ui-builder",
          persona: "Builds React UI changes and verifies them with focused e2e evidence.",
          promptInstruction: "Implement React UI work and return concise verification notes.",
          routingKeywords: ["react", "ui", "e2e"],
          routingReason: "React UI implementation and e2e repair work",
          worldRole: "Interface workshop steward",
        });
      },
      workspacePath: "/repo/lanternwood",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ sandboxMode: "read-only", workspacePath: "/repo/lanternwood" });
    expect(calls[0].prompt).toContain("Do not write files");
    expect(calls[0].prompt).toContain("React UI implementation and e2e repair specialist");
    expect(calls[0].prompt).toContain("Existing agent ids: luma, orion");
    expect(draft).toEqual({
      color: "#7aa2f7",
      displayName: "React UI Builder",
      id: "react-ui-builder",
      persona: "Builds React UI changes and verifies them with focused e2e evidence.",
      promptInstruction: "Implement React UI work and return concise verification notes.",
      routingKeywords: ["react", "ui", "e2e"],
      routingReason: "React UI implementation and e2e repair work",
      worldRole: "Interface workshop steward",
    });
  });

  it("rejects malformed Codex drafts before any agent files can be written", async () => {
    await expect(
      createAgentDraftWithCodex("Unsafe specialist", {
        runCommand: async () =>
          JSON.stringify({
            color: "#7AA2F7",
            displayName: "Unsafe",
            id: "../unsafe",
            persona: "Unsafe persona",
            promptInstruction: "Unsafe prompt",
            routingKeywords: ["unsafe"],
            routingReason: "unsafe",
            worldRole: "Unsafe",
          }),
      }),
    ).rejects.toThrow("Agent id must use lowercase letters, numbers, and hyphens");
  });
});
