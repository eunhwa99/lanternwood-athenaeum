import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { isManagedWorktreePath, readManagedWorktreeMetadata, writeManagedWorktreeMetadata } from "./managedWorktreeMetadata";

type NormalizeWorkspaceInputOptions = {
  baseDirectory?: string;
  homeDirectory?: string;
};

type ResolveWorkspacePathOptions = NormalizeWorkspaceInputOptions & {
  allowMissing?: boolean;
  execFile?: GitExecFile;
};

const execFile = promisify(execFileCallback);

export type WorkspaceOption = {
  name: string;
  path: string;
  root: string;
};

export type LaunchBranchWorktreeInput = {
  branch: string;
  repositoryPath: string;
};

export type LaunchBranchWorktreeResult = {
  branch: string;
  created: boolean;
  detached?: boolean;
  repositoryPath: string;
  workspacePath: string;
};

export type GitExecFile = (file: string, args: string[], options: { cwd: string }) => Promise<string>;

type ParsedWorktree = {
  branchRef?: string;
  detached: boolean;
  path: string;
  prunable: boolean;
};

function isInsideRoot(path: string, root: string) {
  const relativePath = relative(root, path);

  return relativePath === "" || (!relativePath.startsWith("..") && !resolve(relativePath).startsWith(`${sep}..`));
}

function hasControlCharacter(input: string) {
  return Array.from(input).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function stableHash(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function readableSlug(value: string, fallback: string) {
  const slug = value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return slug || fallback;
}

export function normalizeWorkspaceInput(workspacePath: string, options: NormalizeWorkspaceInputOptions = {}) {
  const trimmedPath = workspacePath.trim();
  const homeDirectory = options.homeDirectory ?? homedir();

  if (!trimmedPath) {
    throw new Error("Missing workspace path");
  }

  if (trimmedPath === "~") {
    return homeDirectory;
  }

  if (trimmedPath.startsWith("~/")) {
    return join(homeDirectory, trimmedPath.slice(2));
  }

  if (!isAbsolute(trimmedPath)) {
    return resolve(options.baseDirectory ?? process.cwd(), trimmedPath);
  }

  return trimmedPath;
}

export function validateBranchName(branch: string) {
  const trimmedBranch = branch.trim();

  if (
    !trimmedBranch ||
    trimmedBranch === "HEAD" ||
    trimmedBranch.startsWith("-") ||
    trimmedBranch.startsWith(".") ||
    trimmedBranch.endsWith(".") ||
    trimmedBranch.startsWith("/") ||
    trimmedBranch.endsWith("/") ||
    trimmedBranch.includes("..") ||
    trimmedBranch.includes("@{") ||
    hasControlCharacter(trimmedBranch) ||
    /[\s~^:?*[\]\\]/.test(trimmedBranch) ||
    trimmedBranch.split("/").some((segment) => !segment || segment.startsWith(".") || segment.endsWith(".lock"))
  ) {
    throw new Error("Invalid branch name");
  }

  return trimmedBranch;
}

export function worktreePathForBranch(
  lanternwoodHome: string,
  repositoryPath: string,
  branch: string,
  repositoryIdentity = repositoryPath,
  repositoryLabel = basename(repositoryPath),
) {
  const repositoryDirectory = `${readableSlug(repositoryLabel, "repo")}-${stableHash(repositoryIdentity)}`;
  const branchDirectory = `${readableSlug(branch, "worktree")}-${stableHash(branch)}`;

  return join(lanternwoodHome, repositoryDirectory, branchDirectory);
}

export function parsePorcelainWorktrees(output: string): ParsedWorktree[] {
  return output
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block): ParsedWorktree | undefined => {
      const path = block.match(/^worktree (.+)$/m)?.[1];
      const branchRef = block.match(/^branch (.+)$/m)?.[1];
      const detached = /^detached\b/m.test(block);
      const prunable = /^prunable\b/m.test(block);

      return path ? { branchRef, detached, path, prunable } : undefined;
    })
    .filter((entry): entry is ParsedWorktree => entry !== undefined);
}

export async function defaultGitExecFile(file: string, args: string[], options: { cwd: string }) {
  const result = await execFile(file, args, { cwd: options.cwd, encoding: "utf8" });
  return result.stdout;
}

async function branchExistsLocally(runGit: GitExecFile, repositoryPath: string, branch: string) {
  try {
    await runGit("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repositoryPath });
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === 1) {
      return false;
    }

    throw error;
  }
}

async function isBranchUpToDateWithRemote(runGit: GitExecFile, repositoryPath: string, branch: string) {
  try {
    const [localCommit, remoteCommit] = await Promise.all([
      runGit("git", ["show-ref", "-s", `refs/heads/${branch}`], { cwd: repositoryPath }).then((value) => value.trim()),
      runGit("git", ["show-ref", "-s", `refs/remotes/origin/${branch}`], { cwd: repositoryPath }).then((value) => value.trim()),
    ]);

    return localCommit !== "" && localCommit === remoteCommit;
  } catch {
    return false;
  }
}

function hasGitExitCode(error: unknown, codes: number[]) {
  return typeof error === "object" && error !== null && "code" in error && codes.includes(Number(error.code));
}

async function ensureRemoteBranchRef(runGit: GitExecFile, repositoryPath: string, branch: string, localBranchExists: boolean) {
  if (localBranchExists) {
    const remoteRef = await runGit("git", ["show-ref", "-s", `refs/remotes/origin/${branch}`], { cwd: repositoryPath }).catch(
      () => undefined as string | undefined,
    );

    if (!remoteRef?.trim()) {
      return false;
    }

    await runGit("git", ["fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: repositoryPath });

    return true;
  }

  let originExists = true;

  try {
    await runGit("git", ["remote", "get-url", "origin"], { cwd: repositoryPath });
  } catch (error) {
    if (hasGitExitCode(error, [2])) {
      originExists = false;
    } else {
      throw error;
    }
  }

  if (!originExists) {
    return false;
  }

  try {
    const remoteRef = await runGit("git", ["ls-remote", "--exit-code", "--heads", "origin", branch], { cwd: repositoryPath });
    const remoteOid = remoteRef.trim().split(/\s+/)[0];

    if (!remoteOid) {
      return false;
    }

    const localOid = await runGit("git", ["show-ref", "-s", `refs/remotes/origin/${branch}`], {
      cwd: repositoryPath,
    }).catch(() => undefined as string | undefined);

    if (!localOid || localOid.trim() !== remoteOid) {
      await runGit("git", ["fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: repositoryPath });
    }

    return true;
  } catch (error) {
    if (hasGitExitCode(error, [1])) {
      return false;
    }

    throw error;
  }
}

async function resolveWorktreeBaseBranch(runGit: GitExecFile, repositoryPath: string) {
  try {
    const originHead = await runGit("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], { cwd: repositoryPath });
    const baseBranch = originHead.trim();

    if (baseBranch) {
      return baseBranch;
    }
  } catch (error) {
    if (!(typeof error === "object" && error && "code" in error && error.code === 1)) {
      throw error;
    }
  }

  const currentBranch = (await runGit("git", ["branch", "--show-current"], { cwd: repositoryPath })).trim();

  if (currentBranch) {
    return currentBranch;
  }

  throw new Error("Cannot determine a verified base branch for the requested repository");
}

async function detachedWorkspaceContainsBranch(runGit: GitExecFile, workspacePath: string, branch: string) {
  const pointedBranches = await detachedWorkspacePointedBranches(runGit, workspacePath);

  return pointedBranches.includes(branch);
}

async function detachedWorkspacePointsOnlyToBranch(runGit: GitExecFile, workspacePath: string, branch: string) {
  const pointedBranches = await detachedWorkspacePointedBranches(runGit, workspacePath);

  return pointedBranches.length === 1 && pointedBranches[0] === branch;
}

async function detachedWorkspacePointedBranches(runGit: GitExecFile, workspacePath: string) {
  return runGit("git", ["branch", "--points-at", "HEAD", "--format", "%(refname:short)"], {
    cwd: workspacePath,
  })
    .then(parsePointedBranchNames)
    .catch(() => [] as string[]);
}

function parsePointedBranchNames(output: string) {
  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => Boolean(entry) && !entry.startsWith("("));
}

async function resolveRepositoryIdentity(runGit: GitExecFile, repositoryPath: string) {
  const repositoryRoot = (
    await runGit("git", ["rev-parse", "--show-toplevel"], {
      cwd: repositoryPath,
    })
  ).trim();
  const resolvedRepositoryRoot = await realpath(repositoryRoot).catch(() => repositoryRoot);
  const commonGitDirectoryOutput = (
    await runGit("git", ["rev-parse", "--git-common-dir"], {
      cwd: repositoryPath,
    })
  ).trim();
  const commonGitDirectory = await realpath(
    isAbsolute(commonGitDirectoryOutput) ? commonGitDirectoryOutput : resolve(repositoryPath, commonGitDirectoryOutput),
  ).catch(() => (isAbsolute(commonGitDirectoryOutput) ? commonGitDirectoryOutput : resolve(repositoryPath, commonGitDirectoryOutput)));
  const canonicalRepositoryPath =
    basename(commonGitDirectory) === ".git"
      ? await realpath(dirname(commonGitDirectory)).catch(() => dirname(commonGitDirectory))
      : resolvedRepositoryRoot;
  const repositoryLabel = basename(canonicalRepositoryPath);

  return {
    commonGitDirectory,
    repositoryPath: canonicalRepositoryPath,
    repositoryLabel,
  };
}

function normalizeGitError(error: unknown, repositoryPath: string) {
  if (typeof error === "object" && error) {
    const execError = error as { stderr?: unknown };
    const stderr = typeof execError.stderr === "string" ? execError.stderr.trim() : "";
    const message = error instanceof Error ? error.message.trim() : "";
    const combined = `${stderr}\n${message}`.trim();

    if (/not a git repository/i.test(combined)) {
      return new Error(`Repository is not a git repository: ${repositoryPath}`);
    }

    if (stderr) {
      return new Error(stderr);
    }

    if (message) {
      return new Error(message);
    }
  }

  return error instanceof Error ? error : new Error(String(error));
}

function isWorktreeCollisionError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const stderr = typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr?: string }).stderr ?? "" : "";
  const combined = `${stderr}\n${error.message}`.trim();

  return /already exists|already registered|already checked out at|branch named .* already exists/i.test(combined);
}

async function resolveAllowedRoots(allowRoots: string[]) {
  return (
    await Promise.all(
      allowRoots.map(async (root) => {
        try {
          return await realpath(normalizeWorkspaceInput(root));
        } catch {
          return undefined;
        }
      }),
    )
  ).filter((root): root is string => Boolean(root));
}

function allowedRootForPath(path: string, rootRealPaths: string[]) {
  return rootRealPaths
    .filter((root) => isInsideRoot(path, root))
    .sort((left, right) => right.length - left.length)[0];
}

function managedHomeRootForRepository(path: string, rootRealPaths: string[]) {
  return rootRealPaths
    .filter((root) => isInsideRoot(path, root) && root !== path)
    .sort((left, right) => right.length - left.length)[0];
}

async function verifyManagedWorkspacePath(workspacePath: string, rootRealPaths: string[], runGit: GitExecFile) {
  const repositoryIdentity = await resolveRepositoryIdentity(runGit, workspacePath).catch(() => undefined);

  if (!repositoryIdentity || repositoryIdentity.repositoryPath === workspacePath) {
    throw new Error("Managed workspace provenance could not be verified");
  }

  if (!allowedRootForPath(repositoryIdentity.repositoryPath, rootRealPaths)) {
    throw new Error("Managed workspace provenance could not be verified");
  }

  const worktrees = parsePorcelainWorktrees(
    await runGit("git", ["worktree", "list", "--porcelain"], { cwd: repositoryIdentity.repositoryPath }),
  );
  const registeredWorktree = (
    await Promise.all(
      worktrees
        .filter((entry) => !entry.prunable)
        .map(async (entry) => ({
          ...entry,
          path: await realpath(entry.path).catch((error: unknown) => {
            if (isMissingWorkspaceError(error)) {
              return undefined;
            }

            return normalizeWorkspaceInput(entry.path);
          }),
        })),
    )
  ).find((entry) => entry.path === workspacePath);

  if (!registeredWorktree) {
    throw new Error("Managed workspace provenance could not be verified");
  }

  const metadata = await readManagedWorktreeMetadata(workspacePath);

  if (!registeredWorktree.detached) {
    const liveBranch = registeredWorktree.branchRef?.replace(/^refs\/heads\//, "");

    if (!liveBranch) {
      throw new Error("Managed workspace provenance could not be verified");
    }

    if (!metadata) {
      return;
    }

    if (metadata.repositoryPath !== repositoryIdentity.repositoryPath || liveBranch !== metadata.branch) {
      throw new Error("Managed workspace provenance could not be verified");
    }

    return;
  }

  if (!metadata) {
    const pointedBranches = await runGit("git", ["branch", "--points-at", "HEAD", "--format", "%(refname:short)"], {
      cwd: workspacePath,
    })
      .then(parsePointedBranchNames)
      .catch(() => [] as string[]);

    if (pointedBranches.length === 1) {
      return;
    }

    throw new Error("Managed workspace provenance could not be verified");
  }

  if (metadata.repositoryPath !== repositoryIdentity.repositoryPath || !(await detachedWorkspaceContainsBranch(runGit, workspacePath, metadata.branch))) {
    throw new Error("Managed workspace provenance could not be verified");
  }
}

export async function resolveWorkspacePath(
  workspacePath: string,
  allowRoots: string[],
  options: ResolveWorkspacePathOptions = {},
) {
  const normalizedWorkspacePath = normalizeWorkspaceInput(workspacePath, options);
  const workspaceRealPath = await realpath(normalizedWorkspacePath).catch((error: unknown) => {
    if (options.allowMissing && isMissingWorkspaceError(error)) {
      return normalizedWorkspacePath;
    }

    throw error;
  });
  const rootRealPaths = await resolveAllowedRoots(allowRoots);

  if (rootRealPaths.some((root) => isInsideRoot(workspaceRealPath, root))) {
    if (isManagedWorktreePath(workspaceRealPath) && options.execFile) {
      await verifyManagedWorkspacePath(workspaceRealPath, rootRealPaths, options.execFile);
    }

    return workspaceRealPath;
  }

  throw new Error("Workspace is outside the allowed roots");
}

export async function discoverWorkspaceOptions(allowRoots: string[]) {
  const roots = await resolveAllowedRoots(allowRoots);
  const discovered = await Promise.all(
    roots.map(async (root) => {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      const workspaces = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map(async (entry): Promise<WorkspaceOption | undefined> => {
            try {
              const path = await realpath(join(root, entry.name));

              return { name: entry.name, path, root };
            } catch {
              return undefined;
            }
          }),
      );

      return workspaces.filter((workspace): workspace is WorkspaceOption => Boolean(workspace));
    }),
  );

  return {
    roots,
    workspaces: discovered
      .flat()
      .sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path)),
  };
}

function isMissingWorkspaceError(error: unknown) {
  return error instanceof Error && /no such file or directory|enoent/i.test(error.message);
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveCompatibleManagedWorktreeEntry(
  runGit: GitExecFile,
  worktrees: ParsedWorktree[],
  managedWorkspacePath: string,
  managedHome: string,
  branch: string,
  repositoryPath: string,
  options: { branchExists: boolean },
) {
  for (const worktree of worktrees) {
    if (worktree.prunable) {
      continue;
    }

    const existingWorktreePath = await realpath(worktree.path).catch((error: unknown) => {
      if (isMissingWorkspaceError(error)) {
        return undefined;
      }

      return normalizeWorkspaceInput(worktree.path);
    });

    if (!existingWorktreePath || !isManagedWorktreePath(existingWorktreePath)) {
      continue;
    }

    if (!isInsideRoot(existingWorktreePath, managedHome)) {
      continue;
    }

    const candidateRepositoryPath = await resolveRepositoryIdentity(runGit, existingWorktreePath)
      .then((identity) => identity.repositoryPath)
      .catch(() => undefined);

    if (candidateRepositoryPath !== repositoryPath) {
      continue;
    }

    if (worktree.branchRef === `refs/heads/${branch}`) {
      return { ...worktree, path: existingWorktreePath };
    }

    if (!worktree.detached) {
      continue;
    }

    const metadata = await readManagedWorktreeMetadata(existingWorktreePath);

    if (!metadata) {
      if (await detachedWorkspacePointsOnlyToBranch(runGit, existingWorktreePath, branch)) {
        return { ...worktree, path: existingWorktreePath };
      }

      continue;
    }

    if (metadata.repositoryPath !== repositoryPath || metadata.branch !== branch) {
      continue;
    }

    const pointedBranches = await detachedWorkspacePointedBranches(runGit, existingWorktreePath);

    if (pointedBranches.length > 0 && !pointedBranches.includes(branch)) {
      continue;
    }

    if (pointedBranches.length === 0 && !options.branchExists) {
      continue;
    }

    return { ...worktree, path: existingWorktreePath };
  }

  return undefined;
}

async function resolveExactManagedWorktreeEntry(
  runGit: GitExecFile,
  worktrees: ParsedWorktree[],
  managedWorkspacePath: string,
  managedHome: string,
  repositoryPath: string,
) {
  for (const worktree of worktrees) {
    if (worktree.prunable) {
      continue;
    }

    const existingWorktreePath = await realpath(worktree.path).catch((error: unknown) => {
      if (isMissingWorkspaceError(error)) {
        return undefined;
      }

      return normalizeWorkspaceInput(worktree.path);
    });

    if (!existingWorktreePath || existingWorktreePath !== managedWorkspacePath || !isManagedWorktreePath(existingWorktreePath)) {
      continue;
    }

    if (!isInsideRoot(existingWorktreePath, managedHome)) {
      continue;
    }

    const candidateRepositoryPath = await resolveRepositoryIdentity(runGit, existingWorktreePath)
      .then((identity) => identity.repositoryPath)
      .catch(() => undefined);

    if (candidateRepositoryPath !== repositoryPath) {
      continue;
    }

    return { ...worktree, path: existingWorktreePath };
  }

  return undefined;
}

async function resolveAnyExactManagedWorktreeEntry(
  worktrees: ParsedWorktree[],
  managedWorkspacePath: string,
  managedHome: string,
) {
  for (const worktree of worktrees) {
    if (worktree.prunable) {
      continue;
    }

    const existingWorktreePath = await realpath(worktree.path).catch((error: unknown) => {
      if (isMissingWorkspaceError(error)) {
        return undefined;
      }

      return normalizeWorkspaceInput(worktree.path);
    });

    if (!existingWorktreePath || existingWorktreePath !== managedWorkspacePath || !isManagedWorktreePath(existingWorktreePath)) {
      continue;
    }

    if (!isInsideRoot(existingWorktreePath, managedHome)) {
      continue;
    }

    return { ...worktree, path: existingWorktreePath };
  }

  return undefined;
}

async function resolveRevision(runGit: GitExecFile, cwd: string, revision: string) {
  return (await runGit("git", ["rev-parse", revision], { cwd })).trim();
}

async function resolveMergeBase(runGit: GitExecFile, cwd: string, left: string, right: string) {
  return (await runGit("git", ["merge-base", left, right], { cwd })).trim();
}

async function syncDetachedManagedWorktree(
  runGit: GitExecFile,
  repositoryPath: string,
  workspacePath: string,
  branch: string,
) {
  const localBranchExists = await branchExistsLocally(runGit, repositoryPath, branch);
  const targetRef = localBranchExists
    ? branch
    : (await ensureRemoteBranchRef(runGit, repositoryPath, branch, localBranchExists))
      ? `refs/remotes/origin/${branch}`
      : undefined;

  if (!targetRef) {
    throw new Error(`Branch ${branch} does not exist locally or on origin`);
  }

  const [workspaceHead, targetHead] = await Promise.all([
    resolveRevision(runGit, workspacePath, "HEAD"),
    resolveRevision(runGit, repositoryPath, targetRef),
  ]);

  if (workspaceHead === targetHead) {
    return;
  }

  const statusOutput = await runGit("git", ["status", "--porcelain"], { cwd: workspacePath });

  if (statusOutput.trim()) {
    throw new Error(`Managed worktree for ${branch} has uncommitted changes`);
  }

  const sharedBase = await resolveMergeBase(runGit, workspacePath, "HEAD", targetRef);

  if (sharedBase !== workspaceHead) {
    throw new Error(`Managed worktree for ${branch} has diverged from the requested branch`);
  }

  await runGit("git", ["checkout", "--detach", targetRef], { cwd: workspacePath });
}

async function syncManagedWorktree(
  runGit: GitExecFile,
  repositoryPath: string,
  workspacePath: string,
  branch: string,
  options: { branchAlreadyCheckedOut: boolean; branchRef?: string; detached: boolean },
) {
  if (!options.detached && options.branchRef === `refs/heads/${branch}`) {
    return;
  }

  if (options.detached || options.branchAlreadyCheckedOut) {
    await syncDetachedManagedWorktree(runGit, repositoryPath, workspacePath, branch);
    return;
  }

  const statusOutput = await runGit("git", ["status", "--porcelain"], { cwd: workspacePath });

  if (statusOutput.trim()) {
    throw new Error(`Managed worktree for ${branch} has uncommitted changes`);
  }

  await runGit("git", ["switch", branch], { cwd: workspacePath });
}

async function reclaimManagedWorktreeForNewBranch(
  runGit: GitExecFile,
  workspacePath: string,
  branch: string,
  baseBranch: string,
) {
  const metadata = await readManagedWorktreeMetadata(workspacePath);

  if (!metadata || metadata.branch !== branch) {
    throw new Error("Managed workspace provenance could not be verified");
  }

  const statusOutput = await runGit("git", ["status", "--porcelain"], { cwd: workspacePath });

  if (statusOutput.trim()) {
    throw new Error(`Managed worktree for ${branch} has uncommitted changes`);
  }

  const [workspaceHead, baseBranchHead] = await Promise.all([
    resolveRevision(runGit, workspacePath, "HEAD"),
    resolveRevision(runGit, workspacePath, baseBranch),
  ]);

  if (workspaceHead !== baseBranchHead) {
    throw new Error(`Managed worktree for ${branch} cannot be safely reclaimed`);
  }

  await runGit("git", ["switch", "-C", branch, baseBranch], { cwd: workspacePath });
}

async function persistManagedWorktreeMetadata(workspacePath: string, repositoryPath: string, branch: string) {
  await writeManagedWorktreeMetadata(workspacePath, { branch, repositoryPath });
}

function isBranchCheckedOutElsewhere(worktrees: ParsedWorktree[], branch: string) {
  return worktrees.some((worktree) => worktree.branchRef === `refs/heads/${branch}` && !worktree.prunable);
}

function defaultLanternwoodHome(repositoryRoot: string) {
  return join(repositoryRoot, ".lanternwood-worktrees");
}

export async function launchBranchWorktree(
  input: LaunchBranchWorktreeInput,
  options: {
    allowRoots: string[];
    execFile?: GitExecFile;
    lanternwoodHome?: string;
  },
): Promise<LaunchBranchWorktreeResult> {
  const runGit = options.execFile ?? defaultGitExecFile;
  const requestedRepositoryPath = await resolveWorkspacePath(input.repositoryPath, options.allowRoots, { execFile: runGit });
  const branch = validateBranchName(input.branch);
  let normalizedRepositoryPath = requestedRepositoryPath;

  try {
    if (isManagedWorktreePath(requestedRepositoryPath)) {
      throw new Error("Repository path must point to a source repository, not a managed worktree");
    }

    const { commonGitDirectory, repositoryLabel, repositoryPath } = await resolveRepositoryIdentity(runGit, requestedRepositoryPath);
    normalizedRepositoryPath = repositoryPath;
    const rootRealPaths = await resolveAllowedRoots(options.allowRoots);
    const repositoryRoot = managedHomeRootForRepository(repositoryPath, rootRealPaths);

    if (!repositoryRoot) {
      throw new Error("Repository allow root must be a parent directory so managed worktrees stay outside the repository checkout");
    }

    const lanternwoodHome = options.lanternwoodHome ?? defaultLanternwoodHome(repositoryRoot);
    const workspacePath = worktreePathForBranch(lanternwoodHome, repositoryPath, branch, commonGitDirectory, repositoryLabel);
    const localBranchExists = await branchExistsLocally(runGit, repositoryPath, branch);
    const remoteBranchExists = await ensureRemoteBranchRef(runGit, repositoryPath, branch, localBranchExists);
    const localBranchMatchesRemote =
      localBranchExists && remoteBranchExists ? await isBranchUpToDateWithRemote(runGit, repositoryPath, branch) : false;
    const worktrees = parsePorcelainWorktrees(
      await runGit("git", ["worktree", "list", "--porcelain"], { cwd: repositoryPath }),
    );
    const exactManagedWorktree = await resolveExactManagedWorktreeEntry(
      runGit,
      worktrees,
      workspacePath,
      lanternwoodHome,
      repositoryPath,
    );
    const exactManagedSlot = await resolveAnyExactManagedWorktreeEntry(worktrees, workspacePath, lanternwoodHome);
    if (exactManagedSlot && !exactManagedWorktree) {
      throw new Error("Managed workspace provenance could not be verified");
    }

    const existingWorktree = await resolveCompatibleManagedWorktreeEntry(
      runGit,
      worktrees,
      workspacePath,
      lanternwoodHome,
      branch,
      repositoryPath,
      { branchExists: localBranchExists || remoteBranchExists },
    );
    const branchAlreadyCheckedOut = isBranchCheckedOutElsewhere(worktrees, branch);

    if (existingWorktree) {
      await syncManagedWorktree(runGit, repositoryPath, existingWorktree.path, branch, {
        branchAlreadyCheckedOut,
        branchRef: existingWorktree.branchRef,
        detached: existingWorktree.detached,
      });
      await persistManagedWorktreeMetadata(existingWorktree.path, repositoryPath, branch);

      return {
        branch,
        created: false,
        detached: existingWorktree.detached || undefined,
        repositoryPath,
        workspacePath: await resolveWorkspacePath(existingWorktree.path, options.allowRoots),
      };
    }

    await mkdir(dirname(workspacePath), { recursive: true });

    try {
      if ((localBranchExists || remoteBranchExists) && exactManagedWorktree) {
        throw new Error("Managed workspace provenance could not be verified");
      }

      if (localBranchExists && (!remoteBranchExists || localBranchMatchesRemote)) {
        await runGit(
          "git",
          branchAlreadyCheckedOut ? ["worktree", "add", "--detach", workspacePath, branch] : ["worktree", "add", workspacePath, branch],
          {
            cwd: repositoryPath,
          },
        );
      } else if (remoteBranchExists) {
        await runGit(
          "git",
          branchAlreadyCheckedOut
            ? ["worktree", "add", "--detach", workspacePath, `refs/remotes/origin/${branch}`]
            : localBranchExists
              ? ["worktree", "add", workspacePath, `refs/remotes/origin/${branch}`]
              : ["worktree", "add", "-b", branch, workspacePath, `refs/remotes/origin/${branch}`],
          { cwd: repositoryPath },
        );
      } else {
        const baseBranch = await resolveWorktreeBaseBranch(runGit, repositoryPath);

        if (exactManagedWorktree) {
          await reclaimManagedWorktreeForNewBranch(runGit, exactManagedWorktree.path, branch, baseBranch);
          await persistManagedWorktreeMetadata(exactManagedWorktree.path, repositoryPath, branch);

          return {
            branch,
            created: true,
            repositoryPath,
            workspacePath: await resolveWorkspacePath(exactManagedWorktree.path, options.allowRoots),
          };
        }

        await runGit("git", ["worktree", "add", "-b", branch, workspacePath, baseBranch], { cwd: repositoryPath });
      }
    } catch (error) {
      if (!isWorktreeCollisionError(error)) {
        throw error;
      }

      const recoveredWorktree = await resolveCompatibleManagedWorktreeEntry(
        runGit,
        parsePorcelainWorktrees(await runGit("git", ["worktree", "list", "--porcelain"], { cwd: repositoryPath })),
        workspacePath,
        lanternwoodHome,
        branch,
        repositoryPath,
        { branchExists: localBranchExists || remoteBranchExists },
      );

      if (!recoveredWorktree) {
        if (await pathExists(workspacePath)) {
          throw new Error("Managed workspace provenance could not be verified");
        }

        throw error;
      }

      await syncManagedWorktree(runGit, repositoryPath, recoveredWorktree.path, branch, {
        branchAlreadyCheckedOut,
        branchRef: recoveredWorktree.branchRef,
        detached: recoveredWorktree.detached,
      });
      await persistManagedWorktreeMetadata(recoveredWorktree.path, repositoryPath, branch);

      return {
        branch,
        created: false,
        detached: recoveredWorktree.detached || undefined,
        repositoryPath,
        workspacePath: await resolveWorkspacePath(recoveredWorktree.path, options.allowRoots),
      };
    }

    await persistManagedWorktreeMetadata(workspacePath, repositoryPath, branch);

    return {
      branch,
      created: true,
      detached: branchAlreadyCheckedOut || undefined,
      repositoryPath,
      workspacePath: await resolveWorkspacePath(workspacePath, options.allowRoots, { allowMissing: true }),
    };
  } catch (error) {
    throw normalizeGitError(error, normalizedRepositoryPath);
  }
}
