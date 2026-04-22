import type { AccountUsageSource, ConversationTabState, UsageSummary } from "../model/types";
import { type RecentSessionFile, readSessionUsageSnapshot } from "../util/usageSessions";

const ACTIVE_POLL_MS = 1_500;
const IDLE_POLL_MS = 15_000;

interface UsageSyncSnapshot {
  threadId: string | null;
  summary: UsageSummary;
  source: AccountUsageSource;
  observedAt: number | null;
  checkedAt: number;
}

export interface UsageSyncCoordinatorDeps {
  getTabs: () => ConversationTabState[];
  resolveSessionFile: (threadId: string) => Promise<string | null>;
  listRecentSessionFiles: () => Promise<RecentSessionFile[]>;
  applyUsageSnapshot: (snapshot: UsageSyncSnapshot) => void;
}

export class UsageSyncCoordinator {
  private readonly knownThreadIds = new Set<string>();
  private readonly activeRunThreads = new Map<string, string | null>();
  private activeTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private activePollInFlight = false;
  private idlePollInFlight = false;

  constructor(private readonly deps: UsageSyncCoordinatorDeps) {}

  start(): void {
    if (!this.idleTimer) {
      this.idleTimer = setInterval(() => {
        void this.pollIdle();
      }, IDLE_POLL_MS);
    }
    void this.pollIdle();
  }

  stop(): void {
    if (this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.activeRunThreads.clear();
    this.knownThreadIds.clear();
  }

  noteLiveUsage(threadId: string | null): void {
    if (threadId?.trim()) {
      this.knownThreadIds.add(threadId.trim());
    }
  }

  noteThread(threadId: string | null): void {
    if (threadId?.trim()) {
      this.knownThreadIds.add(threadId.trim());
    }
  }

  armActiveRun(tabId: string, threadId: string | null): void {
    this.activeRunThreads.set(tabId, threadId?.trim() ? threadId.trim() : null);
    if (threadId?.trim()) {
      this.knownThreadIds.add(threadId.trim());
    }
    this.ensureActiveTimer();
    void this.pollActive();
  }

  updateActiveRunThread(tabId: string, threadId: string | null): void {
    if (!this.activeRunThreads.has(tabId)) {
      return;
    }
    this.activeRunThreads.set(tabId, threadId?.trim() ? threadId.trim() : null);
    if (threadId?.trim()) {
      this.knownThreadIds.add(threadId.trim());
    }
    void this.pollActive();
  }

  disarmActiveRun(tabId: string): void {
    this.activeRunThreads.delete(tabId);
    if (this.activeRunThreads.size === 0 && this.activeTimer) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
  }

  untrackTab(tabId: string, threadId: string | null): void {
    this.disarmActiveRun(tabId);
    const normalizedThreadId = threadId?.trim() ?? "";
    if (normalizedThreadId) {
      this.knownThreadIds.delete(normalizedThreadId);
    }
  }

  refreshUsageForTab(tabId: string): void {
    const tab = this.deps.getTabs().find((entry) => entry.id === tabId) ?? null;
    if (tab?.codexThreadId) {
      this.knownThreadIds.add(tab.codexThreadId);
      void this.pollThread(tab.codexThreadId, "idle_poll");
      return;
    }
    void this.pollRecentSessions();
  }

  async syncKnownThreadsNow(source: AccountUsageSource = "idle_poll"): Promise<void> {
    const threadIds = this.collectKnownThreadIds();
    for (const threadId of threadIds) {
      await this.pollThread(threadId, source);
    }
  }

  private ensureActiveTimer(): void {
    if (this.activeTimer) {
      return;
    }
    this.activeTimer = setInterval(() => {
      void this.pollActive();
    }, ACTIVE_POLL_MS);
  }

  private async pollActive(): Promise<void> {
    if (this.activePollInFlight) {
      return;
    }
    this.activePollInFlight = true;
    try {
      const threadIds = new Set(
        [...this.activeRunThreads.values()].filter((threadId): threadId is string => Boolean(threadId?.trim())),
      );
      for (const threadId of threadIds) {
        await this.pollThread(threadId, "active_poll");
      }
    } finally {
      this.activePollInFlight = false;
    }
  }

  private async pollIdle(): Promise<void> {
    if (this.idlePollInFlight) {
      return;
    }
    this.idlePollInFlight = true;
    try {
      await this.syncKnownThreadsNow("idle_poll");
      await this.pollRecentSessions();
    } finally {
      this.idlePollInFlight = false;
    }
  }

  private collectKnownThreadIds(): string[] {
    const threadIds = new Set<string>();
    for (const tab of this.deps.getTabs()) {
      if (tab.codexThreadId?.trim()) {
        threadIds.add(tab.codexThreadId.trim());
      }
    }
    for (const threadId of this.knownThreadIds) {
      threadIds.add(threadId);
    }
    return [...threadIds];
  }

  private async pollThread(threadId: string, source: AccountUsageSource): Promise<void> {
    try {
      const sessionFile = await this.deps.resolveSessionFile(threadId);
      if (!sessionFile) {
        return;
      }
      const snapshot = await readSessionUsageSnapshot(sessionFile);
      if (!snapshot?.summary) {
        return;
      }
      this.deps.applyUsageSnapshot({
        threadId,
        summary: snapshot.summary,
        source,
        observedAt: snapshot.lastObservedAt,
        checkedAt: snapshot.lastCheckedAt,
      });
    } catch {
      // Keep best-known usage when polling fails.
    }
  }

  private async pollRecentSessions(): Promise<void> {
    try {
      const files = await this.deps.listRecentSessionFiles();
      for (const file of files) {
        const snapshot = await readSessionUsageSnapshot(file.path);
        if (!snapshot?.summary) {
          continue;
        }
        this.deps.applyUsageSnapshot({
          threadId: null,
          summary: snapshot.summary,
          source: "idle_poll",
          observedAt: snapshot.lastObservedAt,
          checkedAt: snapshot.lastCheckedAt,
        });
        return;
      }
    } catch {
      // Keep best-known usage when recent session scan fails.
    }
  }
}
