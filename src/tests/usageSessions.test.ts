import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { findSessionFileForThread, readLastAssistantMessageFromSessionFile, readUsageSummaryFromSessionFile } from "../util/usageSessions";

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
});
