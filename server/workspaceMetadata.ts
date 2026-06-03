import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkspaceMetadata = {
  agentContextFiles: string[];
  changedFiles: string[];
  diffExcerpt?: string;
  gitStatus: string;
  packageScripts: Array<{ command: string; name: string }>;
  verification?: {
    command: string;
    exitCode: number;
    output: string;
  };
  workspacePath: string;
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

export async function readWorkspaceMetadata(
  workspacePath: string,
  { runGit }: WorkspaceMetadataOptions = {},
): Promise<WorkspaceMetadata> {
  const git = runGit ?? ((args: string[]) => defaultRunGit(workspacePath, args));
  const agentContextFiles = [
    ...((await pathExists(join(workspacePath, "AGENTS.md"))) ? ["AGENTS.md"] : []),
    ...(await collectFiles(join(workspacePath, ".agents"))).map((path) => `.agents/${path}`),
  ];
  const [gitStatus, diffExcerpt, packageScripts] = await Promise.all([
    git(["status", "--short"]).then((output) => output.trimEnd()).catch(() => ""),
    git(["diff", "--", "."]).then((output) => output.slice(0, 12_000)).catch(() => ""),
    readPackageScripts(workspacePath),
  ]);

  return {
    agentContextFiles,
    changedFiles: changedFilesFromStatus(gitStatus),
    diffExcerpt: diffExcerpt || undefined,
    gitStatus,
    packageScripts,
    workspacePath,
  };
}