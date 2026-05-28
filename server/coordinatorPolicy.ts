import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export type CoordinatorDecision = "approve" | "deny" | "escalate";

export type CoordinatorPolicy = {
  allowRoots: string[];
  safeCommands: string[];
};

export type PermissionReview = {
  requestId: string;
  action: string;
  decision: CoordinatorDecision;
  reason: string;
  path?: string;
};

export function createDefaultCoordinatorPolicy(homeDirectory: string): CoordinatorPolicy {
  return {
    allowRoots: [join(homeDirectory, ".agents"), join(homeDirectory, "obsidian"), join(homeDirectory, "IdeaProjects")],
    safeCommands: ["git status", "git init", "npm test", "npm run lint", "npm run build", "npm run typecheck"],
  };
}

function permission(
  requestId: string,
  action: string,
  decision: CoordinatorDecision,
  reason: string,
  path?: string,
): PermissionReview {
  return { action, decision, path, reason, requestId };
}

function hasSecretLookingPath(input: string) {
  const withoutEnvExample = input.replace(/(?:^|[\s\\/])\.env\.example\b/gi, " env-example ");
  const envExampleSetupIntent = /\benv-example\b/i.test(withoutEnvExample) && /\b(explain|setup|configure|document|docs?)\b/i.test(input);
  const apiKeyAccessIntent = /\b(copy|show|tell|reveal|print|read|open|access|get)\b.*api[\s_-]*key/i.test(input);

  return (
    /(?:^|[\s\\/])(?:\.env|secrets?|credentials?|api[-_]?keys?)(?:$|[\\/.\s])/i.test(withoutEnvExample) ||
    (/api[\s_-]*key/i.test(withoutEnvExample) && (!envExampleSetupIntent || apiKeyAccessIntent))
  );
}

function hasDeleteIntent(input: string) {
  return /\b(delete|remove|rm|erase|wipe|destroy|overwrite)\b/i.test(input) || /삭제|지워|제거/.test(input);
}

function explicitPaths(input: string) {
  return Array.from(input.matchAll(/(?:~(?:\/[^\s"'`]*)?|\/Users\/[^\s"'`]+|\/[A-Za-z0-9._/-]+)/g), (match) => match[0]);
}

function isInsideRoot(path: string, root: string) {
  const candidate = path === "~" ? resolve(dirname(root)) : path.startsWith("~/") ? resolve(dirname(root), path.slice(2)) : resolve(path);
  const resolvedRoot = realpathIfExists(root);
  const existingCandidate = nearestExistingPath(candidate);
  const resolvedCandidate = existingCandidate ? realpathIfExists(existingCandidate) : candidate;

  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`);
}

function hasPathOutsideRoot(input: string, root: string) {
  if (!root) {
    return explicitPaths(input).length > 0;
  }

  return explicitPaths(input).some((path) => (isAbsolute(path) || path.startsWith("~")) && !isInsideRoot(path, root));
}

function hasRelativeTraversalPath(input: string) {
  return /(?:^|[\s"'`])\.\.(?=$|[\s"'`/\\])/.test(input) || /[\\/]\.\.(?=$|[\s"'`/\\])/.test(input);
}

function nearestExistingPath(path: string) {
  let current = path;

  while (current !== dirname(current)) {
    if (existsSync(current)) {
      return current;
    }

    current = dirname(current);
  }

  return existsSync(current) ? current : undefined;
}

function realpathIfExists(path: string) {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

export function reviewCoordinatorPermissions(input: string, policy: CoordinatorPolicy): PermissionReview[] {
  const allowRoots = (Array.isArray(policy.allowRoots) ? policy.allowRoots : []).filter(
    (root) => typeof root === "string" && root.trim(),
  );
  const [, obsidianRoot, projectsRoot] = allowRoots;

  if (hasSecretLookingPath(input)) {
    return [permission("permission-1", "access_secret_path", "deny", "Secret-looking paths and API keys are denied.")];
  }

  if (hasDeleteIntent(input)) {
    return [permission("permission-1", "destructive_or_delete", "deny", "Destructive command or delete intent is denied.")];
  }

  if (hasRelativeTraversalPath(input)) {
    return [permission("permission-1", "path_outside_allowed_root", "escalate", "Relative path traversal needs human review.")];
  }

  if (/\b(external|sync|upload|overwrite|download|network)\b/i.test(input)) {
    return [permission("permission-1", "unknown_external_or_overwrite", "escalate", "Unknown, external, or overwrite action needs human review.")];
  }

  if (allowRoots.length === 0) {
    return [permission("permission-1", "path_outside_allowed_root", "escalate", "No coordinator allow roots are configured.")];
  }

  if (allowRoots.every((root) => hasPathOutsideRoot(input, root))) {
    return [permission("permission-1", "path_outside_allowed_root", "escalate", "Explicit path is outside allowed roots.")];
  }

  if (/obsidian/i.test(input) || /옵시디언|노트/.test(input)) {
    if (!obsidianRoot || hasPathOutsideRoot(input, obsidianRoot)) {
      return [permission("permission-1", "path_outside_allowed_root", "escalate", "Explicit path is outside the Obsidian allow root.")];
    }

    return [
      permission("permission-1", "create_obsidian_note", "approve", "Create-only Obsidian note intent is inside an allowed root.", obsidianRoot),
    ];
  }

  if (/\bproject\b/i.test(input) && /\b(create|new|init|scaffold)\b/i.test(input)) {
    if (!projectsRoot || hasPathOutsideRoot(input, projectsRoot)) {
      return [permission("permission-1", "path_outside_allowed_root", "escalate", "Explicit path is outside the project allow root.")];
    }

    return [
      permission("permission-1", "create_project_directory", "approve", "New project directory intent is inside an allowed root.", projectsRoot),
    ];
  }

  return [];
}
