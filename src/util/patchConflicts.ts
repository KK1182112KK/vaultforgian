export type PatchConflictReason =
  | "target_exists"
  | "content_changed"
  | "anchor_not_found"
  | "anchor_ambiguous"
  | "empty_anchor";

export interface PatchConflictDetails {
  tabId: string;
  patchId: string;
  targetPath: string;
  reason: PatchConflictReason;
  baseSnapshot: string | null;
  currentContent: string | null;
  proposedText: string;
  unifiedDiff: string;
  openedCurrentContentHash: string;
}

export class PatchConflictError extends Error {
  readonly details: PatchConflictDetails;

  constructor(details: PatchConflictDetails, message: string) {
    super(message);
    this.name = "PatchConflictError";
    this.details = details;
  }
}

export function hashPatchContent(value: string | null): string {
  const normalized = value ?? "";
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}
