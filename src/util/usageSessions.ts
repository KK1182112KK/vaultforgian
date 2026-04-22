import { promises as fs } from "node:fs";
import type { Dir, Stats } from "node:fs";
import { join } from "node:path";
import type { UsageSummary } from "../model/types";
import { sanitizeOperationalAssistantText } from "./assistantChatter";
import { createEmptyUsageSummary, extractUsageSummaryPatch, mergeUsageSummary } from "./usage";

const DEFAULT_SESSION_TRAVERSAL_MAX_DEPTH = 12;
const DEFAULT_SESSION_TRAVERSAL_MAX_DIRECTORIES = 2_000;
const DEFAULT_SESSION_TRAVERSAL_MAX_ENTRIES = 20_000;
const DEFAULT_RECENT_SESSION_LOOKBACK_DAYS = 7;
const DEFAULT_SESSION_JSONL_MAX_BYTES = 4 * 1024 * 1024;

export interface SessionTraversalBounds {
  maxDepth?: number;
  maxDirectories?: number;
  maxEntries?: number;
}

export interface SessionJsonlReadBounds {
  maxBytes?: number;
}

export interface RecentSessionFile {
  path: string;
  name: string;
  modifiedAt: number;
}

export interface RecentSessionFileSearchOptions extends SessionTraversalBounds {
  now?: number;
  lookbackDays?: number;
  limit?: number;
  changedAfterMs?: number;
}

export interface SessionUsageSnapshot {
  summary: UsageSummary | null;
  lastObservedAt: number;
  lastCheckedAt: number;
}

export interface SessionAssistantMessageCandidate {
  rawText: string;
  visibleText: string;
  source: "response_item" | "agent_message" | "task_complete";
}

interface SessionTreeEntry {
  path: string;
  name: string;
  depth: number;
}

interface SessionFileSlice {
  text: string | null;
  stat: Stats;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeBound(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, Math.floor(value));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function extractResponseMessageText(payload: Record<string, unknown>): string | null {
  const content = Array.isArray(payload.content) ? payload.content : [];
  const parts = content
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => asString(entry.text))
    .filter((entry): entry is string => Boolean(entry?.trim()));

  if (parts.length > 0) {
    return parts.join("\n\n");
  }

  const directText = asString(payload.text);
  return directText?.trim() ? directText : null;
}

function parseSessionJsonl(text: string, visit: (event: unknown) => boolean | void): boolean {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (visit(event) === true) {
      return true;
    }
  }
  return false;
}

function parseUsageSummaryFromText(text: string): UsageSummary | null {
  let summary = createEmptyUsageSummary();
  let sawUsage = false;

  parseSessionJsonl(text, (event) => {
    const patch = extractUsageSummaryPatch(event);
    if (!patch) {
      return false;
    }

    summary = mergeUsageSummary(summary, patch);
    sawUsage = true;
    return false;
  });

  return sawUsage ? summary : null;
}

function toSessionAssistantCandidate(
  rawText: string | null,
  source: SessionAssistantMessageCandidate["source"],
): SessionAssistantMessageCandidate | null {
  const trimmed = rawText?.trim();
  if (!trimmed) {
    return null;
  }
  const visibleText = sanitizeOperationalAssistantText(trimmed)?.trim() ?? "";
  if (!visibleText) {
    return null;
  }
  return {
    rawText: trimmed,
    visibleText,
    source,
  };
}

function parseLastAssistantMessageFromText(text: string): string | null {
  let latestMessage: string | null = null;

  parseSessionJsonl(text, (event) => {
    const root = asRecord(event);
    const eventType = asString(root?.type);
    const payload = asRecord(root?.payload);
    const item = asRecord(root?.item);

    if (eventType === "event_msg" && payload) {
      const payloadType = asString(payload.type);
      if (payloadType === "agent_message") {
        const text = asString(payload.message)?.trim();
        if (text) {
          latestMessage = text;
        }
        return false;
      }

      if (payloadType === "task_complete") {
        const text = (asString(payload.last_agent_message) ?? asString(payload.lastAgentMessage))?.trim();
        if (text) {
          latestMessage = text;
        }
        return false;
      }
    }

    if (eventType === "response_item" && payload) {
      const payloadType = asString(payload.type);
      if (payloadType === "message" && asString(payload.role) === "assistant") {
        const text = extractResponseMessageText(payload)?.trim();
        if (text) {
          latestMessage = text;
        }
        return false;
      }
    }

    if (item && asString(item.type) === "agent_message") {
      const text = asString(item.text)?.trim();
      if (text) {
        latestMessage = text;
      }
    }

    return false;
  });

  return latestMessage;
}

function parseLastVisibleAssistantMessageFromText(text: string): SessionAssistantMessageCandidate | null {
  let latestMessage: SessionAssistantMessageCandidate | null = null;

  parseSessionJsonl(text, (event) => {
    const root = asRecord(event);
    const eventType = asString(root?.type);
    const payload = asRecord(root?.payload);
    const item = asRecord(root?.item);

    if (eventType === "event_msg" && payload) {
      const payloadType = asString(payload.type);
      if (payloadType === "agent_message") {
        latestMessage = toSessionAssistantCandidate(asString(payload.message), "agent_message") ?? latestMessage;
        return false;
      }

      if (payloadType === "task_complete") {
        latestMessage =
          toSessionAssistantCandidate(asString(payload.last_agent_message) ?? asString(payload.lastAgentMessage), "task_complete") ??
          latestMessage;
        return false;
      }
    }

    if (eventType === "response_item" && payload) {
      const payloadType = asString(payload.type);
      if (payloadType === "message" && asString(payload.role) === "assistant") {
        latestMessage = toSessionAssistantCandidate(extractResponseMessageText(payload), "response_item") ?? latestMessage;
        return false;
      }
    }

    if (item && asString(item.type) === "agent_message") {
      latestMessage = toSessionAssistantCandidate(asString(item.text), "agent_message") ?? latestMessage;
    }

    return false;
  });

  return latestMessage;
}

function buildSessionDateRoot(root: string, date: Date): string {
  return join(root, String(date.getUTCFullYear()), pad2(date.getUTCMonth() + 1), pad2(date.getUTCDate()));
}

async function readBoundedSessionText(
  sessionFilePath: string,
  bounds: SessionJsonlReadBounds = {},
): Promise<SessionFileSlice | null> {
  const maxBytes = normalizeBound(bounds.maxBytes, DEFAULT_SESSION_JSONL_MAX_BYTES);
  if (maxBytes <= 0) {
    return null;
  }

  let stat: Stats;
  try {
    stat = await fs.stat(sessionFilePath);
  } catch {
    return null;
  }

  if (!stat.isFile()) {
    return null;
  }

  if (stat.size === 0) {
    return { text: "", stat };
  }

  const readSize = Math.min(stat.size, maxBytes);
  const start = Math.max(0, stat.size - readSize);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  let text: string | null = null;

  try {
    handle = await fs.open(sessionFilePath, "r");
    const buffer = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, start);
    if (bytesRead <= 0) {
      return { text: null, stat };
    }

    text = buffer.toString("utf8", 0, bytesRead);
    if (stat.size > maxBytes && !text.includes("\n") && !text.includes("\r")) {
      text = null;
    }
  } catch {
    text = null;
  } finally {
    if (handle) {
      await handle.close().catch(() => {
        // ignore best-effort close failures
      });
    }
  }

  return { text, stat };
}

async function walkSessionTree(
  roots: string[],
  bounds: SessionTraversalBounds,
  onFileEntry: (entry: SessionTreeEntry) => Promise<boolean | void> | boolean | void,
): Promise<boolean> {
  const maxDepth = normalizeBound(bounds.maxDepth, DEFAULT_SESSION_TRAVERSAL_MAX_DEPTH);
  const maxDirectories = normalizeBound(bounds.maxDirectories, DEFAULT_SESSION_TRAVERSAL_MAX_DIRECTORIES);
  const maxEntries = normalizeBound(bounds.maxEntries, DEFAULT_SESSION_TRAVERSAL_MAX_ENTRIES);
  const stack = roots
    .slice()
    .reverse()
    .map((path) => ({ path, depth: 0 }));
  const openedDirectories = new Set<string>();
  let directoriesVisited = 0;
  let entriesVisited = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || openedDirectories.has(current.path)) {
      continue;
    }
    if (directoriesVisited >= maxDirectories) {
      return false;
    }

    let dir: Dir | null = null;
    try {
      dir = await fs.opendir(current.path);
    } catch {
      continue;
    }

    openedDirectories.add(current.path);
    directoriesVisited += 1;

    try {
      for await (const entry of dir) {
        entriesVisited += 1;
        if (entriesVisited > maxEntries) {
          return false;
        }

        const entryPath = join(current.path, entry.name);
        const entryDepth = current.depth + 1;

        if (entry.isDirectory()) {
          if (entryDepth <= maxDepth && !openedDirectories.has(entryPath)) {
            stack.push({ path: entryPath, depth: entryDepth });
          }
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const shouldStop = await onFileEntry({
          path: entryPath,
          name: entry.name,
          depth: entryDepth,
        });
        if (shouldStop) {
          return true;
        }
      }
    } finally {
      await dir.close().catch(() => {
        // ignore best-effort close failures
      });
    }
  }

  return false;
}

export function buildRecentSessionSearchRoots(
  root: string,
  now: Date | number = new Date(),
  lookbackDays = DEFAULT_RECENT_SESSION_LOOKBACK_DAYS,
): string[] {
  const referenceDate = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  const safeDate = Number.isFinite(referenceDate.getTime()) ? referenceDate : new Date();
  const normalizedLookbackDays = normalizeBound(lookbackDays, DEFAULT_RECENT_SESSION_LOOKBACK_DAYS);
  const roots = new Set<string>();

  for (let offset = 0; offset <= normalizedLookbackDays; offset += 1) {
    const date = new Date(Date.UTC(safeDate.getUTCFullYear(), safeDate.getUTCMonth(), safeDate.getUTCDate() - offset));
    roots.add(buildSessionDateRoot(root, date));
  }

  roots.add(root);
  return [...roots];
}

export async function findSessionFileForThread(
  root: string,
  threadId: string,
  bounds: SessionTraversalBounds = {},
): Promise<string | null> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return null;
  }

  let found: string | null = null;
  await walkSessionTree(buildRecentSessionSearchRoots(root), bounds, (entry) => {
    if (entry.name.endsWith(`${normalizedThreadId}.jsonl`)) {
      found = entry.path;
      return true;
    }
    return false;
  });

  return found;
}

export async function listRecentSessionFiles(
  root: string,
  options: RecentSessionFileSearchOptions = {},
): Promise<RecentSessionFile[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) {
    return [];
  }

  const now = typeof options.now === "number" && Number.isFinite(options.now) ? options.now : Date.now();
  const lookbackDays = normalizeBound(options.lookbackDays, DEFAULT_RECENT_SESSION_LOOKBACK_DAYS);
  const cutoffMs = now - lookbackDays * 24 * 60 * 60 * 1000;
  const changedAfterMs =
    typeof options.changedAfterMs === "number" && Number.isFinite(options.changedAfterMs)
      ? options.changedAfterMs
      : null;
  const minimumMtimeMs = changedAfterMs === null ? cutoffMs : Math.max(cutoffMs, changedAfterMs);
  const matches: RecentSessionFile[] = [];

  await walkSessionTree(buildRecentSessionSearchRoots(root, now, lookbackDays), options, async (entry) => {
    if (!entry.name.endsWith(".jsonl")) {
      return false;
    }

    let stat: Stats;
    try {
      stat = await fs.stat(entry.path);
    } catch {
      return false;
    }

    if (!stat.isFile() || stat.mtimeMs < minimumMtimeMs) {
      return false;
    }

    matches.push({
      path: entry.path,
      name: entry.name,
      modifiedAt: stat.mtimeMs,
    });
    return false;
  });

  matches.sort((left, right) => {
    if (right.modifiedAt !== left.modifiedAt) {
      return right.modifiedAt - left.modifiedAt;
    }
    return right.path.localeCompare(left.path);
  });

  return matches.slice(0, limit);
}

export async function readUsageSummaryFromSessionFile(
  sessionFilePath: string,
  bounds: SessionJsonlReadBounds = {},
): Promise<UsageSummary | null> {
  const slice = await readBoundedSessionText(sessionFilePath, bounds);
  if (!slice || slice.text === null) {
    return null;
  }
  return parseUsageSummaryFromText(slice.text);
}

export async function readSessionUsageSnapshot(
  sessionFilePath: string,
  checkedAt = Date.now(),
  bounds: SessionJsonlReadBounds = {},
): Promise<SessionUsageSnapshot | null> {
  const slice = await readBoundedSessionText(sessionFilePath, bounds);
  if (!slice) {
    return null;
  }

  return {
    summary: slice.text === null ? null : parseUsageSummaryFromText(slice.text),
    lastObservedAt: slice.stat.mtimeMs,
    lastCheckedAt: checkedAt,
  };
}

export async function readLastAssistantMessageFromSessionFile(
  sessionFilePath: string,
  bounds: SessionJsonlReadBounds = {},
): Promise<string | null> {
  const slice = await readBoundedSessionText(sessionFilePath, bounds);
  if (!slice || slice.text === null) {
    return null;
  }
  return parseLastAssistantMessageFromText(slice.text);
}

export async function readLastVisibleAssistantMessageFromSessionFile(
  sessionFilePath: string,
  bounds: SessionJsonlReadBounds = {},
): Promise<SessionAssistantMessageCandidate | null> {
  const slice = await readBoundedSessionText(sessionFilePath, bounds);
  if (!slice || slice.text === null) {
    return null;
  }
  return parseLastVisibleAssistantMessageFromText(slice.text);
}
