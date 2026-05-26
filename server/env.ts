import { existsSync, readFileSync } from "node:fs";

type EnvTarget = Record<string, string | undefined>;

function parseEnvValue(value: string) {
  const trimmed = value.trim();
  const isQuoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));

  return isQuoted ? trimmed.slice(1, -1) : trimmed;
}

export function loadDotEnvFile(path = ".env", target: EnvTarget = process.env) {
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (target[key] !== undefined) {
      continue;
    }

    target[key] = parseEnvValue(trimmed.slice(separatorIndex + 1));
  }
}
