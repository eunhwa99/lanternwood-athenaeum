export const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;

export type SandboxMode = (typeof SANDBOX_MODES)[number];

export function isSandboxMode(value: unknown): value is SandboxMode {
  return typeof value === "string" && SANDBOX_MODES.includes(value as SandboxMode);
}
