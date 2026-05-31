codex-cli-setup.md

# Codex CLI Setup

The default `npm run dev` path stays on the mock adapter. Use the Codex CLI path only when you want live Codex runs.

Make sure Codex CLI is logged in on this machine:

```sh
codex login
codex doctor
```

Run both the backend and frontend together:

```sh
npm run dev:all
```

Or run the backend and frontend in separate terminals:

```sh
# Terminal 1
LANTERNWOOD_CODEX_HEALTH_TOKEN=lanternwood-local-dev npm run dev:codex-api

# Terminal 2
VITE_LANTERNWOOD_CODEX_REQUEST_TOKEN=lanternwood-local-dev npm run dev:codex
```

`dev:codex-api` starts the local SSE backend that shells out to `codex exec`. `dev:codex` sets `VITE_RUN_ADAPTER=codex` for that frontend session only, so the safe mock adapter remains the default. The request token keeps browser POST routes scoped to the paired local frontend session; `npm run dev:all` wires it automatically.

In Codex mode, Luma queues the selected specialist Codex CLI routes, tracks each route's status, and runs a final Luma synthesis route once the selected reports are available. The user-facing inspector shows route status, report previews, and task-scoped Luma final output; raw CLI chunks and raw responses remain diagnostic event payloads rather than normal drawer tabs.

Optional local `.env` values:

```sh
LANTERNWOOD_CODEX_PORT=8787
LANTERNWOOD_CODEX_MODEL=gpt-5.3-codex
```

If `LANTERNWOOD_CODEX_MODEL` is set, the backend passes it to `codex exec --model` and the Live Run Inspector displays that value. If it is unset, the app reads `model = "..."` from the top-level `~/.codex/config.toml` settings, or from the selected top-level `profile = "..."` section when that profile defines a model. If neither source exposes a model, the inspector displays `CLI default (model not exposed; set LANTERNWOOD_CODEX_MODEL to pin)`.