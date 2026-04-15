import type { ParsedAssistantPatchAnchor } from "./assistantProposals";

export interface PatchApplyFailure {
  reason: "anchor_not_found" | "anchor_ambiguous" | "empty_anchor";
  anchorIndex: number;
}

export type PatchApplyResult =
  | { ok: true; text: string }
  | { ok: false; failure: PatchApplyFailure };

export function normalizeForComparison(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value.replace(/\r\n/g, "\n").replace(/[\t ]+\n/g, "\n");
}

export function applyAnchorReplacements(
  baseText: string,
  anchors: readonly ParsedAssistantPatchAnchor[],
): PatchApplyResult {
  let working = baseText.replace(/\r\n/g, "\n");
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const before = anchor.anchorBefore.replace(/\r\n/g, "\n");
    const after = anchor.anchorAfter.replace(/\r\n/g, "\n");
    const replacement = anchor.replacement.replace(/\r\n/g, "\n");

    if (!before && !after) {
      return { ok: false, failure: { reason: "empty_anchor", anchorIndex: index } };
    }

    if (before && !after) {
      const count = countOccurrences(working, before);
      if (count === 0) {
        return { ok: false, failure: { reason: "anchor_not_found", anchorIndex: index } };
      }
      if (count > 1) {
        return { ok: false, failure: { reason: "anchor_ambiguous", anchorIndex: index } };
      }
      working = working.replace(before, before + replacement);
      continue;
    }

    if (!before && after) {
      const count = countOccurrences(working, after);
      if (count === 0) {
        return { ok: false, failure: { reason: "anchor_not_found", anchorIndex: index } };
      }
      if (count > 1) {
        return { ok: false, failure: { reason: "anchor_ambiguous", anchorIndex: index } };
      }
      working = working.replace(after, replacement + after);
      continue;
    }

    const combined = before + after;
    const combinedCount = countOccurrences(working, combined);
    if (combinedCount === 1) {
      working = working.replace(combined, before + replacement + after);
      continue;
    }
    const pattern = new RegExp(`${escapeRegExp(before)}[\\s\\S]*?${escapeRegExp(after)}`);
    const matches = working.match(new RegExp(pattern, "g"));
    if (!matches || matches.length === 0) {
      return { ok: false, failure: { reason: "anchor_not_found", anchorIndex: index } };
    }
    if (matches.length > 1) {
      return { ok: false, failure: { reason: "anchor_ambiguous", anchorIndex: index } };
    }
    working = working.replace(pattern, before + replacement + after);
  }
  return { ok: true, text: working };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
