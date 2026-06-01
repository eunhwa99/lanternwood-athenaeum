import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverCodexSkills } from "./skills";

const tempDirectories: string[] = [];

async function createTempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "lanternwood-skills-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("skill discovery", () => {
  it("discovers global Codex skills from SKILL.md files", async () => {
    const codexHome = await createTempDirectory();
    await mkdir(join(codexHome, "skills", "build-helper"), { recursive: true });
    await writeFile(
      join(codexHome, "skills", "build-helper", "SKILL.md"),
      "---\nname: build-helper\ndescription: Use for build tasks\n---\n# Build Helper\n",
    );

    await expect(discoverCodexSkills(codexHome)).resolves.toEqual([
      {
        description: "Use for build tasks",
        name: "build-helper",
        path: join(codexHome, "skills", "build-helper", "SKILL.md"),
      },
    ]);
  });
});