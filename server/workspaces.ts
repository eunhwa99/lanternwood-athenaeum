import { readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

type NormalizeWorkspaceInputOptions = {
  baseDirectory?: string;
  homeDirectory?: string;
};

export type WorkspaceOption = {
  name: string;
  path: string;
  root: string;
};

function isInsideRoot(path: string, root: string) {
  const relativePath = relative(root, path);

  return relativePath === "" || (!relativePath.startsWith("..") && !resolve(relativePath).startsWith(`${sep}..`));
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

export async function resolveWorkspacePath(
  workspacePath: string,
  allowRoots: string[],
  options: NormalizeWorkspaceInputOptions = {},
) {
  const workspaceRealPath = await realpath(normalizeWorkspaceInput(workspacePath, options));
  const rootRealPaths = await resolveAllowedRoots(allowRoots);

  if (!rootRealPaths.some((root) => isInsideRoot(workspaceRealPath, root))) {
    throw new Error("Workspace is outside the allowed roots");
  }

  return workspaceRealPath;
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