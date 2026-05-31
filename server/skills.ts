import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type CodexSkillSummary = {
  description: string;
  name: string;
  path: string;
};

function parseFrontmatter(markdown: string) {
  if (!markdown.startsWith("---\n")) {
    return {};
  }

  const end = markdown.indexOf("\n---", 4);

  if (end < 0) {
    return {};
  }

  return Object.fromEntries(
    markdown
      .slice(4, end)
      .split("\n")
      .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], match[2].trim()]),
  ) as Record<string, string>;
}

export async function discoverCodexSkills(codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex")) {
  const skillsRoot = join(codexHome, "skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<CodexSkillSummary | undefined> => {
        const skillPath = join(skillsRoot, entry.name, "SKILL.md");
        const markdown = await readFile(skillPath, "utf8").catch(() => undefined);

        if (!markdown) {
          return undefined;
        }

        const frontmatter = parseFrontmatter(markdown);

        return {
          description: frontmatter.description ?? "",
          name: frontmatter.name ?? entry.name,
          path: skillPath,
        };
      }),
  );

  return skills
    .filter((skill): skill is CodexSkillSummary => Boolean(skill))
    .sort((left, right) => left.name.localeCompare(right.name));
}