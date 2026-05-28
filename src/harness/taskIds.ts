const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

export function createTaskId(input: string): string {
  const normalized = input.trim();

  if (!normalized) {
    return "task-empty-0";
  }

  let hash = FNV_OFFSET;
  const bytes = new TextEncoder().encode(normalized);

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }

  return `task-${hash.toString(36)}-${bytes.length.toString(36)}`;
}
