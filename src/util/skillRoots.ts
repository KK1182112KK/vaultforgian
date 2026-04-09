import { homedir } from "node:os";
import { join } from "node:path";

export function expandHomePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function normalizeConfiguredSkillRoots(values: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const value of values ?? []) {
    const expanded = expandHomePath(value);
    if (!expanded || seen.has(expanded)) {
      continue;
    }
    seen.add(expanded);
    roots.push(expanded);
  }
  return roots;
}
