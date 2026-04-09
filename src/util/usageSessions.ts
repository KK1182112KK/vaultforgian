import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { UsageSummary } from "../model/types";
import { createEmptyUsageSummary, extractUsageSummaryPatch, mergeUsageSummary } from "./usage";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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

async function walkForSessionFile(root: string, threadId: string): Promise<string | null> {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(`${threadId}.jsonl`)) {
        return absolutePath;
      }
    }
  }

  return null;
}

export async function findSessionFileForThread(root: string, threadId: string): Promise<string | null> {
  if (!threadId.trim()) {
    return null;
  }
  return walkForSessionFile(root, threadId.trim());
}

export async function readUsageSummaryFromSessionFile(sessionFilePath: string): Promise<UsageSummary | null> {
  const content = await fs.readFile(sessionFilePath, "utf8");
  const lines = content.split(/\r?\n/);
  let summary = createEmptyUsageSummary();
  let sawUsage = false;

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

    const patch = extractUsageSummaryPatch(event);
    if (!patch) {
      continue;
    }

    summary = mergeUsageSummary(summary, patch);
    sawUsage = true;
  }

  return sawUsage ? summary : null;
}

export async function readLastAssistantMessageFromSessionFile(sessionFilePath: string): Promise<string | null> {
  const content = await fs.readFile(sessionFilePath, "utf8");
  const lines = content.split(/\r?\n/);
  let latestMessage: string | null = null;

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
        continue;
      }

      if (payloadType === "task_complete") {
        const text = (asString(payload.last_agent_message) ?? asString(payload.lastAgentMessage))?.trim();
        if (text) {
          latestMessage = text;
        }
        continue;
      }
    }

    if (eventType === "response_item" && payload) {
      const payloadType = asString(payload.type);
      if (payloadType === "message" && asString(payload.role) === "assistant") {
        const text = extractResponseMessageText(payload)?.trim();
        if (text) {
          latestMessage = text;
        }
        continue;
      }
    }

    if (item && asString(item.type) === "agent_message") {
      const text = asString(item.text)?.trim();
      if (text) {
        latestMessage = text;
      }
    }
  }

  return latestMessage;
}
