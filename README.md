# Lanternwood Athenaeum

A React and PixiJS mock dashboard for a living-library agent harness. The default app runs fully locally with a mock `RunAdapter`; Codex CLI mode is opt-in.

## Mock Dashboard

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The mock flow uses Luma to dispatch Orion, Neria, Quill, and Argus, then synthesizes the final output.

## Codex CLI Mode

Run the local SSE backend and Codex frontend together:

```sh
npm run dev:all
```

Equivalent separate-terminal commands:

```sh
# Terminal 1
LANTERNWOOD_CODEX_HEALTH_TOKEN=lanternwood-local-dev npm run dev:codex-api

# Terminal 2
VITE_LANTERNWOOD_CODEX_REQUEST_TOKEN=lanternwood-local-dev npm run dev:codex
```

Codex mode shells out through the approved local backend path. Make sure the Codex CLI is logged in before using it:

```sh
codex login
codex doctor
```

## Environment

Copy `.env.example` if you want local overrides:

```sh
LANTERNWOOD_CODEX_PORT=8787
# LANTERNWOOD_CODEX_MODEL=gpt-5.3-codex
```

`LANTERNWOOD_AGENTS_HOME` can point at a global agents directory. If unset, the backend looks at `~/.agents` for optional persona files and `automation_policy.json`.

## Verification

```sh
npm run verify
git diff --check
```