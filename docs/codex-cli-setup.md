# Codex CLI Setup

The default `npm run dev` path stays on the mock adapter. Use the Codex CLI path only when you want live Codex runs.

Make sure Codex CLI is logged in on this machine:

```sh
codex login
codex doctor
```

Run the backend and frontend in separate terminals:

```sh
npm run dev:codex-api
npm run dev:codex
```

`dev:codex-api` starts the local SSE backend that shells out to `codex exec`. `dev:codex` sets `VITE_RUN_ADAPTER=codex` for that frontend session only, so the safe mock adapter remains the default.

In Codex mode, Luma starts separate Codex CLI routes for Orion, Neria, Quill, and Argus, then runs a final Luma synthesis route. The Live Run Inspector shows each route's status, streamed raw chunks, final raw response, and verified report.

Live Codex routes run with `workspace-write` by default. If a route needs broader access, it should return a structured permission request instead of ending the task; the UI shows an approval panel, and an approved retry runs with the requested `danger-full-access` sandbox using a one-use backend approval token.

Optional local `.env` values:

```sh
LANTERNWOOD_CODEX_PORT=8787
LANTERNWOOD_CODEX_MODEL=gpt-5.3-codex
```

If `LANTERNWOOD_CODEX_MODEL` is set, the backend passes it to `codex exec --model` and the Live Run Inspector displays that value. If it is unset, the app reads `model = "..."` from the top-level `~/.codex/config.toml` settings, or from the selected top-level `profile = "..."` section when that profile defines a model. If neither source exposes a model, the inspector displays `CLI default (model not exposed; set LANTERNWOOD_CODEX_MODEL to pin)`.
