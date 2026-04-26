import type { PatchIntent, PatchProposal, PatchProposalKind, PatchSafetyIssue, PatchSafetyIssueCode } from "../model/types";

export interface PatchSafetyAssessment {
  safetyIssues: PatchSafetyIssue[];
  blocked: boolean;
}

export interface PatchSafetyInput {
  kind: PatchProposalKind;
  intent: PatchIntent;
  hasAnchors: boolean;
  baseText: string | null;
  proposedText: string;
}

const BLOCKING_SAFETY_CODES = new Set<PatchSafetyIssueCode>([
  "unsafe_full_update",
  "large_deletion",
]);

function createIssue(
  code: PatchSafetyIssueCode,
  detail?: string | null,
  deletedChars?: number | null,
  deletedPercent?: number | null,
): PatchSafetyIssue {
  return {
    code,
    detail: detail?.trim() ? detail.trim() : null,
    deletedChars: typeof deletedChars === "number" && Number.isFinite(deletedChars) ? deletedChars : null,
    deletedPercent: typeof deletedPercent === "number" && Number.isFinite(deletedPercent) ? deletedPercent : null,
  };
}

export function isBlockingPatchSafetyIssue(issue: Pick<PatchSafetyIssue, "code">): boolean {
  return BLOCKING_SAFETY_CODES.has(issue.code);
}

export function hasBlockingPatchSafetyIssues(issues: readonly PatchSafetyIssue[] | null | undefined): boolean {
  return Boolean(issues?.some(isBlockingPatchSafetyIssue));
}

export function hasRepairablePatchSafetyIssue(proposal: Pick<PatchProposal, "safetyIssues">): boolean {
  return Boolean(proposal.safetyIssues?.some((issue) => issue.code === "unsafe_full_update"));
}

export function shouldBlockExplicitPatchApply(
  proposal: Pick<PatchProposal, "status" | "intent" | "safetyIssues">,
): boolean {
  return (
    proposal.status === "blocked" ||
    proposal.intent === "delete" ||
    proposal.intent === "full_replace" ||
    (proposal.safetyIssues?.length ?? 0) > 0
  );
}

export function assessPatchSafety(input: PatchSafetyInput): PatchSafetyAssessment {
  if (input.kind !== "update" || input.baseText === null) {
    return { safetyIssues: [], blocked: false };
  }

  const safetyIssues: PatchSafetyIssue[] = [];
  const hasProposedBody = input.proposedText.trim().length > 0;
  if (!input.hasAnchors && hasProposedBody) {
    if (input.intent === "full_replace") {
      safetyIssues.push(createIssue("full_replace_requires_review", "explicit_full_replace"));
    } else {
      safetyIssues.push(createIssue("unsafe_full_update", "content_update_without_anchors"));
    }
  }

  if (input.intent === "delete") {
    safetyIssues.push(createIssue("delete_requires_review", "explicit_delete"));
  }

  const baseLength = input.baseText.length;
  const proposedLength = input.proposedText.length;
  const deletedChars = Math.max(0, baseLength - proposedLength);
  const deletedPercent = baseLength > 0 ? deletedChars / baseLength : 0;
  const deletionThreshold = Math.max(500, baseLength * 0.3);
  if (
    input.hasAnchors &&
    input.intent !== "delete" &&
    input.intent !== "full_replace" &&
    deletedChars > deletionThreshold
  ) {
    safetyIssues.push(createIssue("large_deletion", "large_deletion_without_delete_intent", deletedChars, deletedPercent));
  }

  return {
    safetyIssues,
    blocked: hasBlockingPatchSafetyIssues(safetyIssues),
  };
}
