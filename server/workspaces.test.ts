import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeManagedWorktreeMetadata } from "./managedWorktreeMetadata";
import {
  discoverWorkspaceOptions,
  launchBranchWorktree,
  normalizeWorkspaceInput,
  resolveWorkspacePath,
  worktreePathForBranch,
} from "./workspaces";

const tempDirectories: string[] = [];

async function createTempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "lanternwood-workspace-"));
  tempDirectories.push(directory);
  return directory;
}

async function createRepository(root: string, name: string) {
  const repository = join(root, name);
  await mkdir(repository, { recursive: true });
  return repository;
}

function repositoryIdentityResponse(
  command: string,
  repositoryPath: string,
  commonGitDirectory = join(repositoryPath, ".git"),
  topLevelPath = repositoryPath,
) {
  if (command === "rev-parse --show-toplevel") {
    return `${topLevelPath}\n`;
  }

  if (command === "rev-parse --git-common-dir") {
    return `${commonGitDirectory}\n`;
  }

  return undefined;
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

  it("rejects a sidecar-less managed worktree outside the allowed roots even when its source repository is allowed", async () => {
    const parentRoot = await createTempDirectory();
    const repository = await createRepository(parentRoot, "demo");
    const resolvedRepository = await realpath(repository);
    const managedWorkspace = join(parentRoot, ".lanternwood-worktrees", "demo-abc123", "feature-x-def456");
    await mkdir(managedWorkspace, { recursive: true });
    const resolvedManagedWorkspace = await realpath(managedWorkspace);
    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === resolvedManagedWorkspace) {
        const identityResponse = repositoryIdentityResponse(
          command,
          resolvedRepository,
          join(resolvedRepository, ".git"),
          resolvedManagedWorkspace,
        );

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(resolveWorkspacePath(managedWorkspace, [repository], { execFile })).rejects.toThrow("Workspace is outside the allowed roots");
  });

  it("rejects a managed worktree outside the allowed roots when stale sidecar metadata disagrees with live git identity", async () => {
    const parentRoot = await createTempDirectory();
    const repository = await createRepository(parentRoot, "demo");
    const resolvedRepository = await realpath(repository);
    const otherRepository = await createRepository(parentRoot, "archive-demo");
    const fakeManagedWorkspace = join(parentRoot, ".lanternwood-worktrees", "demo-abc123", "feature-x-def456");
    await mkdir(fakeManagedWorkspace, { recursive: true });
    const resolvedFakeManagedWorkspace = await realpath(fakeManagedWorkspace);
    await writeManagedWorktreeMetadata(resolvedFakeManagedWorkspace, {
      branch: "feature/x",
      repositoryPath: await realpath(otherRepository),
    });
    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === resolvedFakeManagedWorkspace) {
        const identityResponse = repositoryIdentityResponse(
          command,
          resolvedRepository,
          join(resolvedRepository, ".git"),
          resolvedFakeManagedWorkspace,
        );

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(resolveWorkspacePath(fakeManagedWorkspace, [repository], { execFile })).rejects.toThrow("Workspace is outside the allowed roots");
  });

  it("rejects a forged managed worktree path outside the allowed roots when it is not actually a git worktree", async () => {
    const parentRoot = await createTempDirectory();
    const repository = await createRepository(parentRoot, "demo");
    const forgedWorkspace = join(parentRoot, ".lanternwood-worktrees", "demo-abc123", "feature-x-def456");
    await mkdir(forgedWorkspace, { recursive: true });
    await writeManagedWorktreeMetadata(forgedWorkspace, {
      branch: "feature/x",
      repositoryPath: await realpath(repository),
    });
    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === await realpath(forgedWorkspace)) {
        const error = new Error(`Unexpected git args: ${command}`);
        Object.assign(error, { code: 128, stderr: "fatal: not a git repository" });
        throw error;
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(resolveWorkspacePath(forgedWorkspace, [repository], { execFile })).rejects.toThrow("Workspace is outside the allowed roots");
  });

  it("rejects a managed worktree inside the allowed roots when its live provenance cannot be verified", async () => {
    const parentRoot = await createTempDirectory();
    const repository = await createRepository(parentRoot, "demo");
    const resolvedRepository = await realpath(repository);
    const managedWorkspace = join(parentRoot, ".lanternwood-worktrees", "demo-abc123", "feature-x-def456");
    await mkdir(managedWorkspace, { recursive: true });
    const resolvedManagedWorkspace = await realpath(managedWorkspace);
    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === resolvedManagedWorkspace) {
        const identityResponse = repositoryIdentityResponse(
          command,
          resolvedRepository,
          join(resolvedRepository, ".git"),
          resolvedManagedWorkspace,
        );

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (options.cwd === resolvedRepository && command === "worktree list --porcelain") {
        return "";
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(resolveWorkspacePath(managedWorkspace, [parentRoot], { execFile })).rejects.toThrow(
      "Managed workspace provenance could not be verified",
    );
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

describe("branch worktree launch", () => {
  it("rejects invalid branch names for worktree launch", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const execFile = vi.fn(async () => "");

    await expect(
      launchBranchWorktree(
        { branch: "--detach", repositoryPath: repository },
        { allowRoots: [root], execFile, lanternwoodHome: await createTempDirectory() },
      ),
    ).rejects.toThrow("Invalid branch name");
  });

  it("rejects a managed worktree path when launch expects a source repository path", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const managedWorkspace = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/current",
      commonGitDirectory,
    );
    await mkdir(managedWorkspace, { recursive: true });
    await writeManagedWorktreeMetadata(managedWorkspace, {
      branch: "feature/current",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === resolvedRepository || options.cwd === managedWorkspace) {
        const identityResponse = repositoryIdentityResponse(
          command,
          resolvedRepository,
          commonGitDirectory,
          options.cwd === managedWorkspace ? managedWorkspace : resolvedRepository,
        );

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (options.cwd === resolvedRepository && command === "worktree list --porcelain") {
        return `worktree ${managedWorkspace}\nHEAD 1234567\nbranch refs/heads/feature/current\n\n`;
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(
      launchBranchWorktree({ branch: "feature/x", repositoryPath: managedWorkspace }, { allowRoots: [root], execFile }),
    ).rejects.toThrow("Repository path must point to a source repository, not a managed worktree");
  });

  it("reuses an existing worktree for the same repository and branch", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const existingWorktree = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(existingWorktree, { recursive: true });

    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (args[0] === "worktree" && args[1] === "list" && args[2] === "--porcelain") {
        return `worktree ${existingWorktree}\nHEAD 1234567\nbranch refs/heads/feature/x\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      throw new Error(`Unexpected git args: ${args.join(" ")}`);
    });

    await expect(
      launchBranchWorktree(
        { branch: "feature/x", repositoryPath: repository },
        { allowRoots: [root], execFile },
      ),
    ).resolves.toEqual({
      branch: "feature/x",
      created: false,
      repositoryPath: await realpath(repository),
      workspacePath: await realpath(existingWorktree),
    });
  });

  it("reuses an existing detached managed worktree for the same repository and branch path", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    await writeManagedWorktreeMetadata(expectedWorkspacePath, {
      branch: "feature/x",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (args[0] === "worktree" && args[1] === "list" && args[2] === "--porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 1234567\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === "branch --show-current") {
        return "\n";
      }

      if (command === "branch --points-at HEAD --format %(refname:short)") {
        return "feature/x\n";
      }

      if (command === "rev-parse HEAD" || command === "rev-parse feature/x") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      if (command === "status --porcelain") {
        return "";
      }

      if (command === "merge-base HEAD feature/x") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      throw new Error(`Unexpected git args: ${args.join(" ")}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: false,
      detached: true,
      repositoryPath: await realpath(repository),
      workspacePath: await realpath(expectedWorkspacePath),
    });
  });

  it("rejects a detached managed worktree that has diverged from the requested branch", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    await writeManagedWorktreeMetadata(expectedWorkspacePath, {
      branch: "feature/x",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 9999999\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === "branch --show-current") {
        return "\n";
      }

      if (command === "branch --points-at HEAD --format %(refname:short)") {
        return "feature/x\n";
      }

      if (command === "rev-parse HEAD") {
        return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
      }

      if (command === "rev-parse feature/x") {
        return "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n";
      }

      if (command === "status --porcelain") {
        return "";
      }

      if (command === "merge-base HEAD feature/x") {
        return "cccccccccccccccccccccccccccccccccccccccc\n";
      }

      throw new Error(`Unexpected git args: ${args.join(" ")}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).rejects.toThrow(
      "Managed worktree for feature/x has diverged from the requested branch",
    );
  });

  it("rejects a dirty detached managed worktree when it no longer matches the requested branch", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    await writeManagedWorktreeMetadata(expectedWorkspacePath, {
      branch: "feature/x",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 9999999\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === "branch --show-current") {
        return "\n";
      }

      if (command === "branch --points-at HEAD --format %(refname:short)") {
        return "feature/x\n";
      }

      if (command === "rev-parse HEAD") {
        return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
      }

      if (command === "rev-parse feature/x") {
        return "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n";
      }

      if (command === "status --porcelain") {
        return " M README.md\n";
      }

      throw new Error(`Unexpected git args: ${args.join(" ")}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).rejects.toThrow(
      "Managed worktree for feature/x has uncommitted changes",
    );
  });

  it("creates a new branch when the requested branch is verified absent and no origin exists", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    await writeManagedWorktreeMetadata(expectedWorkspacePath, {
      branch: "feature/x",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 9999999\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x" || command === "show-ref --verify --quiet refs/remotes/origin/feature/x") {
        const error = new Error("missing branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "branch --points-at HEAD --format %(refname:short)") {
        return "\n";
      }

      if (command === "remote get-url origin") {
        const error = new Error("missing origin");
        Object.assign(error, { code: 2 });
        throw error;
      }

      if (command === "symbolic-ref --quiet refs/remotes/origin/HEAD") {
        const error = new Error("missing origin head");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "branch --show-current") {
        return "main\n";
      }

      if (command === "rev-parse HEAD" || command === "rev-parse main") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      if (command === "status --porcelain") {
        return "";
      }

      if (command === "switch -C feature/x main") {
        return "";
      }

      throw new Error(`Unexpected git args: ${args.join(" ")}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: true,
      repositoryPath: await realpath(repository),
      workspacePath: await realpath(expectedWorkspacePath),
    });
  });

  it("does not reclaim an exact managed worktree path when it contains local-only commits", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    await writeManagedWorktreeMetadata(expectedWorkspacePath, {
      branch: "feature/x",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === resolvedRepository) {
        const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (options.cwd === expectedWorkspacePath) {
        const identityResponse = repositoryIdentityResponse(
          command,
          resolvedRepository,
          commonGitDirectory,
          expectedWorkspacePath,
        );

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 1234567\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x" || command === "show-ref --verify --quiet refs/remotes/origin/feature/x") {
        const error = new Error("missing branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "remote get-url origin") {
        const error = new Error("missing origin");
        Object.assign(error, { code: 2 });
        throw error;
      }

      if (command === "symbolic-ref --quiet refs/remotes/origin/HEAD") {
        const error = new Error("missing origin head");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "branch --show-current") {
        return "main\n";
      }

      if (command === "status --porcelain") {
        return "";
      }

      if (command === "rev-parse HEAD") {
        return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
      }

      if (command === "rev-parse main") {
        return "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n";
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).rejects.toThrow(
      "Managed worktree for feature/x cannot be safely reclaimed",
    );
  });

  it("creates a detached managed worktree when the primary checkout already owns the branch", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${repository}\nHEAD 1234567\nbranch refs/heads/feature/x\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === `worktree add --detach ${expectedWorkspacePath} feature/x`) {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: true,
      detached: true,
      repositoryPath: await realpath(repository),
      workspacePath: expectedWorkspacePath,
    });
  });

  it("reuses a legacy managed worktree path for the same branch", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const legacyWorkspacePath = join(await realpath(root), ".lanternwood-worktrees", "demo-legacy", "feature-x-legacy");
    await mkdir(legacyWorkspacePath, { recursive: true });

    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${legacyWorkspacePath}\nHEAD 1234567\nbranch refs/heads/feature/x\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: false,
      repositoryPath: resolvedRepository,
      workspacePath: await realpath(legacyWorkspacePath),
    });
  });

  it("reuses a legacy detached managed worktree when exactly one branch points at HEAD", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const legacyWorkspacePath = join(await realpath(root), ".lanternwood-worktrees", "demo-legacy", basename(expectedWorkspacePath));
    await mkdir(legacyWorkspacePath, { recursive: true });
    await writeManagedWorktreeMetadata(legacyWorkspacePath, {
      branch: "feature/x",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${legacyWorkspacePath}\nHEAD 1234567\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (options.cwd === legacyWorkspacePath && command === "branch --points-at HEAD --format %(refname:short)") {
        return "(HEAD detached at 1234567)\nfeature/x\n";
      }

      if (options.cwd === legacyWorkspacePath && command === "branch --show-current") {
        return "\n";
      }

      if (options.cwd === legacyWorkspacePath && command === "rev-parse HEAD") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      if (options.cwd === resolvedRepository && command === "rev-parse feature/x") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: false,
      detached: true,
      repositoryPath: resolvedRepository,
      workspacePath: await realpath(legacyWorkspacePath),
    });
  });

  it("reuses an exact detached managed worktree without metadata when exactly one branch points at HEAD", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });

    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 1234567\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (options.cwd === expectedWorkspacePath && command === "branch --points-at HEAD --format %(refname:short)") {
        return "(HEAD detached at 1234567)\nfeature/x\n";
      }

      if (options.cwd === expectedWorkspacePath && command === "branch --show-current") {
        return "\n";
      }

      if (options.cwd === expectedWorkspacePath && command === "rev-parse HEAD") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      if (options.cwd === resolvedRepository && command === "rev-parse feature/x") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: false,
      detached: true,
      repositoryPath: resolvedRepository,
      workspacePath: expectedWorkspacePath,
    });
  });

  it("fast-forwards a detached managed worktree with matching sidecar metadata when the branch has advanced", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    await writeManagedWorktreeMetadata(expectedWorkspacePath, {
      branch: "feature/x",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 1234567\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (options.cwd === expectedWorkspacePath && command === "branch --points-at HEAD --format %(refname:short)") {
        return "(HEAD detached at 1234567)\n";
      }

      if (options.cwd === expectedWorkspacePath && command === "branch --show-current") {
        return "\n";
      }

      if (options.cwd === expectedWorkspacePath && command === "rev-parse HEAD") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      if (options.cwd === resolvedRepository && command === "rev-parse feature/x") {
        return "abcdefabcdefabcdefabcdefabcdefabcdefabcd\n";
      }

      if (options.cwd === expectedWorkspacePath && command === "status --porcelain") {
        return "";
      }

      if (options.cwd === expectedWorkspacePath && command === "merge-base HEAD feature/x") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      if (options.cwd === expectedWorkspacePath && command === "checkout --detach feature/x") {
        return "";
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: false,
      detached: true,
      repositoryPath: resolvedRepository,
      workspacePath: expectedWorkspacePath,
    });
  });

  it("does not reuse a detached managed worktree when live pointed branches disagree with stale metadata", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    await writeManagedWorktreeMetadata(expectedWorkspacePath, {
      branch: "feature/x",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === resolvedRepository) {
        const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (options.cwd === await realpath(expectedWorkspacePath)) {
        const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory, await realpath(expectedWorkspacePath));

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 1234567\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (options.cwd === await realpath(expectedWorkspacePath) && command === "branch --points-at HEAD --format %(refname:short)") {
        return "other-branch\n";
      }

      if (command === `worktree add ${expectedWorkspacePath} feature/x`) {
        const error = new Error("Command failed");
        Object.assign(error, { code: 128, stderr: `fatal: '${expectedWorkspacePath}' already exists` });
        throw error;
      }

      if (command === `worktree add --detach ${expectedWorkspacePath} feature/x`) {
        const error = new Error("Command failed");
        Object.assign(error, { code: 128, stderr: `fatal: '${expectedWorkspacePath}' already exists` });
        throw error;
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).rejects.toThrow(
      "Managed workspace provenance could not be verified",
    );
  });

  it("reuses an exact detached managed worktree when branch probing fails but the live branch ref can still sync it", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    await writeManagedWorktreeMetadata(expectedWorkspacePath, {
      branch: "feature/x",
      repositoryPath: resolvedRepository,
    });

    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === resolvedRepository) {
        const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (options.cwd === await realpath(expectedWorkspacePath)) {
        const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory, await realpath(expectedWorkspacePath));

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 1234567\ndetached\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (options.cwd === await realpath(expectedWorkspacePath) && command === "branch --points-at HEAD --format %(refname:short)") {
        const error = new Error("branch probe failed");
        Object.assign(error, { code: 128, stderr: "fatal: probe failed" });
        throw error;
      }

      if (options.cwd === await realpath(expectedWorkspacePath) && command === "rev-parse HEAD") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      if (options.cwd === resolvedRepository && command === "rev-parse feature/x") {
        return "abcdefabcdefabcdefabcdefabcdefabcdefabcd\n";
      }

      if (options.cwd === await realpath(expectedWorkspacePath) && command === "status --porcelain") {
        return "";
      }

      if (options.cwd === await realpath(expectedWorkspacePath) && command === "merge-base HEAD feature/x") {
        return "1234567890abcdef1234567890abcdef12345678\n";
      }

      if (options.cwd === await realpath(expectedWorkspacePath) && command === "checkout --detach feature/x") {
        return "";
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: false,
      detached: true,
      repositoryPath: resolvedRepository,
      workspacePath: await realpath(expectedWorkspacePath),
    });
  });

  it("creates a deterministic managed worktree path when no existing worktree exists", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === `worktree add ${expectedWorkspacePath} feature/x`) {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: true,
      repositoryPath: await realpath(repository),
      workspacePath: expectedWorkspacePath,
    });
  });

  it("creates a new branch from the default base when it does not exist locally or on origin", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        const error = new Error("missing local branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "show-ref --verify --quiet refs/remotes/origin/feature/x") {
        const error = new Error("missing cached remote branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "remote get-url origin") {
        const error = new Error("missing origin");
        Object.assign(error, { code: 2 });
        throw error;
      }

      if (command === "symbolic-ref --quiet refs/remotes/origin/HEAD") {
        return "refs/remotes/origin/main\n";
      }

      if (command === `worktree add -b feature/x ${expectedWorkspacePath} refs/remotes/origin/main`) {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: true,
      repositoryPath: await realpath(repository),
      workspacePath: expectedWorkspacePath,
    });
  });

  it("fails closed when it cannot determine a verified base branch for a new branch", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        const error = new Error("missing local branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "show-ref --verify --quiet refs/remotes/origin/feature/x") {
        const error = new Error("missing cached remote branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "remote get-url origin") {
        const error = new Error("missing origin");
        Object.assign(error, { code: 2 });
        throw error;
      }

      if (command === "symbolic-ref --quiet refs/remotes/origin/HEAD") {
        const error = new Error("missing origin head");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "branch --show-current") {
        return "\n";
      }

      if (command.includes(expectedWorkspacePath)) {
        throw new Error(`Unexpected worktree creation: ${command}`);
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).rejects.toThrow(
      "Cannot determine a verified base branch for the requested repository",
    );
  });

  it("fetches a remote branch before launching when the local cache is stale", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        const error = new Error("missing local branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "show-ref --verify --quiet refs/remotes/origin/feature/x") {
        const error = new Error("missing cached remote branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "remote get-url origin") {
        return "git@github.com:openai/demo.git\n";
      }

      if (command === "ls-remote --exit-code --heads origin feature/x") {
        return "0123456789abcdef0123456789abcdef01234567\trefs/heads/feature/x\n";
      }

      if (command === "fetch origin refs/heads/feature/x:refs/remotes/origin/feature/x") {
        return "";
      }

      if (command === `worktree add -b feature/x ${expectedWorkspacePath} refs/remotes/origin/feature/x`) {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: true,
      repositoryPath: await realpath(repository),
      workspacePath: expectedWorkspacePath,
    });
  });

  it("reuses a cached remote-tracking branch without hitting the network", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        const error = new Error("missing local branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "show-ref -s refs/remotes/origin/feature/x") {
        return "0123456789abcdef0123456789abcdef01234567\n";
      }

      if (command === "remote get-url origin") {
        return "git@github.com:openai/demo.git\n";
      }

      if (command === "ls-remote --exit-code --heads origin feature/x") {
        return "0123456789abcdef0123456789abcdef01234567\trefs/heads/feature/x\n";
      }

      if (command === "fetch origin refs/heads/feature/x:refs/remotes/origin/feature/x") {
        throw new Error("unexpected fetch call");
      }

      if (command === `worktree add -b feature/x ${expectedWorkspacePath} refs/remotes/origin/feature/x`) {
        return "";
      }

      if (command.startsWith("ls-remote ") || command.startsWith("fetch origin ")) {
        throw new Error(`Unexpected network git args: ${command}`);
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: true,
      repositoryPath: await realpath(repository),
      workspacePath: expectedWorkspacePath,
    });
  });

  it("prefers the verified remote branch tip when a local branch is stale", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === "show-ref -s refs/remotes/origin/feature/x") {
        return "1111111111111111111111111111111111111111\n";
      }

      if (command === "show-ref -s refs/heads/feature/x") {
        return "0000000000000000000000000000000000000000\n";
      }

      if (command === "remote get-url origin") {
        return "git@github.com:openai/demo.git\n";
      }

      if (command === "ls-remote --exit-code --heads origin feature/x") {
        return "2222222222222222222222222222222222222222\trefs/heads/feature/x\n";
      }

      if (command === "fetch origin refs/heads/feature/x:refs/remotes/origin/feature/x") {
        return "";
      }

      if (command === `worktree add ${expectedWorkspacePath} refs/remotes/origin/feature/x`) {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: true,
      repositoryPath: await realpath(repository),
      workspacePath: expectedWorkspacePath,
    });
  });

  it("fails when remote verification fails for transport/auth errors", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        const error = new Error("missing local branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "show-ref -s refs/remotes/origin/feature/x") {
        const error = new Error("missing cached remote branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "remote get-url origin") {
        return "git@github.com:openai/demo.git\n";
      }

      if (command === "ls-remote --exit-code --heads origin feature/x") {
        const error = new Error("origin unavailable");
        Object.assign(error, { code: 128 });
        throw error;
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).rejects.toThrow(
      "origin unavailable",
    );
  });

  it("recovers when concurrent branch creation makes worktree add -b report that the branch already exists", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    let listedAfterCollision = false;
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        if (!listedAfterCollision) {
          listedAfterCollision = true;
          return "";
        }

        return `worktree ${expectedWorkspacePath}\nHEAD 1234567\nbranch refs/heads/feature/x\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        const error = new Error("missing local branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "show-ref --verify --quiet refs/remotes/origin/feature/x") {
        const error = new Error("missing cached remote branch");
        Object.assign(error, { code: 1 });
        throw error;
      }

      if (command === "remote get-url origin") {
        const error = new Error("missing origin");
        Object.assign(error, { code: 2 });
        throw error;
      }

      if (command === "ls-remote --exit-code --heads origin feature/x") {
        const error = new Error("missing upstream branch");
        Object.assign(error, { code: 2 });
        throw error;
      }

      if (command === "symbolic-ref --quiet refs/remotes/origin/HEAD") {
        return "refs/remotes/origin/main\n";
      }

      if (command === `worktree add -b feature/x ${expectedWorkspacePath} refs/remotes/origin/main`) {
        const error = new Error("Command failed");
        Object.assign(error, { code: 128, stderr: "fatal: a branch named 'feature/x' already exists" });
        throw error;
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: false,
      repositoryPath: resolvedRepository,
      workspacePath: expectedWorkspacePath,
    });
  });

  it("ignores prunable branch worktree entries and recreates the managed path", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${join(root, ".lanternwood-worktrees", "demo-stale", "feature-x")}\nHEAD 1234567\nbranch refs/heads/feature/x\nprunable gitdir file points to non-existent location\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === `worktree add ${expectedWorkspacePath} feature/x`) {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).resolves.toEqual({
      branch: "feature/x",
      created: true,
      repositoryPath: await realpath(repository),
      workspacePath: expectedWorkspacePath,
    });
  });

  it("keeps same-name repositories distinct in the managed worktree path", () => {
    const worktreeBase = "/Users/eunhwa/IdeaProjects/.lanternwood-worktrees";

    expect(worktreePathForBranch(worktreeBase, "/Users/eunhwa/IdeaProjects/drive", "feature/x")).not.toBe(
      worktreePathForBranch(worktreeBase, "/Users/eunhwa/IdeaProjects/archive/drive", "feature/x"),
    );
  });

  it("keeps similar branch slugs distinct in the managed worktree path", () => {
    const worktreeBase = "/Users/eunhwa/IdeaProjects/.lanternwood-worktrees";
    const repository = "/Users/eunhwa/IdeaProjects/drive";

    expect(worktreePathForBranch(worktreeBase, repository, "feature/x")).not.toBe(
      worktreePathForBranch(worktreeBase, repository, "feature-x"),
    );
  });

  it("surfaces git path-collision failures without relabeling them as repository errors", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === `worktree add ${expectedWorkspacePath} feature/x`) {
        const error = new Error("Command failed");
        Object.assign(error, { code: 128, stderr: "fatal: '/tmp/collision' already exists" });
        throw error;
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).rejects.toThrow(
      "fatal: '/tmp/collision' already exists",
    );
  });

  it("canonicalizes linked worktree launches to the underlying repository path", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const linkedWorktreePath = join(root, "demo-linked");
    await mkdir(linkedWorktreePath, { recursive: true });
    const resolvedRepository = await realpath(repository);
    const resolvedLinkedWorktreePath = await realpath(linkedWorktreePath);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory, resolvedLinkedWorktreePath);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === `worktree add ${expectedWorkspacePath} feature/x`) {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(
      launchBranchWorktree({ branch: "feature/x", repositoryPath: linkedWorktreePath }, { allowRoots: [root], execFile }),
    ).resolves.toEqual({
      branch: "feature/x",
      created: true,
      repositoryPath: resolvedRepository,
      workspacePath: expectedWorkspacePath,
    });
  });

  it("uses the most specific allowed root for the managed worktree home", async () => {
    const parentRoot = await createTempDirectory();
    const childRoot = join(parentRoot, "IdeaProjects");
    await mkdir(childRoot, { recursive: true });
    const repository = await createRepository(childRoot, "demo");
    const resolvedRepository = await realpath(repository);
    const resolvedChildRoot = await realpath(childRoot);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(resolvedChildRoot, ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === `worktree add ${expectedWorkspacePath} feature/x`) {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(
      launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [parentRoot, childRoot], execFile }),
    ).resolves.toEqual({
      branch: "feature/x",
      created: true,
      repositoryPath: resolvedRepository,
      workspacePath: expectedWorkspacePath,
    });
  });

  it("creates a new managed worktree under the active allow root instead of reusing a legacy outer home", async () => {
    const parentRoot = await createTempDirectory();
    const childRoot = join(parentRoot, "IdeaProjects");
    await mkdir(childRoot, { recursive: true });
    const repository = await createRepository(childRoot, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(childRoot), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    const legacyWorkspacePath = worktreePathForBranch(
      join(await realpath(parentRoot), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(legacyWorkspacePath, { recursive: true });
    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === resolvedRepository) {
        const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (options.cwd === await realpath(legacyWorkspacePath)) {
        const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory, await realpath(legacyWorkspacePath));

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${legacyWorkspacePath}\nHEAD 1234567\nbranch refs/heads/feature/x\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === `worktree add --detach ${expectedWorkspacePath} feature/x`) {
        return "";
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(
      launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [parentRoot, childRoot], execFile }),
    ).resolves.toEqual({
      branch: "feature/x",
      created: true,
      detached: true,
      repositoryPath: resolvedRepository,
      workspacePath: expectedWorkspacePath,
    });
  });

  it("rejects repository-scoped allow roots so managed worktrees do not dirty the source repository", async () => {
    const parentRoot = await createTempDirectory();
    const repository = await createRepository(parentRoot, "demo");
    const resolvedRepository = await realpath(repository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(" ");
      const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

      if (identityResponse !== undefined) {
        return identityResponse;
      }

      if (command === "worktree list --porcelain") {
        return "";
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      throw new Error(`Unexpected git args: ${command}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [repository], execFile })).rejects.toThrow(
      "Repository allow root must be a parent directory so managed worktrees stay outside the repository checkout",
    );
  });

  it("does not reuse an exact managed worktree path when it belongs to another repository identity", async () => {
    const root = await createTempDirectory();
    const repository = await createRepository(root, "demo");
    const archiveRepository = await createRepository(root, "archive-demo");
    const resolvedRepository = await realpath(repository);
    const resolvedArchiveRepository = await realpath(archiveRepository);
    const commonGitDirectory = join(resolvedRepository, ".git");
    const expectedWorkspacePath = worktreePathForBranch(
      join(await realpath(root), ".lanternwood-worktrees"),
      resolvedRepository,
      "feature/x",
      commonGitDirectory,
    );
    await mkdir(expectedWorkspacePath, { recursive: true });
    const execFile = vi.fn(async (_file: string, args: string[], options: { cwd: string }) => {
      const command = args.join(" ");

      if (options.cwd === resolvedRepository) {
        const identityResponse = repositoryIdentityResponse(command, resolvedRepository, commonGitDirectory);

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (options.cwd === expectedWorkspacePath) {
        const identityResponse = repositoryIdentityResponse(
          command,
          resolvedArchiveRepository,
          join(resolvedArchiveRepository, ".git"),
          expectedWorkspacePath,
        );

        if (identityResponse !== undefined) {
          return identityResponse;
        }
      }

      if (command === "worktree list --porcelain") {
        return `worktree ${expectedWorkspacePath}\nHEAD 1234567\nbranch refs/heads/feature/x\n\n`;
      }

      if (command === "show-ref --verify --quiet refs/heads/feature/x") {
        return "";
      }

      if (command === `worktree add ${expectedWorkspacePath} feature/x`) {
        const error = new Error("Command failed");
        Object.assign(error, { code: 128, stderr: `fatal: '${expectedWorkspacePath}' already exists` });
        throw error;
      }

      if (command === `worktree add --detach ${expectedWorkspacePath} feature/x`) {
        const error = new Error("Command failed");
        Object.assign(error, { code: 128, stderr: `fatal: '${expectedWorkspacePath}' already exists` });
        throw error;
      }

      throw new Error(`Unexpected git args: ${command} @ ${options.cwd}`);
    });

    await expect(launchBranchWorktree({ branch: "feature/x", repositoryPath: repository }, { allowRoots: [root], execFile })).rejects.toThrow(
      "Managed workspace provenance could not be verified",
    );
  });
});
