# Repository Instructions

## Project Harness

- For file-changing work, read `.agents/docs/harness-engineering.md` before implementation.
- Create or update a plan under `docs/plan/` before target edits.
- Keep the main agent as orchestrator. Use bounded worker personas for non-atomic work.
- Run focused verification before review.
- Run `$subagent-review-loop` after verification when available. Do not claim it ran if unavailable.

## Project Structure

- `src/agents/`: role and persona definitions.
- `src/events/`: event contracts and reducers.
- `src/harness/`: mock and future real agent adapters.
- `src/ui/`: React dashboard panels.
- `src/world/`: PixiJS living library scene.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`

Do not commit secrets, `.env` files, API keys, or live OpenAI credentials.
