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
  private generation = 0;
  private stopped = false;

  constructor(private readonly deps: UsageSyncCoordinatorDeps) {}

  start(): void {
    this.stopped = false;
    if (!this.idleTimer) {
      this.idleTimer = setInterval(() => {
        void this.pollIdle();
      }, IDLE_POLL_MS);
    }
    void this.pollIdle();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
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
    if (this.stopped) {
      return;
    }
    if (threadId?.trim()) {
      this.knownThreadIds.add(threadId.trim());
    }
  }

  noteThread(threadId: string | null): void {
    if (this.stopped) {
      return;
    }
    if (threadId?.trim()) {
      this.knownThreadIds.add(threadId.trim());
    }
  }

  armActiveRun(tabId: string, threadId: string | null): void {
    if (this.stopped) {
      return;
    }
    this.activeRunThreads.set(tabId, threadId?.trim() ? threadId.trim() : null);
    if (threadId?.trim()) {
      this.knownThreadIds.add(threadId.trim());
    }
    this.ensureActiveTimer();
    void this.pollActive();
  }

  updateActiveRunThread(tabId: string, threadId: string | null): void {
    if (this.stopped) {
      return;
    }
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
    if (this.stopped) {
      return;
    }
    const generation = this.generation;
    const tab = this.deps.getTabs().find((entry) => entry.id === tabId) ?? null;
    if (tab?.codexThreadId) {
      this.knownThreadIds.add(tab.codexThreadId);
      void this.pollThread(tab.codexThreadId, "idle_poll", generation);
      return;
    }
    void this.pollRecentSessions(generation);
  }

  async syncKnownThreadsNow(source: AccountUsageSource = "idle_poll", generation = this.generation): Promise<void> {
    if (this.stopped) {
      return;
    }
    const threadIds = this.collectKnownThreadIds();
    for (const threadId of threadIds) {
      if (!this.isGenerationCurrent(generation)) {
        return;
      }
      await this.pollThread(threadId, source, generation);
    }
  }

  private ensureActiveTimer(): void {
    if (this.stopped) {
      return;
    }
    if (this.activeTimer) {
      return;
    }
    this.activeTimer = setInterval(() => {
      void this.pollActive();
    }, ACTIVE_POLL_MS);
  }

  private async pollActive(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.activePollInFlight) {
      return;
    }
    this.activePollInFlight = true;
    const generation = this.generation;
    try {
      const threadIds = new Set(
        [...this.activeRunThreads.values()].filter((threadId): threadId is string => Boolean(threadId?.trim())),
      );
      for (const threadId of threadIds) {
        if (!this.isGenerationCurrent(generation)) {
          return;
        }
        await this.pollThread(threadId, "active_poll", generation);
      }
    } finally {
      this.activePollInFlight = false;
    }
  }

  private async pollIdle(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.idlePollInFlight) {
      return;
    }
    this.idlePollInFlight = true;
    const generation = this.generation;
    try {
      await this.syncKnownThreadsNow("idle_poll", generation);
      if (!this.isGenerationCurrent(generation)) {
        return;
      }
      await this.pollRecentSessions(generation);
    } finally {
      this.idlePollInFlight = false;
    }
  }

  private isGenerationCurrent(generation: number): boolean {
    return !this.stopped && generation === this.generation;
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

  private async pollThread(threadId: string, source: AccountUsageSource, generation = this.generation): Promise<void> {
    try {
      if (!this.isGenerationCurrent(generation)) {
        return;
      }
      const sessionFile = await this.deps.resolveSessionFile(threadId);
      if (!this.isGenerationCurrent(generation)) {
        return;
      }
      if (!sessionFile) {
        return;
      }
      const snapshot = await readSessionUsageSnapshot(sessionFile);
      if (!this.isGenerationCurrent(generation)) {
        return;
      }
      if (!snapshot?.summary) {
        return;
      }
      if (!this.isGenerationCurrent(generation)) {
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

  private async pollRecentSessions(generation = this.generation): Promise<void> {
    try {
      if (!this.isGenerationCurrent(generation)) {
        return;
      }
      const files = await this.deps.listRecentSessionFiles();
      if (!this.isGenerationCurrent(generation)) {
        return;
      }
      for (const file of files) {
        const snapshot = await readSessionUsageSnapshot(file.path);
        if (!this.isGenerationCurrent(generation)) {
          return;
        }
        if (!snapshot?.summary) {
          continue;
        }
        if (!this.isGenerationCurrent(generation)) {
          return;
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
