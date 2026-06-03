import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeManagedWorktreeMetadata } from "./managedWorktreeMetadata";
import { readWorkspaceMetadata, readWorkspaceProvenance } from "./workspaceMetadata";

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

  it("reads managed worktree repository provenance from the metadata sidecar without trusting its branch label", async () => {
    const root = await createTempDirectory();
    const workspace = join(root, ".lanternwood-worktrees", "drive-abc123", "feature-branch-launcher-def456");
    await mkdir(workspace, { recursive: true });
    await writeManagedWorktreeMetadata(workspace, {
      branch: "feature/branch-launcher",
      repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
    });

    const metadata = await readWorkspaceMetadata(workspace, {
      runGit: async (args) => {
        const command = args.join(" ");

        if (command === "rev-parse --show-toplevel") {
          return "/home/eunhwapark/IdeaProjects/drive\n";
        }

        if (command === "rev-parse --git-common-dir") {
          return "/home/eunhwapark/IdeaProjects/drive/.git\n";
        }

        return "";
      },
    });

    expect(metadata).toMatchObject({
      repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
      workspacePath: workspace,
    });
    expect(metadata.workspaceLabel).toBeUndefined();
  });

  it("derives a legacy managed worktree label from the attached branch when no sidecar exists", async () => {
    const root = await createTempDirectory();
    const workspace = join(root, ".lanternwood-worktrees", "drive-abc123", "feature-branch-launcher-def456");
    await mkdir(workspace, { recursive: true });

    const metadata = await readWorkspaceMetadata(workspace, {
      runGit: async (args) => {
        const command = args.join(" ");

        if (command === "rev-parse --show-toplevel") {
          return "/home/eunhwapark/IdeaProjects/drive\n";
        }

        if (command === "rev-parse --git-common-dir") {
          return "/home/eunhwapark/IdeaProjects/drive/.git\n";
        }

        if (command === "branch --show-current") {
          return "feature/branch-launcher\n";
        }

        return "";
      },
    });

    expect(metadata).toMatchObject({
      repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
      workspaceLabel: "drive:feature/branch-launcher",
      workspacePath: workspace,
    });
  });

  it("derives a legacy detached managed worktree label when exactly one branch points at HEAD", async () => {
    const root = await createTempDirectory();
    const workspace = join(root, ".lanternwood-worktrees", "drive-abc123", "feature-branch-launcher-def456");
    await mkdir(workspace, { recursive: true });

    const metadata = await readWorkspaceMetadata(workspace, {
      runGit: async (args) => {
        const command = args.join(" ");

        if (command === "rev-parse --show-toplevel") {
          return "/home/eunhwapark/IdeaProjects/drive\n";
        }

        if (command === "rev-parse --git-common-dir") {
          return "/home/eunhwapark/IdeaProjects/drive/.git\n";
        }

        if (command === "branch --show-current") {
          return "\n";
        }

        if (command === "branch --points-at HEAD --format %(refname:short)") {
          return "(HEAD detached at 1234567)\nfeature/branch-launcher\n";
        }

        return "";
      },
    });

    expect(metadata).toMatchObject({
      repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
      workspaceLabel: "drive:feature/branch-launcher (detached)",
      workspacePath: workspace,
    });
  });

  it("prefers live git repository identity over stale sidecar provenance", async () => {
    const root = await createTempDirectory();
    const workspace = join(root, ".lanternwood-worktrees", "drive-abc123", "feature-branch-launcher-def456");
    await mkdir(workspace, { recursive: true });
    await writeManagedWorktreeMetadata(workspace, {
      branch: "feature/branch-launcher",
      repositoryPath: "/home/eunhwapark/IdeaProjects/archive-drive",
    });

    const provenance = await readWorkspaceProvenance(workspace, {
      runGit: async (args) => {
        const command = args.join(" ");

        if (command === "rev-parse --show-toplevel") {
          return "/home/eunhwapark/IdeaProjects/drive\n";
        }

        if (command === "rev-parse --git-common-dir") {
          return "/home/eunhwapark/IdeaProjects/drive/.git\n";
        }

        if (command === "branch --show-current") {
          return "feature/branch-launcher\n";
        }

        return "";
      },
    });

    expect(provenance).toEqual({
      repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
      workspaceLabel: "drive:feature/branch-launcher",
    });
  });

  it("prefers the live branch over stale sidecar branch metadata", async () => {
    const root = await createTempDirectory();
    const workspace = join(root, ".lanternwood-worktrees", "drive-abc123", "feature-branch-launcher-def456");
    await mkdir(workspace, { recursive: true });
    await writeManagedWorktreeMetadata(workspace, {
      branch: "feature/branch-launcher",
      repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
    });

    const provenance = await readWorkspaceProvenance(workspace, {
      runGit: async (args) => {
        const command = args.join(" ");

        if (command === "rev-parse --show-toplevel") {
          return "/home/eunhwapark/IdeaProjects/drive\n";
        }

        if (command === "rev-parse --git-common-dir") {
          return "/home/eunhwapark/IdeaProjects/drive/.git\n";
        }

        if (command === "branch --show-current") {
          return "other-branch\n";
        }

        return "";
      },
    });

    expect(provenance).toEqual({
      repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
      workspaceLabel: "drive:other-branch",
    });
  });

  it("preserves the sidecar branch label when the recorded branch still points at detached HEAD", async () => {
    const root = await createTempDirectory();
    const workspace = join(root, ".lanternwood-worktrees", "drive-abc123", "feature-branch-launcher-def456");
    await mkdir(workspace, { recursive: true });
    await writeManagedWorktreeMetadata(workspace, {
      branch: "feature/branch-launcher",
      repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
    });

    const provenance = await readWorkspaceProvenance(workspace, {
      runGit: async (args) => {
        const command = args.join(" ");

        if (command === "rev-parse --show-toplevel") {
          return "/home/eunhwapark/IdeaProjects/drive\n";
        }

        if (command === "rev-parse --git-common-dir") {
          return "/home/eunhwapark/IdeaProjects/drive/.git\n";
        }

        if (command === "branch --show-current") {
          return "\n";
        }

        if (command === "branch --points-at HEAD --format %(refname:short)") {
          return "(HEAD detached at 1234567)\nmain\nfeature/branch-launcher\n";
        }

        return "";
      },
    });

    expect(provenance).toEqual({
      repositoryPath: "/home/eunhwapark/IdeaProjects/drive",
      workspaceLabel: "drive:feature/branch-launcher (detached)",
    });
  });
});
