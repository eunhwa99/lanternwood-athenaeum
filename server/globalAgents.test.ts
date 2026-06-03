import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGlobalAgents } from "./globalAgents";

const tempDirectories: string[] = [];

async function createAgentsHome() {
  const directory = await mkdtemp(join(tmpdir(), "lanternwood-agents-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("global agents", () => {
  it("loads optional personas and automation policy from the agents home", async () => {
    const agentsHome = await createAgentsHome();
    await writeFile(join(agentsHome, "automation_policy.json"), JSON.stringify({ safeCommands: ["git status"] }));
    await writeFile(join(agentsHome, "personas", "luma.md"), "Luma global persona", { flag: "wx" }).catch(async () => {
      await rm(join(agentsHome, "personas"), { force: true, recursive: true });
      await import("node:fs/promises").then(({ mkdir }) => mkdir(join(agentsHome, "personas"), { recursive: true }));
      await writeFile(join(agentsHome, "personas", "luma.md"), "Luma global persona");
    });

    const globalAgents = await loadGlobalAgents({ agentsHome, homeDirectory: "/Users/eunhwa" });

    expect(globalAgents.personas.luma).toBe("Luma global persona");
    expect(globalAgents.automationPolicy).toMatchObject({ safeCommands: ["git status"] });
  });

  it("falls back to a default policy when files are missing", async () => {
    const agentsHome = await createAgentsHome();
    const globalAgents = await loadGlobalAgents({ agentsHome, homeDirectory: "/Users/eunhwa" });

    expect(globalAgents.personas).toEqual({});
    expect(globalAgents.automationPolicy.allowRoots).toContain("/Users/eunhwa/IdeaProjects");
  });

  it("allows the active workspace even when it lives outside the default roots", async () => {
    const agentsHome = await createAgentsHome();
    const activeWorkspace = "/Users/eunhwa/.codex/worktrees/1304/lanternwood-athenaeum";

    const globalAgents = await loadGlobalAgents({
      agentsHome,
      homeDirectory: "/Users/eunhwa",
      workspacePath: activeWorkspace,
    });

    expect(globalAgents.automationPolicy.allowRoots).toContain(activeWorkspace);
  });
});
