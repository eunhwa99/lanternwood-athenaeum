import { loadDotEnvFile } from "./env";

loadDotEnvFile();

const port = Number(process.env.LANTERNWOOD_CODEX_PORT ?? 8787);
const expectedToken = process.env.LANTERNWOOD_CODEX_HEALTH_TOKEN;
const deadline = Date.now() + 5_000;
const url = `http://127.0.0.1:${port}/api/health`;

async function waitForHealth() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers: expectedToken ? { "X-Lanternwood-Codex-Token": expectedToken } : undefined,
      });
      const body = (await response.json().catch(() => undefined)) as { ok?: unknown } | undefined;

      if (response.ok && body?.ok === true) {
        return;
      }
    } catch {
      // Retry until the backend has had a short chance to bind.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Codex API health check failed at ${url}`);
}

await waitForHealth();
