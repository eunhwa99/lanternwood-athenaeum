import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createDefaultCoordinatorPolicy, type CoordinatorPolicy } from "./coordinatorPolicy";

const PERSONA_IDS = ["luma", "orion", "neria", "quill", "argus", "coordinator"] as const;

export type GlobalAgents = {
  agentsHome: string;
  automationPolicy: CoordinatorPolicy & Record<string, unknown>;
  personas: Partial<Record<(typeof PERSONA_IDS)[number], string>>;
};

type LoadGlobalAgentsOptions = {
  agentsHome?: string;
  homeDirectory?: string;
  workspacePath?: string;
};

function readOptionalText(path: string) {
  if (!existsSync(path)) {
    return undefined;
  }

  return readFileSync(path, "utf8").trim();
}

function readOptionalJson(path: string): Record<string, unknown> | undefined {
  const text = readOptionalText(path);

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeAllowRoot(path: string) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

export async function loadGlobalAgents(options: LoadGlobalAgentsOptions = {}): Promise<GlobalAgents> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const configuredAgentsHome = options.agentsHome ?? process.env.LANTERNWOOD_AGENTS_HOME?.trim();
  const agentsHome = configuredAgentsHome || join(homeDirectory, ".agents");
  const personas: GlobalAgents["personas"] = {};

  for (const personaId of PERSONA_IDS) {
    const persona = readOptionalText(join(agentsHome, "personas", `${personaId}.md`));

    if (persona) {
      personas[personaId] = persona;
    }
  }

  return {
    agentsHome,
    automationPolicy: {
      ...(() => {
        const defaultPolicy = createDefaultCoordinatorPolicy(homeDirectory);
        const configuredPolicy = readOptionalJson(join(agentsHome, "automation_policy.json"));
        const activeWorkspacePath = options.workspacePath?.trim() || process.cwd();
        const allowRoots = new Set(
          (Array.isArray(defaultPolicy.allowRoots) ? defaultPolicy.allowRoots : []).map(normalizeAllowRoot),
        );

        if (Array.isArray(configuredPolicy?.allowRoots)) {
          for (const root of configuredPolicy.allowRoots) {
            if (typeof root === "string" && root.trim()) {
              allowRoots.add(normalizeAllowRoot(root));
            }
          }
        }

        if (activeWorkspacePath) {
          allowRoots.add(normalizeAllowRoot(activeWorkspacePath));
        }

        return {
          ...defaultPolicy,
          ...configuredPolicy,
          allowRoots: Array.from(allowRoots),
        };
      })(),
    },
    personas,
  };
}
