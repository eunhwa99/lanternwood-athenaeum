import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

export const MANAGED_WORKTREE_METADATA_DIRECTORY = ".metadata";

export type ManagedWorktreeMetadata = {
  branch: string;
  repositoryPath: string;
};

export function isManagedWorktreePath(path: string) {
  return /[\\/]\.lanternwood-worktrees[\\/]/.test(path);
}

function stableHash(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

export function managedWorktreeMetadataPath(workspacePath: string) {
  const normalizedPath = resolve(workspacePath);
  const marker = `${sep}.lanternwood-worktrees${sep}`;
  const markerIndex = normalizedPath.lastIndexOf(marker);

  if (markerIndex < 0) {
    return join(dirname(normalizedPath), `${stableHash(normalizedPath)}.json`);
  }

  const managedRoot = normalizedPath.slice(0, markerIndex + marker.length - 1);
  return join(managedRoot, MANAGED_WORKTREE_METADATA_DIRECTORY, `${stableHash(normalizedPath)}.json`);
}

export function managedWorktreeLabel(metadata: ManagedWorktreeMetadata) {
  return `${basename(metadata.repositoryPath)}:${metadata.branch}`;
}

export async function readManagedWorktreeMetadata(workspacePath: string) {
  try {
    const parsed = JSON.parse(await readFile(managedWorktreeMetadataPath(workspacePath), "utf8")) as Partial<ManagedWorktreeMetadata>;

    if (typeof parsed.branch !== "string" || typeof parsed.repositoryPath !== "string") {
      return undefined;
    }

    return {
      branch: parsed.branch,
      repositoryPath: parsed.repositoryPath,
    } satisfies ManagedWorktreeMetadata;
  } catch {
    return undefined;
  }
}

export async function writeManagedWorktreeMetadata(workspacePath: string, metadata: ManagedWorktreeMetadata) {
  const metadataPath = managedWorktreeMetadataPath(workspacePath);
  await mkdir(dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}
