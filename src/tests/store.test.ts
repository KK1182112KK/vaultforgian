import { describe, expect, it } from "vitest";
import { AgentStore } from "../model/store";
import type { ComposerAttachment } from "../model/types";
import { createEmptyAccountUsageSummary, createEmptyUsageSummary } from "../util/usage";

describe("AgentStore", () => {
  it("creates a fallback tab when no persisted workspace exists", () => {
    const store = new AgentStore(null, "/vault", false);
    const state = store.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.cwd).toBe("/vault");
    expect(state.tabs[0]?.targetNotePath).toBeNull();
    expect(state.tabs[0]?.selectionContext).toBeNull();
    expect(state.authState).toBe("missing_login");
  });

  it("normalizes an invalid persisted active tab id to the first available tab", () => {
    const store = new AgentStore(
      {
        tabs: [
          {
            id: "tab-a",
            title: "A",
            draft: "",
            cwd: "/vault",
            studyWorkflow: null,
            instructionChips: [],
            summary: null,
            lineage: {
              parentTabId: null,
              forkedFromThreadId: null,
              resumedFromThreadId: null,
              compactedAt: null,
            },
            targetNotePath: null,
            selectionContext: null,
            composeMode: "chat",
            contextPaths: [],
            lastResponseId: null,
            sessionItems: [],
            codexThreadId: null,
            model: "gpt-5.4",
            reasoningEffort: "xhigh",
            usageSummary: createEmptyUsageSummary(),
            messages: [],
            diffText: "",
            toolLog: [],
            patchBasket: [],
            campaigns: [],
          },
        ],
        activeTabId: "missing-tab",
        accountUsage: createEmptyAccountUsageSummary(),
        activeStudyWorkflow: null,
        recentStudySources: [],
        studyHubState: { lastOpenedAt: null, isCollapsed: false },
        smartSets: [],
        activeSmartSetId: null,
        refactorRecipes: [],
        activeRefactorRecipeId: null,
      },
      "/vault",
      true,
    );

    expect(store.getActiveTab()?.id).toBe("tab-a");
    expect(store.getState().activeTabId).toBe("tab-a");
  });

  it("serializes tab metadata without runtime-only fields", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.createTab("/vault/notes", "Notes");
    const sessionItems: ComposerAttachment[] = [
      {
        id: "attachment-1",
        kind: "file",
        displayName: "notes.txt",
        mimeType: "text/plain",
        stagedPath: "/vault/.obsidian/plugins/obsidian-codex-study/.staging/tab/attachment-1-notes.txt",
        vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab/attachment-1-notes.txt",
        promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab/attachment-1-notes.txt",
        originalPath: "/tmp/notes.txt",
        source: "picker",
        createdAt: 123,
      },
    ];
    store.setDraft(tab.id, "draft");
    store.setTargetNotePath(tab.id, "notes/current.md");
    store.setInstructionChips(tab.id, [
      {
        id: "instruction-1",
        label: "brief",
        createdAt: 123,
      },
    ]);
    store.setSummary(tab.id, {
      id: "summary-1",
      text: "Condensed conversation",
      createdAt: 456,
    });
    store.setLineage(tab.id, {
      parentTabId: "tab-origin",
      forkedFromThreadId: "thread-origin",
      resumedFromThreadId: null,
      compactedAt: 789,
    });
    store.setSelectionContext(tab.id, {
      text: "Ohm's law applies here.",
      sourcePath: "notes/current.md",
      createdAt: 123,
    });
    store.setLastResponseId(tab.id, "resp_123");
    store.setContextPaths(tab.id, ["notes/a.md", "daily/2026-04-05.md"]);
    store.setSessionItems(tab.id, sessionItems);
    store.setCodexThreadId(tab.id, "thread_123");
    store.setTabModel(tab.id, "gpt-5.1-codex");
    store.setTabReasoningEffort(tab.id, "high");
    store.setUsageSummary(tab.id, {
      ...createEmptyUsageSummary(),
      lastTurn: {
        inputTokens: 1200,
        cachedInputTokens: 200,
        outputTokens: 180,
        reasoningOutputTokens: 60,
        totalTokens: 1380,
      },
    });
    store.setRuntimeMode(tab.id, "skill");
    store.addToolLog(tab.id, {
      id: "tool-1",
      callId: "call-1",
      kind: "web",
      name: "web_search",
      title: "Web search",
      summary: "Look up docs",
      argsJson: "{}",
      createdAt: 100,
      updatedAt: 101,
      status: "completed",
      resultText: "Found docs",
    });
    const serialized = store.serialize();
    expect(serialized.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tab.id,
          title: "Notes",
          cwd: "/vault/notes",
          draft: "draft",
          instructionChips: [
            {
              id: "instruction-1",
              label: "brief",
              createdAt: 123,
            },
          ],
          summary: {
            id: "summary-1",
            text: "Condensed conversation",
            createdAt: 456,
          },
          lineage: {
            parentTabId: "tab-origin",
            forkedFromThreadId: "thread-origin",
            resumedFromThreadId: null,
            compactedAt: 789,
          },
          targetNotePath: "notes/current.md",
          selectionContext: {
            text: "Ohm's law applies here.",
            sourcePath: "notes/current.md",
            createdAt: 123,
          },
          contextPaths: ["notes/a.md", "daily/2026-04-05.md"],
          lastResponseId: "resp_123",
          sessionItems,
          codexThreadId: "thread_123",
          model: "gpt-5.1-codex",
          reasoningEffort: "high",
          usageSummary: expect.objectContaining({
            lastTurn: expect.objectContaining({
              totalTokens: 1380,
            }),
          }),
          toolLog: [
            expect.objectContaining({
              callId: "call-1",
              kind: "web",
              status: "completed",
            }),
          ],
          patchBasket: [],
          campaigns: [],
        }),
      ]),
    );
    expect(serialized.tabs[1]?.messages).toBeDefined();
    expect(serialized.accountUsage).toEqual(createEmptyAccountUsageSummary());
    expect(serialized.activeStudyWorkflow).toBeNull();
    expect(serialized.recentStudySources).toEqual([]);
    expect(serialized.studyHubState).toEqual({ lastOpenedAt: null, isCollapsed: false });
    expect(serialized.smartSets).toEqual([]);
    expect(serialized.activeSmartSetId).toBeNull();
    expect(serialized.refactorRecipes).toEqual([]);
    expect(serialized.activeRefactorRecipeId).toBeNull();
    expect(store.getState().tabs[1]?.runtimeMode).toBe("skill");
  });

  it("serializes and restores study workflow state", () => {
    const store = new AgentStore(null, "/vault", true);
    const activeTabId = store.getActiveTab()?.id;
    expect(activeTabId).toBeTruthy();
    if (!activeTabId) {
      throw new Error("Missing active tab");
    }

    store.setTabStudyWorkflow(activeTabId, "paper");
    store.addRecentStudySource({
      id: "study-source-1",
      label: "lecture-05.pdf",
      path: "Courses/Signals/lecture-05.pdf",
      kind: "attachment",
      createdAt: 123,
    });
    store.setStudyHubState({ lastOpenedAt: 456, isCollapsed: true });

    const serialized = store.serialize();
    expect(serialized.activeStudyWorkflow).toBe("paper");
    expect(serialized.tabs[0]?.studyWorkflow).toBe("paper");
    expect(serialized.recentStudySources).toEqual([
      {
        id: "study-source-1",
        label: "lecture-05.pdf",
        path: "Courses/Signals/lecture-05.pdf",
        kind: "attachment",
        createdAt: 123,
      },
    ]);
    expect(serialized.studyHubState).toEqual({ lastOpenedAt: 456, isCollapsed: true });

    const restored = new AgentStore(serialized, "/vault", true);
    expect(restored.getActiveTab()?.studyWorkflow).toBe("paper");
    expect(restored.getState().activeStudyWorkflow).toBe("paper");
    expect(restored.getState().recentStudySources).toEqual([
      {
        id: "study-source-1",
        label: "lecture-05.pdf",
        path: "Courses/Signals/lecture-05.pdf",
        kind: "attachment",
        createdAt: 123,
      },
    ]);
    expect(restored.getState().studyHubState).toEqual({ lastOpenedAt: 456, isCollapsed: true });
  });

  it("derives the active workflow from the active tab", () => {
    const store = new AgentStore(null, "/vault", true);
    const paperTab = store.getActiveTab();
    expect(paperTab).toBeTruthy();
    if (!paperTab) {
      throw new Error("Missing active tab");
    }
    store.setTabStudyWorkflow(paperTab.id, "paper");

    const reviewTab = store.createTab("/vault", "Review");
    store.setTabStudyWorkflow(reviewTab.id, "review");
    expect(store.getState().activeStudyWorkflow).toBe("review");

    store.activateTab(paperTab.id);
    expect(store.getState().activeStudyWorkflow).toBe("paper");
  });

  it("deduplicates recent study sources and keeps the latest first", () => {
    const store = new AgentStore(null, "/vault", true);
    store.addRecentStudySource({
      id: "study-source-1",
      label: "Signals.md",
      path: "Courses/Signals/Signals.md",
      kind: "note",
      createdAt: 100,
    });
    store.addRecentStudySource({
      id: "study-source-2",
      label: "Signals.md",
      path: "Courses/Signals/Signals.md",
      kind: "note",
      createdAt: 200,
    });

    expect(store.getState().recentStudySources).toEqual([
      {
        id: "study-source-2",
        label: "Signals.md",
        path: "Courses/Signals/Signals.md",
        kind: "note",
        createdAt: 200,
      },
    ]);
  });

  it("can reset a tab back to a fresh conversation shell", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.createTab("/vault", "Scratch");
    store.setDraft(tab.id, "draft");
    store.setTargetNotePath(tab.id, "notes/current.md");
    store.setInstructionChips(tab.id, [
      {
        id: "instruction-1",
        label: "brief",
        createdAt: 111,
      },
    ]);
    store.setSummary(tab.id, {
      id: "summary-1",
      text: "Compact summary",
      createdAt: 222,
    });
    store.setLineage(tab.id, {
      parentTabId: "tab-parent",
      forkedFromThreadId: "thread-parent",
      resumedFromThreadId: null,
      compactedAt: 333,
    });
    store.setSelectionContext(tab.id, {
      text: "Selected text",
      sourcePath: "notes/current.md",
      createdAt: 321,
    });
    store.setContextPaths(tab.id, ["notes/a.md"]);
    store.addMessage(tab.id, {
      id: "msg-1",
      kind: "user",
      text: "hello",
      createdAt: Date.now(),
    });

    store.resetTab(tab.id, {
      title: "New chat",
      draft: "",
      instructionChips: [],
      summary: null,
      lineage: {
        parentTabId: null,
        forkedFromThreadId: null,
        resumedFromThreadId: null,
        compactedAt: null,
      },
      targetNotePath: "notes/next.md",
      selectionContext: null,
      contextPaths: [],
      messages: [],
      diffText: "",
      toolLog: [],
      patchBasket: [],
      campaigns: [],
    });

    const next = store.getState().tabs.find((entry) => entry.id === tab.id);
    expect(next).toEqual(
      expect.objectContaining({
        id: tab.id,
        title: "New chat",
        draft: "",
        instructionChips: [],
        summary: null,
        lineage: {
          parentTabId: null,
          forkedFromThreadId: null,
          resumedFromThreadId: null,
          compactedAt: null,
        },
        targetNotePath: "notes/next.md",
        selectionContext: null,
        contextPaths: [],
        messages: [],
        diffText: "",
        toolLog: [],
        patchBasket: [],
        campaigns: [],
      }),
    );
  });

  it("can store workspace-level account usage independently from tabs", () => {
    const store = new AgentStore(null, "/vault", true);
    store.createTab("/vault", "Second");
    const accountUsage = {
      limits: {
        fiveHourPercent: 11,
        weekPercent: 6,
        planType: "pro",
      },
      source: "live" as const,
      updatedAt: 123,
      threadId: "thread-123",
    };

    store.setAccountUsage(accountUsage);

    expect(store.getState().accountUsage).toEqual(accountUsage);
    expect(store.getState().tabs.every((tab) => tab.usageSummary.limits.fiveHourPercent === null)).toBe(true);
  });

  it("can persist campaign state alongside tabs", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    expect(tab).not.toBeNull();
    if (!tab) {
      return;
    }

    store.setCampaigns(tab.id, [
      {
        id: "campaign-1",
        sourceMessageId: "assistant-1",
        title: "Refactor Campaign",
        query: "ai",
        targetPaths: ["Notes/AI.md"],
        items: [],
        heatmap: [
          {
            path: "Notes/AI.md",
            score: 3,
            backlinks: 2,
            reasons: ["body patch"],
          },
        ],
        snapshotCapsule: null,
        executionLog: [],
        status: "ready",
        createdAt: 1,
      },
    ]);

    expect(store.serialize().tabs[0]?.campaigns).toEqual([
      expect.objectContaining({
        id: "campaign-1",
        query: "ai",
      }),
    ]);
  });

  it("can persist workspace-level Smart Sets", () => {
    const store = new AgentStore(null, "/vault", true);
    store.upsertSmartSet({
      id: "smart-set-1",
      title: "Control lectures",
      naturalQuery: "control lectures except archived",
      normalizedQuery: "{\n  \"includeText\": [\"control\", \"lectures\"]\n}",
      savedNotePath: "Codex/Smart Sets/control-lectures.md",
      liveResult: {
        items: [],
        count: 0,
        generatedAt: 1,
      },
      lastSnapshot: null,
      lastDrift: null,
      lastRunAt: 1,
      createdAt: 1,
      updatedAt: 2,
    });

    expect(store.serialize().smartSets).toEqual([
      expect.objectContaining({
        id: "smart-set-1",
        title: "Control lectures",
      }),
    ]);
    expect(store.serialize().activeSmartSetId).toBe("smart-set-1");
  });

  it("can persist workspace-level refactor recipes", () => {
    const store = new AgentStore(null, "/vault", true);
    store.upsertRefactorRecipe({
      id: "recipe-1",
      title: "Lecture cleanup",
      description: "Backlink-safe rename and move surgery for a bounded note set.",
      sourceCampaignId: "campaign-1",
      sourceCampaignTitle: "Refactor Campaign",
      sourceQuery: "control lectures",
      preferredScopeKind: "search_query",
      operationKinds: ["rename", "move"],
      examples: [
        {
          kind: "vault_op",
          operationKind: "rename",
          title: "Rename lecture note",
          summary: "Rename for consistency",
          targetPath: "courses/control/L01.md",
          destinationPath: "courses/control/lecture-01.md",
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    });

    expect(store.serialize().refactorRecipes).toEqual([
      expect.objectContaining({
        id: "recipe-1",
        title: "Lecture cleanup",
      }),
    ]);
    expect(store.serialize().activeRefactorRecipeId).toBe("recipe-1");
  });

  it("replaces patch proposals per source message without touching other proposals", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    expect(tab).not.toBeNull();
    if (!tab) {
      return;
    }

    store.replacePatchProposals(tab.id, "message-a", [
      {
        id: "patch-a",
        threadId: "thread-1",
        sourceMessageId: "message-a",
        targetPath: "Notes/A.md",
        kind: "update",
        baseSnapshot: "before",
        proposedText: "after",
        unifiedDiff: "--- A",
        summary: "Update A",
        status: "pending",
        createdAt: 1,
      },
    ]);
    store.replacePatchProposals(tab.id, "message-b", [
      {
        id: "patch-b",
        threadId: "thread-1",
        sourceMessageId: "message-b",
        targetPath: "Notes/B.md",
        kind: "create",
        baseSnapshot: null,
        proposedText: "content",
        unifiedDiff: "--- B",
        summary: "Create B",
        status: "pending",
        createdAt: 2,
      },
    ]);
    store.replacePatchProposals(tab.id, "message-a", []);

    expect(store.getState().tabs[0]?.patchBasket).toEqual([
      expect.objectContaining({
        id: "patch-b",
        sourceMessageId: "message-b",
      }),
    ]);
  });
});
