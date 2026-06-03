# Lanternwood Branch Worktree Launcher Design

## Summary

Lanternwood should stop relying on direct branch switches inside the app's own checkout when the user wants to work on a different branch. Instead, the app should launch and reuse branch-specific `git worktree` directories and then target those worktrees as the active Codex workspace.

The goal is to make branch changes feel isolated in the same way Codex app isolates work by workspace, while preserving the current Lanternwood dashboard, queue orchestration, workspace inspection flow, and server-side allow-root protections.

## Goals

- Let a user pick a repository and branch from inside Lanternwood.
- Reuse an existing worktree when the same repository and branch were launched before.
- Create a new worktree automatically when no matching worktree exists yet.
- Make the launched worktree the selected `workspacePath` for runs, queue jobs, synthesis, and workspace inspection.
- Keep the Lanternwood app checkout stable so branch work no longer depends on switching the app's own working tree.

## Non-Goals

- Do not introduce per-branch tab/session management beyond selecting the launched worktree as the current workspace.
- Do not implement destructive cleanup flows such as deleting worktrees from the UI in the first pass.
- Do not support repositories outside the existing coordinator allow roots.
- Do not mutate arbitrary workspace guidance files as part of launching a worktree.
- Do not change the current Codex run pipeline beyond feeding it a different validated workspace path.

## User Experience

The existing Workspace Launcher becomes the main entry point for branch-isolated work.

Primary flow:

1. User selects a repository from allowed roots.
2. User enters or selects a branch name.
3. User clicks `Launch worktree`.
4. Lanternwood asks the server to find or create a worktree for that repository and branch.
5. The returned worktree path becomes the current selected workspace automatically.
6. The user can inspect that workspace or immediately run Codex tasks against it.

The launcher should surface:

- selected repository name and path
- selected branch name
- whether the worktree was reused or newly created
- launched worktree path
- any validation or git errors in plain language

The existing advanced path input remains available as a fallback, but the branch launcher becomes the default path for repository work.

## Architecture

The design introduces a branch launcher path that sits beside the existing workspace discovery and inspection flow.

Client responsibilities:

- show repository selection from allowed roots
- collect a branch name
- call a new launch endpoint
- store the returned worktree as the active workspace
- reflect worktree metadata in the workspace panel

Server responsibilities:

- validate that the repository path is inside the allow roots
- confirm the repository is a git repo
- validate the branch name format
- inspect existing worktrees for a matching repository and branch
- return the existing worktree when one already exists
- create a new worktree when one does not exist
- return normalized launch metadata to the UI

Codex run responsibilities do not change. The current `workspacePath` plumbing remains the integration point.

## Worktree Strategy

Lanternwood should create deterministic worktree paths under an app-managed directory that still lives inside the repository's allowed project root, so the same repository and branch can be launched again without guessing where the previous worktree was created or tripping later allow-root validation.

Recommended base directory:

```text
<allow-root>/.lanternwood-worktrees/<repo-key>/<branch-key>
```

Rules:

- `<repo-key>` should stay human-readable but include stable repository identity so same-name repositories do not collide.
- `<branch-key>` should stay human-readable but include stable branch identity so names like `feature/x` and `feature-x` do not collide.
- When the same repository and branch are launched again, Lanternwood should prefer the existing Lanternwood-managed worktree path from `git worktree list`.
- The repository's primary checkout must never count as the reusable branch worktree.
- If the branch is already checked out somewhere else, Lanternwood should still create its own managed path, but it may need to launch that path in detached mode rather than reusing the other checkout.
- The returned path must always be realpath-normalized before the UI stores it.

## Git Behavior

Launch behavior should distinguish three cases:

1. Matching branch worktree already exists.
   Return that path with `created: false`.

2. Branch already exists locally or on the remote, but no matching worktree exists.
   Create a worktree for that branch and return `created: true`.

3. Branch already exists but is checked out in another non-managed worktree.
   Create a detached managed worktree at that branch tip and return `created: true`.

4. Branch does not exist yet.
   Create a new branch worktree from the repository default base branch and return `created: true`.

Recommended base branch resolution order:

1. `origin/HEAD`
2. repository current branch
3. explicit error if neither can be resolved

The first pass should avoid destructive git commands. It only needs to inspect, reuse, or add worktrees.
If the remote branch is not present in the local remote-tracking refs, the launcher may fetch just that branch from `origin` before adding the worktree.

## API Design

Add a new guarded endpoint:

```text
POST /api/worktrees/launch
```

Request body:

```json
{
  "repositoryPath": "/Users/eunhwa/IdeaProjects/MCPContentSearch",
  "branch": "feature/branch-launcher"
}
```

Response body:

```json
{
  "workspacePath": "/Users/eunhwa/IdeaProjects/.lanternwood-worktrees/mcpcontentsearch-a1b2c3d4/feature-branch-launcher-e5f6g7h8",
  "repositoryPath": "/Users/eunhwa/IdeaProjects/MCPContentSearch",
  "branch": "feature/branch-launcher",
  "created": true
}
```

Optional response fields can include a short `statusMessage` for reused versus newly created worktrees.

## UI Changes

`src/ui/AppShell.tsx` should gain:

- repository selection state
- branch input state
- launch-in-progress state
- launched worktree metadata state
- a `Launch worktree` action beside the current workspace controls

The Workspace Launcher should evolve toward:

- repository picker
- branch field
- launch button
- selected worktree summary
- existing inspect action

The app should continue remembering recent workspaces, but launched worktrees should also be remembered as recent selections once the launch succeeds.

## Server Changes

Add worktree-focused helpers to `server/workspaces.ts` or a nearby module:

- repository validation under allow roots
- branch-name validation
- worktree path calculation
- worktree discovery from git output
- worktree creation command execution

`server/index.ts` should:

- accept the new launch route
- validate the incoming request
- resolve allow roots through the existing coordinator policy
- return clear failure messages for invalid repositories, invalid branch names, and git command failures

## Error Handling

The first pass should treat these as explicit user-facing failures:

- repository path missing or outside allowed roots
- selected path is not a git repository
- branch name is empty or invalid
- repository default base branch cannot be resolved for a new branch
- `git worktree add` fails

If an existing worktree is found for the branch, that should not be treated as an error. It is the expected reuse path.

## Testing Strategy

Add focused tests for:

- branch name validation
- deterministic worktree path generation
- reusing an existing branch worktree
- creating a worktree for an existing branch
- creating a worktree for a new branch from the default base
- rejecting repositories outside allowed roots
- updating the UI state after a successful launch
- preserving existing workspace inspection and run submission behavior after a launched worktree is selected

Expected verification flow after implementation:

```bash
npm test
npm run build
```

If the UI surface changes materially, also run:

```bash
npm run e2e
npm run verify
```

## Open Decisions Resolved

- Worktree reuse policy: reuse existing worktree for the same repository and branch.
- Worktree creation policy: create only when no matching worktree exists.
- Worktree path ownership: Lanternwood-owned app directory rather than scattering worktrees inside arbitrary repositories.
- Workspace handoff: launched worktree becomes the current `workspacePath` automatically.

## Implementation Notes

This slice should build on the current multi-workspace architecture rather than replacing it. The existing workspace picker, `workspacePath` request plumbing, and workspace metadata inspection are already the right backbone. The new launcher only needs to become a smarter producer of valid workspace paths.
