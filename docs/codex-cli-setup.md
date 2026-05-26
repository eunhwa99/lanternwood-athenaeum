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

Optional local `.env` values:

```sh
LANTERNWOOD_CODEX_PORT=8787
```
