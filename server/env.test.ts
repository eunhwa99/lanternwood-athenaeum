import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDotEnvFile } from "./env";

describe("server env loader", () => {
  it("loads local .env values without replacing already exported variables", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lanternwood-env-"));
    const envPath = join(directory, ".env");

    await writeFile(envPath, "OPENAI_API_KEY=from-file\nLANTERNWOOD_AGENTS_PORT=9191\nEXISTING=from-file\n");

    const target = { EXISTING: "from-shell" };
    loadDotEnvFile(envPath, target);

    expect(target).toEqual({
      EXISTING: "from-shell",
      LANTERNWOOD_AGENTS_PORT: "9191",
      OPENAI_API_KEY: "from-file",
    });
  });
});
