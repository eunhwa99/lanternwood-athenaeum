import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentDefinition, loadAgentDefinitions } from "./agentCatalog";

const tempDirectories: string[] = [];

async function createCatalogRoot() {
  const directory = await mkdtemp(join(tmpdir(), "lanternwood-agent-catalog-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("agent catalog authoring", () => {
  it("creates an agent definition and persona under the repo-local catalog", async () => {
    const catalogRoot = await createCatalogRoot();

    const result = await createAgentDefinition(catalogRoot, {
      color: "#7AA2F7",
      displayName: "Sol",
      id: "sol",
      persona: "Careful build agent that keeps implementation notes grounded.",
      promptInstruction: "Inspect implementation tasks and return concise build notes.",
      routingKeywords: ["build", "implement"],
      routingReason: "implementation and build work",
      worldRole: "Workshop steward",
    });

    expect(result.agentDirectory).toBe(join(catalogRoot, "sol"));
    await expect(readFile(join(catalogRoot, "sol", "persona.md"), "utf8")).resolves.toContain("Careful build agent");
    await expect(readFile(join(catalogRoot, "sol", "agent.json"), "utf8")).resolves.toContain("\"id\": \"sol\"");
  });

  it("rejects invalid or unsafe agent ids", async () => {
    const catalogRoot = await createCatalogRoot();

    await expect(
      createAgentDefinition(catalogRoot, {
        color: "#7AA2F7",
        displayName: "Unsafe",
        id: "../unsafe",
        persona: "Unsafe persona",
        promptInstruction: "Unsafe prompt",
        routingKeywords: ["unsafe"],
        routingReason: "unsafe",
        worldRole: "Unsafe",
      }),
    ).rejects.toThrow("Agent id must use lowercase letters, numbers, and hyphens");
  });

  it("rejects duplicate agent ids", async () => {
    const catalogRoot = await createCatalogRoot();
    const input = {
      color: "#7AA2F7",
      displayName: "Sol",
      id: "sol",
      persona: "Careful build agent that keeps implementation notes grounded.",
      promptInstruction: "Inspect implementation tasks and return concise build notes.",
      routingKeywords: ["build"],
      routingReason: "implementation and build work",
      worldRole: "Workshop steward",
    };

    await createAgentDefinition(catalogRoot, input);
    await expect(createAgentDefinition(catalogRoot, input)).rejects.toThrow("Agent already exists");
  });

  it("loads authored agents from agent.json and persona.md files", async () => {
    const catalogRoot = await createCatalogRoot();
    await mkdir(join(catalogRoot, "build-scribe"));
    await writeFile(
      join(catalogRoot, "build-scribe", "agent.json"),
      JSON.stringify({
        color: "#7AA2F7",
        displayName: "Build Scribe",
        futureTools: [],
        homePosition: { x: 520, y: 300 },
        id: "build-scribe",
        promptInstruction: "Inspect implementation tasks and return build notes.",
        routing: {
          keywords: ["build-note"],
          reason: "custom implementation notes",
        },
        systemRole: "ResearchAgent",
        worldRole: "Workshop steward",
      }),
    );
    await writeFile(join(catalogRoot, "build-scribe", "persona.md"), "Implementation agent\n");

    await expect(loadAgentDefinitions(catalogRoot)).resolves.toEqual([
      expect.objectContaining({
        id: "build-scribe",
        persona: "Implementation agent",
        routing: {
          keywords: ["build-note"],
          reason: "custom implementation notes",
        },
      }),
    ]);
  });

  it("skips incomplete agent directories left by interrupted authoring runs", async () => {
    const catalogRoot = await createCatalogRoot();
    await mkdir(join(catalogRoot, "incomplete-agent"));

    await expect(loadAgentDefinitions(catalogRoot)).resolves.toEqual([]);
  });
});