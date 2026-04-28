import { describe, expect, it } from "vitest";
import { AgentStore } from "../model/store";
import type { ComposerAttachment, PatchProposal, PendingApproval, PersistedTabState } from "../model/types";
import { createEmptyAccountUsageSummary, createEmptyUsageSummary } from "../util/usage";

function createPersistedTab(overrides: Partial<PersistedTabState> = {}): PersistedTabState {
  return {
    id: overrides.id ?? "tab-a",
    title: overrides.title ?? "A",
    draft: overrides.draft ?? "",
    cwd: overrides.cwd ?? "/vault",
    studyWorkflow: overrides.studyWorkflow ?? null,
    activeStudyRecipeId: overrides.activeStudyRecipeId ?? null,
    activeStudySkillNames: overrides.activeStudySkillNames ?? [],
    summary: overrides.summary ?? null,
    studyCoachState: overrides.studyCoachState ?? null,
    lineage: {
      parentTabId: null,
      forkedFromThreadId: null,
      resumedFromThreadId: null,
      compactedAt: null,
      pendingThreadReset: false,
      compactedFromThreadId: null,
      ...(overrides.lineage ?? {}),
    },
    targetNotePath: overrides.targetNotePath ?? null,
    selectionContext: overrides.selectionContext ?? null,
    panelSessionOrigin: overrides.panelSessionOrigin ?? null,
    chatSuggestion: overrides.chatSuggestion ?? null,
    composeMode: overrides.composeMode ?? "chat",
    learningMode: overrides.learningMode ?? false,
    contextPaths: overrides.contextPaths ?? [],
    lastResponseId: overrides.lastResponseId ?? null,
    sessionItems: overrides.sessionItems ?? [],
    codexThreadId: overrides.codexThreadId ?? null,
    model: overrides.model ?? "gpt-5.4",
    reasoningEffort: overrides.reasoningEffort ?? "xhigh",
    fastMode: overrides.fastMode,
    usageSummary: overrides.usageSummary ?? createEmptyUsageSummary(),
    messages: overrides.messages ?? [],
    diffText: overrides.diffText ?? "",
    toolLog: overrides.toolLog ?? [],
    patchBasket: overrides.patchBasket ?? [],
    restartDropNotice: overrides.restartDropNotice,
  };
}

describe("AgentStore", () => {
  it("creates a fallback tab when no persisted workspace exists", () => {
    const store = new AgentStore(null, "/vault", false, { fastMode: true, learningMode: true });
    const state = store.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.cwd).toBe("/vault");
    expect(state.tabs[0]?.targetNotePath).toBeNull();
    expect(state.tabs[0]?.selectionContext).toBeNull();
    expect(state.tabs[0]?.fastMode).toBe(true);
    expect(state.tabs[0]?.learningMode).toBe(true);
    expect(state.authState).toBe("missing_login");
  });

  it("fills in missing restored mode flags from sticky defaults", () => {
    const persistedTab = {
      ...createPersistedTab({ learningMode: false, fastMode: false }),
    } as PersistedTabState & Record<string, unknown>;
    Reflect.deleteProperty(persistedTab, "fastMode");
    Reflect.deleteProperty(persistedTab, "learningMode");

    const store = new AgentStore(
      {
        tabs: [persistedTab],
        activeTabId: persistedTab.id,
        accountUsage: createEmptyAccountUsageSummary(),
        activeStudyWorkflow: null,
        recentStudySources: [],
        studyHubState: { lastOpenedAt: null, isCollapsed: false },
        studyRecipes: [],
        activeStudyRecipeId: null,
      },
      "/vault",
      true,
      { fastMode: true, learningMode: true },
    );

    const restoredTab = store.getState().tabs[0];
    expect(restoredTab?.fastMode).toBe(true);
    expect(restoredTab?.learningMode).toBe(true);
  });

  it("normalizes mixed restored tab mode flags to the provided global defaults", () => {
    const store = new AgentStore(
      {
        tabs: [
          createPersistedTab({ id: "tab-a", title: "A", learningMode: false, fastMode: false }),
          createPersistedTab({ id: "tab-b", title: "B", learningMode: true, fastMode: true }),
        ],
        activeTabId: "tab-b",
        accountUsage: createEmptyAccountUsageSummary(),
        activeStudyWorkflow: null,
        recentStudySources: [],
        studyHubState: { lastOpenedAt: null, isCollapsed: false },
        studyRecipes: [],
        activeStudyRecipeId: null,
      },
      "/vault",
      true,
      { fastMode: false, learningMode: true },
    );

    expect(store.getState().tabs.every((tab) => tab.fastMode === false)).toBe(true);
    expect(store.getState().tabs.every((tab) => tab.learningMode === true)).toBe(true);
  });

  it("restores and serializes hidden user adaptation memory", () => {
    const persisted = {
      tabs: [createPersistedTab()],
      activeTabId: "tab-a",
      accountUsage: createEmptyAccountUsageSummary(),
      activeStudyWorkflow: null,
      recentStudySources: [],
      studyHubState: { lastOpenedAt: null, isCollapsed: false },
      studyRecipes: [],
      activeStudyRecipeId: null,
      userAdaptationMemory: {
        globalProfile: {
          explanationDepth: "step_by_step",
          preferredFocusTags: ["examples", "pitfalls"],
          preferredNoteStyleHints: ["bullet_lists"],
          avoidResponsePatterns: ["too much filler"],
          updatedAt: 123,
        },
        panelOverlays: {
          "panel-1": {
            panelId: "panel-1",
            preferredFocusTags: ["claims_vs_interpretation"],
            preferredNoteStyleHints: ["separate_claims"],
            preferredSkillNames: ["deep-read"],
            lastAppliedTargetPath: "Notes/Paper.md",
            updatedAt: 456,
            studyMemory: {
              weakConcepts: [
                {
                  conceptLabel: "claims vs interpretation",
                  evidence: "Still blends author claims with reader interpretation.",
                  lastStuckPoint: "Needs a source-grounded distinction.",
                  nextQuestion: "Which sentence is the claim and which is interpretation?",
                  workflow: "paper",
                  updatedAt: 800,
                },
              ],
              understoodConcepts: [],
              nextProblems: [
                {
                  prompt: "Mark one paragraph as claim, method, or interpretation.",
                  workflow: "paper",
                  source: "Notes/Paper.md",
                  createdAt: 801,
                },
              ],
              recentStuckPoints: [],
              sourcePreferences: [
                {
                  label: "paper PDF",
                  count: 3,
                  workflow: "paper",
                  updatedAt: 802,
                },
              ],
              lastContract: {
                objective: "Separate paper claims from interpretation.",
                sources: ["paper PDF"],
                concepts: [{ label: "claims vs interpretation", status: "weak", evidence: "Needs source grounding." }],
                likelyStuckPoints: ["Claim wording is being paraphrased as fact."],
                checkQuestion: "What is the strongest source-backed claim?",
                nextAction: "Classify one paragraph.",
                nextProblems: ["Classify one paragraph as claim, method, or interpretation."],
                confidenceNote: "Good summary, weak attribution.",
                workflow: "paper",
              },
              improvementSignals: [
                {
                  kind: "source",
                  key: "paper pdf",
                  label: "paper PDF",
                  count: 3,
                  updatedAt: 803,
                },
              ],
            },
          },
        },
        studyMemory: {
          weakConcepts: [
            {
              conceptLabel: "RMS voltage",
              evidence: "Still mixes peak and RMS voltage.",
              lastStuckPoint: "Forgets peak-to-RMS conversion.",
              nextQuestion: "What if the voltage is already RMS?",
              workflow: "homework",
              updatedAt: 789,
            },
          ],
          understoodConcepts: [
            {
              conceptLabel: "Average power formula",
              evidence: "Can state P = Vrms^2 / R.",
              workflow: "homework",
              updatedAt: 790,
            },
          ],
          nextProblems: [
            {
              prompt: "Compute average load power for Vpeak = 10 V and R = 50 ohms.",
              workflow: "homework",
              source: "EENG3520 HW5",
              createdAt: 791,
            },
          ],
          recentStuckPoints: [
            {
              conceptLabel: "Peak-to-RMS conversion",
              detail: "Dividing by sqrt(2) is not automatic yet.",
              workflow: "homework",
              createdAt: 792,
            },
          ],
        },
      },
    } as ConstructorParameters<typeof AgentStore>[0] & { userAdaptationMemory?: unknown };

    const store = new AgentStore(persisted, "/vault", true);
    const state = store.getState() as typeof store.getState extends () => infer T ? T & { userAdaptationMemory?: any } : never;
    expect(state.userAdaptationMemory?.globalProfile?.preferredFocusTags).toEqual(["examples", "pitfalls"]);
    expect(state.userAdaptationMemory?.panelOverlays?.["panel-1"]?.preferredSkillNames).toEqual(["deep-read"]);
    expect(state.userAdaptationMemory?.panelOverlays?.["panel-1"]?.studyMemory?.weakConcepts?.[0]?.conceptLabel).toBe(
      "claims vs interpretation",
    );
    expect(state.userAdaptationMemory?.panelOverlays?.["panel-1"]?.studyMemory?.sourcePreferences?.[0]?.count).toBe(3);
    expect(state.userAdaptationMemory?.studyMemory?.weakConcepts?.[0]?.conceptLabel).toBe("RMS voltage");
    expect(state.userAdaptationMemory?.studyMemory?.understoodConcepts?.[0]?.conceptLabel).toBe("Average power formula");

    const serialized = store.serialize() as ReturnType<AgentStore["serialize"]> & { userAdaptationMemory?: any };
    expect(serialized.userAdaptationMemory?.globalProfile?.explanationDepth).toBe("step_by_step");
    expect(serialized.userAdaptationMemory?.panelOverlays?.["panel-1"]?.lastAppliedTargetPath).toBe("Notes/Paper.md");
    expect(serialized.userAdaptationMemory?.panelOverlays?.["panel-1"]?.studyMemory?.lastContract?.objective).toContain(
      "Separate paper claims",
    );
    expect(serialized.userAdaptationMemory?.studyMemory?.nextProblems?.[0]?.prompt).toContain("average load power");
    expect(serialized.userAdaptationMemory?.studyMemory?.recentStuckPoints?.[0]?.detail).toContain("sqrt(2)");
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
            reasoningEffort: "xhigh",
            usageSummary: createEmptyUsageSummary(),
            messages: [],
            diffText: "",
            toolLog: [],
            patchBasket: [],
                      },
        ],
        activeTabId: "missing-tab",
        accountUsage: createEmptyAccountUsageSummary(),
        activeStudyWorkflow: null,
        recentStudySources: [],
        studyHubState: { lastOpenedAt: null, isCollapsed: false },
        studyRecipes: [],
        activeStudyRecipeId: null,
                                      },
      "/vault",
      true,
    );

    expect(store.getActiveTab()?.id).toBe("tab-a");
    expect(store.getState().activeTabId).toBe("tab-a");
  });

  it("deduplicates persisted tab ids during restore", () => {
    const store = new AgentStore(
      {
        tabs: [
          {
            id: "tab-a",
            title: "A",
            draft: "",
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
            reasoningEffort: "xhigh",
            usageSummary: createEmptyUsageSummary(),
            messages: [],
            diffText: "",
            toolLog: [],
            patchBasket: [],
                      },
          {
            id: "tab-a",
            title: "B",
            draft: "",
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
            reasoningEffort: "xhigh",
            usageSummary: createEmptyUsageSummary(),
            messages: [],
            diffText: "",
            toolLog: [],
            patchBasket: [],
                      },
        ],
        activeTabId: "tab-a",
        accountUsage: createEmptyAccountUsageSummary(),
        activeStudyWorkflow: null,
        recentStudySources: [],
        studyHubState: { lastOpenedAt: null, isCollapsed: false },
        studyRecipes: [],
        activeStudyRecipeId: null,
                                      },
      "/vault",
      true,
    );

    const ids = store.getState().tabs.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(store.getState().activeTabId).toBe("tab-a");
  });

  it("filters legacy transient runtime messages on restore but preserves current failures on serialize", () => {
    const restored = new AgentStore(
      {
        tabs: [
          {
            id: "tab-a",
            title: "A",
            draft: "",
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
            reasoningEffort: "xhigh",
            usageSummary: createEmptyUsageSummary(),
            messages: [
              {
                id: "old-watchdog",
                kind: "system",
                text: "Codex stopped emitting events for 120 seconds, so this turn was aborted.",
                createdAt: 1,
              },
              {
                id: "old-empty",
                kind: "system",
                text: "Codex finished the turn without leaving a visible assistant reply. The session file was not found.",
                createdAt: 2,
              },
              {
                id: "assistant-1",
                kind: "assistant",
                text: "Real reply",
                createdAt: 3,
              },
            ],
            diffText: "",
            toolLog: [],
            patchBasket: [],
                      },
        ],
        activeTabId: "tab-a",
        accountUsage: createEmptyAccountUsageSummary(),
        activeStudyWorkflow: null,
        recentStudySources: [],
        studyHubState: { lastOpenedAt: null, isCollapsed: false },
        studyRecipes: [],
        activeStudyRecipeId: null,
                                      },
      "/vault",
      true,
    );

    expect(restored.getState().tabs[0]?.messages.map((message) => message.id)).toEqual(["old-empty", "assistant-1"]);

    const tabId = restored.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing active tab");
    }
    restored.addMessage(tabId, {
      id: "new-watchdog",
      kind: "system",
      text: "Codex stopped responding long enough that this turn could not be recovered.",
      createdAt: 4,
    });

    const serialized = restored.serialize();
    expect(serialized.tabs[0]?.messages.map((message) => message.id)).toEqual(["old-empty", "assistant-1", "new-watchdog"]);
  });

  it("keeps lineage parentTabId pointing at an existing tab after duplicate-id restore", () => {
    const store = new AgentStore(
      {
        tabs: [
          {
            id: "tab-a",
            title: "A",
            draft: "",
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
            reasoningEffort: "xhigh",
            usageSummary: createEmptyUsageSummary(),
            messages: [],
            diffText: "",
            toolLog: [],
            patchBasket: [],
                      },
          {
            id: "tab-a",
            title: "Child",
            draft: "",
            cwd: "/vault",
            studyWorkflow: null,
            activeStudyRecipeId: null,
            activeStudySkillNames: [],
            learningMode: false,
            summary: null,
            lineage: {
              parentTabId: "tab-a",
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
            reasoningEffort: "xhigh",
            usageSummary: createEmptyUsageSummary(),
            messages: [],
            diffText: "",
            toolLog: [],
            patchBasket: [],
                      },
        ],
        activeTabId: "tab-a",
        accountUsage: createEmptyAccountUsageSummary(),
        activeStudyWorkflow: null,
        recentStudySources: [],
        studyHubState: { lastOpenedAt: null, isCollapsed: false },
        studyRecipes: [],
        activeStudyRecipeId: null,
                                      },
      "/vault",
      true,
    );

    const state = store.getState();
    const childTab = state.tabs.find((tab) => tab.title === "Child");
    expect(childTab?.lineage.parentTabId).toBe("tab-a");
    expect(state.tabs.some((tab) => tab.id === childTab?.lineage.parentTabId)).toBe(true);
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
    store.setLearningMode(tab.id, true);
    store.setSummary(tab.id, {
      id: "summary-1",
      text: "Condensed conversation",
      createdAt: 456,
    });
    store.setStudyCoachState(tab.id, {
      latestRecap: {
        workflow: "lecture",
        mastered: ["Can explain the intuition behind the Fourier transform."],
        unclear: ["Still mixes up phase and magnitude."],
        nextStep: "Compare two spectra and say what phase changes.",
        confidenceNote: "Good headline understanding, weak on interpretation details.",
      },
      weakPointLedger: [
        {
          conceptLabel: "phase vs magnitude",
          workflow: "lecture",
          updatedAt: 500,
          explanationSummary: "The learner still confuses what each axis feature tells them.",
          nextQuestion: "What changes if the phase shifts but the magnitude stays the same?",
          resolved: false,
        },
      ],
      lastCheckpointAt: 500,
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
    store.setComposerHistory(tab.id, {
      entries: ["first", "second"],
      index: 1,
      draft: "current draft",
    });
    const serialized = store.serialize();
    expect(serialized.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tab.id,
          title: "Notes",
          cwd: "/vault/notes",
          draft: "draft",
          learningMode: true,
          summary: {
            id: "summary-1",
            text: "Condensed conversation",
            createdAt: 456,
          },
          studyCoachState: {
            latestRecap: {
              workflow: "lecture",
              mastered: ["Can explain the intuition behind the Fourier transform."],
              unclear: ["Still mixes up phase and magnitude."],
              nextStep: "Compare two spectra and say what phase changes.",
              confidenceNote: "Good headline understanding, weak on interpretation details.",
            },
            weakPointLedger: [
              {
                conceptLabel: "phase vs magnitude",
                workflow: "lecture",
                updatedAt: 500,
                explanationSummary: "The learner still confuses what each axis feature tells them.",
                nextQuestion: "What changes if the phase shifts but the magnitude stays the same?",
                resolved: false,
              },
            ],
            lastCheckpointAt: 500,
          },
          lineage: {
            parentTabId: "tab-origin",
            forkedFromThreadId: "thread-origin",
            resumedFromThreadId: null,
            compactedAt: 789,
            pendingThreadReset: false,
            compactedFromThreadId: null,
          },
          targetNotePath: "notes/current.md",
          selectionContext: {
            text: "Ohm's law applies here.",
            sourcePath: "notes/current.md",
            createdAt: 123,
          },
          contextPaths: ["notes/a.md", "daily/2026-04-05.md"],
          lastResponseId: "resp_123",
          sessionItems: [],
          codexThreadId: "thread_123",
          model: "gpt-5.1-codex",
          reasoningEffort: "high",
          fastMode: false,
          usageSummary: expect.objectContaining({
            lastTurn: expect.objectContaining({
              totalTokens: 1380,
            }),
          }),
          composerHistory: {
            entries: ["first", "second"],
            index: 1,
            draft: "current draft",
          },
          toolLog: [
            expect.objectContaining({
              callId: "call-1",
              kind: "web",
              status: "completed",
            }),
          ],
          patchBasket: [],
                  }),
      ]),
    );
    expect(serialized.tabs[1]?.messages).toBeDefined();
    expect(serialized.accountUsage).toEqual(createEmptyAccountUsageSummary());
    expect(serialized.activeStudyWorkflow).toBeNull();
    expect(serialized.recentStudySources).toEqual([]);
    expect(serialized.studyHubState).toEqual({ lastOpenedAt: null, isCollapsed: false });
    expect(serialized.studyRecipes).toEqual([]);
    expect(serialized.activeStudyRecipeId).toBeNull();
    expect(store.getState().tabs[1]?.runtimeMode).toBe("skill");
  });

  it("serializes explicit false fastMode values", () => {
    const store = new AgentStore(null, "/vault", true, { fastMode: true, learningMode: false });
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }

    expect(tab.fastMode).toBe(true);
    store.setTabFastMode(tab.id, false);

    const serialized = store.serialize();
    expect(serialized.tabs[0]?.fastMode).toBe(false);
  });

  it("syncs mode changes across all open tabs and future tabs", () => {
    const store = new AgentStore(null, "/vault", true, { fastMode: false, learningMode: false });
    const firstTab = store.getActiveTab();
    if (!firstTab) {
      throw new Error("Missing active tab");
    }
    const secondTab = store.createTab("/vault", "Second");

    store.setAllTabsFastMode(true);
    store.setAllTabsLearningMode(true);

    expect(store.getState().tabs.every((tab) => tab.fastMode === true)).toBe(true);
    expect(store.getState().tabs.every((tab) => tab.learningMode === true)).toBe(true);

    const thirdTab = store.createTab("/vault", "Third");
    const tabs = store.getState().tabs;
    expect(tabs.find((tab) => tab.id === secondTab.id)?.fastMode).toBe(true);
    expect(tabs.find((tab) => tab.id === secondTab.id)?.learningMode).toBe(true);
    expect(tabs.find((tab) => tab.id === thirdTab.id)?.fastMode).toBe(true);
    expect(tabs.find((tab) => tab.id === thirdTab.id)?.learningMode).toBe(true);
  });

  it("serializes and restores tab-level study coach state", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }

    store.setStudyCoachState(tab.id, {
      latestRecap: {
        workflow: "review",
        mastered: ["Can state the high-level review order for the chapter."],
        unclear: ["Cannot justify why the final proof step works."],
        nextStep: "Re-derive the last implication without looking.",
        confidenceNote: "The learner can summarize but not defend the final step.",
      },
      weakPointLedger: [
        {
          conceptLabel: "final proof implication",
          workflow: "review",
          updatedAt: 777,
          explanationSummary: "The last implication is being repeated from memory instead of understood.",
          nextQuestion: "Which assumption unlocks the last implication?",
          resolved: false,
        },
      ],
      lastCheckpointAt: 777,
      latestContract: {
        objective: "Understand the final proof implication.",
        sources: ["Chapter proof note"],
        concepts: [{ label: "final proof implication", status: "weak", evidence: "Can repeat but not justify it." }],
        likelyStuckPoints: ["Which assumption unlocks the implication."],
        checkQuestion: "Which assumption unlocks the last implication?",
        nextAction: "Re-derive the final implication from the assumption.",
        nextProblems: ["Prove the last implication without looking."],
        confidenceNote: "The learner can summarize but not defend the final step.",
        workflow: "review",
      },
      lastStuckPoint: {
        conceptLabel: "final proof implication",
        detail: "The last implication is being repeated from memory instead of understood.",
        workflow: "review",
        createdAt: 777,
      },
      nextProblems: [
        {
          prompt: "Prove the last implication without looking.",
          workflow: "review",
          source: "Chapter proof note",
          createdAt: 777,
        },
      ],
      lastCoachMode: "scaffold",
      lastHintLevel: "guided",
      consecutiveStuckCount: 2,
    });

    const serialized = store.serialize();
    expect(serialized.tabs[0]?.studyCoachState).toEqual({
      latestRecap: {
        workflow: "review",
        mastered: ["Can state the high-level review order for the chapter."],
        unclear: ["Cannot justify why the final proof step works."],
        nextStep: "Re-derive the last implication without looking.",
        confidenceNote: "The learner can summarize but not defend the final step.",
      },
      weakPointLedger: [
        {
          conceptLabel: "final proof implication",
          workflow: "review",
          updatedAt: 777,
          explanationSummary: "The last implication is being repeated from memory instead of understood.",
          nextQuestion: "Which assumption unlocks the last implication?",
          resolved: false,
        },
      ],
      lastCheckpointAt: 777,
      latestContract: {
        objective: "Understand the final proof implication.",
        sources: ["Chapter proof note"],
        concepts: [{ label: "final proof implication", status: "weak", evidence: "Can repeat but not justify it." }],
        likelyStuckPoints: ["Which assumption unlocks the implication."],
        checkQuestion: "Which assumption unlocks the last implication?",
        nextAction: "Re-derive the final implication from the assumption.",
        nextProblems: ["Prove the last implication without looking."],
        confidenceNote: "The learner can summarize but not defend the final step.",
        workflow: "review",
      },
      lastStuckPoint: {
        conceptLabel: "final proof implication",
        detail: "The last implication is being repeated from memory instead of understood.",
        workflow: "review",
        createdAt: 777,
      },
      nextProblems: [
        {
          prompt: "Prove the last implication without looking.",
          workflow: "review",
          source: "Chapter proof note",
          createdAt: 777,
        },
      ],
      lastCoachMode: "scaffold",
      lastHintLevel: "guided",
      consecutiveStuckCount: 2,
    });

    const restored = new AgentStore(serialized, "/vault", true);
    expect(restored.getState().tabs[0]?.studyCoachState).toEqual({
      latestRecap: {
        workflow: "review",
        mastered: ["Can state the high-level review order for the chapter."],
        unclear: ["Cannot justify why the final proof step works."],
        nextStep: "Re-derive the last implication without looking.",
        confidenceNote: "The learner can summarize but not defend the final step.",
      },
      weakPointLedger: [
        {
          conceptLabel: "final proof implication",
          workflow: "review",
          updatedAt: 777,
          explanationSummary: "The last implication is being repeated from memory instead of understood.",
          nextQuestion: "Which assumption unlocks the last implication?",
          resolved: false,
        },
      ],
      lastCheckpointAt: 777,
      latestContract: {
        objective: "Understand the final proof implication.",
        sources: ["Chapter proof note"],
        concepts: [{ label: "final proof implication", status: "weak", evidence: "Can repeat but not justify it." }],
        likelyStuckPoints: ["Which assumption unlocks the implication."],
        checkQuestion: "Which assumption unlocks the last implication?",
        nextAction: "Re-derive the final implication from the assumption.",
        nextProblems: ["Prove the last implication without looking."],
        confidenceNote: "The learner can summarize but not defend the final step.",
        workflow: "review",
      },
      lastStuckPoint: {
        conceptLabel: "final proof implication",
        detail: "The last implication is being repeated from memory instead of understood.",
        workflow: "review",
        createdAt: 777,
      },
      nextProblems: [
        {
          prompt: "Prove the last implication without looking.",
          workflow: "review",
          source: "Chapter proof note",
          createdAt: 777,
        },
      ],
      lastCoachMode: "scaffold",
      lastHintLevel: "guided",
      consecutiveStuckCount: 2,
    });
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

  it("can persist workspace-level study recipes", () => {
    const store = new AgentStore(null, "/vault", true);
    store.upsertStudyRecipe({
      id: "study-recipe-1",
      title: "Signals lecture loop",
      description: "Turn signals lecture material into a reusable study panel.",
      commandAlias: "/recipe-signals-lecture-loop",
      workflow: "lecture",
      promptTemplate: "Turn this lecture into a study guide.",
      linkedSkillNames: ["lecture-read"],
      contextContract: {
        summary: "Prefer lecture PDF or current lecture note.",
        requireTargetNote: false,
        recommendAttachments: true,
        requireSelection: false,
                minimumPinnedContextCount: 0,
      },
      outputContract: ["Main topics", "Formulas"],
      sourceHints: ["attached lecture files", "current note"],
      exampleSession: {
        sourceTabTitle: "Signals",
        targetNotePath: "courses/signals/week-03.md",
        prompt: "Help me study this lecture.",
        outcomePreview: "Covered Nyquist and aliasing.",
        createdAt: 123,
      },
      promotionState: "captured",
      promotedSkillName: null,
      useCount: 2,
      lastUsedAt: 456,
      createdAt: 123,
      updatedAt: 456,
    });

    expect(store.serialize().studyRecipes).toEqual([
      expect.objectContaining({
        id: "study-recipe-1",
        title: "Signals lecture loop",
        commandAlias: "/recipe-signals-lecture-loop",
        workflow: "lecture",
        useCount: 2,
      }),
    ]);
    expect(store.serialize().activeStudyRecipeId).toBeNull();
  });

  it("does not inject a workspace-global active panel into the active tab during restore", () => {
    const store = new AgentStore(
      {
        tabs: [
          {
            id: "tab-a",
            title: "A",
            draft: "",
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
            reasoningEffort: "xhigh",
            usageSummary: createEmptyUsageSummary(),
            messages: [],
            diffText: "",
            toolLog: [],
            patchBasket: [],
                      },
        ],
        activeTabId: "tab-a",
        accountUsage: createEmptyAccountUsageSummary(),
        activeStudyWorkflow: null,
        recentStudySources: [],
        studyHubState: { lastOpenedAt: null, isCollapsed: false },
        studyRecipes: [
          {
            id: "study-panel-1",
            title: "Lecture",
            description: "Lecture panel",
            commandAlias: "/recipe-lecture",
            workflow: "lecture",
            promptTemplate: "Summarize this lecture.",
            linkedSkillNames: ["lecture-read"],
            contextContract: {
              summary: "Prefer lecture context.",
              requireTargetNote: false,
              recommendAttachments: true,
              requireSelection: false,
                            minimumPinnedContextCount: 0,
            },
            outputContract: ["Main ideas"],
            sourceHints: ["current note"],
            exampleSession: {
              sourceTabTitle: "Study chat",
              targetNotePath: null,
              prompt: "Summarize this lecture.",
              outcomePreview: null,
              createdAt: 1,
            },
            promotionState: "captured",
            promotedSkillName: null,
            useCount: 0,
            lastUsedAt: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeStudyRecipeId: "study-panel-1",
                                      },
      "/vault",
      true,
    );

    expect(store.getActiveTab()?.activeStudyRecipeId).toBeNull();
    expect(store.getState().activeStudyRecipeId).toBeNull();
  });

  it("restores per-tab active panel, selected skill, and chat suggestion state", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing tab");
    }

    store.upsertStudyRecipe({
      id: "study-panel-1",
      title: "Lecture",
      description: "Lecture panel",
      commandAlias: "/recipe-lecture",
      workflow: "lecture",
      promptTemplate: "Summarize this lecture.",
      linkedSkillNames: ["lecture-read"],
      contextContract: {
        summary: "Prefer lecture context.",
        requireTargetNote: false,
        recommendAttachments: true,
        requireSelection: false,
                minimumPinnedContextCount: 0,
      },
      outputContract: ["Main ideas"],
      sourceHints: ["current note"],
      exampleSession: {
        sourceTabTitle: "Study chat",
        targetNotePath: null,
        prompt: "Summarize this lecture.",
        outcomePreview: null,
        createdAt: 1,
      },
      promotionState: "captured",
      promotedSkillName: null,
      useCount: 0,
      lastUsedAt: null,
      createdAt: 1,
      updatedAt: 1,
    });
    store.setActiveStudyPanel(tab.id, "study-panel-1", ["lecture-read"]);
    store.setPanelSessionOrigin(tab.id, {
      panelId: "study-panel-1",
      selectedSkillNames: ["lecture-read"],
      promptSnapshot: "Summarize this lecture with drills.",
      awaitingCompletionSignal: true,
      lastAssistantMessageId: "assistant-1",
      startedAt: 1,
    });
    store.setChatSuggestion(tab.id, {
      id: "suggestion-1",
      kind: "panel_completion",
      status: "pending",
      messageId: "message-1",
      panelId: "study-panel-1",
      panelTitle: "Lecture",
      promptSnapshot: "Summarize this lecture with drills.",
      matchedSkillName: "lecture-read",
      canUpdatePanel: true,
      canSaveCopy: true,
      planSummary: null,
      planStatus: null,
      createdAt: 2,
    });

    const restored = new AgentStore(store.serialize(), "/vault", true);
    const restoredTab = restored.getActiveTab();

    expect(restoredTab?.activeStudyRecipeId).toBe("study-panel-1");
    expect(restoredTab?.activeStudySkillNames).toEqual(["lecture-read"]);
    expect(restoredTab?.panelSessionOrigin?.awaitingCompletionSignal).toBe(true);
    expect(restoredTab?.chatSuggestion?.messageId).toBe("message-1");
  });

  it("persists composer history with a bounded ring buffer", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }

    store.setComposerHistory(tab.id, {
      entries: Array.from({ length: 60 }, (_, index) => ` prompt ${index + 1} `),
      index: 49,
      draft: "draft in progress",
    });

    const restored = new AgentStore(store.serialize(), "/vault", true);
    const restoredHistory = restored.getActiveTab()?.composerHistory;
    expect(restoredHistory?.entries).toHaveLength(50);
    expect(restoredHistory?.entries[0]).toBe("prompt 11");
    expect(restoredHistory?.entries.at(-1)).toBe("prompt 60");
    expect(restoredHistory?.index).toBe(49);
    expect(restoredHistory?.draft).toBe("draft in progress");
  });

  it("normalizes active skills, panel session origin, and suggestion skill to the panel linked skills", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }
    store.setStudyRecipes([
      {
        id: "study-panel-1",
        title: "Lecture",
        description: "Lecture panel",
        commandAlias: "/recipe-lecture",
        workflow: "lecture",
        promptTemplate: "Summarize this lecture.",
        linkedSkillNames: ["lecture-read", "deep-read"],
        contextContract: {
          summary: "Prefer lecture context.",
          requireTargetNote: false,
          recommendAttachments: true,
          requireSelection: false,
                    minimumPinnedContextCount: 0,
        },
        outputContract: ["Main ideas"],
        sourceHints: ["current note"],
        exampleSession: {
          sourceTabTitle: "Study chat",
          targetNotePath: null,
          prompt: "Summarize this lecture.",
          outcomePreview: null,
          createdAt: 1,
        },
        promotionState: "captured",
        promotedSkillName: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    store.setActiveStudyPanel(tab.id, "study-panel-1", ["lecture-read", "nonexistent-skill"]);
    store.setPanelSessionOrigin(tab.id, {
      panelId: "study-panel-1",
      selectedSkillNames: ["lecture-read", "nonexistent-skill"],
      promptSnapshot: "Summarize this lecture.",
      awaitingCompletionSignal: true,
      lastAssistantMessageId: null,
      startedAt: 1,
    });
    store.setChatSuggestion(tab.id, {
      id: "suggestion-1",
      kind: "panel_completion",
      status: "pending",
      messageId: "message-1",
      panelId: "study-panel-1",
      panelTitle: "Lecture",
      promptSnapshot: "Summarize this lecture.",
      matchedSkillName: "nonexistent-skill",
      canUpdatePanel: true,
      canSaveCopy: true,
      planSummary: null,
      planStatus: null,
      createdAt: 1,
    });

    store.setStudyRecipes([
      {
        id: "study-panel-1",
        title: "Lecture",
        description: "Lecture panel",
        commandAlias: "/recipe-lecture",
        workflow: "lecture",
        promptTemplate: "Summarize this lecture.",
        linkedSkillNames: ["deep-read"],
        contextContract: {
          summary: "Prefer lecture context.",
          requireTargetNote: false,
          recommendAttachments: true,
          requireSelection: false,
                    minimumPinnedContextCount: 0,
        },
        outputContract: ["Main ideas"],
        sourceHints: ["current note"],
        exampleSession: {
          sourceTabTitle: "Study chat",
          targetNotePath: null,
          prompt: "Summarize this lecture.",
          outcomePreview: null,
          createdAt: 1,
        },
        promotionState: "captured",
        promotedSkillName: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    const nextTab = store.getActiveTab();
    expect(nextTab?.activeStudyRecipeId).toBe("study-panel-1");
    expect(nextTab?.activeStudySkillNames).toEqual([]);
    expect(nextTab?.panelSessionOrigin?.selectedSkillNames).toEqual([]);
    expect(nextTab?.chatSuggestion?.matchedSkillName).toBeNull();
  });

  it("reconciles open tab panel state when a study recipe is updated in place", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }

    store.setStudyRecipes([
      {
        id: "study-panel-1",
        title: "Lecture",
        description: "Lecture panel",
        commandAlias: "/recipe-lecture",
        workflow: "lecture",
        promptTemplate: "Summarize this lecture.",
        linkedSkillNames: ["lecture-read", "deep-read"],
        contextContract: {
          summary: "Prefer lecture context.",
          requireTargetNote: false,
          recommendAttachments: true,
          requireSelection: false,
          minimumPinnedContextCount: 0,
        },
        outputContract: ["Main ideas"],
        sourceHints: ["current note"],
        exampleSession: {
          sourceTabTitle: "Study chat",
          targetNotePath: null,
          prompt: "Summarize this lecture.",
          outcomePreview: null,
          createdAt: 1,
        },
        promotionState: "captured",
        promotedSkillName: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    store.setActiveStudyPanel(tab.id, "study-panel-1", ["lecture-read", "deep-read"]);
    store.setPanelSessionOrigin(tab.id, {
      panelId: "study-panel-1",
      selectedSkillNames: ["lecture-read", "deep-read"],
      promptSnapshot: "Summarize this lecture.",
      awaitingCompletionSignal: true,
      lastAssistantMessageId: null,
      startedAt: 1,
    });
    store.setChatSuggestion(tab.id, {
      id: "suggestion-1",
      kind: "panel_completion",
      status: "pending",
      messageId: "message-1",
      panelId: "study-panel-1",
      panelTitle: "Lecture",
      promptSnapshot: "Summarize this lecture.",
      matchedSkillName: "lecture-read",
      canUpdatePanel: true,
      canSaveCopy: true,
      planSummary: null,
      planStatus: null,
      createdAt: 1,
    });

    store.upsertStudyRecipe({
      id: "study-panel-1",
      title: "Lecture Revised",
      description: "Lecture panel",
      commandAlias: "/recipe-lecture",
      workflow: "lecture",
      promptTemplate: "Summarize this lecture.",
      linkedSkillNames: ["deep-read"],
      contextContract: {
        summary: "Prefer lecture context.",
        requireTargetNote: false,
        recommendAttachments: true,
        requireSelection: false,
        minimumPinnedContextCount: 0,
      },
      outputContract: ["Main ideas"],
      sourceHints: ["current note"],
      exampleSession: {
        sourceTabTitle: "Study chat",
        targetNotePath: null,
        prompt: "Summarize this lecture.",
        outcomePreview: null,
        createdAt: 1,
      },
      promotionState: "captured",
      promotedSkillName: null,
      useCount: 1,
      lastUsedAt: 2,
      createdAt: 1,
      updatedAt: 2,
    });

    const updatedTab = store.getActiveTab();
    expect(updatedTab?.activeStudyRecipeId).toBe("study-panel-1");
    expect(updatedTab?.activeStudySkillNames).toEqual(["deep-read"]);
    expect(updatedTab?.panelSessionOrigin?.selectedSkillNames).toEqual(["deep-read"]);
    expect(updatedTab?.chatSuggestion?.panelTitle).toBe("Lecture Revised");
    expect(updatedTab?.chatSuggestion?.matchedSkillName).toBeNull();
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

  it("clears selected skills when the active panel is removed", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }
    store.setStudyRecipes([
      {
        id: "study-panel-1",
        title: "Lecture",
        description: "Lecture panel",
        commandAlias: "/recipe-lecture",
        workflow: "lecture",
        promptTemplate: "Summarize this lecture.",
        linkedSkillNames: ["lecture-read"],
        contextContract: {
          summary: "Prefer lecture context.",
          requireTargetNote: false,
          recommendAttachments: true,
          requireSelection: false,
                    minimumPinnedContextCount: 0,
        },
        outputContract: ["Main ideas"],
        sourceHints: ["current note"],
        exampleSession: {
          sourceTabTitle: "Study chat",
          targetNotePath: null,
          prompt: "Summarize this lecture.",
          outcomePreview: null,
          createdAt: 1,
        },
        promotionState: "captured",
        promotedSkillName: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "study-panel-2",
        title: "Review",
        description: "Review panel",
        commandAlias: "/recipe-review",
        workflow: "review",
        promptTemplate: "Review these notes.",
        linkedSkillNames: [],
        contextContract: {
          summary: "Prefer notes.",
          requireTargetNote: false,
          recommendAttachments: false,
          requireSelection: false,
                    minimumPinnedContextCount: 0,
        },
        outputContract: ["Weak spots"],
        sourceHints: [],
        exampleSession: {
          sourceTabTitle: "Study chat",
          targetNotePath: null,
          prompt: "Review these notes.",
          outcomePreview: null,
          createdAt: 1,
        },
        promotionState: "captured",
        promotedSkillName: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    store.setActiveStudyPanel(tab.id, "study-panel-1", ["lecture-read"]);

    store.removeStudyRecipe("study-panel-1");

    expect(store.getActiveTab()?.activeStudyRecipeId).toBeNull();
    expect(store.getActiveTab()?.activeStudySkillNames).toEqual([]);
  });

  it("drops stale panel references when the study recipe list is replaced", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }
    store.setActiveStudyPanel(tab.id, "missing-panel", ["lecture-read"]);
    store.setPanelSessionOrigin(tab.id, {
      panelId: "missing-panel",
      selectedSkillNames: ["lecture-read"],
      promptSnapshot: "Help me study this lecture.",
      awaitingCompletionSignal: true,
      lastAssistantMessageId: null,
      startedAt: 1,
    });
    store.setChatSuggestion(tab.id, {
      id: "suggestion-1",
      kind: "panel_completion",
      status: "pending",
      messageId: "message-1",
      panelId: "missing-panel",
      panelTitle: "Lecture",
      promptSnapshot: "Help me study this lecture.",
      matchedSkillName: "lecture-read",
      canUpdatePanel: true,
      canSaveCopy: true,
      planSummary: null,
      planStatus: null,
      createdAt: 1,
    });

    store.setStudyRecipes([]);

    expect(store.getActiveTab()?.activeStudyRecipeId).toBeNull();
    expect(store.getActiveTab()?.activeStudySkillNames).toEqual([]);
    expect(store.getActiveTab()?.panelSessionOrigin).toBeNull();
    expect(store.getActiveTab()?.chatSuggestion).toBeNull();
  });

  it("clears stale panel state on inactive tabs instead of reassigning another panel", () => {
    const store = new AgentStore(null, "/vault", true);
    const activeTab = store.getActiveTab();
    if (!activeTab) {
      throw new Error("Missing active tab");
    }
    const otherTab = store.createTab("/vault", "Other");
    store.activateTab(activeTab.id);

    store.setStudyRecipes([
      {
        id: "study-panel-1",
        title: "Lecture",
        description: "Lecture panel",
        commandAlias: "/recipe-lecture",
        workflow: "lecture",
        promptTemplate: "Summarize this lecture.",
        linkedSkillNames: ["lecture-read"],
        contextContract: {
          summary: "Prefer lecture context.",
          requireTargetNote: false,
          recommendAttachments: true,
          requireSelection: false,
                    minimumPinnedContextCount: 0,
        },
        outputContract: ["Main ideas"],
        sourceHints: ["current note"],
        exampleSession: {
          sourceTabTitle: "Study chat",
          targetNotePath: null,
          prompt: "Summarize this lecture.",
          outcomePreview: null,
          createdAt: 1,
        },
        promotionState: "captured",
        promotedSkillName: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "study-panel-2",
        title: "Review",
        description: "Review panel",
        commandAlias: "/recipe-review",
        workflow: "review",
        promptTemplate: "Review these notes.",
        linkedSkillNames: [],
        contextContract: {
          summary: "Prefer notes.",
          requireTargetNote: false,
          recommendAttachments: false,
          requireSelection: false,
                    minimumPinnedContextCount: 0,
        },
        outputContract: ["Weak spots"],
        sourceHints: [],
        exampleSession: {
          sourceTabTitle: "Study chat",
          targetNotePath: null,
          prompt: "Review these notes.",
          outcomePreview: null,
          createdAt: 1,
        },
        promotionState: "captured",
        promotedSkillName: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    store.setActiveStudyPanel(activeTab.id, "study-panel-1", ["lecture-read"]);
    store.setActiveStudyPanel(otherTab.id, "study-panel-2", []);
    store.setPanelSessionOrigin(otherTab.id, {
      panelId: "study-panel-2",
      selectedSkillNames: [],
      promptSnapshot: "Review these notes.",
      awaitingCompletionSignal: true,
      lastAssistantMessageId: null,
      startedAt: 1,
    });

    store.removeStudyRecipe("study-panel-2");

    const restoredOtherTab = store.getState().tabs.find((entry) => entry.id === otherTab.id);
    expect(restoredOtherTab?.activeStudyRecipeId).toBeNull();
    expect(restoredOtherTab?.activeStudySkillNames).toEqual([]);
    expect(restoredOtherTab?.panelSessionOrigin).toBeNull();
    expect(store.getActiveTab()?.activeStudyRecipeId).toBe("study-panel-1");
  });

  it("rejects missing panel ids when setting the active panel directly", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }

    store.setActiveStudyPanel(tab.id, "missing-panel", ["lecture-read"]);

    expect(store.getActiveTab()?.activeStudyRecipeId).toBeNull();
    expect(store.getActiveTab()?.activeStudySkillNames).toEqual([]);
    expect(store.getState().activeStudyRecipeId).toBeNull();
  });

  it("rejects missing panel ids when activating a workspace-level panel", () => {
    const store = new AgentStore(null, "/vault", true);

    store.activateStudyRecipe("missing-panel");

    expect(store.getActiveTab()?.activeStudyRecipeId).toBeNull();
    expect(store.getActiveTab()?.activeStudySkillNames).toEqual([]);
    expect(store.getState().activeStudyRecipeId).toBeNull();
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
    store.setLearningMode(tab.id, true);
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
      learningMode: false,
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
          });

    const next = store.getState().tabs.find((entry) => entry.id === tab.id);
    expect(next).toEqual(
      expect.objectContaining({
        id: tab.id,
        title: "New chat",
        draft: "",
        learningMode: false,
        summary: null,
        lineage: {
          parentTabId: null,
          forkedFromThreadId: null,
          resumedFromThreadId: null,
          compactedAt: null,
          pendingThreadReset: false,
          compactedFromThreadId: null,
        },
        targetNotePath: "notes/next.md",
        selectionContext: null,
        contextPaths: [],
        messages: [],
        diffText: "",
        toolLog: [],
        patchBasket: [],
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
      lastObservedAt: 123,
      lastCheckedAt: 124,
      threadId: "thread-123",
    };

    store.setAccountUsage(accountUsage);

    expect(store.getState().accountUsage).toEqual(accountUsage);
    expect(store.getState().tabs.every((tab) => tab.usageSummary.limits.fiveHourPercent === null)).toBe(true);
  });

  it("uses sticky defaults when the last open tab is closed", () => {
    const store = new AgentStore(null, "/vault", true, { fastMode: false, learningMode: false });
    const activeTab = store.getActiveTab();
    if (!activeTab) {
      throw new Error("Missing active tab");
    }

    store.closeTab(activeTab.id, "/vault", { fastMode: true, learningMode: true });

    const replacementTab = store.getActiveTab();
    expect(replacementTab?.fastMode).toBe(true);
    expect(replacementTab?.learningMode).toBe(true);
  });

  it("prefers restored tab usage over stale restored account usage", () => {
    const store = new AgentStore(
      {
        tabs: [
          {
            id: "tab-a",
            title: "A",
            draft: "",
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
            codexThreadId: "thread-a",
            model: "gpt-5.4",
            reasoningEffort: "xhigh",
            usageSummary: {
              ...createEmptyUsageSummary(),
              limits: {
                fiveHourPercent: 33,
                weekPercent: 17,
                planType: "pro",
              },
            },
            messages: [],
            diffText: "",
            toolLog: [],
            patchBasket: [],
                      },
        ],
        activeTabId: "tab-a",
        accountUsage: {
          limits: {
            fiveHourPercent: 5,
            weekPercent: 2,
            planType: "pro",
          },
          source: "restored",
          updatedAt: null,
          lastObservedAt: null,
          lastCheckedAt: null,
          threadId: "thread-stale",
        },
        activeStudyWorkflow: null,
        recentStudySources: [],
        studyHubState: { lastOpenedAt: null, isCollapsed: false },
        studyRecipes: [],
        activeStudyRecipeId: null,
                                      },
      "/vault",
      true,
    );

    expect(store.getState().accountUsage).toEqual({
      limits: {
        fiveHourPercent: 33,
        weekPercent: 17,
        planType: "pro",
      },
      source: "restored",
      updatedAt: null,
      lastObservedAt: null,
      lastCheckedAt: null,
      threadId: "thread-a",
    });
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
        originTurnId: null,
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
        originTurnId: null,
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

  it("round-trips full compact lineage state through serialize and restore", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }

    store.setLineage(tab.id, {
      parentTabId: "tab-parent",
      forkedFromThreadId: "thread-parent",
      resumedFromThreadId: "thread-resume",
      compactedAt: 123,
      pendingThreadReset: true,
      compactedFromThreadId: "thread-compacted",
    });

    const serialized = store.serialize();
    expect(serialized.tabs[0]?.lineage).toEqual({
      parentTabId: "tab-parent",
      forkedFromThreadId: "thread-parent",
      resumedFromThreadId: "thread-resume",
      compactedAt: 123,
      pendingThreadReset: true,
      compactedFromThreadId: "thread-compacted",
    });

    const restored = new AgentStore(serialized, "/vault", true);
    expect(restored.getState().tabs[0]?.lineage).toEqual({
      parentTabId: "tab-parent",
      forkedFromThreadId: "thread-parent",
      resumedFromThreadId: "thread-resume",
      compactedAt: 123,
      pendingThreadReset: true,
      compactedFromThreadId: "thread-compacted",
    });
  });

  it("normalizes missing lineage fields when callers set a legacy lineage shape", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }

    store.setLineage(tab.id, {
      parentTabId: "tab-parent",
      forkedFromThreadId: null,
      resumedFromThreadId: null,
      compactedAt: 456,
    });

    expect(store.getState().tabs[0]?.lineage).toEqual({
      parentTabId: "tab-parent",
      forkedFromThreadId: null,
      resumedFromThreadId: null,
      compactedAt: 456,
      pendingThreadReset: false,
      compactedFromThreadId: null,
    });
    expect(store.serialize().tabs[0]?.lineage).toEqual({
      parentTabId: "tab-parent",
      forkedFromThreadId: null,
      resumedFromThreadId: null,
      compactedAt: 456,
      pendingThreadReset: false,
      compactedFromThreadId: null,
    });
  });

  it("persists dropped review-state markers and restores them as an explicit system notice", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }

    const approval: PendingApproval = {
      id: "approval-1",
      tabId: tab.id,
      callId: "call-1",
      toolName: "write_note",
      title: "Write note",
      description: "Update note",
      details: "Apply note edits",
      createdAt: 100,
    };
    const patch: PatchProposal = {
      id: "patch-1",
      threadId: "thread-1",
      sourceMessageId: "message-1",
      originTurnId: null,
      targetPath: "Notes/A.md",
      kind: "update",
      baseSnapshot: "before",
      proposedText: "after",
      unifiedDiff: "--- A",
      summary: "Update A",
      status: "pending",
      createdAt: 101,
    };

    store.addApproval(tab.id, approval);
    store.setPatchBasket(tab.id, [patch]);

    const serialized = store.serialize();
    const persistedTab = serialized.tabs[0];
    if (!persistedTab) {
      throw new Error("Missing persisted tab");
    }
    expect(serialized.tabs[0]?.patchBasket).toEqual([]);
    expect(serialized.tabs[0]?.restartDropNotice).toEqual(
      expect.objectContaining({
        approvalCount: 1,
        patchCount: 1,
      }),
    );

    const restored = new AgentStore(
      {
        tabs: [createPersistedTab(persistedTab)],
        activeTabId: serialized.activeTabId,
        accountUsage: serialized.accountUsage,
        activeStudyWorkflow: serialized.activeStudyWorkflow,
        recentStudySources: serialized.recentStudySources,
        studyHubState: serialized.studyHubState,
        studyRecipes: serialized.studyRecipes,
        activeStudyRecipeId: serialized.activeStudyRecipeId,
      },
      "/vault",
      true,
    );

    const restoredTab = restored.getState().tabs[0];
    expect(restoredTab?.pendingApprovals).toEqual([]);
    expect(restoredTab?.patchBasket).toEqual([]);
    expect(restoredTab?.sessionApprovals).toEqual({ write: false, shell: false });
    expect(restoredTab?.messages.at(-1)).toEqual(
      expect.objectContaining({
        kind: "system",
        text: expect.stringContaining("1 approval and 1 patch proposal were cleared when this tab was restored after restart."),
        meta: expect.objectContaining({
          restartDropNotice: true,
          restartDropApprovalCount: 1,
          restartDropPatchCount: 1,
        }),
      }),
    );

    const reserialized = restored.serialize();
    expect(reserialized.tabs[0]?.restartDropNotice).toBeNull();
  });

  it("deep-clones runtime-owned approval and patch payloads in state snapshots", () => {
    const store = new AgentStore(null, "/vault", true);
    const tab = store.getActiveTab();
    if (!tab) {
      throw new Error("Missing active tab");
    }

    store.setApprovals(tab.id, [
      {
        id: "approval-1",
        tabId: tab.id,
        callId: "call-1",
        toolName: "skill_update",
        title: "Update skill: lecture-read",
        description: "/vault/.codex/skills/lecture-read/SKILL.md",
        details: "Learned refinement",
        diffText: "@@",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        scope: "write",
        toolPayload: {
          skillName: "lecture-read",
          skillPath: "/vault/.codex/skills/lecture-read/SKILL.md",
          baseContent: "# Skill",
          baseContentHash: "hash-1",
          nextContent: "# Skill\n\nRefined",
          feedbackSummary: "Learned refinement",
          attribution: {
            prompt: "Improve this note.",
            summary: "Applied a note cleanup.",
            targetNotePath: "notes/a.md",
            panelId: null,
          },
        },
      },
    ]);
    store.setPatchBasket(tab.id, [
      {
        id: "patch-1",
        threadId: null,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        targetPath: "notes/a.md",
        kind: "update",
        baseSnapshot: "before",
        proposedText: "after",
        unifiedDiff: "@@",
        summary: "Update note",
        status: "pending",
        createdAt: 1,
        anchors: [
          {
            anchorBefore: "Before",
            anchorAfter: "After",
            replacement: "Replacement",
          },
        ],
        evidence: [
          {
            kind: "vault_note",
            label: "Lecture",
            sourceRef: "notes/a.md",
            snippet: "Source snippet",
          },
        ],
      },
    ]);

    const snapshot = store.getState();
    const approvalPayload = snapshot.tabs[0]?.pendingApprovals[0]?.toolPayload as
      | {
          nextContent: string;
        }
      | undefined;
    const patch = snapshot.tabs[0]?.patchBasket[0];
    if (!approvalPayload || !patch?.anchors?.[0] || !patch.evidence?.[0]) {
      throw new Error("Missing runtime-owned data");
    }

    approvalPayload.nextContent = "# Mutated";
    patch.anchors[0].replacement = "Changed";
    patch.evidence[0].snippet = "Changed snippet";

    const refreshed = store.getState().tabs[0];
    expect((refreshed?.pendingApprovals[0]?.toolPayload as { nextContent?: string } | undefined)?.nextContent).toBe("# Skill\n\nRefined");
    expect(refreshed?.patchBasket[0]?.anchors?.[0]?.replacement).toBe("Replacement");
    expect(refreshed?.patchBasket[0]?.evidence?.[0]?.snippet).toBe("Source snippet");
  });
});
