// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "../../model/types";
import { getLocalizedCopy } from "../../util/i18n";
import { TranscriptRenderer } from "../../views/renderers/transcriptRenderer";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "../../views/renderers/types";
import { installObsidianDomHelpers } from "../setup/obsidian";

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
  activeTabIndex = 0,
): WorkspaceRenderContext {
  const copy = getLocalizedCopy("en");
  const activeTab = state.tabs[activeTabIndex] ?? null;
  return {
    app: {
      vault: {
        configDir: ".obsidian",
        adapter: {},
      },
    } as unknown as WorkspaceRenderContext["app"],
    service: {
      getShowReasoning: () => true,
      getPermissionMode: () => "suggest",
    } as WorkspaceRenderContext["service"],
    state,
    activeTab,
    locale: "en",
    copy,
  };
}

function createCallbacks(): Pick<WorkspaceRenderCallbacks, "markdownComponent" | "seedDraftAndSend" | "respondToChatSuggestion"> {
  return {
    markdownComponent: {} as WorkspaceRenderCallbacks["markdownComponent"],
    seedDraftAndSend: vi.fn(async () => {}),
    respondToChatSuggestion: vi.fn(async () => {}),
  };
}

describe("TranscriptRenderer avatar safety", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installObsidianDomHelpers();
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
  });

  it("keeps assistant message text visible while applying the avatar image after load", () => {
    const state = createState();
    state.tabs[0]!.messages = [{ id: "m1", kind: "assistant", text: "Assistant reply", createdAt: 1 }];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const markdown = root.querySelector(".obsidian-codex__message-markdown");
    const avatar = root.querySelector(".obsidian-codex__avatar-assistant") as HTMLElement | null;
    const image = root.querySelector(".obsidian-codex__avatar-image") as HTMLImageElement | null;
    image?.dispatchEvent(new Event("load"));
    expect(markdown?.textContent).toContain("Assistant reply");
    expect(avatar?.dataset.hasImage).toBe("true");
    expect(image?.getAttribute("src")).toContain("data:image/png;base64,");
  });

  it("falls back to the icon when the avatar image errors", () => {
    const state = createState();
    state.tabs[0]!.messages = [{ id: "m1", kind: "assistant", text: "Assistant reply", createdAt: 1 }];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const avatar = root.querySelector(".obsidian-codex__avatar-assistant") as HTMLElement | null;
    const image = root.querySelector(".obsidian-codex__avatar-image") as HTMLImageElement | null;
    image?.dispatchEvent(new Event("error"));
    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain("Assistant reply");
    expect(avatar?.dataset.hasImage).toBeUndefined();
    expect(avatar?.dataset.icon).toBe("sparkles");
  });

  it("keeps the welcome logo on the fallback icon", () => {
    const state = createState();
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const logo = root.querySelector(".obsidian-codex__welcome-logo") as HTMLElement | null;
    expect(root.querySelector(".obsidian-codex__welcome h3")?.textContent).toBeTruthy();
    expect(logo?.dataset.icon).toBe("sparkles");
    expect(logo?.dataset.hasImage).toBeUndefined();
  });

  it("uses the assistant avatar image in the welcome state after load", () => {
    const state = createState();
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const logo = root.querySelector(".obsidian-codex__welcome-logo") as HTMLElement | null;
    const image = root.querySelector(".obsidian-codex__welcome-logo .obsidian-codex__avatar-image") as HTMLImageElement | null;
    image?.dispatchEvent(new Event("load"));

    expect(logo?.dataset.hasImage).toBe("true");
    expect(image?.getAttribute("src")).toContain("data:image/png;base64,");
  });

  it("renders welcome starter actions and seeds the selected prompt", () => {
    const state = createState();
    const callbacks = createCallbacks();
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, callbacks);
    const context = createContext(state);
    renderer.render(context);

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-smoke^="welcome-suggestion-"]'));
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.textContent)).toEqual(context.copy.workspace.welcomeSuggestions);

    buttons[0]?.click();
    expect(callbacks.seedDraftAndSend).toHaveBeenCalledWith(context.copy.workspace.welcomeSuggestions[0]);
  });

  it("does not remount the welcome avatar on draft-only re-renders", () => {
    const state = createState();
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    const context = createContext(state);

    renderer.render(context);

    const firstWelcome = root.querySelector(".obsidian-codex__welcome");
    const firstLogo = root.querySelector(".obsidian-codex__welcome-logo");
    const firstImage = root.querySelector(".obsidian-codex__welcome-logo .obsidian-codex__avatar-image");

    state.tabs[0]!.draft = "typing should not shake welcome";
    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__welcome")).toBe(firstWelcome);
    expect(root.querySelector(".obsidian-codex__welcome-logo")).toBe(firstLogo);
    expect(root.querySelector(".obsidian-codex__welcome-logo .obsidian-codex__avatar-image")).toBe(firstImage);
  });

  it("renders waiting state text while the avatar image is present", () => {
    const state = createState();
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.waitingState = {
      phase: "reasoning",
      text: "Thinking",
    };
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const avatar = root.querySelector(".obsidian-codex__avatar-assistant") as HTMLElement | null;
    const image = root.querySelector(".obsidian-codex__avatar-image") as HTMLImageElement | null;
    image?.dispatchEvent(new Event("load"));
    expect(root.querySelector(".obsidian-codex__waiting-copy")?.textContent).toContain("Thinking");
    expect(avatar?.dataset.hasImage).toBe("true");
  });

  it("shows effective skills as compact metadata on a normal user message", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "user",
        text: "Read this paper carefully.",
        createdAt: 1,
        meta: {
          effectiveSkillsCsv: "deep-read,study-material-builder",
          effectiveSkillCount: 2,
        },
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-skill-meta .obsidian-codex__selection-message-label")?.textContent).toBe("Skills");
    expect(
      Array.from(root.querySelectorAll(".obsidian-codex__message-skill-chip")).map((element) => element.textContent),
    ).toEqual(["/deep-read", "/study-material-builder"]);
    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain("Read this paper carefully.");
  });

  it("shows active modifiers as compact metadata on a user message", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "user",
        text: "Summarize this note.",
        createdAt: 1,
        meta: {
          modifierChipsCsv: "focus,concise",
          modifierChipCount: 2,
        },
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const labels = Array.from(root.querySelectorAll(".obsidian-codex__message-skill-meta .obsidian-codex__selection-message-label")).map(
      (element) => element.textContent,
    );
    expect(labels).toContain("Modifiers");
    expect(
      Array.from(root.querySelectorAll(".obsidian-codex__message-skill-chip")).map((element) => element.textContent),
    ).toEqual(["#focus", "#concise"]);
  });

  it("renders successful patch system messages without the error variant", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "system",
        text: "Successfully patched notes/source.md.",
        createdAt: 1,
        meta: {
          tone: "success",
          patchTargetPath: "notes/source.md",
          patchOperation: "update",
        },
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const content = root.querySelector(".obsidian-codex__message-content--system") as HTMLElement | null;
    expect(content?.classList.contains("is-success")).toBe(true);
    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain("Successfully patched notes/source.md.");
  });

  it("renders rewrite-followup suggestions with the reflect CTA and fallback question", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: [
          "I reorganized the explanation around the core formulas.",
          "",
          "```obsidian-suggest",
          JSON.stringify({
            kind: "rewrite_followup",
            summary: "Turn this into a formatting-focused note patch.",
            question: "Want me to reflect this in the note?",
          }),
          "```",
        ].join("\n"),
        createdAt: 1,
      },
    ];
    state.tabs[0]!.chatSuggestion = {
      id: "suggestion-1",
      kind: "rewrite_followup",
      status: "pending",
      messageId: "m1",
      panelId: null,
      panelTitle: null,
      promptSnapshot: "",
      matchedSkillName: null,
      canUpdatePanel: false,
      canSaveCopy: false,
      planSummary: null,
      planStatus: null,
      rewriteSummary: "Turn this into a formatting-focused note patch.",
      rewriteQuestion: "Want me to reflect this in the note?",
      createdAt: 2,
    };
    const callbacks = createCallbacks();
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, callbacks);
    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain("Want me to reflect this in the note?");
    const actions = Array.from(root.querySelectorAll(".obsidian-codex__chat-suggestion-actions button")).map((element) => element.textContent);
    expect(actions).toEqual(["Reflect in note", "Skip"]);
  });

  it("invalidates the transcript when the active tab suggestion is dismissed", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: "I can turn this into a patch.",
        createdAt: 1,
      },
    ];
    state.tabs[0]!.chatSuggestion = {
      id: "suggestion-1",
      kind: "rewrite_followup",
      status: "pending",
      messageId: "m1",
      panelId: null,
      panelTitle: null,
      promptSnapshot: "",
      matchedSkillName: null,
      canUpdatePanel: false,
      canSaveCopy: false,
      planSummary: null,
      planStatus: null,
      rewriteSummary: "Turn this into a note patch.",
      rewriteQuestion: "Want me to reflect this in the note?",
      createdAt: 2,
    };
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));
    expect(root.querySelectorAll(".obsidian-codex__chat-suggestion-actions button")).toHaveLength(2);

    state.tabs[0]!.chatSuggestion = null;
    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__chat-suggestion-actions")).toBeNull();
  });

  it("invalidates the transcript when only UI-driving message metadata changes", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "system",
        text: "Successfully patched notes/source.md.",
        createdAt: 1,
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));
    expect(root.querySelector(".obsidian-codex__message-content--system")?.classList.contains("is-success")).toBe(false);

    state.tabs[0]!.messages[0]!.meta = {
      tone: "success",
      patchTargetPath: "notes/source.md",
      patchOperation: "update",
    };
    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-content--system")?.classList.contains("is-success")).toBe(true);
  });

  it("sticks to the latest transcript entry only when already near the bottom", () => {
    const state = createState();
    state.tabs[0]!.messages = [{ id: "m1", kind: "assistant", text: "Older reply", createdAt: 1 }];
    const root = document.createElement("div");
    let scrollHeight = 640;
    Object.defineProperty(root, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      get: () => 240,
    });

    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));
    expect(root.scrollTop).toBe(640);

    root.scrollTop = 396;
    root.dispatchEvent(new Event("scroll"));
    state.tabs[0]!.messages.push({ id: "m2", kind: "assistant", text: "Latest reply", createdAt: 2 });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      scrollHeight = 720;
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    renderer.render(createContext(state));

    expect(root.scrollTop).toBe(720);
  });

  it("does not snap back to the bottom after a small manual upward scroll", () => {
    const state = createState();
    state.tabs[0]!.messages = [{ id: "m1", kind: "assistant", text: "Older reply", createdAt: 1 }];
    const root = document.createElement("div");
    let scrollHeight = 640;
    Object.defineProperty(root, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      get: () => 240,
    });

    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    root.scrollTop = 380;
    root.dispatchEvent(new Event("scroll"));
    state.tabs[0]!.messages.push({ id: "m2", kind: "assistant", text: "Latest reply", createdAt: 2 });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      scrollHeight = 720;
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    renderer.render(createContext(state));

    expect(root.scrollTop).toBe(380);
  });

  it("ignores internal scroll events fired during rerender while Codex is thinking", () => {
    const state = createState();
    state.tabs[0]!.messages = [{ id: "m1", kind: "assistant", text: "Older reply", createdAt: 1 }];
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.waitingState = {
      phase: "reasoning",
      text: "Thinking",
    };
    const root = document.createElement("div");
    let scrollHeight = 640;
    Object.defineProperty(root, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      get: () => 240,
    });

    const originalEmpty = (root as HTMLDivElement & { empty?: () => void }).empty?.bind(root);
    (root as HTMLDivElement & { empty: () => void }).empty = () => {
      originalEmpty?.();
      root.scrollTop = 0;
      root.dispatchEvent(new Event("scroll"));
    };

    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    root.scrollTop = 320;
    root.dispatchEvent(new Event("scroll"));
    state.tabs[0]!.waitingState = {
      phase: "tools",
      text: "Still thinking",
    };
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      scrollHeight = 700;
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    renderer.render(createContext(state));

    expect(root.scrollTop).toBe(320);
  });

  it("does not override a manual scroll that happens before the pending restore runs", () => {
    const state = createState();
    state.tabs[0]!.messages = [{ id: "m1", kind: "assistant", text: "Older reply", createdAt: 1 }];
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.waitingState = {
      phase: "reasoning",
      text: "Thinking",
    };
    const root = document.createElement("div");
    let scrollHeight = 640;
    Object.defineProperty(root, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      get: () => 240,
    });

    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    root.scrollTop = 320;
    root.dispatchEvent(new Event("scroll"));
    state.tabs[0]!.waitingState = {
      phase: "tools",
      text: "Still thinking",
    };

    let pendingFrame: ((timestamp: number) => void) | null = null;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    }) as typeof window.requestAnimationFrame;
    scrollHeight = 700;
    renderer.render(createContext(state));

    root.scrollTop = 180;
    root.dispatchEvent(new Event("scroll"));
    if (pendingFrame !== null) {
      (pendingFrame as (timestamp: number) => void)(0);
    }

    expect(root.scrollTop).toBe(180);
  });

  it("restores bottom-follow immediately after rerender instead of flashing to the top", () => {
    const state = createState();
    state.tabs[0]!.messages = [{ id: "m1", kind: "assistant", text: "Older reply", createdAt: 1 }];
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.waitingState = {
      phase: "reasoning",
      text: "Thinking",
    };
    const root = document.createElement("div");
    let scrollHeight = 640;
    Object.defineProperty(root, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      get: () => 240,
    });

    const originalEmpty = (root as HTMLDivElement & { empty?: () => void }).empty?.bind(root);
    (root as HTMLDivElement & { empty: () => void }).empty = () => {
      originalEmpty?.();
      root.scrollTop = 0;
    };

    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));
    expect(root.scrollTop).toBe(640);

    state.tabs[0]!.messages.push({ id: "m2", kind: "assistant", text: "Latest reply", createdAt: 2 });
    let pendingFrame: ((timestamp: number) => void) | null = null;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    }) as typeof window.requestAnimationFrame;
    scrollHeight = 720;
    renderer.render(createContext(state));

    expect(root.scrollTop).toBe(720);
    expect(pendingFrame).not.toBeNull();
  });

  it("preserves older scroll position and restores it when returning to a tab", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      { id: "m1", kind: "assistant", text: "Older reply", createdAt: 1 },
      { id: "m2", kind: "assistant", text: "Latest reply", createdAt: 2 },
    ];
    state.tabs.push({
      ...state.tabs[0]!,
      id: "tab-2",
      title: "Chat 2",
      messages: [{ id: "m3", kind: "assistant", text: "Other tab", createdAt: 3 }],
    });

    const root = document.createElement("div");
    let scrollHeight = 640;
    Object.defineProperty(root, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      get: () => 240,
    });

    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state, 0));
    root.scrollTop = 120;
    root.dispatchEvent(new Event("scroll"));

    scrollHeight = 500;
    renderer.render(createContext(state, 1));
    expect(root.scrollTop).toBe(500);

    scrollHeight = 700;
    renderer.render(createContext(state, 0));
    expect(root.scrollTop).toBe(120);
  });

  it("soft-collapses summarized conversations and can expand earlier messages", () => {
    const state = createState();
    state.tabs[0]!.summary = {
      id: "summary-1",
      text: "Carry-forward summary",
      createdAt: 1,
    };
    state.tabs[0]!.messages = Array.from({ length: 25 }, (_, index) => ({
      id: `m${index + 1}`,
      kind: index % 2 === 0 ? "user" : "assistant",
      text: `Message ${index + 1}`,
      createdAt: index + 1,
    }));
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const collapsedBodies = Array.from(root.querySelectorAll(".obsidian-codex__message-body")).map((element) => element.textContent ?? "");
    expect(collapsedBodies).not.toContain("Message 1");
    expect(collapsedBodies).toContain("Message 25");

    const toggle = root.querySelector(".obsidian-codex__conversation-summary-toggle");
    expect(toggle?.textContent).toContain("Show 5 earlier messages");
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const expandedBodies = Array.from(root.querySelectorAll(".obsidian-codex__message-body")).map((element) => element.textContent ?? "");
    expect(expandedBodies).toContain("Message 1");
    expect(root.textContent).toContain("Collapse earlier messages");
  });
});
