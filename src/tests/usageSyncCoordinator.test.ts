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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function waitForCondition(check: () => boolean, timeoutMs = 250): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
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
    await waitForCondition(() => applied.length === 1);
    expect(applied).toEqual([
      expect.objectContaining({
        threadId: null,
        source: "idle_poll",
      }),
    ]);
  });

  it("forgets remembered threads when the coordinator stops", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-sync-stop-"));
    tempRoots.push(root);
    const sessionFile = join(root, "thread-123.jsonl");
    await writeUsageSession(sessionFile, { fiveHourPercent: 12, weekPercent: 34 });

    const applied: Array<{ threadId: string | null; source: string }> = [];
    const coordinator = new UsageSyncCoordinator({
      getTabs: () => [],
      resolveSessionFile: async (threadId) => (threadId === "thread-123" ? sessionFile : null),
      listRecentSessionFiles: async () => [],
      applyUsageSnapshot: (snapshot) => {
        applied.push({ threadId: snapshot.threadId, source: snapshot.source });
      },
    });

    coordinator.noteThread("thread-123");
    coordinator.stop();
    await coordinator.syncKnownThreadsNow("idle_poll");

    expect(applied).toEqual([]);
  });

  it("untracks a closed tab thread so it no longer participates in polling", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-sync-untrack-"));
    tempRoots.push(root);
    const sessionFile = join(root, "thread-123.jsonl");
    await writeUsageSession(sessionFile, { fiveHourPercent: 12, weekPercent: 34 });

    const applied: Array<{ threadId: string | null; source: string }> = [];
    const coordinator = new UsageSyncCoordinator({
      getTabs: () => [],
      resolveSessionFile: async (threadId) => (threadId === "thread-123" ? sessionFile : null),
      listRecentSessionFiles: async () => [],
      applyUsageSnapshot: (snapshot) => {
        applied.push({ threadId: snapshot.threadId, source: snapshot.source });
      },
    });

    coordinator.noteThread("thread-123");
    coordinator.untrackTab("tab-1", "thread-123");
    await coordinator.syncKnownThreadsNow("idle_poll");

    expect(applied).toEqual([]);
  });

  it("does not apply thread usage after stop interrupts an in-flight poll", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-sync-stop-race-"));
    tempRoots.push(root);
    const sessionFile = join(root, "thread-123.jsonl");
    await writeUsageSession(sessionFile, { fiveHourPercent: 12, weekPercent: 34 });
    const resolveStarted = deferred<void>();
    const resolveRelease = deferred<string | null>();

    const applied: Array<{ threadId: string | null; source: string }> = [];
    const coordinator = new UsageSyncCoordinator({
      getTabs: () => [],
      resolveSessionFile: async (threadId) => {
        if (threadId === "thread-123") {
          resolveStarted.resolve();
          return await resolveRelease.promise;
        }
        return null;
      },
      listRecentSessionFiles: async () => [],
      applyUsageSnapshot: (snapshot) => {
        applied.push({ threadId: snapshot.threadId, source: snapshot.source });
      },
    });

    coordinator.noteThread("thread-123");
    const syncPromise = coordinator.syncKnownThreadsNow("idle_poll");
    await resolveStarted.promise;
    coordinator.stop();
    resolveRelease.resolve(sessionFile);
    await syncPromise;

    expect(applied).toEqual([]);
  });

  it("does not apply recent session usage after stop interrupts an in-flight scan", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-sync-recent-stop-race-"));
    tempRoots.push(root);
    const sessionFile = join(root, "external-run.jsonl");
    await writeUsageSession(sessionFile, { fiveHourPercent: 22, weekPercent: 44 });
    const listStarted = deferred<void>();
    const listRelease = deferred<Array<{ path: string; name: string; modifiedAt: number }>>();

    const applied: Array<{ threadId: string | null; source: string }> = [];
    const coordinator = new UsageSyncCoordinator({
      getTabs: () => [createTab()],
      resolveSessionFile: async () => null,
      listRecentSessionFiles: async () => {
        listStarted.resolve();
        return await listRelease.promise;
      },
      applyUsageSnapshot: (snapshot) => {
        applied.push({ threadId: snapshot.threadId, source: snapshot.source });
      },
    });

    coordinator.refreshUsageForTab("tab-1");
    await listStarted.promise;
    coordinator.stop();
    listRelease.resolve([{ path: sessionFile, name: "external-run.jsonl", modifiedAt: Date.now() }]);
    await tick();
    await tick();

    expect(applied).toEqual([]);
  });

  it("does not start a thread poll from refreshUsageForTab after stop", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-sync-stopped-refresh-thread-"));
    tempRoots.push(root);
    const sessionFile = join(root, "thread-123.jsonl");
    await writeUsageSession(sessionFile, { fiveHourPercent: 12, weekPercent: 34 });

    const resolveSessionFile = vi.fn(async () => sessionFile);
    const applied: Array<{ threadId: string | null; source: string }> = [];
    const coordinator = new UsageSyncCoordinator({
      getTabs: () => [createTab({ codexThreadId: "thread-123" })],
      resolveSessionFile,
      listRecentSessionFiles: async () => [],
      applyUsageSnapshot: (snapshot) => {
        applied.push({ threadId: snapshot.threadId, source: snapshot.source });
      },
    });

    coordinator.stop();
    coordinator.refreshUsageForTab("tab-1");
    await tick();

    expect(resolveSessionFile).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
  });

  it("does not start a recent session scan from refreshUsageForTab after stop", async () => {
    const listRecentSessionFiles = vi.fn(async () => []);
    const coordinator = new UsageSyncCoordinator({
      getTabs: () => [createTab()],
      resolveSessionFile: async () => null,
      listRecentSessionFiles,
      applyUsageSnapshot: () => {
        throw new Error("usage snapshot should not be applied after stop");
      },
    });

    coordinator.stop();
    coordinator.refreshUsageForTab("tab-1");
    await tick();

    expect(listRecentSessionFiles).not.toHaveBeenCalled();
  });

  it("does not start a tab-derived known thread sync after stop", async () => {
    const root = await mkdtemp(join(tmpdir(), "obsidian-codex-usage-sync-stopped-known-thread-"));
    tempRoots.push(root);
    const sessionFile = join(root, "thread-123.jsonl");
    await writeUsageSession(sessionFile, { fiveHourPercent: 12, weekPercent: 34 });

    const resolveSessionFile = vi.fn(async () => sessionFile);
    const applied: Array<{ threadId: string | null; source: string }> = [];
    const coordinator = new UsageSyncCoordinator({
      getTabs: () => [createTab({ codexThreadId: "thread-123" })],
      resolveSessionFile,
      listRecentSessionFiles: async () => [],
      applyUsageSnapshot: (snapshot) => {
        applied.push({ threadId: snapshot.threadId, source: snapshot.source });
      },
    });

    coordinator.stop();
    await coordinator.syncKnownThreadsNow("idle_poll");

    expect(resolveSessionFile).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
  });
});
