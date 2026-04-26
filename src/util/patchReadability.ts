import type {
  PatchProposal,
  PatchQualityIssue,
  PatchQualityIssueCode,
  PatchQualityState,
} from "../model/types";

export class PatchReadabilityError extends Error {
  constructor(
    message: string,
    readonly targetPath: string,
  ) {
    super(message);
    this.name = "PatchReadabilityError";
  }
}

interface ParsedLine {
  original: string;
  prefix: string;
  content: string;
  trimmedContent: string;
  lineNumber: number;
  quoteDepth: number;
}

interface DisplayMathRange {
  openIndex: number;
  closeIndex: number;
  quoteDepth: number;
}

export interface PatchReadabilityAssessment {
  text: string;
  qualityState: PatchQualityState;
  qualityIssues: PatchQualityIssue[];
  healedByPlugin?: boolean;
}

const QUOTE_PREFIX_PATTERN = /^(\s*(?:>\s*)+)(.*)$/;
const CALLOUT_HEADER_PATTERN = /^\s*\[![^\]]+\][+-]?/u;

function createIssue(code: PatchQualityIssueCode, line: number, detail?: string | null): PatchQualityIssue {
  return {
    code,
    line,
    detail: detail?.trim() ? detail.trim() : null,
  };
}

function parseLine(line: string, index: number): ParsedLine {
  const match = line.match(QUOTE_PREFIX_PATTERN);
  const prefix = match?.[1] ?? "";
  const content = match?.[2] ?? line;
  return {
    original: line,
    prefix,
    content,
    trimmedContent: content.trim(),
    lineNumber: index + 1,
    quoteDepth: prefix ? (prefix.match(/>/g) ?? []).length : 0,
  };
}

function parseLines(lines: readonly string[]): ParsedLine[] {
  return lines.map((line, index) => parseLine(line, index));
}

function isBlankLine(line: ParsedLine | undefined, quoteDepth?: number): boolean {
  if (!line) {
    return false;
  }
  if (quoteDepth !== undefined && line.quoteDepth !== quoteDepth) {
    return false;
  }
  return line.trimmedContent.length === 0;
}

function isStandaloneDisplayDelimiter(line: ParsedLine): boolean {
  return line.trimmedContent === "$$";
}

function isLegacyDisplayDelimiter(line: ParsedLine): boolean {
  return line.trimmedContent === "$";
}

function parseCollisionMarker(trimmedContent: string): string | null {
  const markerText = trimmedContent.startsWith("$$")
    ? trimmedContent.slice(2)
    : trimmedContent.startsWith("$")
      ? trimmedContent.slice(1)
      : null;
  if (!markerText) {
    return null;
  }
  if (markerText.startsWith(">")) {
    return markerText;
  }
  if (/^#(?:\s|$)/.test(markerText)) {
    return markerText;
  }
  if (/^\*(?:\s|$)/.test(markerText)) {
    return markerText;
  }
  if (/^-(?:\s|$)/.test(markerText)) {
    return markerText;
  }
  return null;
}

function countInlineDisplayDelimiterTokens(trimmedContent: string): number {
  return (trimmedContent.match(/\$\$/g) ?? []).length;
}

function buildMixedContextDetail(fromDepth: number, toDepth: number): string {
  return `${fromDepth === 0 ? "plain" : `quote_${fromDepth}`}->${toDepth === 0 ? "plain" : `quote_${toDepth}`}`;
}

function findMostRecentOpenInDifferentContext(openByDepth: Map<number, number[]>, quoteDepth: number): number | null {
  let latest: number | null = null;
  for (const [depth, stack] of openByDepth.entries()) {
    if (depth === quoteDepth || stack.length === 0) {
      continue;
    }
    const candidate = stack[stack.length - 1] ?? null;
    if (candidate !== null && (latest === null || candidate > latest)) {
      latest = candidate;
    }
  }
  return latest;
}

function registerRangeLine(
  line: ParsedLine,
  parsedLines: readonly ParsedLine[],
  openByDepth: Map<number, number[]>,
  issues: PatchQualityIssue[],
  ranges: DisplayMathRange[],
): void {
  const stack = openByDepth.get(line.quoteDepth) ?? [];
  if (stack.length > 0) {
    const openIndex = stack.pop()!;
    if (stack.length === 0) {
      openByDepth.delete(line.quoteDepth);
    } else {
      openByDepth.set(line.quoteDepth, stack);
    }
    ranges.push({
      openIndex,
      closeIndex: line.lineNumber - 1,
      quoteDepth: line.quoteDepth,
    });
    return;
  }

  const latestOtherOpen = findMostRecentOpenInDifferentContext(openByDepth, line.quoteDepth);
  if (latestOtherOpen !== null) {
    const otherLine = parsedLines[latestOtherOpen];
    issues.push(
      createIssue(
        "mixed_display_math_context",
        otherLine?.lineNumber ?? latestOtherOpen + 1,
        buildMixedContextDetail(otherLine?.quoteDepth ?? 0, line.quoteDepth),
      ),
    );
    issues.push(
      createIssue(
        "mixed_display_math_context",
        line.lineNumber,
        buildMixedContextDetail(otherLine?.quoteDepth ?? 0, line.quoteDepth),
      ),
    );
  }

  openByDepth.set(line.quoteDepth, [...stack, line.lineNumber - 1]);
}

function collectDisplayMathRanges(
  parsedLines: readonly ParsedLine[],
  delimiter: "$" | "$$",
  issues: PatchQualityIssue[],
): DisplayMathRange[] {
  const openByDepth = new Map<number, number[]>();
  const ranges: DisplayMathRange[] = [];
  for (const line of parsedLines) {
    if ((delimiter === "$" && !isLegacyDisplayDelimiter(line)) || (delimiter === "$$" && !isStandaloneDisplayDelimiter(line))) {
      continue;
    }
    registerRangeLine(line, parsedLines, openByDepth, issues, ranges);
  }
  for (const [depth, stack] of openByDepth.entries()) {
    for (const index of stack) {
      const line = parsedLines[index];
      issues.push(
        createIssue(
          "unmatched_display_math",
          line?.lineNumber ?? index + 1,
          depth === 0 ? "plain" : `quote_${depth}`,
        ),
      );
    }
  }
  return ranges;
}

function collectIssues(lines: readonly string[]): PatchQualityIssue[] {
  const parsedLines = parseLines(lines);
  const issues: PatchQualityIssue[] = [];

  for (const [index, line] of parsedLines.entries()) {
    const nextLine = parsedLines[index + 1];
    if (line.quoteDepth === 0 && CALLOUT_HEADER_PATTERN.test(line.content) && nextLine && nextLine.quoteDepth > 0) {
      issues.push(createIssue("unquoted_callout_header", line.lineNumber));
    }
    if (isLegacyDisplayDelimiter(line)) {
      issues.push(createIssue("display_math_single_dollar", line.lineNumber));
      continue;
    }
    const marker = parseCollisionMarker(line.trimmedContent);
    if (marker) {
      const detail = line.quoteDepth > 0 ? `quoted:${marker}` : marker;
      issues.push(createIssue("math_delimiter_marker_collision", line.lineNumber, detail));
    }
    const inlineDisplayTokenCount = countInlineDisplayDelimiterTokens(line.trimmedContent);
    if (inlineDisplayTokenCount > 0 && !isStandaloneDisplayDelimiter(line) && inlineDisplayTokenCount % 2 === 1) {
      issues.push(createIssue("display_math_same_line_delimiter", line.lineNumber, line.trimmedContent));
    }
  }

  const legacyRanges = collectDisplayMathRanges(parsedLines, "$", issues);
  const canonicalRanges = collectDisplayMathRanges(parsedLines, "$$", issues);

  for (const range of [...legacyRanges, ...canonicalRanges]) {
    const openLine = parsedLines[range.openIndex];
    const closeLine = parsedLines[range.closeIndex];
    const beforeLine = parsedLines[range.openIndex - 1];
    if (beforeLine && !isBlankLine(beforeLine, range.quoteDepth)) {
      issues.push(createIssue("adjacent_block_spacing", openLine?.lineNumber ?? range.openIndex + 1, "missing_blank_line_before_math_block"));
    }
    const afterLine = parsedLines[range.closeIndex + 1];
    if (afterLine && !isBlankLine(afterLine, range.quoteDepth)) {
      issues.push(createIssue("adjacent_block_spacing", closeLine?.lineNumber ?? range.closeIndex + 1, "missing_blank_line_after_math_block"));
    }
  }

  const deduped = new Map<string, PatchQualityIssue>();
  for (const issue of issues) {
    const key = `${issue.code}:${issue.line ?? 0}:${issue.detail ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, issue);
    }
  }
  return [...deduped.values()].sort((left, right) => (left.line ?? 0) - (right.line ?? 0));
}

function collectHealableLegacyDelimiterLines(parsedLines: readonly ParsedLine[]): number[] | null {
  const openByDepth = new Map<number, number[]>();
  const replaceIndices: number[] = [];
  for (const line of parsedLines) {
    if (!isLegacyDisplayDelimiter(line)) {
      continue;
    }
    const stack = openByDepth.get(line.quoteDepth) ?? [];
    if (stack.length > 0) {
      const openIndex = stack.pop()!;
      if (stack.length === 0) {
        openByDepth.delete(line.quoteDepth);
      } else {
        openByDepth.set(line.quoteDepth, stack);
      }
      replaceIndices.push(openIndex, line.lineNumber - 1);
      continue;
    }
    if (findMostRecentOpenInDifferentContext(openByDepth, line.quoteDepth) !== null) {
      return null;
    }
    openByDepth.set(line.quoteDepth, [...stack, line.lineNumber - 1]);
  }
  if ([...openByDepth.values()].some((stack) => stack.length > 0)) {
    return null;
  }
  return replaceIndices.sort((left, right) => left - right);
}

function buildDisplayDelimiterLine(line: ParsedLine, delimiter: "$$"): string {
  return line.quoteDepth > 0 ? `${line.prefix}${delimiter}` : delimiter;
}

function buildBlankLine(line: ParsedLine): string {
  return line.quoteDepth > 0 ? line.prefix.trimEnd() : "";
}

function healStandaloneLegacyDelimiters(lines: string[]): boolean {
  const parsedLines = parseLines(lines);
  const replaceIndices = collectHealableLegacyDelimiterLines(parsedLines);
  if (!replaceIndices || replaceIndices.length === 0) {
    return false;
  }
  for (const index of replaceIndices) {
    const line = parsedLines[index];
    if (!line) {
      continue;
    }
    lines[index] = buildDisplayDelimiterLine(line, "$$");
  }
  return true;
}

function healDelimiterMarkerCollisions(lines: string[]): boolean {
  let changed = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = parseLine(lines[index] ?? "", index);
    if (line.quoteDepth > 0) {
      continue;
    }
    const marker = parseCollisionMarker(line.trimmedContent);
    if (!marker) {
      continue;
    }
    lines.splice(index, 1, "$$", marker);
    index += 1;
    changed = true;
  }
  return changed;
}

function collectCanonicalRangesForHealing(lines: readonly string[]): DisplayMathRange[] {
  const parsedLines = parseLines(lines);
  const openByDepth = new Map<number, number[]>();
  const ranges: DisplayMathRange[] = [];
  for (const line of parsedLines) {
    if (!isStandaloneDisplayDelimiter(line)) {
      continue;
    }
    const stack = openByDepth.get(line.quoteDepth) ?? [];
    if (stack.length > 0) {
      const openIndex = stack.pop()!;
      if (stack.length === 0) {
        openByDepth.delete(line.quoteDepth);
      } else {
        openByDepth.set(line.quoteDepth, stack);
      }
      ranges.push({
        openIndex,
        closeIndex: line.lineNumber - 1,
        quoteDepth: line.quoteDepth,
      });
      continue;
    }
    if (findMostRecentOpenInDifferentContext(openByDepth, line.quoteDepth) !== null) {
      continue;
    }
    openByDepth.set(line.quoteDepth, [...stack, line.lineNumber - 1]);
  }
  return ranges;
}

function healDisplayMathSpacing(lines: string[]): boolean {
  let changed = false;
  for (const range of collectCanonicalRangesForHealing(lines).reverse()) {
    const parsedLines = parseLines(lines);
    const beforeLine = parsedLines[range.openIndex - 1];
    if (beforeLine && !isBlankLine(beforeLine, range.quoteDepth)) {
      const openLine = parsedLines[range.openIndex];
      if (openLine) {
        lines.splice(range.openIndex, 0, buildBlankLine(openLine));
        changed = true;
      }
    }
  }
  for (const range of collectCanonicalRangesForHealing(lines).reverse()) {
    const parsedLines = parseLines(lines);
    const afterLine = parsedLines[range.closeIndex + 1];
    if (afterLine && !isBlankLine(afterLine, range.quoteDepth)) {
      const closeLine = parsedLines[range.closeIndex];
      if (closeLine) {
        lines.splice(range.closeIndex + 1, 0, buildBlankLine(closeLine));
        changed = true;
      }
    }
  }
  return changed;
}

function healUnquotedCalloutHeaders(lines: string[]): boolean {
  let changed = false;
  const parsedLines = parseLines(lines);
  for (const [index, line] of parsedLines.entries()) {
    const nextLine = parsedLines[index + 1];
    if (line.quoteDepth > 0 || !CALLOUT_HEADER_PATTERN.test(line.content) || !nextLine || nextLine.quoteDepth === 0) {
      continue;
    }
    lines[index] = `> ${line.content.trim()}`;
    changed = true;
  }
  return changed;
}

export function assessPatchReadability(text: string): PatchReadabilityAssessment {
  const normalized = text.replace(/\r\n/g, "\n");
  const initialLines = normalized.split("\n");
  const initialIssues = collectIssues(initialLines);
  if (initialIssues.length === 0) {
    return {
      text: normalized,
      qualityState: "clean",
      qualityIssues: [],
    };
  }

  const healedLines = [...initialLines];
  const healedCalloutHeaders = healUnquotedCalloutHeaders(healedLines);
  const healedLegacyDelimiters = healStandaloneLegacyDelimiters(healedLines);
  const healedCollisions = healDelimiterMarkerCollisions(healedLines);
  const healedSpacing = healDisplayMathSpacing(healedLines);
  const healedText = healedLines.join("\n");
  const healedIssues = collectIssues(healedLines);
  const healedByPlugin = healedCalloutHeaders || healedLegacyDelimiters || healedCollisions || healedSpacing;

  if (healedByPlugin && healedIssues.length === 0) {
    return {
      text: healedText,
      qualityState: "auto_healed",
      qualityIssues: [],
      healedByPlugin: true,
    };
  }

  return {
    text: healedByPlugin ? healedText : normalized,
    qualityState: "review_required",
    qualityIssues: healedByPlugin ? healedIssues : initialIssues,
    healedByPlugin: healedByPlugin || undefined,
  };
}

export function shouldBlockAutomaticPatchApply(
  proposal: Pick<PatchProposal, "qualityState" | "healedByPlugin" | "status" | "intent" | "safetyIssues">,
): boolean {
  return (
    proposal.status === "blocked" ||
    proposal.intent === "delete" ||
    proposal.intent === "full_replace" ||
    (proposal.safetyIssues?.length ?? 0) > 0 ||
    proposal.qualityState === "review_required" ||
    proposal.healedByPlugin === true
  );
}
