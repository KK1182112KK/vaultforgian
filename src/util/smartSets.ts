import { basename } from "node:path";
import type {
  SmartSet,
  SmartSetDrift,
  SmartSetQuery,
  SmartSetQueryProperty,
  SmartSetResult,
  SmartSetResultItem,
  SmartSetSnapshot,
} from "../model/types";

export interface SmartSetCandidate {
  path: string;
  title: string;
  text: string;
  tags: string[];
  properties: Record<string, string>;
  mtime: number | null;
  size: number | null;
}

export interface NormalizedSmartSetInput {
  title: string;
  query: SmartSetQuery;
  normalizedQuery: string;
}

export const MAX_SMART_SET_RESULTS = 100;
export const MAX_SMART_SET_CAMPAIGN_RESULTS = 25;

const SMART_SET_STOP_WORDS = new Set(["notes", "note"]);

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizePropertyList(values: readonly SmartSetQueryProperty[]): SmartSetQueryProperty[] {
  return [...values]
    .map((entry) => ({
      key: entry.key.trim().toLowerCase(),
      value: entry.value?.trim() ? entry.value.trim().toLowerCase() : null,
    }))
    .filter((entry) => entry.key.length > 0)
    .sort((left, right) => left.key.localeCompare(right.key) || (left.value ?? "").localeCompare(right.value ?? ""));
}

function tokenizeSegment(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !SMART_SET_STOP_WORDS.has(token));
}

function splitIncludeExclude(input: string): { includeSegment: string; excludeSegment: string } {
  const match = input.match(/\b(?:except|excluding|without)\b/i);
  if (!match || typeof match.index !== "number") {
    return { includeSegment: input, excludeSegment: "" };
  }
  return {
    includeSegment: input.slice(0, match.index).trim(),
    excludeSegment: input.slice(match.index + match[0].length).trim(),
  };
}

function pluckTaggedTokens(input: string, pattern: RegExp): { next: string; matches: string[] } {
  const matches: string[] = [];
  const next = input.replace(pattern, (...args: unknown[]) => {
    const captures = args.slice(1, -2);
    const value = typeof captures[captures.length - 1] === "string" ? (captures[captures.length - 1] as string) : "";
    if (value?.trim()) {
      matches.push(value.trim().toLowerCase());
    }
    return " ";
  });
  return { next, matches };
}

function pluckProperties(input: string): { next: string; properties: SmartSetQueryProperty[] } {
  const properties: SmartSetQueryProperty[] = [];
  const next = input.replace(/\b([A-Za-z0-9_-]+):([^\s#]+)/g, (_match, key: string, value: string) => {
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey === "path" || normalizedKey === "folder" || normalizedKey === "in") {
      return " ";
    }
    properties.push({
      key: normalizedKey,
      value: value?.trim() ? value.trim().toLowerCase() : null,
    });
    return " ";
  });
  return { next, properties };
}

function clampExcerpt(text: string, maxChars = 180): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trimEnd()}...`;
}

function scoreCandidate(query: SmartSetQuery, candidate: SmartSetCandidate, excerpt: string): number {
  const pathLower = candidate.path.toLowerCase();
  const titleLower = candidate.title.toLowerCase();
  const textLower = candidate.text.toLowerCase();
  const excerptLower = excerpt.toLowerCase();
  let score = 0;

  for (const token of query.includeText) {
    if (pathLower.includes(token)) {
      score += 5;
    }
    if (titleLower.includes(token)) {
      score += 4;
    }
    if (excerptLower.includes(token)) {
      score += 3;
    }
    if (textLower.includes(token)) {
      score += 1;
    }
  }

  score += query.tags.filter((tag) => candidate.tags.includes(tag)).length * 4;
  score += query.properties.filter((property) => {
    const propertyValue = candidate.properties[property.key];
    return property.value === null ? Boolean(propertyValue) : propertyValue === property.value;
  }).length * 3;

  return score || 1;
}

function findExcerpt(query: SmartSetQuery, candidate: SmartSetCandidate): string {
  const lines = candidate.text.replace(/\r\n/g, "\n").split("\n");
  const tokens = [...query.includeText, ...query.pathIncludes].filter(Boolean);
  const match =
    lines.find((line) => tokens.length > 0 && tokens.every((token) => line.toLowerCase().includes(token))) ??
    lines.find((line) => tokens.some((token) => line.toLowerCase().includes(token))) ??
    lines.find((line) => line.trim().length > 0) ??
    candidate.path;
  return clampExcerpt(match.trim() || candidate.path);
}

export function serializeSmartSetQuery(query: SmartSetQuery): string {
  return JSON.stringify(
    {
      includeText: uniqueSorted(query.includeText.map((value) => value.toLowerCase())),
      excludeText: uniqueSorted(query.excludeText.map((value) => value.toLowerCase())),
      pathIncludes: uniqueSorted(query.pathIncludes.map((value) => value.toLowerCase())),
      pathExcludes: uniqueSorted(query.pathExcludes.map((value) => value.toLowerCase())),
      tags: uniqueSorted(query.tags.map((value) => value.toLowerCase())),
      properties: normalizePropertyList(query.properties),
    },
    null,
    2,
  );
}

export function parseSmartSetQuery(value: string): SmartSetQuery {
  try {
    const parsed = JSON.parse(value) as Partial<SmartSetQuery>;
    return {
      includeText: uniqueSorted(Array.isArray(parsed.includeText) ? parsed.includeText.map(String) : []),
      excludeText: uniqueSorted(Array.isArray(parsed.excludeText) ? parsed.excludeText.map(String) : []),
      pathIncludes: uniqueSorted(Array.isArray(parsed.pathIncludes) ? parsed.pathIncludes.map(String) : []),
      pathExcludes: uniqueSorted(Array.isArray(parsed.pathExcludes) ? parsed.pathExcludes.map(String) : []),
      tags: uniqueSorted(Array.isArray(parsed.tags) ? parsed.tags.map(String) : []),
      properties: normalizePropertyList(Array.isArray(parsed.properties) ? parsed.properties : []),
    };
  } catch {
    return {
      includeText: [],
      excludeText: [],
      pathIncludes: [],
      pathExcludes: [],
      tags: [],
      properties: [],
    };
  }
}

export function normalizeSmartSetPrompt(input: string): NormalizedSmartSetInput {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Provide a Smart Set query.");
  }

  const title = trimmed.replace(/\s+/g, " ").slice(0, 80);
  const { includeSegment, excludeSegment } = splitIncludeExclude(trimmed);

  const includeTagExtraction = pluckTaggedTokens(includeSegment, /(^|\s)#([A-Za-z0-9/_-]+)/g);
  const excludeTagExtraction = pluckTaggedTokens(excludeSegment, /(^|\s)#([A-Za-z0-9/_-]+)/g);
  const includePathExtraction = pluckTaggedTokens(includeTagExtraction.next, /\b(?:path|folder|in):([^\s]+)/gi);
  const excludePathExtraction = pluckTaggedTokens(excludeTagExtraction.next, /\b(?:path|folder|in):([^\s]+)/gi);
  const includePropertyExtraction = pluckProperties(includePathExtraction.next);
  const excludePropertyExtraction = pluckProperties(excludePathExtraction.next);

  const query: SmartSetQuery = {
    includeText: tokenizeSegment(includePropertyExtraction.next),
    excludeText: tokenizeSegment(excludePropertyExtraction.next),
    pathIncludes: uniqueSorted(includePathExtraction.matches),
    pathExcludes: uniqueSorted(excludePathExtraction.matches),
    tags: uniqueSorted([...includeTagExtraction.matches, ...excludeTagExtraction.matches]),
    properties: normalizePropertyList([...includePropertyExtraction.properties, ...excludePropertyExtraction.properties]),
  };

  return {
    title,
    query,
    normalizedQuery: serializeSmartSetQuery(query),
  };
}

export function executeSmartSetQuery(
  query: SmartSetQuery,
  candidates: readonly SmartSetCandidate[],
  generatedAt = Date.now(),
): SmartSetResult {
  const items: SmartSetResultItem[] = [];

  for (const candidate of candidates) {
    const pathLower = candidate.path.toLowerCase();
    const titleLower = candidate.title.toLowerCase();
    const textLower = candidate.text.toLowerCase();
    const bag = `${pathLower}\n${titleLower}\n${textLower}`;

    if (query.includeText.some((token) => !bag.includes(token))) {
      continue;
    }
    if (query.excludeText.some((token) => bag.includes(token))) {
      continue;
    }
    if (query.pathIncludes.some((token) => !pathLower.includes(token))) {
      continue;
    }
    if (query.pathExcludes.some((token) => pathLower.includes(token))) {
      continue;
    }
    if (query.tags.some((tag) => !candidate.tags.includes(tag))) {
      continue;
    }
    if (
      query.properties.some((property) => {
        const value = candidate.properties[property.key];
        return property.value === null ? !value : value !== property.value;
      })
    ) {
      continue;
    }

    const excerpt = findExcerpt(query, candidate);
    items.push({
      path: candidate.path,
      title: candidate.title || basename(candidate.path, ".md"),
      excerpt,
      mtime: candidate.mtime,
      size: candidate.size,
      score: scoreCandidate(query, candidate, excerpt),
    });
  }

  items.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return {
    items,
    count: items.length,
    generatedAt,
  };
}

export function computeSmartSetDrift(liveResult: SmartSetResult, snapshot: SmartSetSnapshot | null, comparedAt = Date.now()): SmartSetDrift | null {
  if (!snapshot) {
    return null;
  }

  const liveByPath = new Map(liveResult.items.map((item) => [item.path, item]));
  const snapshotByPath = new Map(snapshot.result.items.map((item) => [item.path, item]));
  const added = liveResult.items.filter((item) => !snapshotByPath.has(item.path));
  const removed = snapshot.result.items.filter((item) => !liveByPath.has(item.path));
  const changed = liveResult.items.filter((item) => {
    const previous = snapshotByPath.get(item.path);
    return Boolean(previous && (previous.mtime !== item.mtime || previous.size !== item.size));
  });

  return {
    added,
    removed,
    changed,
    comparedAt,
  };
}

export function slugifySmartSetTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "smart-set";
}

function formatTimestamp(value: number | null): string {
  return value ? new Date(value).toISOString() : "n/a";
}

function formatList(items: readonly string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

export function buildSmartSetMirrorMarkdown(smartSet: SmartSet): string {
  const liveItems = smartSet.liveResult?.items ?? [];
  const snapshotItems = smartSet.lastSnapshot?.result.items ?? [];
  const drift = smartSet.lastDrift;

  return [
    "---",
    "type: codex-smart-set",
    `smart_set_id: ${smartSet.id}`,
    `title: ${JSON.stringify(smartSet.title)}`,
    `natural_query: ${JSON.stringify(smartSet.naturalQuery)}`,
    `last_run_at: ${JSON.stringify(formatTimestamp(smartSet.lastRunAt))}`,
    `snapshot_at: ${JSON.stringify(formatTimestamp(smartSet.lastSnapshot?.createdAt ?? null))}`,
    "---",
    "",
    `# ${smartSet.title}`,
    "",
    "## Natural Query",
    "",
    smartSet.naturalQuery,
    "",
    "## Normalized Query",
    "",
    "```json",
    smartSet.normalizedQuery,
    "```",
    "",
    `## Live Result (${smartSet.liveResult?.count ?? 0})`,
    "",
    formatList(liveItems.slice(0, 20).map((item) => `[[${item.path}]]`)),
    "",
    `## Snapshot (${snapshotItems.length})`,
    "",
    smartSet.lastSnapshot ? `Created: ${formatTimestamp(smartSet.lastSnapshot.createdAt)} (${smartSet.lastSnapshot.reason})` : "No snapshot yet.",
    "",
    smartSet.lastSnapshot ? formatList(snapshotItems.slice(0, 20).map((item) => `[[${item.path}]]`)) : "- none",
    "",
    "## Drift",
    "",
    drift
      ? [`Added: ${drift.added.length}`, `Removed: ${drift.removed.length}`, `Changed: ${drift.changed.length}`, `Compared: ${formatTimestamp(drift.comparedAt)}`].join("\n")
      : "No drift computed yet.",
  ].join("\n");
}
