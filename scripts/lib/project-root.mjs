import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT_ENV = "VAULTFORGIAN_PROJECT_ROOT";
export const LEGACY_PROJECT_ROOT_ENV = "CODEX_NOTEFORGE_PROJECT_ROOT";

export function resolveProjectRoot(importMetaUrl) {
  const override = process.env[PROJECT_ROOT_ENV]?.trim() || process.env[LEGACY_PROJECT_ROOT_ENV]?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

export function compareStringsLexicographically(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
