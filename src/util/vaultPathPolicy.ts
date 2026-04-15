import { extname, isAbsolute, relative, resolve } from "node:path";
import type { App } from "obsidian";

export interface ManagedVaultPathPolicyResult {
  ok: boolean;
  normalizedPath: string;
  reason:
    | "empty"
    | "absolute"
    | "invalid_segment"
    | "hidden_segment"
    | "outside_vault"
    | "unsupported_extension";
}

function normalizeCandidatePath(input: string): string {
  return input.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function getVaultBasePath(app: App): string {
  const adapter = (app.vault as { adapter?: { basePath?: string } }).adapter;
  return adapter?.basePath?.trim() ?? "";
}

function hasAbsolutePrefix(input: string): boolean {
  return isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input) || /^\\\\/.test(input);
}

function containsInvalidSegments(segments: string[]): ManagedVaultPathPolicyResult["reason"] | null {
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      return "invalid_segment";
    }
    if (segment.startsWith(".")) {
      return "hidden_segment";
    }
  }
  return null;
}

function isOutsideVault(basePath: string, segments: string[]): boolean {
  if (!basePath) {
    return false;
  }
  const nextPath = resolve(basePath, ...segments);
  const rel = relative(basePath, nextPath);
  return rel.startsWith("..") || isAbsolute(rel);
}

export function validateManagedNotePath(app: App, input: string): ManagedVaultPathPolicyResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, normalizedPath: "", reason: "empty" };
  }
  if (hasAbsolutePrefix(trimmed)) {
    return { ok: false, normalizedPath: normalizeCandidatePath(trimmed), reason: "absolute" };
  }

  const normalizedPath = normalizeCandidatePath(trimmed);
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return { ok: false, normalizedPath, reason: "empty" };
  }

  const segmentIssue = containsInvalidSegments(segments);
  if (segmentIssue) {
    return { ok: false, normalizedPath, reason: segmentIssue };
  }

  const extension = extname(segments[segments.length - 1] ?? "").toLowerCase();
  if (extension !== ".md" && extension !== ".mdx") {
    return { ok: false, normalizedPath, reason: "unsupported_extension" };
  }

  if (isOutsideVault(getVaultBasePath(app), segments)) {
    return { ok: false, normalizedPath, reason: "outside_vault" };
  }

  return { ok: true, normalizedPath, reason: "empty" };
}

export function validateManagedFolderPath(app: App, input: string): ManagedVaultPathPolicyResult {
  const trimmed = input.trim();
  if (!trimmed || trimmed === ".") {
    return { ok: true, normalizedPath: "", reason: "empty" };
  }
  if (hasAbsolutePrefix(trimmed)) {
    return { ok: false, normalizedPath: normalizeCandidatePath(trimmed), reason: "absolute" };
  }
  const normalizedPath = normalizeCandidatePath(trimmed);
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return { ok: true, normalizedPath: "", reason: "empty" };
  }

  const segmentIssue = containsInvalidSegments(segments);
  if (segmentIssue) {
    return { ok: false, normalizedPath, reason: segmentIssue };
  }

  if (isOutsideVault(getVaultBasePath(app), segments)) {
    return { ok: false, normalizedPath, reason: "outside_vault" };
  }

  return { ok: true, normalizedPath, reason: "empty" };
}
