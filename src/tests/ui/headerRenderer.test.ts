// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "../../model/types";
import { getLocalizedCopy } from "../../util/i18n";
import { HeaderRenderer } from "../../views/renderers/headerRenderer";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "../../views/renderers/types";
import { installObsidianDomHelpers, Menu, Notice } from "../setup/obsidian";

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
        codexThreadId: "thread-1",
        model: "gpt-5.4",
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
        messages: [{ id: "m1", kind: "assistant", text: "Hi", createdAt: 1 }],
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
    availableModels: [],
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
    studyRecipes: [],
    activeStudyRecipeId: null,
                    runtimeIssue: null,
  };
}

function createContext(
  state: WorkspaceState,
  serviceOverrides: Record<string, unknown> = {},
  options: { isNarrowLayout?: boolean } = {},
): WorkspaceRenderContext {
  const copy = getLocalizedCopy("en");
  const activeTab = state.tabs[0] ?? null;
  return {
    app: {
      vault: {
        configDir: ".obsidian",
        adapter: {},
      },
    } as unknown as WorkspaceRenderContext["app"],
    service: {
      getMaxOpenTabs: () => 6,
      createTab: vi.fn(() => ({ id: "tab-2" })),
      startNewSession: vi.fn(() => true),
      forkTab: vi.fn(() => "tab-2"),
      resumeTab: vi.fn(() => "tab-3"),
      compactTab: vi.fn(),
      activateTab: vi.fn(),
      closeTab: vi.fn(),
      ...serviceOverrides,
    } as unknown as WorkspaceRenderContext["service"],
    state,
    activeTab,
    isNarrowLayout: options.isNarrowLayout ?? false,
    locale: "en",
    copy,
  };
}

function createCallbacks(): Pick<WorkspaceRenderCallbacks, "openSettings"> {
  return {
    openSettings: vi.fn(),
  };
}

describe("HeaderRenderer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installObsidianDomHelpers();
    Menu.reset();
    Notice.reset();
  });

  it("renders session controls and dispatches the existing service actions", () => {
    const state = createState();
    const callbacks = createCallbacks();
    const context = createContext(state);
    const service = context.service as unknown as {
      createTab: ReturnType<typeof vi.fn>;
      startNewSession: ReturnType<typeof vi.fn>;
      forkTab: ReturnType<typeof vi.fn>;
      resumeTab: ReturnType<typeof vi.fn>;
      compactTab: ReturnType<typeof vi.fn>;
    };
    const root = document.createElement("div");

    new HeaderRenderer(root, callbacks).render(context);

    root.querySelector<HTMLButtonElement>('[data-smoke="header-new-tab"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-smoke="header-new-session"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-smoke="header-fork"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-smoke="header-resume"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-smoke="header-compact"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-smoke="header-settings"]')?.click();

    expect(service.createTab).toHaveBeenCalledTimes(1);
    expect(service.startNewSession).toHaveBeenCalledWith("tab-1");
    expect(service.forkTab).toHaveBeenCalledWith("tab-1");
    expect(service.resumeTab).toHaveBeenCalledWith("tab-1");
    expect(service.compactTab).toHaveBeenCalledWith("tab-1");
    expect(callbacks.openSettings).toHaveBeenCalledTimes(1);
  });

  it("disables fork, resume, compact, and new session when the active tab is not actionable", () => {
    const state = createState();
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.codexThreadId = null;
    state.tabs[0]!.messages = [];
    const root = document.createElement("div");

    new HeaderRenderer(root, createCallbacks()).render(createContext(state));

    expect(root.querySelector<HTMLButtonElement>('[data-smoke="header-new-session"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-smoke="header-fork"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-smoke="header-resume"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-smoke="header-compact"]')?.disabled).toBe(true);
  });

  it("shows the existing notices when fork or resume cannot run", () => {
    const state = createState();
    const root = document.createElement("div");

    new HeaderRenderer(root, createCallbacks()).render(
      createContext(state, {
        forkTab: vi.fn(() => null),
        resumeTab: vi.fn(() => null),
      }),
    );

    root.querySelector<HTMLButtonElement>('[data-smoke="header-fork"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-smoke="header-resume"]')?.click();

    expect(Notice.messages).toContain("Cannot fork this conversation.");
    expect(Notice.messages).toContain("No resumable Codex thread on this tab.");
  });

  it("hides header tab badges when tab placement is set to the composer", () => {
    const state = createState();
    const root = document.createElement("div");

    new HeaderRenderer(root, createCallbacks()).render(
      createContext(state, {
        getTabBarPosition: () => "composer",
      }),
    );

    expect(root.querySelector(".obsidian-codex__tab-bar")).toBeNull();
    expect(root.querySelector(".obsidian-codex__tab-badges")).toBeNull();
  });

  it("collapses header actions into an overflow menu in narrow layout", () => {
    const state = createState();
    const callbacks = createCallbacks();
    const context = createContext(state, {}, { isNarrowLayout: true });
    const service = context.service as unknown as {
      createTab: ReturnType<typeof vi.fn>;
      compactTab: ReturnType<typeof vi.fn>;
    };
    const root = document.createElement("div");

    new HeaderRenderer(root, callbacks).render(context);

    expect(root.classList.contains("is-narrow")).toBe(true);
    expect(root.querySelector('[data-smoke="header-new-tab"]')).toBeNull();
    expect(root.querySelector(".obsidian-codex__tab-bar")).toBeNull();

    root.querySelector<HTMLButtonElement>('[data-smoke="header-more-actions"]')?.click();

    const menu = Menu.lastShown;
    expect(menu).not.toBeNull();
    expect(menu?.items.map((item) => item.title)).toEqual([
      "New tab",
      "New session",
      "Fork conversation",
      "Resume thread in a new tab",
      "Compact conversation",
      "Settings",
    ]);

    menu?.items[0]?.trigger();
    menu?.items[4]?.trigger();
    menu?.items[5]?.trigger();

    expect(service.createTab).toHaveBeenCalledTimes(1);
    expect(service.compactTab).toHaveBeenCalledWith("tab-1");
    expect(callbacks.openSettings).toHaveBeenCalledTimes(1);
  });
});
