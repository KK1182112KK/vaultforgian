import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageSyncCoordinator } from "../app/usageSyncCoordinator";
import type { ConversationTabState, UsageSummary } from "../model/types";
import { createEmptyUsageSummary } from "../util/usage";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createTab(overrides: Partial<ConversationTabState> = {}): ConversationTabState {
  return {
    id: "tab-1",
    title: "Chat",
    draft: "",
    composerHistory: { entries: [], index: null, draft: null },
    cwd: "/vault",
    studyWorkflow: null,
    activeStudyRecipeId: null,
    activeStudySkillNames: [],
    learningMode: false,
    summary: null,
    lineage: {
      parentTabId: null,
      forkedFromThreadId: null,
      resumedFromThreadId: null,
      compactedAt: null,
    },
    targetNotePath: null,
    selectionContext: null,
    panelSessionOrigin: null,
    chatSuggestion: null,
    composeMode: "chat",
    contextPaths: [],
    lastResponseId: null,
    sessionItems: [],
    codexThreadId: null,
    model: "gpt-5.4",
    reasoningEffort: "high",
    usageSummary: createEmptyUsageSummary(),
    messages: [],
    diffText: "",
    toolLog: [],
    patchBasket: [],
        status: "ready",
    runtimeMode: "normal",
    lastError: null,
    pendingApprovals: [],
    sessionApprovals: { write: false, shell: false },
    waitingState: null,
    ...overrides,
  };
}

function writeUsageSession(filePath: string, summary: { fiveHourPercent: number; weekPercent: number }) {
  return writeFile(
    filePath,
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          primary: { used_percent: summary.fiveHourPercent },
          secondary: { used_percent: summary.weekPercent },
          plan_type: "plus",
        },
      },
    }),
    "utf8",
  );
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForSnapshots(check: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (check()) {
      return;
    }
    await tick();
  }
  throw new Error("Timed out waiting for usage snapshots.");
}

describe("UsageSyncCoordinator", () => {
  it("syncs known thread usage through session polling", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-sync-"));
    tempRoots.push(root);
    const sessionFile = join(root, "rollout-thread-123.jsonl");
    await writeUsageSession(sessionFile, { fiveHourPercent: 12, weekPercent: 34 });

    const applied: Array<{ threadId: string | null; summary: UsageSummary; source: string }> = [];
    const coordinator = new UsageSyncCoordinator({
      getTabs: () => [createTab({ codexThreadId: "thread-123" })],
      resolveSessionFile: async (threadId) => (threadId === "thread-123" ? sessionFile : null),
      listRecentSessionFiles: async () => [],
      applyUsageSnapshot: (snapshot) => {
        applied.push({ threadId: snapshot.threadId, summary: snapshot.summary, source: snapshot.source });
      },
    });

    await coordinator.syncKnownThreadsNow("active_poll");
    expect(applied).toEqual([
      expect.objectContaining({
        threadId: "thread-123",
        source: "active_poll",
        summary: expect.objectContaining({
          limits: expect.objectContaining({
            fiveHourPercent: 12,
            weekPercent: 34,
          }),
        }),
      }),
    ]);
  });

  it("falls back to recent session scanning when a tab has no thread id", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-sync-"));
    tempRoots.push(root);
    const sessionFile = join(root, "external-run.jsonl");
    await writeUsageSession(sessionFile, { fiveHourPercent: 22, weekPercent: 44 });

    const applied: Array<{ threadId: string | null; source: string }> = [];
    const coordinator = new UsageSyncCoordinator({
      getTabs: () => [createTab()],
      resolveSessionFile: async () => null,
      listRecentSessionFiles: async () => [
        {
          path: sessionFile,
          name: "external-run.jsonl",
          modifiedAt: Date.now(),
        },
      ],
      applyUsageSnapshot: (snapshot) => {
        applied.push({ threadId: snapshot.threadId, source: snapshot.source });
      },
    });

    coordinator.refreshUsageForTab("tab-1");
    await waitForSnapshots(() => applied.length === 1);
    expect(applied).toEqual([
      expect.objectContaining({
        threadId: null,
        source: "idle_poll",
      }),
    ]);
  });
});
