import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverWorkspaceOptions, normalizeWorkspaceInput, resolveWorkspacePath } from "./workspaces";

const tempDirectories: string[] = [];

async function createTempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "lanternwood-workspace-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("workspace validation", () => {
  it("resolves an allowed workspace path to its real path", async () => {
    const root = await createTempDirectory();
    const workspace = await mkdtemp(join(root, "repo-"));
    const resolved = await resolveWorkspacePath(workspace, [root]);

    expect(resolved).toBe(await realpath(workspace));
  });

  it("rejects workspaces outside the allowed roots", async () => {
    const root = await createTempDirectory();
    const outside = await createTempDirectory();

    await expect(resolveWorkspacePath(outside, [root])).rejects.toThrow("Workspace is outside the allowed roots");
  });

  it("rejects empty workspace paths", async () => {
    const root = await createTempDirectory();

    await expect(resolveWorkspacePath("   ", [root])).rejects.toThrow("Missing workspace path");
  });

  it("expands home-relative and cwd-relative workspace inputs before validation", async () => {
    const homeDirectory = await createTempDirectory();
    const workspace = join(homeDirectory, "IdeaProjects", "demo");
    await mkdir(workspace, { recursive: true });

    expect(normalizeWorkspaceInput("~/IdeaProjects/demo", { homeDirectory })).toBe(workspace);
    expect(normalizeWorkspaceInput("demo", { baseDirectory: join(homeDirectory, "IdeaProjects"), homeDirectory })).toBe(workspace);
    await expect(resolveWorkspacePath("~/IdeaProjects/demo", [join(homeDirectory, "IdeaProjects")], { homeDirectory })).resolves.toBe(
      await realpath(workspace),
    );
  });

  it("discovers direct child workspaces under allowed roots", async () => {
    const root = await createTempDirectory();
    await mkdir(join(root, "drive"));
    await mkdir(join(root, "lanternwood-athenaeum"));

    await expect(discoverWorkspaceOptions([root])).resolves.toEqual({
      roots: [await realpath(root)],
      workspaces: [
        { name: "drive", path: await realpath(join(root, "drive")), root: await realpath(root) },
        { name: "lanternwood-athenaeum", path: await realpath(join(root, "lanternwood-athenaeum")), root: await realpath(root) },
      ],
    });
  });
});