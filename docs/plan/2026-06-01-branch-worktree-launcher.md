# Branch Worktree Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a branch-specific worktree launcher that reuses or creates `git worktree` directories and automatically sets the launched path as Lanternwood's active workspace.

**Architecture:** Extend the existing multi-workspace flow instead of replacing it. Keep `src/ui/AppShell.tsx` as the launcher entry point, add server-side git/worktree helpers behind a guarded `POST /api/worktrees/launch` route, and continue using the existing `workspacePath` plumbing for runs and workspace inspection.

**Tech Stack:** React, TypeScript, Node.js, Vitest, Testing Library, existing local HTTP server, `git worktree`.

---

## Scope

- Add a branch-oriented launcher to the existing Workspace Launcher.
- Validate repository paths against coordinator allow roots.
- Reuse an existing worktree for the same repository and branch.
- Create a deterministic managed worktree path under the repository allow root when no matching worktree exists.
- Fall back to a detached managed worktree when the requested branch is already checked out in another non-managed worktree.
- Automatically select the launched worktree as the current workspace.

## Non-Goals

- Do not add worktree deletion or cleanup UI.
- Do not add multi-tab or session persistence beyond current workspace/recent workspace behavior.
- Do not change Codex execution logic beyond feeding it the launched `workspacePath`.
- Do not support repositories outside existing allow roots.

## Expected Files

- Modify: `server/workspaces.ts`
- Modify: `server/workspaces.test.ts`
- Modify: `server/index.ts`
- Modify: `src/ui/AppShell.tsx`
- Modify: `src/ui/AppShell.test.tsx`
- Modify: `docs/plan/2026-06-01-branch-worktree-launcher.md`

## Worker Personas

- **Server worker:** Implement git/worktree validation and launch helpers.
- **UI worker:** Add repository/branch launcher controls and success/error state.
- **Test worker:** Add focused server and UI regression coverage before implementation.
- **Review worker:** Check for unsafe git behavior, stale state, and launcher regressions.

## Verification Plan

1. Focused RED/GREEN test cycle for `server/workspaces.test.ts`.
2. Focused RED/GREEN test cycle for `src/ui/AppShell.test.tsx`.
3. Run `npm test -- server/workspaces.test.ts src/ui/AppShell.test.tsx`.
4. Run `npm run build`.
5. If UI behavior changes settle cleanly, run `npm run verify`.
6. Run `$subagent-review-loop` after verification when available.

## Files and Responsibilities

- `server/workspaces.ts`
  - Keep existing workspace normalization/discovery helpers.
  - Add repository validation, branch validation, allow-root-safe worktree path helpers, worktree reuse parsing, and worktree launch orchestration.
- `server/workspaces.test.ts`
  - Cover invalid branch names, out-of-root repositories, worktree reuse, and new worktree creation behavior.
- `server/index.ts`
  - Register `POST /api/worktrees/launch`, validate request payload, and return launch metadata.
- `src/ui/AppShell.tsx`
  - Add repository + branch launcher state, launch action, and selected worktree summary.
- `src/ui/AppShell.test.tsx`
  - Verify launcher POST behavior and that the returned worktree becomes the selected workspace.

## Task 1: Add failing server tests for branch launch behavior

**Files:**
- Modify: `server/workspaces.test.ts`
- Test: `server/workspaces.test.ts`

- [ ] **Step 1: Add lightweight git-test helpers near the top of `server/workspaces.test.ts`**

```ts
async function createGitRepository(root: string, name: string) {
  const repository = join(root, name);
  await mkdir(repository, { recursive: true });
  return repository;
}

const mockExecFileSuccess = vi.fn(async () => "");
```

- [ ] **Step 2: Add a branch-name validation test**

```ts
it("rejects invalid branch names for worktree launch", async () => {
  const root = await createTempDirectory();
  const repository = await createGitRepository(root, "demo");

  await expect(
    launchBranchWorktree(
      { branch: "../bad-branch", repositoryPath: repository },
      { allowRoots: [root], execFile: mockExecFileSuccess, lanternwoodHome: await createTempDirectory() },
    ),
  ).rejects.toThrow("Invalid branch name");
});
```

- [ ] **Step 3: Add an existing-worktree reuse test**

```ts
it("reuses an existing worktree for the same repository and branch", async () => {
  const root = await createTempDirectory();
  const repository = await createGitRepository(root, "demo");
  const existingWorktree = join(await createTempDirectory(), "demo-feature-x");
  const execFile = vi.fn(async (_file, args: string[]) => {
    if (args[0] === "worktree" && args[1] === "list") {
      return `worktree ${existingWorktree}\nHEAD 1234567\nbranch refs/heads/feature/x\n\n`;
    }
    throw new Error(`Unexpected git args: ${args.join(" ")}`);
  });

  await expect(
    launchBranchWorktree(
      { branch: "feature/x", repositoryPath: repository },
      { allowRoots: [root], execFile, lanternwoodHome: await createTempDirectory() },
    ),
  ).resolves.toMatchObject({
    branch: "feature/x",
    created: false,
    repositoryPath: await realpath(repository),
    workspacePath: existingWorktree,
  });
});
```

- [ ] **Step 4: Add a new-worktree creation test**

```ts
it("creates a deterministic worktree path when the branch has no existing worktree", async () => {
  const root = await createTempDirectory();
  const home = await createTempDirectory();
  const repository = await createGitRepository(root, "demo");
  const execFile = vi.fn(async (_file, args: string[]) => {
    if (args.join(" ") === "worktree list --porcelain") {
      return "";
    }
    if (args.join(" ") === "symbolic-ref --quiet refs/remotes/origin/HEAD") {
      return "refs/remotes/origin/main\n";
    }
    if (args.join(" ") === "show-ref --verify --quiet refs/heads/feature/x") {
      throw Object.assign(new Error("missing"), { code: 1 });
    }
    if (args.join(" ").startsWith("worktree add")) {
      return "";
    }
    throw new Error(`Unexpected git args: ${args.join(" ")}`);
  });

  await expect(
    launchBranchWorktree(
      { branch: "feature/x", repositoryPath: repository },
      { allowRoots: [root], execFile, lanternwoodHome: home },
    ),
  ).resolves.toMatchObject({
    branch: "feature/x",
    created: true,
    workspacePath: join(home, "worktrees", "demo", "feature-x"),
  });
});
```

- [ ] **Step 5: Run the focused server test file and confirm failure**

Run: `npm test -- server/workspaces.test.ts`
Expected: FAIL because `launchBranchWorktree` and git-launch helpers do not exist yet.

## Task 2: Implement server-side worktree helpers

**Files:**
- Modify: `server/workspaces.ts`
- Test: `server/workspaces.test.ts`

- [ ] **Step 1: Add the launch types and git-runner seam**

```ts
export type LaunchBranchWorktreeInput = {
  branch: string;
  repositoryPath: string;
};

export type LaunchBranchWorktreeResult = {
  branch: string;
  created: boolean;
  repositoryPath: string;
  workspacePath: string;
};

type ExecFileLike = (file: string, args: string[], cwd: string) => Promise<string>;
```

- [ ] **Step 2: Add branch validation and deterministic path helpers**

```ts
export function validateBranchName(branch: string) {
  const trimmed = branch.trim();
  if (!trimmed || trimmed.startsWith(".") || trimmed.includes("..") || /[\s~^:?*\[\]\\]/.test(trimmed)) {
    throw new Error("Invalid branch name");
  }
  return trimmed;
}

export function worktreePathForBranch(lanternwoodHome: string, repositoryPath: string, branch: string) {
  const repoName = basename(repositoryPath);
  const branchSlug = branch.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return join(lanternwoodHome, "worktrees", repoName, branchSlug || "worktree");
}
```

- [ ] **Step 3: Add reuse parsing for `git worktree list --porcelain`**

```ts
function parsePorcelainWorktrees(output: string) {
  return output
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const path = block.match(/^worktree (.+)$/m)?.[1];
      const branchRef = block.match(/^branch (.+)$/m)?.[1];
      return path && branchRef ? { branchRef, path } : undefined;
    })
    .filter((entry): entry is { branchRef: string; path: string } => Boolean(entry));
}
```

- [ ] **Step 4: Add the launch orchestration**

```ts
export async function launchBranchWorktree(
  input: LaunchBranchWorktreeInput,
  options: { allowRoots: string[]; execFile?: ExecFileLike; lanternwoodHome?: string },
) {
  const repositoryPath = await resolveWorkspacePath(input.repositoryPath, options.allowRoots);
  const branch = validateBranchName(input.branch);
  const runGit = options.execFile ?? defaultExecFile;
  const worktreeList = parsePorcelainWorktrees(await runGit("git", ["worktree", "list", "--porcelain"], repositoryPath));
  const existing = worktreeList.find((entry) => entry.branchRef === `refs/heads/${branch}`);

  if (existing) {
    return {
      branch,
      created: false,
      repositoryPath,
      workspacePath: await realpath(existing.path),
    };
  }

  const base = await resolveWorktreeBaseBranch(runGit, repositoryPath);
  const workspacePath = worktreePathForBranch(options.lanternwoodHome ?? join(homedir(), ".lanternwood"), repositoryPath, branch);
  await mkdir(dirname(workspacePath), { recursive: true });
  await addWorktree(runGit, repositoryPath, workspacePath, branch, base);

  return {
    branch,
    created: true,
    repositoryPath,
    workspacePath,
  };
}
```

- [ ] **Step 5: Run the focused server test file and confirm pass**

Run: `npm test -- server/workspaces.test.ts`
Expected: PASS for branch validation, reuse, and creation cases.

## Task 3: Add failing route and UI tests for the launcher

**Files:**
- Modify: `src/ui/AppShell.test.tsx`
- Test: `src/ui/AppShell.test.tsx`

- [ ] **Step 1: Add a launcher success test**

```ts
it("launches a branch worktree and stores the returned workspace", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/api/workspaces")) {
      return Promise.resolve(new Response(JSON.stringify({ currentWorkspace: "/repo/app", roots: ["/repo"], workspaces: [] }), { status: 200 }));
    }
    if (url.endsWith("/api/worktrees/launch")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            branch: "feature/x",
            created: true,
            repositoryPath: "/repo/demo",
            workspacePath: "/Users/eunhwa/.lanternwood/worktrees/demo/feature-x",
          }),
          { status: 200 },
        ),
      );
    }
    throw new Error(`Unexpected url: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  renderApp(<AppShell runAdapter={mockRunAdapter} />);
  fireEvent.change(await screen.findByLabelText("Repository path"), { target: { value: "/repo/demo" } });
  fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "feature/x" } });
  fireEvent.click(screen.getByRole("button", { name: "Launch worktree" }));

  await screen.findByText("/Users/eunhwa/.lanternwood/worktrees/demo/feature-x");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/worktrees/launch",
    expect.objectContaining({
      body: JSON.stringify({ branch: "feature/x", repositoryPath: "/repo/demo" }),
      method: "POST",
    }),
  );
});
```

- [ ] **Step 2: Add a launcher reuse-status test**

```ts
expect(await screen.findByText("Reused existing worktree for feature/x.")).toBeInTheDocument();
```

- [ ] **Step 3: Run the focused UI test file and confirm failure**

Run: `npm test -- src/ui/AppShell.test.tsx`
Expected: FAIL because the repository/branch launcher controls and launch request do not exist yet.

## Task 4: Wire the launch route and UI implementation

**Files:**
- Modify: `server/index.ts`
- Modify: `src/ui/AppShell.tsx`
- Test: `src/ui/AppShell.test.tsx`

- [ ] **Step 1: Add the launch route to `server/index.ts`**

```ts
const workspaceRoutes = new Set(["/api/workspace-metadata", "/api/workspaces", "/api/worktrees/launch"]);
```

```ts
if (path === "/api/worktrees/launch") {
  globalAgents = await loadGlobalAgents();
  const launched = await launchBranchWorktree(
    {
      branch: typeof body.branch === "string" ? body.branch : "",
      repositoryPath: typeof body.repositoryPath === "string" ? body.repositoryPath : "",
    },
    { allowRoots: globalAgents.automationPolicy.allowRoots },
  );

  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(launched));
  return;
}
```

- [ ] **Step 2: Add launcher state to `src/ui/AppShell.tsx`**

```ts
const [repositoryPath, setRepositoryPath] = useState("");
const [branchName, setBranchName] = useState("");
const [worktreeLaunchStatus, setWorktreeLaunchStatus] = useState("Idle");
const [launchedWorktree, setLaunchedWorktree] = useState<{
  branch: string;
  created: boolean;
  repositoryPath: string;
  workspacePath: string;
} | null>(null);
```

- [ ] **Step 3: Add the launch action**

```ts
async function launchWorktree() {
  setWorktreeLaunchStatus("Launching");
  try {
    const response = await fetch("/api/worktrees/launch", {
      body: JSON.stringify({ branch: branchName, repositoryPath }),
      headers: codexRequestHeaders(),
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const result = (await response.json()) as {
      branch: string;
      created: boolean;
      repositoryPath: string;
      workspacePath: string;
    };
    setLaunchedWorktree(result);
    setWorkspacePath(result.workspacePath);
    rememberWorkspace(result.workspacePath, `${workspaceNameFromPath(result.repositoryPath)}:${result.branch}`);
    setWorktreeLaunchStatus(result.created ? `Created new worktree for ${result.branch}.` : `Reused existing worktree for ${result.branch}.`);
  } catch (error) {
    setWorktreeLaunchStatus(messageFromError(error));
  }
}
```

- [ ] **Step 4: Add the launcher controls to the Workspace panel**

```tsx
<label>
  <span>Repository path</span>
  <input aria-label="Repository path" value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} />
</label>
<label>
  <span>Branch name</span>
  <input aria-label="Branch name" value={branchName} onChange={(event) => setBranchName(event.target.value)} />
</label>
<div className="workspace-actions">
  <button onClick={() => void launchWorktree()} type="button">Launch worktree</button>
  <button onClick={() => void inspectWorkspace()} type="button">Inspect workspace</button>
</div>
{launchedWorktree ? <p>{launchedWorktree.workspacePath}</p> : null}
```

- [ ] **Step 5: Run the focused UI test file and confirm pass**

Run: `npm test -- src/ui/AppShell.test.tsx`
Expected: PASS for the new launcher flow and existing workspace behavior.

## Task 5: Run focused verification and handoff checks

**Files:**
- Modify: `docs/plan/2026-06-01-branch-worktree-launcher.md`

- [ ] **Step 1: Run combined focused tests**

Run: `npm test -- server/workspaces.test.ts src/ui/AppShell.test.tsx`
Expected: PASS

- [ ] **Step 2: Run build verification**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Run full verification if the branch launcher touches stable UI paths cleanly**

Run: `npm run verify`
Expected: PASS

- [ ] **Step 4: Run review loop when available**

Run: `$subagent-review-loop`
Expected: either review findings to address or a documented note that the tool is unavailable in this environment.

## Progress Log

- [x] Wrote the approved design spec to `docs/superpowers/specs/2026-06-01-branch-worktree-launcher-design.md`.
- [x] Resolved the key product decisions before implementation: reuse existing worktrees, create only when missing, and automatically hand the launched worktree to `workspacePath`.
- [ ] Implementation not started yet.
