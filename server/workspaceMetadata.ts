import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { isManagedWorktreePath, managedWorktreeLabel, readManagedWorktreeMetadata } from "./managedWorktreeMetadata";

const execFileAsync = promisify(execFile);

export type WorkspaceMetadata = {
  agentContextFiles: string[];
  changedFiles: string[];
  diffExcerpt?: string;
  gitStatus: string;
  packageScripts: Array<{ command: string; name: string }>;
  repositoryPath?: string;
  verification?: {
    command: string;
    exitCode: number;
    output: string;
  };
  workspacePath: string;
  workspaceLabel?: string;
};

type WorkspaceMetadataOptions = {
  runGit?: (args: string[]) => Promise<string>;
};

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(root: string, base = root, depth = 0): Promise<string[]> {
  if (depth > 4) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path, base, depth + 1)));
    } else if (entry.isFile()) {
      files.push(relative(base, path));
    }
  }

  return files.sort();
}

async function readPackageScripts(workspacePath: string) {
  try {
    const packageJson = JSON.parse(await readFile(join(workspacePath, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };

    return Object.entries(packageJson.scripts ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([name, command]) => ({ command, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function changedFilesFromStatus(status: string) {
  return status
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((path) => path.split(" -> ").at(-1) ?? path);
}

async function defaultRunGit(workspacePath: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", workspacePath, ...args], {
    maxBuffer: 1024 * 1024,
  });

  return stdout;
}

async function resolveWorkspaceRepositoryPath(workspacePath: string, git: (args: string[]) => Promise<string>) {
  try {
    const [repositoryRootOutput, commonGitDirectoryOutput] = await Promise.all([
      git(["rev-parse", "--show-toplevel"]),
      git(["rev-parse", "--git-common-dir"]),
    ]);
    const repositoryRoot = repositoryRootOutput.trim();
    const commonGitDirectoryRaw = commonGitDirectoryOutput.trim();
    const resolvedRepositoryRoot = await realpath(repositoryRoot).catch(() => repositoryRoot);
    const commonGitDirectory = await realpath(
      isAbsolute(commonGitDirectoryRaw) ? commonGitDirectoryRaw : resolve(workspacePath, commonGitDirectoryRaw),
    ).catch(() => (isAbsolute(commonGitDirectoryRaw) ? commonGitDirectoryRaw : resolve(workspacePath, commonGitDirectoryRaw)));

    return basename(commonGitDirectory) === ".git"
      ? await realpath(dirname(commonGitDirectory)).catch(() => dirname(commonGitDirectory))
      : resolvedRepositoryRoot;
  } catch {
    return undefined;
  }
}

function parsePointedBranchNames(output: string) {
  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => Boolean(entry) && !entry.startsWith("("));
}

export async function readWorkspaceProvenance(
  workspacePath: string,
  { runGit }: WorkspaceMetadataOptions = {},
): Promise<{ repositoryPath?: string; workspaceLabel?: string }> {
  const git = runGit ?? ((args: string[]) => defaultRunGit(workspacePath, args));
  const liveRepositoryPath = await resolveWorkspaceRepositoryPath(workspacePath, git);
  const repositoryPath = liveRepositoryPath;
  let branchName = "";
  let detached = false;
  const metadata = isManagedWorktreePath(workspacePath) ? await readManagedWorktreeMetadata(workspacePath) : undefined;

  if (isManagedWorktreePath(workspacePath)) {
    branchName = await git(["branch", "--show-current"]).then((output) => output.trim()).catch(() => "");
    detached = !branchName;
  }

  if (!branchName && isManagedWorktreePath(workspacePath)) {
    const pointedBranches = await git(["branch", "--points-at", "HEAD", "--format", "%(refname:short)"])
      .then(parsePointedBranchNames)
      .catch(() => [] as string[]);

    if (metadata && metadata.repositoryPath === repositoryPath && pointedBranches.includes(metadata.branch)) {
      branchName = metadata.branch;
    }

    if (pointedBranches.length === 1) {
      [branchName] = pointedBranches;
    }
  }

  return {
    repositoryPath,
    workspaceLabel:
      repositoryPath && branchName
        ? `${managedWorktreeLabel({ branch: branchName, repositoryPath })}${detached ? " (detached)" : ""}`
        : undefined,
  };
}

export async function readWorkspaceMetadata(
  workspacePath: string,
  { runGit }: WorkspaceMetadataOptions = {},
): Promise<WorkspaceMetadata> {
  const git = runGit ?? ((args: string[]) => defaultRunGit(workspacePath, args));
  const agentContextFiles = [
    ...((await pathExists(join(workspacePath, "AGENTS.md"))) ? ["AGENTS.md"] : []),
    ...(await collectFiles(join(workspacePath, ".agents"))).map((path) => `.agents/${path}`),
  ];
  const [gitStatus, diffExcerpt, packageScripts, provenance] = await Promise.all([
    git(["status", "--short"]).then((output) => output.trimEnd()).catch(() => ""),
    git(["diff", "--", "."]).then((output) => output.slice(0, 12_000)).catch(() => ""),
    readPackageScripts(workspacePath),
    readWorkspaceProvenance(workspacePath, { runGit: git }),
  ]);

  return {
    agentContextFiles,
    changedFiles: changedFilesFromStatus(gitStatus),
    diffExcerpt: diffExcerpt || undefined,
    gitStatus,
    packageScripts,
    repositoryPath: provenance.repositoryPath,
    workspacePath,
    workspaceLabel: provenance.workspaceLabel,
  };
}
