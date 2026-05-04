// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PatchProposal, StudyRecipe, WorkspaceState } from "../../model/types";
import { getLocalizedCopy } from "../../util/i18n";
import type { SlashCommandDefinition } from "../../util/slashCommandCatalog";
import { ComposerRenderer } from "../../views/renderers/composerRenderer";
import { createHubRendererEphemeralState, HubRenderer } from "../../views/renderers/hubRenderer";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "../../views/renderers/types";
import { isUserOwnedSkillDefinition, type InstalledSkillDefinition } from "../../util/skillCatalog";
import { installObsidianDomHelpers, Notice } from "../setup/obsidian";

function createState(): WorkspaceState {
  return {
    tabs: [
      {
        id: "tab-1",
        title: "Chat 1",
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
        composerHistory: {
          entries: [],
          index: null,
          draft: null,
        },
        composeMode: "chat",
        contextPaths: [],
        lastResponseId: null,
        sessionItems: [],
        codexThreadId: null,
        model: "gpt-5.5",
        reasoningEffort: "high",
        usageSummary: {
          lastTurn: null,
          total: null,
          limits: {
            fiveHourPercent: null,
            weekPercent: null,
            planType: null,
          },
        },
        messages: [],
        diffText: "",
        toolLog: [],
        waitingState: null,
        patchBasket: [],
        pendingApprovals: [],
        status: "ready",
        runtimeMode: "normal",
        lastError: null,
        sessionApprovals: {
          write: false,
          shell: false,
        },
              },
    ],
    activeTabId: "tab-1",
    authState: "ready",
    availableModels: [
      {
        slug: "gpt-5.5",
        displayName: "GPT-5.5",
        defaultReasoningLevel: "high",
        supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
      },
    ],
    accountUsage: {
      limits: {
        fiveHourPercent: null,
        weekPercent: null,
        planType: null,
      },
      source: null,
      updatedAt: null,
      lastObservedAt: null,
      lastCheckedAt: null,
      threadId: null,
    },
    activeStudyWorkflow: null,
    recentStudySources: [],
    studyHubState: {
      lastOpenedAt: null,
      isCollapsed: false,
    },
    studyRecipes: [
      {
        id: "panel-1",
        title: "Lecture",
        description: "Use lecture skills.",
        commandAlias: "lecture",
        workflow: "lecture",
        promptTemplate: "Turn this into lecture study notes.",
        linkedSkillNames: ["lecture-read"],
        contextContract: {
          summary: "",
          requireTargetNote: false,
          recommendAttachments: false,
          requireSelection: false,
                    minimumPinnedContextCount: 0,
        },
        outputContract: [],
        sourceHints: [],
        exampleSession: {
          sourceTabTitle: "Chat 1",
          targetNotePath: null,
          prompt: "",
          outcomePreview: null,
          createdAt: 0,
        },
        promotionState: "captured",
        promotedSkillName: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    activeStudyRecipeId: null,
                    runtimeIssue: null,
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installFocusShim(): void {
  let activeElement: Element | null = document.body;
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => activeElement ?? document.body,
  });
  const installOnPrototype = (prototype: object) => {
    Object.defineProperty(prototype, "focus", {
      configurable: true,
      value: function focus(this: HTMLElement) {
        activeElement = this;
      },
    });
    Object.defineProperty(prototype, "blur", {
      configurable: true,
      value: function blur(this: HTMLElement) {
        if (activeElement === this) {
          activeElement = document.body;
        }
      },
    });
  };
  installOnPrototype(HTMLElement.prototype);
  installOnPrototype(HTMLTextAreaElement.prototype);
  installOnPrototype(HTMLButtonElement.prototype);
}

function createHarness(
  options: {
    rejectSend?: boolean;
    slashCommands?: readonly SlashCommandDefinition[];
    permissionMode?: "suggest" | "auto-edit" | "full-auto";
    preserveReadyStatusWhileSending?: boolean;
    fastMode?: boolean;
    tabBarPosition?: "header" | "composer";
    isNarrowLayout?: boolean;
    activeFilePath?: string | null;
    dailyNotePath?: string | null;
    contextPaths?: string[];
    composeMode?: WorkspaceState["tabs"][number]["composeMode"];
    status?: WorkspaceState["tabs"][number]["status"];
    createHubPanelError?: string;
    updateHubPanelError?: string;
  } = {},
) {
  const state = createState();
  const copy = getLocalizedCopy("en");
  const activeTab = state.tabs[0]!;
  let nextPanelIndex = state.studyRecipes.length + 1;
  let permissionMode = options.permissionMode ?? "suggest";
  activeTab.fastMode = options.fastMode ?? false;
  activeTab.contextPaths = [...(options.contextPaths ?? [])];
  activeTab.composeMode = options.composeMode ?? activeTab.composeMode;
  activeTab.status = options.status ?? activeTab.status;
  const installedSkills: InstalledSkillDefinition[] = [
    {
      name: "lecture-read",
      description: "Read lecture material deeply.",
      path: "/home/tester/.agents/skills/lecture-read/SKILL.md",
    },
    {
      name: "grill-me",
      description: "Stress-test a plan by asking one question at a time.",
      path: "/home/tester/.agents/skills/grill-me/SKILL.md",
    },
    {
      name: "study-drill",
      description: "Create short study drills.",
      path: "/home/tester/.agents/skills/study-drill/SKILL.md",
    },
    {
      name: "github:gh-fix-ci",
      description: "Fix failing GitHub Actions checks.",
      path: "/home/tester/.codex/plugins/cache/openai-curated/github/hash123/skills/gh-fix-ci/SKILL.md",
    },
  ];
  const sendGate = createDeferred();
  let lastEffectiveSkillsCsv: string | null = null;
  const sendPrompt = vi.fn(async (_tabId: string, _prompt: string) => {
    lastEffectiveSkillsCsv = activeTab.activeStudySkillNames.length > 0 ? activeTab.activeStudySkillNames.join(",") : null;
    if (!options.preserveReadyStatusWhileSending) {
      activeTab.status = "busy";
      renderAll();
    }
    await sendGate.promise;
    if (!options.preserveReadyStatusWhileSending) {
      activeTab.status = "ready";
    }
    if (options.rejectSend) {
      activeTab.lastError = "Send failed";
      renderAll();
      throw new Error("Send failed");
    }
    activeTab.draft = "";
    renderAll();
  });

  const service = {
    getHubPanels: () => state.studyRecipes,
    getActivePanelId: () => activeTab.activeStudyRecipeId,
    getActivePanelSkillNames: () => [...activeTab.activeStudySkillNames],
    getStudyHubState: () => state.studyHubState,
    toggleStudyHubCollapsed: () => {
      state.studyHubState.isCollapsed = !state.studyHubState.isCollapsed;
      renderAll();
    },
    setStudyHubCollapsed: (isCollapsed: boolean) => {
      state.studyHubState.isCollapsed = isCollapsed;
      renderAll();
    },
    refreshInstalledSkills: vi.fn(async () => {}),
    getUserOwnedInstalledSkills: () => installedSkills.filter((entry) => isUserOwnedSkillDefinition(entry)),
    getInstalledSkills: () => installedSkills,
    createHubPanel: vi.fn((draft?: { title?: string; description?: string; promptTemplate?: string; linkedSkillNames?: string[] }) => {
      if (options.createHubPanelError) {
        throw new Error(options.createHubPanelError);
      }
      const panel: StudyRecipe = {
        ...state.studyRecipes[0]!,
        id: `panel-${nextPanelIndex}`,
        title: draft?.title?.trim() ?? "",
        description: draft?.description?.trim() ?? "",
        commandAlias: `panel-${nextPanelIndex}`,
        workflow: "custom",
        promptTemplate: draft?.promptTemplate?.trim() ?? "",
        linkedSkillNames: draft?.linkedSkillNames ? [...draft.linkedSkillNames] : [],
        createdAt: nextPanelIndex,
        updatedAt: nextPanelIndex,
      };
      nextPanelIndex += 1;
      state.studyRecipes = [...state.studyRecipes, panel];
      return panel;
    }),
    updateHubPanel: vi.fn((panelId: string, patch: { title?: string; description?: string; promptTemplate?: string; linkedSkillNames?: string[] }) => {
      if (options.updateHubPanelError) {
        throw new Error(options.updateHubPanelError);
      }
      state.studyRecipes = state.studyRecipes.map((panel) =>
        panel.id === panelId
          ? {
              ...panel,
              title: patch.title?.trim() ? patch.title.trim() : panel.title,
              description: patch.description?.trim() ?? panel.description,
              promptTemplate: patch.promptTemplate?.trim() ?? panel.promptTemplate,
              linkedSkillNames: patch.linkedSkillNames ? [...patch.linkedSkillNames] : panel.linkedSkillNames,
            }
          : panel,
      );
      return state.studyRecipes.find((panel) => panel.id === panelId)!;
    }),
    seedHubPanelPrompt: vi.fn(),
    commitHubPanelSkillSelection: vi.fn((tabId: string, panelId: string, skillNames: string[]) => {
      if (tabId === activeTab.id) {
        activeTab.activeStudyRecipeId = panelId;
        activeTab.activeStudySkillNames = [...skillNames];
      }
    }),
    seedHubPanelSkills: vi.fn((_tabId: string, panelId: string, skillNames: string[], _file?: unknown, options?: { mode?: string }) => {
      activeTab.activeStudyRecipeId = panelId;
      activeTab.activeStudySkillNames =
        options?.mode === "replace" ? [...skillNames] : [...new Set([...activeTab.activeStudySkillNames, ...skillNames])];
      const panel = state.studyRecipes.find((entry) => entry.id === panelId);
      if (panel) {
        panel.linkedSkillNames = [...new Set([...panel.linkedSkillNames, ...skillNames])];
      }
      activeTab.draft = `${skillNames.map((skillName) => `/${skillName}`).join("\n")}\n\n${state.studyRecipes[0]!.promptTemplate}`;
      renderAll();
      return activeTab.draft;
    }),
    getActiveTab: () => activeTab,
    getTabComposerHistory: () => activeTab.composerHistory,
    setTabComposerHistory: vi.fn((tabId: string, composerHistory: typeof activeTab.composerHistory) => {
      if (tabId === activeTab.id) {
        activeTab.composerHistory = {
          entries: [...composerHistory.entries],
          index: composerHistory.index,
          draft: composerHistory.draft,
        };
      }
    }),
    getTabTargetNotePath: () => activeTab.targetNotePath,
    getTabSelectionContext: () => activeTab.selectionContext,
    getTabAttachments: () => [],
    getTabPatchBasket: (): PatchProposal[] => [],
    openPatchTarget: vi.fn(),
    rejectPatchProposal: vi.fn(),
    applyPatchProposal: vi.fn(async () => {}),
    clearActivePanelContext: vi.fn((tabId: string) => {
      if (tabId === activeTab.id) {
        activeTab.activeStudyRecipeId = null;
        activeTab.activeStudySkillNames = [];
      }
      renderAll();
    }),
    getPermissionMode: () => permissionMode,
    setPermissionMode: vi.fn(async (mode: typeof permissionMode) => {
      permissionMode = mode;
      renderAll();
    }),
    getMaxOpenTabs: () => 6,
    ensureAccountUsage: vi.fn(),
    getAvailableModels: () => state.availableModels,
    getTabBarPosition: () => options.tabBarPosition ?? "header",
    getMentionCandidates: () => [],
    getSlashCommandCatalog: () => options.slashCommands ?? [],
    setTabModel: vi.fn(),
    setTabReasoningEffort: vi.fn(),
    toggleTabLearningMode: vi.fn((tabId: string) => {
      if (tabId === activeTab.id) {
        activeTab.learningMode = !activeTab.learningMode;
      }
      renderAll();
      return activeTab.learningMode;
    }),
    setTabLearningMode: vi.fn((tabId: string, enabled: boolean) => {
      if (tabId === activeTab.id) {
        activeTab.learningMode = enabled;
      }
      renderAll();
      return enabled;
    }),
    setTabFastMode: vi.fn((tabId: string, enabled: boolean) => {
      if (tabId === activeTab.id) {
        activeTab.fastMode = enabled;
      }
      renderAll();
    }),
    setDraft: vi.fn((tabId: string, draft: string) => {
      if (tabId === activeTab.id) {
        activeTab.draft = draft;
      }
    }),
    toggleTabComposeMode: vi.fn(),
    addCurrentNoteToContext: vi.fn(async (tabId: string, file: { path: string } | null) => {
      if (tabId !== activeTab.id || !file) {
        throw new Error("No active note to pin.");
      }
      activeTab.contextPaths = [...new Set([...activeTab.contextPaths, file.path])];
      renderAll();
    }),
    addDailyNoteToContext: vi.fn(async (tabId: string) => {
      if (tabId !== activeTab.id) {
        return;
      }
      const path = options.dailyNotePath ?? "daily/2026-04-13.md";
      activeTab.contextPaths = [...new Set([...activeTab.contextPaths, path])];
      renderAll();
    }),
    removeContextPath: vi.fn((tabId: string, path: string) => {
      if (tabId !== activeTab.id) {
        return;
      }
      activeTab.contextPaths = activeTab.contextPaths.filter((entry) => entry !== path);
      renderAll();
    }),
    clearContextPack: vi.fn((tabId: string) => {
      if (tabId !== activeTab.id) {
        return;
      }
      activeTab.contextPaths = [];
      renderAll();
    }),
    interruptActiveTurn: vi.fn(async () => {}),
    sendPrompt,
  };

  const app = {
    workspace: {
      getActiveFile: () => null,
    },
  };

  const hubRoot = document.createElement("div");
  const composerRoot = document.createElement("div");
  document.body.append(hubRoot, composerRoot);
  const hubEphemeralState = createHubRendererEphemeralState();

  const callbacks: WorkspaceRenderCallbacks = {
    markdownComponent: {} as never,
    openSettings: vi.fn(),
    requestRender: () => renderAll(),
    focusComposer: vi.fn(),
    seedDraftAndSend: vi.fn(),
    respondToChatSuggestion: vi.fn(async () => {}),
    resolvePromptContext: () => ({
      file: options.activeFilePath ? ({ path: options.activeFilePath } as unknown as ReturnType<WorkspaceRenderCallbacks["resolvePromptContext"]>["file"]) : null,
      editor: null,
    }),
    attachBrowserFiles: vi.fn(async () => {}),
    openTargetNote: vi.fn(async () => {}),
  };

  let hubRenderer = new HubRenderer(hubRoot, callbacks, hubEphemeralState);
  const composerRenderer = new ComposerRenderer(composerRoot, callbacks);

  function getContext(): WorkspaceRenderContext {
    return {
      app: app as never,
      service: service as never,
      state,
      activeTab,
      isNarrowLayout: options.isNarrowLayout ?? false,
      locale: "en",
      copy,
    };
  }

  function renderAll(): void {
    const context = getContext();
    hubRenderer.render(context);
    composerRenderer.render(context);
  }

  function rebuildHubRenderer(): void {
    hubRenderer.dispose();
    hubRenderer = new HubRenderer(hubRoot, callbacks, hubEphemeralState);
    renderAll();
  }

  renderAll();

  return {
    state,
    activeTab,
    service,
    callbacks,
    renderAll,
    sendGate,
    hubRoot,
    composerRoot,
    sendPrompt,
    rebuildHubRenderer,
    getLastEffectiveSkillsCsv: () => lastEffectiveSkillsCsv,
  };
}

function createMultiTabComposerHarness() {
  const state = createState();
  const copy = getLocalizedCopy("en");
  const secondTab = structuredClone(state.tabs[0]!);
  secondTab.id = "tab-2";
  secondTab.title = "Chat 2";
  secondTab.model = "gpt-5.4";
  secondTab.reasoningEffort = "low";
  state.tabs = [state.tabs[0]!, secondTab];
  state.activeTabId = "tab-1";
  state.availableModels = [
    {
      slug: "gpt-5.5",
      displayName: "GPT-5.5",
      defaultReasoningLevel: "high",
      supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
    },
    {
      slug: "gpt-5.4",
      displayName: "GPT-5.4",
      defaultReasoningLevel: "medium",
      supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
    },
    {
      slug: "gpt-5.3-codex",
      displayName: "GPT-5.3",
      defaultReasoningLevel: "medium",
      supportedReasoningLevels: ["low", "medium", "high"],
    },
  ];
  const service = {
    getHubPanels: () => state.studyRecipes,
    getActiveTab: () => state.tabs.find((entry) => entry.id === state.activeTabId) ?? null,
    getMaxOpenTabs: () => 6,
    getTabComposerHistory: () => ({
      entries: [],
      index: null,
      draft: null,
    }),
    setTabComposerHistory: vi.fn(),
    getTabTargetNotePath: () => null,
    setTabTargetNote: vi.fn(),
    getTabSelectionContext: () => null,
    setTabSelectionContext: vi.fn(),
    getTabAttachments: () => [],
    removeComposerAttachment: vi.fn(),
    getTabPatchBasket: () => [],
    openPatchTarget: vi.fn(),
    rejectPatchProposal: vi.fn(),
    applyPatchProposal: vi.fn(async () => {}),
    clearActivePanelContext: vi.fn(),
    getPermissionMode: () => "suggest" as const,
    getAvailableModels: () => state.availableModels,
    getTabBarPosition: () => "header" as const,
    ensureAccountUsage: vi.fn(),
    setTabModel: vi.fn((tabId: string, model: string) => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      if (tab) {
        tab.model = model;
      }
      render();
    }),
    setTabReasoningEffort: vi.fn((tabId: string, level: "low" | "medium" | "high" | "xhigh") => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      if (tab) {
        tab.reasoningEffort = level;
      }
      render();
    }),
    toggleTabLearningMode: vi.fn((tabId: string) => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      if (tab) {
        tab.learningMode = !tab.learningMode;
      }
      render();
      return tab?.learningMode ?? false;
    }),
    setTabLearningMode: vi.fn((tabId: string, enabled: boolean) => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      if (tab) {
        tab.learningMode = enabled;
      }
      render();
      return enabled;
    }),
    getMentionCandidates: () => [],
    getSlashCommandCatalog: () => [],
    getInstalledSkills: () => [],
    setTabFastMode: vi.fn(),
    setDraft: vi.fn(),
    toggleTabComposeMode: vi.fn(),
    sendPrompt: vi.fn(async () => {}),
    getStudyHubState: () => state.studyHubState,
    setStudyHubCollapsed: vi.fn(),
    interruptActiveTurn: vi.fn(async () => {}),
  };
  const composerRoot = document.createElement("div");
  document.body.append(composerRoot);
  const callbacks: WorkspaceRenderCallbacks = {
    markdownComponent: {} as never,
    openSettings: vi.fn(),
    requestRender: () => render(),
    focusComposer: vi.fn(),
    seedDraftAndSend: vi.fn(),
    respondToChatSuggestion: vi.fn(async () => {}),
    resolvePromptContext: () => ({ file: null, editor: null }),
    attachBrowserFiles: vi.fn(async () => {}),
    openTargetNote: vi.fn(async () => {}),
  };
  const composerRenderer = new ComposerRenderer(composerRoot, callbacks);

  function render(): void {
    const activeTab = state.tabs.find((entry) => entry.id === state.activeTabId) ?? null;
    const context: WorkspaceRenderContext = {
      app: { workspace: { getActiveFile: () => null } } as never,
      service: service as never,
      state,
      activeTab,
      isNarrowLayout: false,
      locale: "en",
      copy,
    };
    composerRenderer.render(context);
  }

  render();

  return {
    state,
    service,
    composerRoot,
    render,
    activateTab(tabId: string) {
      state.activeTabId = tabId;
      render();
    },
  };
}

describe("Panel Studio composer flow", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    installFocusShim();
    Notice.reset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;
    vi.stubGlobal("confirm", vi.fn(() => true));
    document.body.innerHTML = "";
  });

  it("seeds skills into the composer without sending immediately", async () => {
    const harness = createHarness();
    await tick();

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const skillButton = Array.from(harness.hubRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__suggestion-chip")).find(
      (button) => button.textContent?.trim() === "/lecture-read",
    );
    expect(skillButton).not.toBeNull();
    skillButton?.click();
    await tick();

    expect(harness.service.seedHubPanelSkills).toHaveBeenCalledTimes(1);
    expect(harness.sendPrompt).not.toHaveBeenCalled();
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input");
    expect(input?.value).toContain("/lecture-read");
    expect(input?.value).toContain("lecture study notes");
  });

  it("refreshes user-owned skills when Panel Studio opens, but shows available CLI skills only in edit mode", async () => {
    const harness = createHarness();
    await tick();

    expect(harness.service.refreshInstalledSkills).toHaveBeenCalledTimes(1);

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const drawerText = harness.hubRoot.textContent ?? "";
    expect(drawerText).toContain("lecture-read");
    expect(drawerText).not.toContain("grill-me");
    expect(drawerText).not.toContain("github:gh-fix-ci");

    const editButton = harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]');
    expect(editButton).not.toBeNull();
    editButton?.click();
    await tick();

    const editText = harness.hubRoot.textContent ?? "";
    expect(editText).toContain("grill-me");
    expect(editText).not.toContain("github:gh-fix-ci");
  });

  it("shows edit as the only header action until a panel enters edit mode", async () => {
    const harness = createHarness();
    await tick();

    const editButton = harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]');
    expect(harness.hubRoot.querySelector('[aria-label="Delete panel"]')).toBeNull();
    expect(harness.hubRoot.querySelectorAll('[data-smoke="panel-edit-toggle"]')).toHaveLength(1);
    expect(editButton?.getAttribute("aria-label")).toBe("Edit panel");
    expect(editButton?.title).toBe("Edit panel");

    editButton?.click();
    await tick();

    const saveButton = harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]');
    expect(saveButton?.getAttribute("aria-label")).toBe("Save panel");
    expect(saveButton?.title).toBe("Save panel");
    expect(harness.hubRoot.querySelector('[data-smoke="panel-edit-delete"]')).not.toBeNull();
  });

  it("opens Add panel as a floating popup and waits until save to create the panel", async () => {
    const harness = createHarness();
    await tick();

    const addButton = harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-studio-add"]');
    expect(addButton).not.toBeNull();

    addButton?.click();
    await tick();

    expect(harness.service.createHubPanel).not.toHaveBeenCalled();
    expect(harness.hubRoot.classList.contains("is-create-popover-open")).toBe(true);
    expect(harness.hubRoot.querySelector('[data-smoke="panel-create-overlay"]')).not.toBeNull();
    expect(harness.hubRoot.querySelector('[data-smoke="panel-create-popover"]')).not.toBeNull();
    expect(harness.hubRoot.querySelector(".obsidian-codex__hub-panel.is-editing")).toBeNull();
    const sections = Array.from(harness.hubRoot.querySelectorAll('[data-smoke^="panel-skill-section-"]')).map((element) => element.getAttribute("data-smoke"));
    expect(sections).toEqual(["panel-skill-section-linked", "panel-skill-section-available"]);
    expect(document.activeElement).toBe(harness.hubRoot.querySelector('[data-smoke="panel-create-title"]'));
  });

  it("creates and fills the new panel only after saving the popup draft", async () => {
    const harness = createHarness();
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-studio-add"]')?.click();
    await tick();

    const titleInput = harness.hubRoot.querySelector<HTMLInputElement>('[data-smoke="panel-create-title"]')!;
    titleInput.value = "Exam drill";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));

    const textareas = Array.from(harness.hubRoot.querySelectorAll<HTMLTextAreaElement>('[data-smoke="panel-create-popover"] textarea'));
    expect(textareas).toHaveLength(2);
    textareas[0]!.value = "Use this before the exam.";
    textareas[0]!.dispatchEvent(new Event("input", { bubbles: true }));
    textareas[1]!.value = "Turn these notes into an exam drill.";
    textareas[1]!.dispatchEvent(new Event("input", { bubbles: true }));

    const skillCheckbox = Array.from(
      harness.hubRoot.querySelectorAll<HTMLInputElement>('[data-smoke="panel-create-popover"] .obsidian-codex__panel-skill-option input[type="checkbox"]'),
    ).find((input) => input.parentElement?.dataset.skillName === "grill-me");
    expect(skillCheckbox).not.toBeNull();
    skillCheckbox!.checked = true;
    skillCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-create-save"]')?.click();
    await tick();

    expect(harness.service.createHubPanel).toHaveBeenCalledTimes(1);
    expect(harness.service.createHubPanel).toHaveBeenCalledWith({
      title: "Exam drill",
      description: "Use this before the exam.",
      promptTemplate: "Turn these notes into an exam drill.",
      linkedSkillNames: ["grill-me"],
    });
    expect(harness.service.updateHubPanel).not.toHaveBeenCalled();
    expect(harness.hubRoot.querySelector('[data-smoke="panel-create-popover"]')).toBeNull();
    expect(harness.hubRoot.textContent).toContain("Exam drill");
  });

  it("keeps an empty new-panel draft open instead of creating a blank panel", async () => {
    const harness = createHarness();
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-studio-add"]')?.click();
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-create-save"]')?.click();
    await tick();

    expect(harness.service.createHubPanel).not.toHaveBeenCalled();
    expect(harness.hubRoot.querySelector('[data-smoke="panel-create-popover"]')).not.toBeNull();
    expect(Notice.messages).toContain("Add a panel title and prompt before saving.");
  });

  it("keeps the new-panel popover open when panel creation fails", async () => {
    const harness = createHarness({ createHubPanelError: "Create failed" });
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-studio-add"]')?.click();
    await tick();

    const titleInput = harness.hubRoot.querySelector<HTMLInputElement>('[data-smoke="panel-create-title"]')!;
    titleInput.value = "Exam drill";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    const promptInput = Array.from(harness.hubRoot.querySelectorAll<HTMLTextAreaElement>('[data-smoke="panel-create-popover"] textarea'))[1]!;
    promptInput.value = "Turn these notes into an exam drill.";
    promptInput.dispatchEvent(new Event("input", { bubbles: true }));

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-create-save"]')?.click();
    await tick();

    expect(harness.service.createHubPanel).toHaveBeenCalledTimes(1);
    expect(harness.hubRoot.querySelector('[data-smoke="panel-create-popover"]')).not.toBeNull();
    expect(harness.hubRoot.querySelector<HTMLInputElement>('[data-smoke="panel-create-title"]')?.value).toBe("Exam drill");
    expect(Notice.messages).toContain("Create failed");
  });

  it("confirms before discarding a dirty new panel draft from the overlay", async () => {
    const harness = createHarness();
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-studio-add"]')?.click();
    await tick();

    const titleInput = harness.hubRoot.querySelector<HTMLInputElement>('[data-smoke="panel-create-title"]')!;
    titleInput.value = "Keep me";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));

    const overlay = harness.hubRoot.querySelector<HTMLElement>('[data-smoke="panel-create-overlay"]');
    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(confirmSpy).toHaveBeenCalledWith("Discard this new panel draft?");
    expect(harness.hubRoot.querySelector('[data-smoke="panel-create-popover"]')).not.toBeNull();
    expect(harness.service.createHubPanel).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(harness.hubRoot.querySelector('[data-smoke="panel-create-popover"]')).toBeNull();
    expect(harness.service.createHubPanel).not.toHaveBeenCalled();
  });

  it("confirms before discarding dirty inline panel edits", async () => {
    const harness = createHarness();
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]')?.click();
    await tick();

    const titleInput = harness.hubRoot.querySelector<HTMLInputElement>(".obsidian-codex__panel-edit-input-title")!;
    titleInput.value = "Dirty edit";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));

    harness.hubRoot.querySelector<HTMLButtonElement>('[aria-label="Cancel editing"]')?.click();
    await tick();

    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved panel edits?");
    expect(harness.hubRoot.querySelector(".obsidian-codex__hub-panel.is-editing")).not.toBeNull();

    confirmSpy.mockReturnValueOnce(true);
    harness.hubRoot.querySelector<HTMLButtonElement>('[aria-label="Cancel editing"]')?.click();
    await tick();

    expect(harness.hubRoot.querySelector(".obsidian-codex__hub-panel.is-editing")).toBeNull();
  });

  it("preserves the new-panel popup draft across Hub renderer reconstruction", async () => {
    const harness = createHarness();
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-studio-add"]')?.click();
    await tick();

    const titleInput = harness.hubRoot.querySelector<HTMLInputElement>('[data-smoke="panel-create-title"]')!;
    titleInput.value = "Persistent draft";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));

    const textareas = Array.from(harness.hubRoot.querySelectorAll<HTMLTextAreaElement>('[data-smoke="panel-create-popover"] textarea'));
    textareas[0]!.value = "Keep this description.";
    textareas[0]!.dispatchEvent(new Event("input", { bubbles: true }));
    textareas[1]!.value = "Keep this prompt.";
    textareas[1]!.dispatchEvent(new Event("input", { bubbles: true }));

    harness.rebuildHubRenderer();
    await tick();

    expect(harness.hubRoot.querySelector('[data-smoke="panel-create-popover"]')).not.toBeNull();
    expect(harness.hubRoot.querySelector<HTMLInputElement>('[data-smoke="panel-create-title"]')?.value).toBe("Persistent draft");
    const rebuiltTextareas = Array.from(harness.hubRoot.querySelectorAll<HTMLTextAreaElement>('[data-smoke="panel-create-popover"] textarea'));
    expect(rebuiltTextareas.map((textarea) => textarea.value)).toEqual(["Keep this description.", "Keep this prompt."]);
  });

  it("preserves inline panel edits across Hub renderer reconstruction", async () => {
    const harness = createHarness();
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]')?.click();
    await tick();

    const titleInput = harness.hubRoot.querySelector<HTMLInputElement>(".obsidian-codex__panel-edit-input-title")!;
    titleInput.value = "Edited title";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));

    harness.rebuildHubRenderer();
    await tick();

    expect(harness.hubRoot.querySelector(".obsidian-codex__hub-panel.is-editing")).not.toBeNull();
    expect(harness.hubRoot.querySelector<HTMLInputElement>(".obsidian-codex__panel-edit-input-title")?.value).toBe("Edited title");
  });

  it("keeps panel edits open when saving the panel fails", async () => {
    const harness = createHarness({ updateHubPanelError: "Save failed" });
    await tick();

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]')?.click();
    await tick();

    const titleInput = harness.hubRoot.querySelector<HTMLInputElement>(".obsidian-codex__panel-edit-input-title")!;
    titleInput.value = "Edited title";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]')?.click();
    await tick();

    expect(harness.service.updateHubPanel).toHaveBeenCalledTimes(1);
    expect(harness.hubRoot.querySelector(".obsidian-codex__hub-panel.is-editing")).not.toBeNull();
    expect(harness.hubRoot.querySelector<HTMLInputElement>(".obsidian-codex__panel-edit-input-title")?.value).toBe("Edited title");
    expect(Notice.messages).toContain("Save failed");
  });

  it("opens the skills drawer as a panel-local popover", async () => {
    const harness = createHarness();
    await tick();

    const actions = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__hub-panel-card-actions");
    expect(actions?.children[0]?.classList.contains("obsidian-codex__change-card-btn")).toBe(true);
    expect(actions?.children[1]?.classList.contains("obsidian-codex__hub-panel-skill-control")).toBe(true);

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const panelStudio = harness.hubRoot;
    const openPanel = harness.hubRoot.querySelector<HTMLDivElement>('.obsidian-codex__hub-panel[data-panel-id="panel-1"]');
    const popover = harness.hubRoot.querySelector<HTMLDivElement>('[data-smoke="panel-skill-popover"]');
    expect(panelStudio?.classList.contains("is-skill-drawer-open")).toBe(false);
    expect(openPanel?.classList.contains("is-skills-open")).toBe(true);
    expect(popover).not.toBeNull();
    expect(popover?.parentElement?.classList.contains("obsidian-codex__hub-panel-skill-control")).toBe(true);
    expect(popover?.classList.contains("is-open-up")).toBe(true);
  });

  it("closes the skills popover when the same Skills button is pressed again", async () => {
    const harness = createHarness();
    await tick();

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();

    toggleButton?.click();
    await tick();
    expect(harness.hubRoot.querySelector('[data-smoke="panel-skill-popover"]')).not.toBeNull();

    toggleButton?.click();
    await tick();

    expect(harness.hubRoot.querySelector('[data-smoke="panel-skill-popover"]')).toBeNull();
  });

  it("closes the skills popover on outside click", async () => {
    const harness = createHarness();
    await tick();

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await tick();

    expect(harness.hubRoot.querySelector('[data-smoke="panel-skill-popover"]')).toBeNull();
  });

  it("closes the skills popover with Escape and restores focus to the trigger", async () => {
    const harness = createHarness();
    await tick();

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const popover = harness.hubRoot.querySelector<HTMLDivElement>('[data-smoke="panel-skill-popover"]');
    expect(popover).not.toBeNull();
    popover?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();

    expect(harness.hubRoot.querySelector('[data-smoke="panel-skill-popover"]')).toBeNull();
    expect(document.activeElement).toBe(harness.hubRoot.querySelector(".obsidian-codex__hub-panel-skill-toggle"));
  });

  it("flips the skills popover downward when there is not enough room above", async () => {
    const harness = createHarness();
    await tick();

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList.contains("obsidian-codex__hub-panel-skill-drawer")) {
          return 260;
        }
        return 0;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function getBoundingClientRect(this: HTMLElement) {
        if (this.classList.contains("obsidian-codex__ingest-hub-body")) {
          return { top: 100, bottom: 520, left: 0, right: 420, width: 420, height: 420, x: 0, y: 100, toJSON() { return {}; } };
        }
        if (this.classList.contains("obsidian-codex__hub-panel-skill-control")) {
          return { top: 120, bottom: 148, left: 24, right: 180, width: 156, height: 28, x: 24, y: 120, toJSON() { return {}; } };
        }
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() { return {}; } };
      },
    });

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const popover = harness.hubRoot.querySelector<HTMLDivElement>('[data-smoke="panel-skill-popover"]');
    expect(popover?.classList.contains("is-open-down")).toBe(true);
  });

  it("keeps the exact Hub scroll position when selecting skills in the drawer", async () => {
    const harness = createHarness();
    await tick();

    let skillOffsetTop = 260;
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.dataset.skillName === "lecture-read") {
          return skillOffsetTop;
        }
        return 0;
      },
    });

    const originalRequestRender = harness.callbacks.requestRender;
    let renderCount = 0;
    harness.callbacks.requestRender = () => {
      renderCount += 1;
      if (renderCount >= 2) {
        skillOffsetTop = 340;
      }
      originalRequestRender();
    };

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const hubBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(hubBody).not.toBeNull();
    hubBody!.scrollTop = 180;
    hubBody!.dispatchEvent(new Event("scroll"));

    const checkbox = Array.from(harness.hubRoot.querySelectorAll<HTMLInputElement>(".obsidian-codex__hub-panel-skill-checkbox")).find(
      (input) => input.getAttribute("aria-label") === "lecture-read",
    );
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    const rerenderedBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(rerenderedBody).not.toBeNull();
    expect(rerenderedBody!.scrollTop).toBe(180);
  });

  it("keeps drawer checkbox changes local until Use selected is pressed", async () => {
    const harness = createHarness();
    await tick();

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const checkbox = Array.from(harness.hubRoot.querySelectorAll<HTMLInputElement>(".obsidian-codex__hub-panel-skill-checkbox")).find(
      (input) => input.getAttribute("aria-label") === "lecture-read",
    );
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    expect(harness.service.commitHubPanelSkillSelection).not.toHaveBeenCalled();
    expect(harness.service.seedHubPanelSkills).not.toHaveBeenCalled();
    expect(harness.activeTab.activeStudySkillNames).toEqual([]);

    const useSelectedButton = Array.from(harness.hubRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__change-card-btn")).find(
      (button) => button.textContent?.trim() === "Use selected",
    );
    expect(useSelectedButton).not.toBeNull();
    expect(useSelectedButton?.disabled).toBe(false);
    useSelectedButton?.click();
    await tick();

    expect(harness.service.seedHubPanelSkills).toHaveBeenCalledWith("tab-1", "panel-1", ["lecture-read"], null, { mode: "replace" });
    expect(harness.activeTab.activeStudySkillNames).toEqual(["lecture-read"]);
  });

  it("closes the skills popover after seeding a single linked skill", async () => {
    const harness = createHarness();
    await tick();

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const skillButton = Array.from(harness.hubRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__suggestion-chip")).find(
      (button) => button.textContent?.trim() === "/lecture-read",
    );
    expect(skillButton).not.toBeNull();
    skillButton?.click();
    await tick();

    expect(harness.hubRoot.querySelector('[data-smoke="panel-skill-popover"]')).toBeNull();
  });

  it("closes the skills popover after using selected skills", async () => {
    const harness = createHarness();
    await tick();

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const checkbox = harness.hubRoot.querySelector<HTMLInputElement>(".obsidian-codex__hub-panel-skill-checkbox");
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    const useSelectedButton = Array.from(harness.hubRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__change-card-btn")).find(
      (button) => button.textContent?.trim() === "Use selected",
    );
    expect(useSelectedButton).not.toBeNull();
    useSelectedButton?.click();
    await tick();

    expect(harness.hubRoot.querySelector('[data-smoke="panel-skill-popover"]')).toBeNull();
  });

  it("keeps the exact Hub scroll position when moving a skill between editor sections", async () => {
    const harness = createHarness();
    await tick();

    let skillOffsetTop = 260;
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.dataset.skillName === "grill-me") {
          return skillOffsetTop;
        }
        return 0;
      },
    });

    const originalRequestRender = harness.callbacks.requestRender;
    let renderCount = 0;
    harness.callbacks.requestRender = () => {
      renderCount += 1;
      if (renderCount >= 2) {
        skillOffsetTop = 340;
      }
      originalRequestRender();
    };

    const editButton = harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]');
    expect(editButton).not.toBeNull();
    editButton?.click();
    await tick();

    const hubBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(hubBody).not.toBeNull();
    hubBody!.scrollTop = 180;
    hubBody!.dispatchEvent(new Event("scroll"));

    const checkbox = Array.from(
      harness.hubRoot.querySelectorAll<HTMLInputElement>('.obsidian-codex__panel-skill-picker input[type="checkbox"]'),
    ).find((input) => input.parentElement?.dataset.skillName === "grill-me");
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    const rerenderedBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(rerenderedBody).not.toBeNull();
    expect(rerenderedBody!.scrollTop).toBe(180);
    const sections = Array.from(harness.hubRoot.querySelectorAll('[data-smoke^="panel-skill-section-"]')).map((element) => element.getAttribute("data-smoke"));
    expect(sections).toEqual(["panel-skill-section-linked", "panel-skill-section-available"]);
  });

  it("preserves the inline editor available skills scroll position after selecting a skill", async () => {
    const harness = createHarness();
    await tick();

    let skillOffsetTop = 140;
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        const skillName = this.dataset.skillName;
        if (skillName === "grill-me") {
          return 110;
        }
        if (skillName === "study-drill") {
          return skillOffsetTop;
        }
        return 0;
      },
    });
    const originalRequestRender = harness.callbacks.requestRender;
    let renderCount = 0;
    harness.callbacks.requestRender = () => {
      renderCount += 1;
      if (renderCount >= 2) {
        skillOffsetTop = 220;
      }
      originalRequestRender();
    };

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]')?.click();
    await tick();

    const availableList = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__panel-skill-picker-list--available");
    expect(availableList).not.toBeNull();
    const hubBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(hubBody).not.toBeNull();
    hubBody!.scrollTop = 180;
    hubBody!.dispatchEvent(new Event("scroll"));
    availableList!.scrollTop = 120;
    availableList!.dispatchEvent(new Event("scroll"));

    const checkbox = Array.from(availableList!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
      (input) => input.parentElement?.dataset.skillName === "grill-me",
    );
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    const rerenderedAvailableList = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__panel-skill-picker-list--available");
    expect(rerenderedAvailableList).not.toBeNull();
    expect(rerenderedAvailableList!.scrollTop).toBe(200);
    const rerenderedBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(rerenderedBody).not.toBeNull();
    expect(rerenderedBody!.scrollTop).toBe(180);
  });

  it("preserves the inline editor linked skills scroll position after moving a skill back to available", async () => {
    const harness = createHarness();
    await tick();

    let skillOffsetTop = 100;
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.dataset.skillName === "lecture-read") {
          return skillOffsetTop;
        }
        return this.dataset.skillName === "grill-me" ? 120 : 0;
      },
    });
    const originalRequestRender = harness.callbacks.requestRender;
    let renderCount = 0;
    harness.callbacks.requestRender = () => {
      renderCount += 1;
      if (renderCount >= 3) {
        skillOffsetTop = 180;
      }
      originalRequestRender();
    };

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-edit-toggle"]')?.click();
    await tick();

    const availableCheckbox = Array.from(
      harness.hubRoot.querySelectorAll<HTMLInputElement>(".obsidian-codex__panel-skill-picker-list--available input[type='checkbox']"),
    ).find((input) => input.parentElement?.dataset.skillName === "grill-me");
    expect(availableCheckbox).not.toBeNull();
    availableCheckbox!.checked = true;
    availableCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    const linkedList = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__panel-skill-picker-list--linked");
    expect(linkedList).not.toBeNull();
    const hubBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(hubBody).not.toBeNull();
    hubBody!.scrollTop = 180;
    hubBody!.dispatchEvent(new Event("scroll"));
    linkedList!.scrollTop = 90;
    linkedList!.dispatchEvent(new Event("scroll"));

    const linkedCheckbox = Array.from(linkedList!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
      (input) => input.parentElement?.dataset.skillName === "grill-me",
    );
    expect(linkedCheckbox).not.toBeNull();
    linkedCheckbox!.checked = false;
    linkedCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    const rerenderedLinkedList = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__panel-skill-picker-list--linked");
    expect(rerenderedLinkedList).not.toBeNull();
    expect(rerenderedLinkedList!.scrollTop).toBe(170);
    const rerenderedBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(rerenderedBody).not.toBeNull();
    expect(rerenderedBody!.scrollTop).toBe(180);
  });

  it("preserves the create-panel available skills scroll position after selecting a skill", async () => {
    const harness = createHarness();
    await tick();

    let skillOffsetTop = 150;
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        const skillName = this.dataset.skillName;
        if (skillName === "lecture-read") {
          return 130;
        }
        if (skillName === "grill-me") {
          return skillOffsetTop;
        }
        return 0;
      },
    });
    const originalRequestRender = harness.callbacks.requestRender;
    let renderCount = 0;
    harness.callbacks.requestRender = () => {
      renderCount += 1;
      if (renderCount >= 2) {
        skillOffsetTop = 260;
      }
      originalRequestRender();
    };

    harness.hubRoot.querySelector<HTMLButtonElement>('[data-smoke="panel-studio-add"]')?.click();
    await tick();

    const popover = harness.hubRoot.querySelector<HTMLElement>('[data-smoke="panel-create-popover"]');
    expect(popover).not.toBeNull();
    const availableList = popover!.querySelector<HTMLDivElement>(".obsidian-codex__panel-skill-picker-list--available");
    expect(availableList).not.toBeNull();
    const hubBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(hubBody).not.toBeNull();
    hubBody!.scrollTop = 180;
    hubBody!.dispatchEvent(new Event("scroll"));
    availableList!.scrollTop = 140;
    availableList!.dispatchEvent(new Event("scroll"));

    const checkbox = Array.from(availableList!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
      (input) => input.parentElement?.dataset.skillName === "lecture-read",
    );
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    const rerenderedPopover = harness.hubRoot.querySelector<HTMLElement>('[data-smoke="panel-create-popover"]');
    const rerenderedAvailableList = rerenderedPopover?.querySelector<HTMLDivElement>(".obsidian-codex__panel-skill-picker-list--available");
    expect(rerenderedAvailableList).not.toBeNull();
    expect(rerenderedAvailableList!.scrollTop).toBe(250);
    const rerenderedBody = harness.hubRoot.querySelector<HTMLDivElement>(".obsidian-codex__ingest-hub-body");
    expect(rerenderedBody).not.toBeNull();
    expect(rerenderedBody!.scrollTop).toBe(180);
  });

  it("sends once, shows busy state, and collapses Panel Studio only after success", async () => {
    const harness = createHarness();

    harness.service.seedHubPanelSkills("tab-1", "panel-1", ["lecture-read"]);
    await tick();

    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;
    const sendButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__send-btn")!;
    const attachButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__attach-btn")!;

    const sendPromise = (async () => {
      sendButton.click();
      await tick();
    })();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();

    expect(harness.sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendButton.disabled).toBe(false);
    expect(attachButton.disabled).toBe(true);
    expect(sendButton.classList.contains("is-busy")).toBe(true);
    expect(harness.state.studyHubState.isCollapsed).toBe(false);

    harness.sendGate.resolve();
    await sendPromise;
    await tick();

    expect(harness.state.studyHubState.isCollapsed).toBe(true);
  });

  it("does not interrupt the active turn when Ctrl+C is pressed in the composer", async () => {
    const harness = createHarness();
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true }));
    await tick();

    expect(harness.service.interruptActiveTurn).not.toHaveBeenCalled();
  });

  it("shows built-in and reusable slash commands from the main catalog", async () => {
    const harness = createHarness({
      slashCommands: [
        {
          command: "/note",
          label: "Current note",
          description: "Attach the open note before your question.",
          source: "builtin",
          mode: "context",
        },
        {
          command: "/lecture",
          label: "Lecture",
          description: "Seed a lecture prompt.",
          source: "custom_prompt",
          mode: "prompt",
        },
        {
          command: "/lecture-read",
          label: "lecture-read",
          description: "Read lecture material deeply.",
          source: "skill_alias",
          mode: "skill_alias",
        },
      ],
    });
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;

    input.click();
    await tick();
    input.value = "/";
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();

    const menuText = harness.composerRoot.querySelector(".obsidian-codex__slash-menu")?.textContent ?? "";
    expect(menuText).toContain("/note");
    expect(menuText).toContain("/lecture");
    expect(menuText).toContain("/lecture-read");
  });

  it("turns the send button into the only stop control while a turn is running", async () => {
    const harness = createHarness();
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;
    const sendButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__send-btn")!;

    input.value = "Interrupt this turn.";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();

    sendButton.click();
    await tick();

    expect(sendButton.classList.contains("is-busy")).toBe(true);
    expect(sendButton.disabled).toBe(false);
    expect(sendButton.getAttribute("title")).toContain("Interrupt");
    expect(harness.composerRoot.querySelector('[data-smoke="composer-interrupt"]')).toBeNull();
    expect(harness.composerRoot.querySelector('[data-smoke="composer-stop"]')).toBeNull();

    sendButton.click();
    await tick();
    expect(harness.service.interruptActiveTurn).toHaveBeenCalledWith("tab-1");

    harness.sendGate.resolve();
    await tick();
    await tick();

    expect(sendButton.classList.contains("is-busy")).toBe(false);
    expect(sendButton.getAttribute("title")).toBe("Send");
  });

  it("keeps Panel Studio open when sending fails", async () => {
    const harness = createHarness({ rejectSend: true });

    harness.service.seedHubPanelSkills("tab-1", "panel-1", ["lecture-read"]);
    await tick();

    const sendButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__send-btn")!;
    sendButton.click();
    await tick();

    harness.sendGate.resolve();
    await tick();
    await tick();

    expect(harness.sendPrompt).toHaveBeenCalledTimes(1);
    expect(harness.state.studyHubState.isCollapsed).toBe(false);
    expect(Notice.messages).toContain("Send failed");
  });

  it("toggles learning mode from the dedicated status control", async () => {
    const harness = createHarness();
    const learningModeButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__learning-mode-control")!;

    learningModeButton.click();
    await tick();

    expect(harness.service.toggleTabLearningMode).toHaveBeenCalledWith("tab-1");
    expect(harness.state.tabs[0]!.learningMode).toBe(true);
    expect(learningModeButton.classList.contains("is-active")).toBe(true);
  });

  it("closes the model menu when ownership changes to another active tab", async () => {
    const harness = createMultiTabComposerHarness();
    const modelButton = harness.composerRoot.querySelector<HTMLButtonElement>('[data-smoke="composer-model-trigger"]')!;

    modelButton.click();
    await tick();
    expect(harness.composerRoot.querySelector(".obsidian-codex__status-menu")).not.toBeNull();

    harness.activateTab("tab-2");
    await tick();

    expect(harness.composerRoot.querySelector(".obsidian-codex__status-menu")).toBeNull();
  });

  it("ignores stale model menu clicks after the active tab changes", async () => {
    const harness = createMultiTabComposerHarness();
    const modelButton = harness.composerRoot.querySelector<HTMLButtonElement>('[data-smoke="composer-model-trigger"]')!;

    modelButton.click();
    await tick();

    const detachedOption = Array.from(harness.composerRoot.querySelectorAll<HTMLDivElement>(".obsidian-codex__status-menu-item")).find((item) =>
      item.textContent?.includes("GPT-5.4"),
    );
    expect(detachedOption).not.toBeNull();

    harness.activateTab("tab-2");
    await tick();
    detachedOption?.click();

    expect(harness.service.setTabModel).not.toHaveBeenCalled();
    expect(harness.state.tabs.find((tab) => tab.id === "tab-1")?.model).toBe("gpt-5.5");
  });

  it("renders tab badges above the composer when the placement is set to composer", async () => {
    const harness = createHarness({ tabBarPosition: "composer" });
    await tick();

    const composerTabBar = harness.composerRoot.querySelector<HTMLDivElement>(".obsidian-codex__composer-tab-bar");
    expect(composerTabBar?.classList.contains("is-visible")).toBe(true);
    expect(composerTabBar?.querySelectorAll(".obsidian-codex__tab-badge").length).toBe(1);
  });

  it("does not force tab badges above the composer in narrow layout when the setting is header", async () => {
    const harness = createHarness({ tabBarPosition: "header", isNarrowLayout: true });
    await tick();

    const composerTabBar = harness.composerRoot.querySelector<HTMLDivElement>(".obsidian-codex__composer-tab-bar");
    expect(composerTabBar?.classList.contains("is-visible")).toBe(false);
    expect(composerTabBar?.querySelectorAll(".obsidian-codex__tab-badge").length ?? 0).toBe(0);
  });

  it("keeps a compact two-column status layout when the shared layout is narrow", async () => {
    const harness = createHarness({ isNarrowLayout: true });
    await tick();

    const statusBar = harness.composerRoot.querySelector<HTMLDivElement>(".obsidian-codex__status-bar");
    const statusPrimary = harness.composerRoot.querySelector<HTMLDivElement>(".obsidian-codex__status-primary");
    const statusControls = harness.composerRoot.querySelector<HTMLDivElement>(".obsidian-codex__status-controls");
    const modelButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__status-picker-model");
    const thinkingButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__status-picker-thinking");
    const usageMeters = harness.composerRoot.querySelector<HTMLDivElement>(".obsidian-codex__usage-meters");
    const statusToggles = harness.composerRoot.querySelector<HTMLDivElement>(".obsidian-codex__status-toggles");
    expect(statusBar?.classList.contains("is-narrow")).toBe(false);
    expect(statusPrimary?.parentElement).toBe(statusBar);
    expect(modelButton?.closest(".obsidian-codex__status-controls")).toBe(statusControls);
    expect(thinkingButton?.parentElement).toBe(statusControls);
    expect(usageMeters?.parentElement).toBe(statusBar);
    expect(statusToggles).not.toBeNull();
    expect(statusToggles?.parentElement).toBe(statusBar);
    expect(statusToggles?.querySelectorAll("button").length).toBe(3);
  });

  it("hides the workflow brief modifier row when no modifiers are active", async () => {
    const harness = createHarness();
    harness.activeTab.activeStudyRecipeId = "panel-1";
    harness.activeTab.activeStudySkillNames = ["lecture-read"];
    harness.renderAll();
    await tick();

    const workflowBrief = harness.composerRoot.querySelector<HTMLDivElement>(".obsidian-codex__workflow-brief");
    expect(workflowBrief?.classList.contains("is-visible")).toBe(true);
    expect(workflowBrief?.textContent).toContain("Lecture");
    expect(workflowBrief?.textContent).toContain("/lecture-read");
    expect(workflowBrief?.querySelector(".obsidian-codex__workflow-brief-modifiers")).toBeNull();
  });

  it("renders patch evidence as summary citations with numbered references", async () => {
    const harness = createHarness();
    const proposal: PatchProposal = {
      id: "patch-1",
      threadId: null,
      sourceMessageId: "assistant-1",
      originTurnId: "turn-1",
      targetPath: "courses/lecture-15.md",
      kind: "update",
      baseSnapshot: "# Before",
      proposedText: "# After",
      unifiedDiff: "@@ -1 +1 @@",
      summary: "Normalize LaTeX notation and tighten headings.",
      status: "pending",
      createdAt: 1,
      evidence: [
        {
          kind: "vault_note",
          label: "Lecture 15",
          sourceRef: "courses/lecture-15.md",
          snippet: "Faraday law is introduced in integral form.",
        },
        {
          kind: "web",
          label: "NIST reference",
          sourceRef: "https://www.nist.gov/",
          snippet: "Notation reference used to normalize symbols.",
        },
      ],
    };
    harness.service.getTabPatchBasket = () => [proposal];
    harness.renderAll();
    await tick();

    const summary = harness.composerRoot.querySelector(".obsidian-codex__change-card-summary");
    const evidenceRows = Array.from(harness.composerRoot.querySelectorAll(".obsidian-codex__change-card-evidence-item")).map((entry) =>
      entry.textContent?.replace(/\s+/g, " ").trim(),
    );

    expect(summary?.textContent).toContain("Normalize LaTeX notation and tighten headings.[1][2]");
    expect(harness.composerRoot.textContent).toContain("Web-backed");
    expect(evidenceRows).toEqual([
      '[1]Lecture 15: "Faraday law is introduced in integral form."',
      '[2]NIST reference: "Notation reference used to normalize symbols."',
    ]);
  });

  it("shows a readability warning for review-required patches", async () => {
    const harness = createHarness();
    const proposal: PatchProposal = {
      id: "patch-1",
      threadId: null,
      sourceMessageId: "assistant-1",
      originTurnId: "turn-1",
      targetPath: "courses/lecture-15.md",
      kind: "update",
      baseSnapshot: "# Before",
      proposedText: "# After",
      unifiedDiff: "@@ -1 +1 @@",
      summary: "Normalize LaTeX notation and tighten headings.",
      status: "pending",
      createdAt: 1,
      qualityState: "review_required",
      qualityIssues: [{ code: "display_math_single_dollar", line: 4 }],
    };
    harness.service.getTabPatchBasket = () => [proposal];
    harness.renderAll();
    await tick();

    expect(harness.composerRoot.textContent).toContain("Review required: Markdown readability risk.");
    expect(harness.composerRoot.textContent).toContain("Line 4: Use `$$` for display-math delimiter lines.");
  });

  it("shows the auto-healed warning copy for normalized patches waiting for review", async () => {
    const harness = createHarness();
    const proposal: PatchProposal = {
      id: "patch-2",
      threadId: null,
      sourceMessageId: "assistant-2",
      originTurnId: "turn-2",
      targetPath: "courses/lecture-15.md",
      kind: "update",
      baseSnapshot: "# Before",
      proposedText: "# After",
      unifiedDiff: "@@ -1 +1 @@",
      summary: "Normalize quoted display math.",
      status: "pending",
      createdAt: 2,
      qualityState: "auto_healed",
      qualityIssues: [],
      healedByPlugin: true,
    };
    harness.service.getTabPatchBasket = () => [proposal];
    harness.renderAll();
    await tick();

    expect(harness.composerRoot.textContent).toContain("Plugin normalized Markdown structure. Review it before applying.");
  });

  it("shows blocked patch safety copy and allows confirmed full replacement apply without moving controls", async () => {
    const harness = createHarness();
    const proposal: PatchProposal = {
      id: "patch-blocked-1",
      threadId: null,
      sourceMessageId: "assistant-blocked",
      originTurnId: "turn-blocked",
      targetPath: "courses/lecture-15.md",
      kind: "update",
      baseSnapshot: "# Before\n\nExisting content",
      proposedText: "# After",
      unifiedDiff: "@@ -1,3 +1 @@",
      summary: "Add supporting derivation.",
      status: "blocked",
      createdAt: 3,
      intent: "augment",
      safetyIssues: [{ code: "unsafe_full_update", detail: "content_update_without_anchors" }],
    };
    harness.service.getTabPatchBasket = () => [proposal];
    harness.renderAll();
    await tick();

    expect(harness.composerRoot.textContent).toContain("Blocked: this patch could remove existing note content.");
    expect(harness.composerRoot.textContent).toContain("Existing note content is protected unless full replacement is explicit.");
    const buttons = Array.from(harness.composerRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__change-card-btn"));
    expect(buttons.map((button) => button.textContent)).toEqual(["Open", "Reject", "Apply"]);
    const applyButton = buttons.find((button) => button.textContent === "Apply");
    expect(applyButton?.disabled).toBe(false);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    applyButton?.click();
    await tick();

    expect(confirmSpy).toHaveBeenCalledWith("Apply this full-note replacement? Existing note content may be removed.");
    expect(harness.service.applyPatchProposal).toHaveBeenCalledWith("tab-1", "patch-blocked-1", {
      allowUnsafeFullReplace: true,
    });
    confirmSpy.mockRestore();
  });

  it("summarizes many patch issues compactly while keeping patch actions reachable", async () => {
    const harness = createHarness();
    const proposal: PatchProposal = {
      id: "patch-many-issues-1",
      threadId: null,
      sourceMessageId: "assistant-many-issues",
      originTurnId: "turn-many-issues",
      targetPath: "courses/lecture-15.md",
      kind: "update",
      baseSnapshot: "# Before",
      proposedText: "# After",
      unifiedDiff: "@@ -1 +1 @@",
      summary: "Add derivation with callout math.",
      status: "pending",
      createdAt: 4,
      qualityState: "review_required",
      qualityIssues: [
        ...Array.from({ length: 7 }, (_, index) => ({
          code: "mixed_display_math_context" as const,
          line: 107 + index * 10,
          detail: "quote_1->plain",
        })),
        { code: "math_delimiter_marker_collision", line: 102, detail: "quoted:> - BJT の small-signal" },
        { code: "display_math_same_line_delimiter", line: 102, detail: "> $$> - BJT の small-signal" },
        { code: "unmatched_display_math", line: 214, detail: "plain" },
        { code: "adjacent_block_spacing", line: 220, detail: "missing_blank_line_after_math_block" },
        { code: "display_math_single_dollar", line: 230, detail: null },
      ],
    };
    harness.service.getTabPatchBasket = () => [proposal];
    harness.renderAll();
    await tick();

    const issueRows = Array.from(harness.composerRoot.querySelectorAll<HTMLElement>(".obsidian-codex__change-card-issue"));
    expect(issueRows).toHaveLength(2);
    expect(issueRows[0]?.textContent).toContain("Lines 107, 117, 127 +4");
    expect(issueRows[0]?.textContent).toContain("Keep math delimiters in the same callout/quote context.");
    expect(issueRows[0]?.title).toContain("Line 107");
    expect(issueRows[1]?.textContent).toBe("+5 more issues");

    const buttons = Array.from(harness.composerRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__change-card-btn"));
    expect(buttons.map((button) => button.textContent)).toEqual(["Open", "Reject", "Apply"]);
  });

  it("keeps the changes tray and issue list internally scrollable through CSS", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/40-cards-and-hub-details.css"), "utf8");

    expect(css).toContain(".obsidian-codex__changes-tray.is-visible");
    expect(css).toContain("max-height: min(38dvh, 360px)");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("overscroll-behavior: contain");
    expect(css).toContain(".obsidian-codex__changes-tray-header");
    expect(css).toContain("position: sticky");
    expect(css).toContain(".obsidian-codex__change-card-issues");
    expect(css).toContain("max-height: 118px");
    expect(css).toContain("max-height: 76px");
  });

  it("disables the patch apply button while the apply action is in flight", async () => {
    const harness = createHarness();
    const applyGate = createDeferred<void>();
    const proposal: PatchProposal = {
      id: "patch-apply-1",
      threadId: null,
      sourceMessageId: "assistant-1",
      originTurnId: "turn-1",
      targetPath: "courses/lecture-15.md",
      kind: "update",
      baseSnapshot: "# Before",
      proposedText: "# After",
      unifiedDiff: "@@ -1 +1 @@",
      summary: "Apply this patch once.",
      status: "pending",
      createdAt: 1,
    };
    harness.service.getTabPatchBasket = () => [proposal];
    harness.service.applyPatchProposal.mockImplementation(() => applyGate.promise);
    harness.renderAll();
    await tick();

    const applyButton = Array.from(harness.composerRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__change-card-btn")).find(
      (button) => button.textContent === "Apply",
    );
    expect(applyButton).not.toBeNull();

    applyButton!.click();
    applyButton!.click();
    await tick();

    expect(harness.service.applyPatchProposal).toHaveBeenCalledTimes(1);
    expect(applyButton!.disabled).toBe(true);

    applyGate.resolve();
    await tick();
    await tick();
  });

  it("disables patch rejection while the apply action is in flight", async () => {
    const harness = createHarness();
    const applyGate = createDeferred<void>();
    const proposal: PatchProposal = {
      id: "patch-apply-2",
      threadId: null,
      sourceMessageId: "assistant-1",
      originTurnId: "turn-1",
      targetPath: "courses/lecture-15.md",
      kind: "update",
      baseSnapshot: "# Before",
      proposedText: "# After",
      unifiedDiff: "@@ -1 +1 @@",
      summary: "Apply this patch once.",
      status: "pending",
      createdAt: 1,
    };
    harness.service.getTabPatchBasket = () => [proposal];
    harness.service.applyPatchProposal.mockImplementation(() => applyGate.promise);
    harness.renderAll();
    await tick();

    const buttons = Array.from(harness.composerRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__change-card-btn"));
    const rejectButton = buttons.find((button) => button.textContent === "Reject");
    const applyButton = buttons.find((button) => button.textContent === "Apply");
    expect(rejectButton).not.toBeNull();
    expect(applyButton).not.toBeNull();

    applyButton!.click();
    await tick();

    const refreshedRejectButton = Array.from(
      harness.composerRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__change-card-btn"),
    ).find((button) => button.textContent === "Reject");

    expect(refreshedRejectButton?.disabled).toBe(true);
    refreshedRejectButton?.click();
    expect(harness.service.rejectPatchProposal).not.toHaveBeenCalled();

    applyGate.resolve();
    await tick();
    await tick();
  });

  it("focuses the textarea when the input row is clicked", async () => {
    const harness = createHarness();
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;

    expect(document.activeElement).not.toBe(input);

    input.click();
    await tick();

    expect(document.activeElement).toBe(input);
  });

  it("shows execution state and the plan warning when plan mode is armed", async () => {
    const harness = createHarness({
      permissionMode: "full-auto",
      composeMode: "plan",
    });
    await tick();

    const executionState = harness.composerRoot.querySelector<HTMLElement>('[data-smoke="composer-execution-state"]');
    const planWarning = harness.composerRoot.querySelector<HTMLElement>('[data-smoke="composer-plan-warning"]');

    expect(executionState?.textContent).toBe("Ready to implement");
    expect(planWarning?.classList.contains("is-visible")).toBe(true);
    expect(planWarning?.textContent).toContain("Plan mode stays read-only");
  });

  it("lets Auto-apply leave Read only mode from the status control", async () => {
    const harness = createHarness({ permissionMode: "suggest" });
    await tick();

    const yoloButton = harness.composerRoot.querySelector<HTMLButtonElement>('[data-smoke="composer-yolo"]');
    expect(yoloButton).not.toBeNull();
    expect(yoloButton?.disabled).toBe(false);
    expect(yoloButton?.classList.contains("is-active")).toBe(false);

    yoloButton?.click();
    await tick();

    expect(harness.service.setPermissionMode).toHaveBeenCalledWith("full-auto");
    expect(yoloButton?.classList.contains("is-active")).toBe(true);
  });

  it("disables status controls and closes the picker while a send is pending before the tab flips busy", async () => {
    const harness = createHarness({ preserveReadyStatusWhileSending: true });
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;
    const modelButton = harness.composerRoot.querySelector<HTMLButtonElement>('[data-smoke="composer-model-trigger"]')!;
    const thinkingButton = harness.composerRoot.querySelector<HTMLButtonElement>('[data-smoke="composer-thinking-trigger"]')!;
    const learningModeButton = harness.composerRoot.querySelector<HTMLButtonElement>('[data-smoke="composer-learning-mode"]')!;
    const fastModeButton = harness.composerRoot.querySelector<HTMLButtonElement>('[data-smoke="composer-fastmode"]')!;
    const yoloButton = harness.composerRoot.querySelector<HTMLButtonElement>('[data-smoke="composer-yolo"]')!;
    const sendButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__send-btn")!;

    input.value = "Keep working on this.";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();

    modelButton.click();
    await tick();
    expect(harness.composerRoot.querySelector(".obsidian-codex__status-menu")).not.toBeNull();
    expect(harness.activeTab.status).toBe("ready");

    sendButton.click();
    await tick();

    expect(harness.sendPrompt).toHaveBeenCalledTimes(1);
    expect(harness.activeTab.status).toBe("ready");
    expect(modelButton.disabled).toBe(true);
    expect(thinkingButton.disabled).toBe(true);
    expect(learningModeButton.disabled).toBe(true);
    expect(fastModeButton.disabled).toBe(true);
    expect(yoloButton.disabled).toBe(true);
    expect(harness.composerRoot.querySelector(".obsidian-codex__status-menu")).toBeNull();

    harness.sendGate.resolve();
    await tick();
    await tick();

    expect(modelButton.disabled).toBe(false);
    expect(thinkingButton.disabled).toBe(false);
    expect(learningModeButton.disabled).toBe(false);
    expect(fastModeButton.disabled).toBe(false);
    expect(yoloButton.disabled).toBe(false);
  });

  it("closes the slash menu and keeps it hidden while a send is pending before the tab flips busy", async () => {
    const harness = createHarness({
      preserveReadyStatusWhileSending: true,
      slashCommands: [
        {
          command: "/lecture",
          label: "Lecture",
          description: "Seed a lecture prompt.",
          source: "builtin",
          mode: "prompt",
        },
      ],
    });
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;
    const sendButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__send-btn")!;

    input.click();
    await tick();
    input.value = "/";
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();

    expect(harness.composerRoot.querySelector(".obsidian-codex__slash-menu.is-visible")).not.toBeNull();
    expect(harness.composerRoot.classList.contains("has-slash-menu")).toBe(true);

    sendButton.click();
    await tick();

    expect(harness.sendPrompt).toHaveBeenCalledTimes(1);
    expect(harness.activeTab.status).toBe("ready");
    expect(harness.composerRoot.querySelector(".obsidian-codex__slash-menu.is-visible")).toBeNull();
    expect(harness.composerRoot.classList.contains("has-slash-menu")).toBe(false);

    input.value = "/lecture";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();

    expect(harness.composerRoot.querySelector(".obsidian-codex__slash-menu.is-visible")).toBeNull();
    expect(harness.composerRoot.classList.contains("has-slash-menu")).toBe(false);

    harness.sendGate.resolve();
    await tick();
    await tick();
  });

  it("toggles Fast mode from the fixed status control", async () => {
    const harness = createHarness();
    await tick();

    const fastModeButton = harness.composerRoot.querySelector<HTMLButtonElement>('[data-smoke="composer-fastmode"]');
    expect(fastModeButton).not.toBeNull();
    expect(fastModeButton?.textContent).toContain("Fast mode");
    expect(fastModeButton?.textContent).not.toContain("2x plan usage");
    expect(fastModeButton?.title).toContain("2x plan usage");
    expect(fastModeButton?.classList.contains("is-active")).toBe(false);

    fastModeButton?.click();
    await tick();

    expect(harness.service.setTabFastMode).toHaveBeenCalledWith("tab-1", true);
    expect(harness.activeTab.fastMode).toBe(true);
    expect(fastModeButton?.classList.contains("is-active")).toBe(true);
  });

  it("keeps typed text after an input event and a re-render", async () => {
    const harness = createHarness();
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;

    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await tick();

    input.value = "keep this draft";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    harness.renderAll();
    await tick();

    expect(harness.activeTab.draft).toBe("keep this draft");
    expect(input.value).toBe("keep this draft");
  });

  it("reaches effectiveSkillsCsv after selected panel skills are applied", async () => {
    const harness = createHarness();
    await tick();

    const toggleButton = harness.hubRoot.querySelector<HTMLButtonElement>(".obsidian-codex__hub-panel-skill-toggle");
    expect(toggleButton).not.toBeNull();
    toggleButton?.click();
    await tick();

    const checkbox = Array.from(harness.hubRoot.querySelectorAll<HTMLInputElement>(".obsidian-codex__hub-panel-skill-checkbox")).find(
      (input) => input.getAttribute("aria-label") === "lecture-read",
    );
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();

    const useSelectedButton = Array.from(harness.hubRoot.querySelectorAll<HTMLButtonElement>(".obsidian-codex__change-card-btn")).find(
      (button) => button.textContent?.trim() === "Use selected",
    );
    expect(useSelectedButton).not.toBeNull();
    useSelectedButton?.click();
    await tick();

    harness.activeTab.draft = "Explain this paper carefully.";
    harness.renderAll();
    await tick();

    const sendButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__send-btn")!;
    sendButton.click();
    await tick();

    harness.sendGate.resolve();
    await tick();

    expect(harness.sendPrompt).toHaveBeenCalledTimes(1);
    expect(harness.getLastEffectiveSkillsCsv()).toBe("lecture-read");
  });

  it("can click back into the textarea after opening and closing the slash menu", async () => {
    const harness = createHarness({
      slashCommands: [
        {
          command: "/lecture",
          label: "Lecture",
          description: "Seed a lecture prompt.",
          source: "builtin",
          mode: "prompt",
        },
      ],
    });
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;

    input.click();
    await tick();

    input.value = "/";
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();

    const slashMenu = harness.composerRoot.querySelector<HTMLDivElement>(".obsidian-codex__slash-menu.is-visible");
    expect(slashMenu).not.toBeNull();

    input.value = "";
    input.setSelectionRange(0, 0);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();

    expect(harness.composerRoot.querySelector(".obsidian-codex__slash-menu.is-visible")).toBeNull();

    input.blur();
    input.click();
    await tick();

    expect(document.activeElement).toBe(input);
  });

  it("can click back into the textarea after toggling learning mode", async () => {
    const harness = createHarness();
    const input = harness.composerRoot.querySelector<HTMLTextAreaElement>(".obsidian-codex__input")!;
    const learningModeButton = harness.composerRoot.querySelector<HTMLButtonElement>(".obsidian-codex__learning-mode-control")!;

    learningModeButton.click();
    await tick();

    input.click();
    await tick();

    expect(document.activeElement).toBe(input);
  });
});
