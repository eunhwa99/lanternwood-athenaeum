import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceMetadata } from "./workspaceMetadata";

const tempDirectories: string[] = [];

async function createTempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "lanternwood-workspace-metadata-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("workspace metadata", () => {
  it("summarizes repo-local agent/context files, package scripts, and git changes", async () => {
    const workspace = await createTempDirectory();
    await mkdir(join(workspace, ".agents", "lanternwood", "agents", "build-scribe"), { recursive: true });
    await writeFile(join(workspace, "AGENTS.md"), "# Workspace instructions\n");
    await writeFile(
      join(workspace, ".agents", "lanternwood", "agents", "build-scribe", "agent.json"),
      '{"id":"build-scribe"}\n',
    );
    await writeFile(join(workspace, "package.json"), '{"scripts":{"test":"vitest run","build":"vite build"}}\n');
    await writeFile(join(workspace, "src.txt"), "changed\n");

    const metadata = await readWorkspaceMetadata(workspace, {
      runGit: async () => " M src.txt\n?? notes.md\n",
    });

    expect(metadata).toMatchObject({
      agentContextFiles: ["AGENTS.md", ".agents/lanternwood/agents/build-scribe/agent.json"],
      changedFiles: ["src.txt", "notes.md"],
      gitStatus: " M src.txt\n?? notes.md",
      packageScripts: [
        { name: "build", command: "vite build" },
        { name: "test", command: "vitest run" },
      ],
      workspacePath: workspace,
    });
  });
});