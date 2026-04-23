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
      const matchIndex = findUniqueLiteralMatchIndex(working, before);
      if (matchIndex === null) {
        return { ok: false, failure: { reason: "anchor_not_found", anchorIndex: index } };
      }
      if (matchIndex === -1) {
        return { ok: false, failure: { reason: "anchor_ambiguous", anchorIndex: index } };
      }
      working = spliceText(working, matchIndex + before.length, matchIndex + before.length, replacement);
      continue;
    }

    if (!before && after) {
      const matchIndex = findUniqueLiteralMatchIndex(working, after);
      if (matchIndex === null) {
        return { ok: false, failure: { reason: "anchor_not_found", anchorIndex: index } };
      }
      if (matchIndex === -1) {
        return { ok: false, failure: { reason: "anchor_ambiguous", anchorIndex: index } };
      }
      working = spliceText(working, matchIndex, matchIndex, replacement);
      continue;
    }

    const range = findUniqueAnchorRange(working, before, after);
    if (!range) {
      return { ok: false, failure: { reason: "anchor_not_found", anchorIndex: index } };
    }
    if (range === "ambiguous") {
      return { ok: false, failure: { reason: "anchor_ambiguous", anchorIndex: index } };
    }
    working = spliceText(working, range.start + before.length, range.end - after.length, replacement);
  }
  return { ok: true, text: working };
}

function findUniqueLiteralMatchIndex(haystack: string, needle: string): number | null {
  if (!needle) {
    return null;
  }
  let foundIndex = -1;
  let searchIndex = 0;
  while (true) {
    const nextIndex = haystack.indexOf(needle, searchIndex);
    if (nextIndex === -1) {
      return foundIndex === -1 ? null : foundIndex;
    }
    if (foundIndex !== -1) {
      return -1;
    }
    foundIndex = nextIndex;
    searchIndex = nextIndex + needle.length;
  }
}

function findAllLiteralMatchIndexes(haystack: string, needle: string): number[] {
  if (!needle) {
    return [];
  }
  const indexes: number[] = [];
  let searchIndex = 0;
  while (true) {
    const nextIndex = haystack.indexOf(needle, searchIndex);
    if (nextIndex === -1) {
      return indexes;
    }
    indexes.push(nextIndex);
    searchIndex = nextIndex + needle.length;
  }
}

function spliceText(text: string, start: number, end: number, replacement: string): string {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function findUniqueAnchorRange(
  haystack: string,
  before: string,
  after: string,
): { start: number; end: number } | "ambiguous" | null {
  const combined = before + after;
  const exactMatches = findAllLiteralMatchIndexes(haystack, combined);
  if (exactMatches.length === 1) {
    const start = exactMatches[0]!;
    return { start, end: start + combined.length };
  }
  if (exactMatches.length > 1) {
    return "ambiguous";
  }

  const candidates: Array<{ start: number; end: number }> = [];
  for (const beforeIndex of findAllLiteralMatchIndexes(haystack, before)) {
    const afterIndex = haystack.indexOf(after, beforeIndex + before.length);
    if (afterIndex === -1) {
      continue;
    }
    candidates.push({
      start: beforeIndex,
      end: afterIndex + after.length,
    });
    if (candidates.length > 1) {
      return "ambiguous";
    }
  }

  return candidates[0] ?? null;
}
