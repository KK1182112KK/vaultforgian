import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

export interface SkillRootNormalizationOptions {
  allowedRoots?: readonly string[];
}

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

function hasWindowsDrivePrefix(input: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(input);
}

function isUncPath(input: string): boolean {
  return /^\\\\/.test(input);
}

function isLocalAbsolutePath(input: string): boolean {
  return isAbsolute(input) || hasWindowsDrivePrefix(input);
}

function resolveCanonicalDirectory(input: string): string | null {
  const expanded = expandHomePath(input);
  if (!expanded || !isLocalAbsolutePath(expanded) || isUncPath(expanded)) {
    return null;
  }
  try {
    const stat = lstatSync(expanded);
    if (!stat.isDirectory() && !stat.isSymbolicLink()) {
      return null;
    }
    const resolved = realpathSync.native?.(expanded) ?? realpathSync(expanded);
    if (!statSync(resolved).isDirectory()) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function isPathWithinAllowedRoots(candidate: string, allowedRoots: readonly string[]): boolean {
  return allowedRoots.some((allowedRoot) => {
    const rel = relative(allowedRoot, candidate);
    return rel === "" || (!rel.startsWith("..") && rel !== ".." && !isAbsolute(rel));
  });
}

export function normalizeConfiguredSkillRoots(
  values: readonly string[] | null | undefined,
  options: SkillRootNormalizationOptions = {},
): string[] {
  const normalizedAllowedRoots = options.allowedRoots
    ? options.allowedRoots
        .map((value) => resolveCanonicalDirectory(value))
        .filter((value): value is string => Boolean(value))
    : null;
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const value of values ?? []) {
    const expanded = expandHomePath(value);
    if (!expanded) {
      continue;
    }
    const normalized =
      normalizedAllowedRoots !== null
        ? resolveCanonicalDirectory(expanded)
        : expanded;
    if (!normalized) {
      continue;
    }
    if (normalizedAllowedRoots !== null && !isPathWithinAllowedRoots(normalized, normalizedAllowedRoots)) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    roots.push(normalized);
  }
  return roots;
}

export function getDefaultWslBridgeSkillRoots(platformName = process.platform): string[] {
  if (platformName !== "win32") {
    return [];
  }
  return [
    "\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\.codex\\skills",
    "\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\.agents\\skills",
    "\\\\wsl$\\Ubuntu\\home\\kenshin\\.codex\\skills",
    "\\\\wsl$\\Ubuntu\\home\\kenshin\\.agents\\skills",
  ];
}
