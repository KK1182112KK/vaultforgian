import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRecentSessionSearchRoots,
  findSessionFileForThread,
  listRecentSessionFiles,
  readLastAssistantMessageFromSessionFile,
  readSessionUsageSnapshot,
  readUsageSummaryFromSessionFile,
} from "../util/usageSessions";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

describe("usage session helpers", () => {
  it("finds the session file for a codex thread id", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-"));
    tempRoots.push(root);
    const sessionDir = join(root, "2026", "04", "05");
    await mkdir(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, "rollout-2026-04-05T01-02-03-thread-123.jsonl");
    await writeFile(sessionFile, "", "utf8");

    await expect(findSessionFileForThread(root, "thread-123")).resolves.toBe(sessionFile);
  });

  it("returns null when the matching thread file is deeper than the traversal bounds", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-"));
    tempRoots.push(root);
    const sessionFile = join(root, "2026", "04", "05", "deep", "rollout-2026-04-05T01-02-03-thread-123.jsonl");
    await mkdir(join(root, "2026", "04", "05", "deep"), { recursive: true });
    await writeFile(sessionFile, "", "utf8");

    await expect(findSessionFileForThread(root, "thread-123", { maxDepth: 2 })).resolves.toBeNull();
  });

  it("reads token usage and codex rate limits from a session jsonl", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-"));
    tempRoots.push(root);
    const sessionFile = join(root, "rollout-usage-thread.jsonl");
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 3200,
                cached_input_tokens: 400,
                output_tokens: 280,
                reasoning_output_tokens: 120,
                total_tokens: 3480,
              },
              last_token_usage: {
                input_tokens: 1200,
                cached_input_tokens: 200,
                output_tokens: 80,
                reasoning_output_tokens: 40,
                total_tokens: 1280,
              },
            },
            rate_limits: {
              primary: { used_percent: 12 },
              secondary: { used_percent: 38 },
              plan_type: "plus",
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    await expect(readUsageSummaryFromSessionFile(sessionFile)).resolves.toEqual({
      lastTurn: {
        inputTokens: 1200,
        cachedInputTokens: 200,
        outputTokens: 80,
        reasoningOutputTokens: 40,
        totalTokens: 1280,
      },
      total: {
        inputTokens: 3200,
        cachedInputTokens: 400,
        outputTokens: 280,
        reasoningOutputTokens: 120,
        totalTokens: 3480,
      },
      limits: {
        fiveHourPercent: 12,
        weekPercent: 38,
        planType: "plus",
      },
    });
  });

  it("reads the final assistant reply from a session jsonl", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-"));
    tempRoots.push(root);
    const sessionFile = join(root, "rollout-message-thread.jsonl");
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "First draft",
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "task_complete",
            last_agent_message: "Final answer",
          },
        }),
      ].join("\n"),
      "utf8",
    );

    await expect(readLastAssistantMessageFromSessionFile(sessionFile)).resolves.toBe("Final answer");
  });

  it("reads the final assistant reply from response_item and item events", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-"));
    tempRoots.push(root);
    const sessionFile = join(root, "rollout-response-item-thread.jsonl");
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ text: "Backfilled answer" }],
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: "Newest backfilled answer",
          },
        }),
      ].join("\n"),
      "utf8",
    );

    await expect(readLastAssistantMessageFromSessionFile(sessionFile)).resolves.toBe("Newest backfilled answer");
  });

  it("lists recent session files by mtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-"));
    tempRoots.push(root);
    const older = join(root, "older.jsonl");
    const newer = join(root, "newer.jsonl");
    await writeFile(older, "", "utf8");
    await writeFile(newer, "", "utf8");
    await utimes(older, new Date("2026-04-10T11:59:59Z"), new Date("2026-04-10T11:59:59Z"));
    await utimes(newer, new Date("2026-04-10T12:00:00Z"), new Date("2026-04-10T12:00:00Z"));

    const files = await listRecentSessionFiles(root, { limit: 2 });
    expect(files).toHaveLength(2);
    expect(files[0]?.name).toBe("newer.jsonl");
  });

  it("skips session files deeper than the traversal bounds when listing recent files", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-"));
    tempRoots.push(root);
    const shallowFile = join(root, "shallow.jsonl");
    const deepFile = join(root, "2026", "04", "05", "deep", "nested.jsonl");
    await mkdir(join(root, "2026", "04", "05", "deep"), { recursive: true });
    await writeFile(shallowFile, "", "utf8");
    await writeFile(deepFile, "", "utf8");

    const files = await listRecentSessionFiles(root, { limit: 10, maxDepth: 1 });
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("shallow.jsonl");
  });

  it("reads a session usage snapshot with file timestamps", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-"));
    tempRoots.push(root);
    const sessionFile = join(root, "rollout-usage-thread.jsonl");
    await writeFile(
      sessionFile,
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          rate_limits: {
            primary: { used_percent: 15 },
            secondary: { used_percent: 25 },
            plan_type: "plus",
          },
        },
      }),
      "utf8",
    );

    const snapshot = await readSessionUsageSnapshot(sessionFile, 1234);
    expect(snapshot?.summary?.limits.fiveHourPercent).toBe(15);
    expect(snapshot?.lastCheckedAt).toBe(1234);
    expect(snapshot?.lastObservedAt).not.toBeNull();
  });

  it("fails softly for oversized jsonl tails instead of reading the whole file", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-"));
    tempRoots.push(root);
    const sessionFile = join(root, "oversized-tail.jsonl");
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 32,
                cached_input_tokens: 4,
                output_tokens: 8,
                reasoning_output_tokens: 2,
                total_tokens: 40,
              },
              last_token_usage: {
                input_tokens: 12,
                cached_input_tokens: 2,
                output_tokens: 3,
                reasoning_output_tokens: 1,
                total_tokens: 15,
              },
            },
            rate_limits: {
              primary: { used_percent: 12 },
              secondary: { used_percent: 38 },
              plan_type: "plus",
            },
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "task_complete",
            last_agent_message: "Should not be recovered",
          },
        }),
        "x".repeat(1024),
      ].join("\n"),
      "utf8",
    );

    await expect(readUsageSummaryFromSessionFile(sessionFile, { maxBytes: 64 })).resolves.toBeNull();
    await expect(readLastAssistantMessageFromSessionFile(sessionFile, { maxBytes: 64 })).resolves.toBeNull();
    await expect(readSessionUsageSnapshot(sessionFile, 1234, { maxBytes: 64 })).resolves.toMatchObject({
      summary: null,
      lastCheckedAt: 1234,
    });
  });

  it("builds recent date search roots under the session root", () => {
    const roots = buildRecentSessionSearchRoots("/tmp/codex-sessions", new Date("2026-04-10T12:00:00Z"), 1);
    expect(roots).toContain("/tmp/codex-sessions");
    expect(roots).toContain("/tmp/codex-sessions/2026/04/10");
    expect(roots).toContain("/tmp/codex-sessions/2026/04/09");
  });
});
