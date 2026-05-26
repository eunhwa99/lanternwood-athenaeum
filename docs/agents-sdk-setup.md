# Agents SDK Setup

The default `npm run dev` path stays on the mock adapter. Use the Agents SDK path only when you want live OpenAI agent runs.

Create a local `.env` file. Do not commit it.

```sh
OPENAI_API_KEY=your-api-key
OPENAI_AGENTS_MODEL=
OPENAI_AGENTS_MAX_TURNS=12
LANTERNWOOD_AGENTS_PORT=8787
```

Run the backend and frontend in separate terminals:

```sh
npm run dev:api
npm run dev:agents
```

`dev:api` loads `.env` for the local SSE backend. `dev:agents` sets `VITE_RUN_ADAPTER=agents` for that frontend session only, so copying the `.env` values does not change the safe mock default.
