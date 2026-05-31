# 2026-05-29 Multi-Workspace Agent Workbench Plan

## Scope

Turn Lanternwood from a single-repo Codex demo into a local multi-workspace agent workbench while preserving the current scene, timeline, mock mode, live Codex mode, task queues, and existing agent experience.

The target experience is:

- A user selects or enters a target workspace directory.
- Lanternwood validates that workspace against an allowlist before any filesystem or Codex action.
- A user submits a task from the app.
- Codex runs with the target workspace as its working directory, not the Lanternwood app repository.
- The app streams agent progress, outputs, permission reviews, changed files, diffs, and verification evidence.
- Existing built-in agents keep working after their definitions move to repo-local data files.
- A local-only Agent Library UI can create new Lanternwood agent definitions under `.agents/lanternwood/agents/<agent-id>/`.

The architecture should keep three scopes separate:

- Lanternwood orchestrator data: this repo's `.agents/lanternwood/agents/*`.
- Target workspace guidance: the selected workspace's `AGENTS.md` and `.agents/*`.
- Personal/global Codex capabilities: `~/.codex/skills/*` and optional global context.

## Non-goals

- Do not add Slack or any external messenger adapter in this pass.
- Do not add API-key-backed OpenAI integrations.
- Do not make arbitrary browser requests able to write files without the existing local token/guard path.
- Do not edit a target workspace's `.agents/*` as part of the first pass; that can become a separate workspace-guidance editor later.
- Do not require hot-loading newly created agents during an active run; reload or dev-server restart is acceptable for the initial Agent Library.
- Do not remove mock mode or the existing Lanternwood visual scene.

## Expected files

- `.agents/lanternwood/agents/<agent-id>/agent.json`: repo-local source of truth for Lanternwood agent metadata, routing hints, prompt instruction, color, and scene placement.
- `.agents/lanternwood/agents/<agent-id>/persona.md`: repo-local long-form persona text for each Lanternwood agent.
- `src/agents/types.ts`: loosen the closed `AgentId` model so runtime-loaded agent ids are supported while preserving the manager/specialist distinction.
- `src/agents/registry.ts`: replace hardcoded definitions with a data-backed registry imported from generated or server-provided agent data.
- `src/harness/routePlanning.ts`: route from loaded agent definitions instead of hardcoded specialist regex rules.
- `src/events/types.ts` and `src/events/validation.ts`: validate agent ids and specialist partitions against the loaded roster instead of a fixed five-agent list.
- `src/world/sceneLayout.ts`: support default/fallback work, report, and bubble positions for newly added agents.
- `src/ui/AppShell.tsx`: add target workspace state, pass workspace information into run requests, and keep current task queue behavior.
- `src/ui/*`: add workspace picker/status UI, agent library entry points, and result panels for workspace diff/verification evidence.
- `src/harness/runAdapter.ts` and `src/harness/codexRunAdapter.ts`: include validated workspace identity/path in run, agent-job, and synthesis requests.
- `server/index.ts`: add guarded workspace and agent-authoring endpoints, and validate workspace fields on existing SSE routes.
- `server/codexWorkflow.ts`: pass the validated workspace to Codex CLI via `--cd`, load target workspace context, and emit workspace/result evidence events.
- `server/coordinatorPolicy.ts`: make workspace allowlist checks explicit and reusable.
- New focused tests beside the touched files for workspace validation, Codex cwd selection, dynamic agent registry, route planning, authoring validation, and UI request payloads.

## Worker personas when relevant

- Workspace runtime worker: backend workspace validation, Codex cwd plumbing, target context loading, and permission boundaries.
- Agent catalog worker: `.agents/lanternwood/agents/*` schema, registry loading, route planning, and Add Agent authoring API.
- UI worker: workspace picker, Agent Library, run result evidence, and preservation of current task queue UX.
- Verification worker: targeted RED/GREEN tests, focused command verification, and final review-loop evidence.

The main agent remains the orchestrator because this change crosses runtime, UI, server, and repo-local data boundaries.

## Verification plan

1. Add failing tests before implementation for:
    - rejecting a workspace outside allowed roots,
    - forwarding an allowed workspace to the Codex CLI `--cd` argument,
    - preserving existing default agents after they move to `.agents/lanternwood/agents/*`,
    - routing with dynamically loaded specialist definitions,
    - rejecting duplicate, invalid, or path-traversal agent ids in the authoring endpoint,
    - sending workspace data from the UI adapter to all Codex routes.
2. Implement the smallest runtime changes needed to pass each test.
3. Add focused UI tests for workspace selection, displayed target workspace, and Agent Library creation states.
4. Run focused suites as files are changed.
5. Run:

   ```sh
   npm run typecheck
   npm test
   npm run lint
   npm run build
   ```

6. Run `npm run e2e` when the UI surface is stable.
7. Run `npm run verify` before claiming completion.
8. Run the available review loop after verification when available, and document if it is unavailable.

## Implementation slices

### Slice 1: Workspace selection and request plumbing

- Add `workspacePath?: string` to `RunAdapterOptions`.
- Add a compact workspace field to `AppShell`.
- Pass the selected workspace path to `startRun`, `startAgentJob`, and `synthesizeTask`.
- Forward the workspace path in `createCodexRunAdapter` request bodies.
- Add RED tests in `src/harness/codexRunAdapter.test.ts` and `src/ui/AppShell.test.tsx` before implementation.

### Slice 2: Backend workspace validation and Codex cwd

- Add a small `server/workspaces.ts` module that realpath-normalizes a requested workspace and rejects paths outside the coordinator allow roots.
- Parse `workspacePath` in `server/index.ts` and pass the validated path into Codex workflow options.
- Add `workspacePath?: string` to `CodexExecutionOptions`.
- Pass the workspace path through `createCodexCliWorkflow` into the command runner.
- Use the workspace path for `codex exec --cd` instead of `process.cwd()` when present.
- Add RED tests in `server/workspaces.test.ts` and `server/codexWorkflow.test.ts` before implementation.

### Slice 3: Repo-local Agent Library authoring

- Add `server/agentCatalog.ts` for validating agent ids and writing `.agents/lanternwood/agents/<agent-id>/agent.json` plus `persona.md`.
- Add a guarded `POST /api/agents` endpoint to the existing local backend.
- Add an Agent Library panel in `AppShell` with a minimal Add Agent form.
- The first UI pass creates files and reports that reload is needed before the new agent participates in routing.
- Add RED tests for invalid ids, duplicates, path traversal, and successful file creation before implementation.

### Slice 4: Dynamic routing follow-up

- Move the built-in five agents to `.agents/lanternwood/agents/*`.
- Replace the hardcoded registry and routing tables with the repo-local catalog.
- Add fallback scene positions for arbitrary new specialist ids.
- This slice should only start after Slice 1-3 are stable because it touches the widest set of UI/runtime assumptions.

### Slice 5: Workspace context, write approval, results, and skills

- Treat explicit workspace context loading as optional metadata rather than instruction injection because Codex CLI already receives `--cd <workspace>` and can discover the workspace `AGENTS.md` itself.
- Add workspace metadata panels for git status, changed files, package scripts, and detected workspace guidance files.
- Add a conservative `workspace-write` approval control that toggles the Codex sandbox from `read-only` to `workspace-write` only for the submitted run.
- Capture run evidence around each task:
    - git status before and after,
    - changed files,
    - concise diff excerpts,
    - verification command output when requested.
- Discover global skills from `~/.codex/skills/*/SKILL.md` and show them in the app with per-task selected skill hints derived from task text.
- Add e2e coverage that creates a real repo-local agent through the UI, runs against a real target workspace path, verifies workspace metadata appears, exercises workspace-write approval, and checks that the generated agent files exist.

## Progress log

- Created this plan after clarifying that Lanternwood should become a multi-workspace local agent workbench, not a runner tied to the Lanternwood repository.
- Confirmed Slack/messenger support is out of scope for this pass.
- Confirmed the Agent Library remains in scope, but it creates Lanternwood orchestrator agents under `.agents/lanternwood/agents/*`; it should not edit arbitrary target workspace guidance in the first pass.
- Preserved the existing UI/event architecture as the base: `RunAdapter -> AgentEvent -> reducer -> React panels + PixiJS scene`.
- Detailed the first implementation pass as workspace request plumbing, backend workspace validation, Codex cwd selection, and guarded Agent Library file creation. Full dynamic routing for newly added agents remains the next slice because it requires loosening fixed agent-id assumptions across validation, scene layout, and server workflow.
- Implemented the first pass:
    - added target workspace input to the app and snapshot forwarding through run, queued specialist, and synthesis adapter calls,
    - added backend workspace validation with allow-root checks and passed the validated workspace to Codex CLI `--cd`,
    - added guarded Agent Library file creation for `.agents/lanternwood/agents/<agent-id>/agent.json` and `persona.md`,
    - added a collapsed Agent Library form so the existing dashboard scene and inspector remain the primary first-screen experience.
- Verification completed:
    - RED tests were added for workspace request forwarding, Codex workspace propagation, workspace validation, agent catalog authoring, and Agent Library POST behavior,
    - `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, escalated `npm run e2e`, escalated `npm run verify`, and `git diff --check` passed,
    - `npm run e2e:update` refreshed the dashboard snapshot after the intentional Workspace and Agent Library UI additions,
    - `$subagent-review-loop` was not available as a local command or repo-local tool in the current context, so no review loop was claimed.
- Continuing implementation for the remaining requested slices:
    - dynamic agent registry and routing from `.agents/lanternwood/agents/*`,
    - dynamic validation and scene fallbacks for new specialist ids,
    - workspace metadata/results panels,
    - write-mode approval and Codex sandbox selection,
    - global skill discovery and selected skill hints,
    - real e2e coverage for target workspace path input and agent creation through the UI.
- Follow-up regression check: after moving route metadata into repo-local agent definitions, broad implementation prompts such as "구현해줘", "build a feature", or "make this app" must still route through Luma to visible specialists. Add focused RED coverage before adjusting built-in routing metadata, then verify the PixiJS speech-bubble path with e2e.
- Next UX slice: remove repeated manual setup from the workbench.
    - Workspace Launcher: add a guarded `POST /api/workspaces` discovery endpoint, show pinned/recent workspace buttons, allow search/select under approved roots, preserve advanced path entry, expand `~` and relative paths on the server, and persist the last/recent workspace selections in localStorage.
    - Quick Agent Creator: replace the default Agent Library experience with a single description textarea, auto-generate id/display name/world role/color/routing keywords/routing reason/prompt instruction/persona, show a preview, and keep the full field editor inside an Advanced details panel for override cases.
    - Tests: add server unit coverage for discovery and path expansion, UI tests for workspace selection persistence and one-field agent creation, and e2e coverage for selecting a workspace without typing a full path and creating an agent from a description.
- Follow-up UX slice: make Quick Agent Creator Codex-assisted without letting Codex write files directly.
    - Keep the deterministic local draft as the instant fallback preview while the user types.
    - Add a guarded `POST /api/agents/draft` endpoint that calls Codex CLI in `read-only` sandbox mode and asks it to return only a JSON agent definition draft.
    - Validate the Codex draft through the same authoring validation used by `POST /api/agents`.
    - Add a `Generate with Codex` action in Agent Library that replaces the preview with the Codex draft, but still requires the existing `Create agent` approval button before any `.agents/lanternwood/agents/*` file is written.
    - Tests: add server unit coverage for Codex draft parsing/validation and UI coverage proving draft generation calls `/api/agents/draft` while file creation still only calls `/api/agents`.