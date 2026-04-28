// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Notice } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalResult } from "../../app/approvalCoordinator";
import type { WorkspaceState } from "../../model/types";
import { getLocalizedCopy } from "../../util/i18n";
import { TranscriptRenderer } from "../../views/renderers/transcriptRenderer";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "../../views/renderers/types";
import { installObsidianDomHelpers } from "../setup/obsidian";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const testNotice = Notice as typeof Notice & {
  messages: string[];
  reset(): void;
};

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
  locale: "en" | "ja" = "en",
  serviceOverrides: Partial<WorkspaceRenderContext["service"]> = {},
): WorkspaceRenderContext {
  const copy = getLocalizedCopy(locale);
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
      respondToApproval: vi.fn(async (): Promise<ApprovalResult> => "ignored"),
      respondToAllApprovals: vi.fn(async () => {}),
      ...serviceOverrides,
    } as WorkspaceRenderContext["service"],
    state,
    activeTab,
    isNarrowLayout: false,
    locale,
    copy,
  };
}

function createCallbacks(): Pick<
  WorkspaceRenderCallbacks,
  "markdownComponent" | "requestRender" | "seedDraftAndSend" | "respondToChatSuggestion"
> {
  return {
    markdownComponent: {} as WorkspaceRenderCallbacks["markdownComponent"],
    requestRender: vi.fn(),
    seedDraftAndSend: vi.fn(async () => {}),
    respondToChatSuggestion: vi.fn(async () => {}),
  };
}

describe("TranscriptRenderer avatar safety", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installObsidianDomHelpers();
    testNotice.reset();
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

  it("renders raw assistant derivation math without visible markdown math delimiters", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: ["Close.", "", "- 6^2 + 8^2 = 36 + 64 = 100", "- That means c^2 = 100", "- So c = \\sqrt{100} = 10"].join("\n"),
        createdAt: 1,
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const markdown = root.querySelector(".obsidian-codex__message-markdown") as HTMLElement;
    const text = markdown.textContent ?? "";
    expect(text).not.toContain("$6^2");
    expect(text).not.toContain("$c^2");
    expect(text).not.toContain("$c =");
    expect(text).toContain("- 6² + 8² = 36 + 64 = 100");
    expect(text).toContain("- That means c² = 100");
    expect(text).toContain("- So c = √100 = 10");
    expect(markdown.querySelectorAll(".obsidian-codex__chat-math")).toHaveLength(3);
  });

  it("hides existing assistant markdown math delimiters in chat output", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: [
          "The answer is:",
          "",
          "$a^2 + b^2 = c^2$",
          "",
          "$$c = \\sqrt{100}$$",
          "",
          "Skill /deep-read stays visible.",
        ].join("\n"),
        createdAt: 1,
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    const markdown = root.querySelector(".obsidian-codex__message-markdown") as HTMLElement;
    const text = markdown.textContent ?? "";
    expect(text).not.toContain("$a");
    expect(text).not.toContain("$$");
    expect(text).toContain("a² + b² = c²");
    expect(text).toContain("c = √100");
    expect(text).toContain("/deep-read");
    expect(markdown.querySelectorAll(".obsidian-codex__chat-math")).toHaveLength(2);
    expect(markdown.querySelectorAll(".obsidian-codex__chat-math--display")).toHaveLength(1);
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

  it("renders waiting skill usage text and tooltip", () => {
    const state = createState();
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.runtimeMode = "skill";
    state.tabs[0]!.waitingState = {
      phase: "boot",
      text: "Using skills: /brainstorming, /lecture-read +1 · Gathering clues",
      locale: "en",
      mode: "skill",
      requiredSkillNames: ["brainstorming", "lecture-read"],
      autoSelectedSkillNames: ["paper-visualizer"],
      orderedSkillNames: ["brainstorming", "lecture-read", "paper-visualizer"],
      primarySkillName: "brainstorming",
      skillCount: 3,
    };
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));

    const waitingCopy = root.querySelector(".obsidian-codex__waiting-copy") as HTMLElement | null;
    const waitingBody = root.querySelector(".obsidian-codex__message-content--waiting") as HTMLElement | null;
    expect(waitingCopy?.textContent).toContain("Using skills: /brainstorming, /lecture-read +1");
    expect(waitingCopy?.title).toBe("Required: /brainstorming, /lecture-read. Auto: /paper-visualizer");
    expect(waitingBody?.title).toBe("Required: /brainstorming, /lecture-read. Auto: /paper-visualizer");
  });

  it("renders stale generated waiting copy in the current display language", () => {
    const state = createState();
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.runtimeMode = "normal";
    state.tabs[0]!.waitingState = {
      phase: "boot",
      text: "文脈をほどいています",
    };
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state, 0, "en"));

    const waitingText = root.querySelector(".obsidian-codex__waiting-copy")?.textContent ?? "";
    expect(waitingText).not.toMatch(/[ぁ-んァ-ン一-龥]/u);
    expect(waitingText.length).toBeGreaterThan(0);
  });

  it("corrects generated waiting copy when the stored locale metadata is wrong", () => {
    const state = createState();
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.runtimeMode = "normal";
    state.tabs[0]!.waitingState = {
      phase: "boot",
      text: "入口を見つけています",
      locale: "en",
      mode: "normal",
    };
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state, 0, "en"));

    const waitingText = root.querySelector(".obsidian-codex__waiting-copy")?.textContent ?? "";
    expect(waitingText).not.toMatch(/[ぁ-んァ-ン一-龥]/u);
    expect(waitingText.length).toBeGreaterThan(0);
  });

  it("hides generic mcp plumbing activity while keeping the waiting row visible", () => {
    const state = createState();
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.waitingState = {
      phase: "tools",
      text: "Using tools",
    };
    state.tabs[0]!.toolLog = [
      {
        id: "mcp-1",
        callId: "mcp-1",
        kind: "mcp",
        name: "mcp_tool",
        title: "mcp_tool",
        summary: "mcp_tool",
        argsJson: "{}",
        createdAt: 1,
        updatedAt: 1,
        status: "running",
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-activity")).toBeNull();
    expect(root.querySelector(".obsidian-codex__waiting-copy")?.textContent).toContain("Using tools");
  });

  it("shows the batch review controls for skill-update approvals", () => {
    const state = createState();
    state.tabs[0]!.pendingApprovals = [
      {
        id: "approval-skill-1",
        tabId: "tab-1",
        callId: "call-skill-1",
        toolName: "skill_update",
        title: "Update skill: lecture-read",
        description: "/vault/.codex/skills/lecture-read/SKILL.md",
        details: "Learned refinement 1",
        diffText: "@@",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          skillName: "lecture-read",
          skillPath: "/vault/.codex/skills/lecture-read/SKILL.md",
          baseContent: "# Skill",
          baseContentHash: "hash-1",
          nextContent: "# Skill\n\nRefined",
          feedbackSummary: "Learned refinement 1",
          attribution: {
            prompt: "Improve this note.",
            summary: "Applied a note cleanup.",
            targetNotePath: "notes/a.md",
            panelId: null,
          },
        },
      },
      {
        id: "approval-skill-2",
        tabId: "tab-1",
        callId: "call-skill-2",
        toolName: "skill_update",
        title: "Update skill: deep-read",
        description: "/vault/.codex/skills/deep-read/SKILL.md",
        details: "Learned refinement 2",
        diffText: "@@",
        createdAt: 2,
        sourceMessageId: "assistant-2",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          skillName: "deep-read",
          skillPath: "/vault/.codex/skills/deep-read/SKILL.md",
          baseContent: "# Skill",
          baseContentHash: "hash-2",
          nextContent: "# Skill\n\nRefined",
          feedbackSummary: "Learned refinement 2",
          attribution: {
            prompt: "Clean up this note.",
            summary: "Applied a note rewrite.",
            targetNotePath: "notes/b.md",
            panelId: null,
          },
        },
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    const context = createContext(state);

    renderer.render(context);

    expect(root.querySelector(".obsidian-codex__approval-batch-label")?.textContent).toBe(context.copy.workspace.pendingApprovals);
    expect(root.textContent).toContain(context.copy.workspace.approveAll);
    expect(root.textContent).toContain(context.copy.workspace.denyAll);
    expect(root.querySelectorAll(".obsidian-codex__approval-card")).toHaveLength(2);
  });

  it("rerenders when message text changes without changing length", () => {
    const state = createState();
    state.tabs[0]!.messages = [{ id: "m1", kind: "assistant", text: "ABCD", createdAt: 1 }];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));
    state.tabs[0]!.messages[0]!.text = "WXYZ";
    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain("WXYZ");
  });

  it("disables single approval actions while a request is in flight and re-enables them after failure", async () => {
    const state = createState();
    state.tabs[0]!.pendingApprovals = [
      {
        id: "approval-1",
        tabId: "tab-1",
        callId: "call-1",
        toolName: "vault_op",
        title: "Rename note",
        description: "notes/source.md -> notes/destination.md",
        details: "Backlinks detected",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          kind: "rename",
          targetPath: "notes/source.md",
          destinationPath: "notes/destination.md",
          impact: null,
        },
      },
    ];
    const approvalGate = createDeferred<ApprovalResult>();
    const respondToApproval = vi.fn(() => approvalGate.promise);
    const root = document.createElement("div");
    const callbacks = createCallbacks();
    const renderer = new TranscriptRenderer(root, callbacks);
    const context = createContext(state, 0, "en", { respondToApproval });
    callbacks.requestRender = () => renderer.render(context);

    renderer.render(context);

    const approveButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".obsidian-codex__approval-btn")).find(
      (button) => button.textContent === context.copy.workspace.approve,
    );
    expect(approveButton).not.toBeNull();

    approveButton!.click();
    approveButton!.click();
    expect(respondToApproval).toHaveBeenCalledTimes(1);
    expect(approveButton!.disabled).toBe(true);

    approvalGate.reject(new Error("Approval failed"));
    await Promise.resolve();
    await Promise.resolve();

    const refreshedApproveButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".obsidian-codex__approval-btn")).find(
      (button) => button.textContent === context.copy.workspace.approve,
    );
    expect(refreshedApproveButton?.disabled).toBe(false);
    expect(testNotice.messages).toContain("Approval failed");
  });

  it("disables batch approval controls while a single approval is in flight on the same tab", async () => {
    const state = createState();
    state.tabs[0]!.pendingApprovals = [
      {
        id: "approval-1",
        tabId: "tab-1",
        callId: "call-1",
        toolName: "skill_update",
        title: "Update skill: lecture-read",
        description: "/vault/.codex/skills/lecture-read/SKILL.md",
        details: "Learned refinement 1",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          skillName: "lecture-read",
          skillPath: "/vault/.codex/skills/lecture-read/SKILL.md",
          baseContent: "# Skill",
          baseContentHash: "hash-1",
          nextContent: "# Skill\n\nRefined",
          feedbackSummary: "Learned refinement 1",
          attribution: {
            prompt: "Improve this note.",
            summary: "Applied a note cleanup.",
            targetNotePath: "notes/a.md",
            panelId: null,
          },
        },
      },
      {
        id: "approval-2",
        tabId: "tab-1",
        callId: "call-2",
        toolName: "skill_update",
        title: "Update skill: deep-read",
        description: "/vault/.codex/skills/deep-read/SKILL.md",
        details: "Learned refinement 2",
        createdAt: 2,
        sourceMessageId: "assistant-2",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          skillName: "deep-read",
          skillPath: "/vault/.codex/skills/deep-read/SKILL.md",
          baseContent: "# Skill",
          baseContentHash: "hash-2",
          nextContent: "# Skill\n\nRefined",
          feedbackSummary: "Learned refinement 2",
          attribution: {
            prompt: "Clean up this note.",
            summary: "Applied a note rewrite.",
            targetNotePath: "notes/b.md",
            panelId: null,
          },
        },
      },
    ];
    const approvalGate = createDeferred<ApprovalResult>();
    const respondToApproval = vi.fn(() => approvalGate.promise);
    const root = document.createElement("div");
    const callbacks = createCallbacks();
    const renderer = new TranscriptRenderer(root, callbacks);
    const context = createContext(state, 0, "en", { respondToApproval });
    const renderCurrent = () => renderer.render(context);
    callbacks.requestRender = renderCurrent;

    renderCurrent();

    const approveButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".obsidian-codex__approval-btn")).find(
      (button) => button.textContent === context.copy.workspace.approve,
    );
    approveButton?.click();
    await Promise.resolve();

    const approveAllButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".obsidian-codex__approval-btn")).find(
      (button) => button.textContent === context.copy.workspace.approveAll,
    );
    expect(approveAllButton?.disabled).toBe(true);

    approvalGate.resolve("applied");
    await Promise.resolve();
    await Promise.resolve();
  });

  it("disables batch approval actions while a batch request is in flight and re-enables them after failure", async () => {
    const state = createState();
    state.tabs[0]!.pendingApprovals = [
      {
        id: "approval-1",
        tabId: "tab-1",
        callId: "call-1",
        toolName: "skill_update",
        title: "Update skill: lecture-read",
        description: "/vault/.codex/skills/lecture-read/SKILL.md",
        details: "Learned refinement 1",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          skillName: "lecture-read",
          skillPath: "/vault/.codex/skills/lecture-read/SKILL.md",
          baseContent: "# Skill",
          baseContentHash: "hash-1",
          nextContent: "# Skill\n\nRefined",
          feedbackSummary: "Learned refinement 1",
          attribution: {
            prompt: "Improve this note.",
            summary: "Applied a note cleanup.",
            targetNotePath: "notes/a.md",
            panelId: null,
          },
        },
      },
      {
        id: "approval-2",
        tabId: "tab-1",
        callId: "call-2",
        toolName: "skill_update",
        title: "Update skill: deep-read",
        description: "/vault/.codex/skills/deep-read/SKILL.md",
        details: "Learned refinement 2",
        createdAt: 2,
        sourceMessageId: "assistant-2",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          skillName: "deep-read",
          skillPath: "/vault/.codex/skills/deep-read/SKILL.md",
          baseContent: "# Skill",
          baseContentHash: "hash-2",
          nextContent: "# Skill\n\nRefined",
          feedbackSummary: "Learned refinement 2",
          attribution: {
            prompt: "Clean up this note.",
            summary: "Applied a note rewrite.",
            targetNotePath: "notes/b.md",
            panelId: null,
          },
        },
      },
    ];
    const approvalGate = createDeferred<void>();
    const respondToAllApprovals = vi.fn(() => approvalGate.promise);
    const root = document.createElement("div");
    const callbacks = createCallbacks();
    const renderer = new TranscriptRenderer(root, callbacks);
    const context = createContext(state, 0, "en", { respondToAllApprovals });
    callbacks.requestRender = () => renderer.render(context);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    try {
      renderer.render(context);

      const approveAllButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".obsidian-codex__approval-btn")).find(
        (button) => button.textContent === context.copy.workspace.approveAll,
      );
      expect(approveAllButton).not.toBeNull();

      approveAllButton!.click();
      approveAllButton!.click();
      expect(respondToAllApprovals).toHaveBeenCalledTimes(1);
      expect(approveAllButton!.disabled).toBe(true);

      approvalGate.reject(new Error("Batch failed"));
      await Promise.resolve();
      await Promise.resolve();

      const refreshedApproveAllButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".obsidian-codex__approval-btn")).find(
        (button) => button.textContent === context.copy.workspace.approveAll,
      );
      expect(refreshedApproveAllButton?.disabled).toBe(false);
      expect(testNotice.messages).toContain("Batch failed");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("disables single approval controls while a batch request is in flight on the same tab", async () => {
    const state = createState();
    state.tabs[0]!.pendingApprovals = [
      {
        id: "approval-1",
        tabId: "tab-1",
        callId: "call-1",
        toolName: "skill_update",
        title: "Update skill: lecture-read",
        description: "/vault/.codex/skills/lecture-read/SKILL.md",
        details: "Learned refinement 1",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          skillName: "lecture-read",
          skillPath: "/vault/.codex/skills/lecture-read/SKILL.md",
          baseContent: "# Skill",
          baseContentHash: "hash-1",
          nextContent: "# Skill\n\nRefined",
          feedbackSummary: "Learned refinement 1",
          attribution: {
            prompt: "Improve this note.",
            summary: "Applied a note cleanup.",
            targetNotePath: "notes/a.md",
            panelId: null,
          },
        },
      },
      {
        id: "approval-2",
        tabId: "tab-1",
        callId: "call-2",
        toolName: "skill_update",
        title: "Update skill: deep-read",
        description: "/vault/.codex/skills/deep-read/SKILL.md",
        details: "Learned refinement 2",
        createdAt: 2,
        sourceMessageId: "assistant-2",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          skillName: "deep-read",
          skillPath: "/vault/.codex/skills/deep-read/SKILL.md",
          baseContent: "# Skill",
          baseContentHash: "hash-2",
          nextContent: "# Skill\n\nRefined",
          feedbackSummary: "Learned refinement 2",
          attribution: {
            prompt: "Clean up this note.",
            summary: "Applied a note rewrite.",
            targetNotePath: "notes/b.md",
            panelId: null,
          },
        },
      },
    ];
    const approvalGate = createDeferred<void>();
    const respondToAllApprovals = vi.fn(() => approvalGate.promise);
    const root = document.createElement("div");
    const callbacks = createCallbacks();
    const renderer = new TranscriptRenderer(root, callbacks);
    const context = createContext(state, 0, "en", { respondToAllApprovals });
    callbacks.requestRender = () => renderer.render(context);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    try {
      renderer.render(context);

      const approveAllButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".obsidian-codex__approval-btn")).find(
        (button) => button.textContent === context.copy.workspace.approveAll,
      );
      approveAllButton?.click();
      await Promise.resolve();

      const approveButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".obsidian-codex__approval-btn")).find(
        (button) => button.textContent === context.copy.workspace.approve,
      );
      expect(approveButton?.disabled).toBe(true);

      approvalGate.resolve();
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("rerenders through requestRender so resolving an approval does not repaint a stale tab", async () => {
    const state = createState();
    state.tabs[0]!.pendingApprovals = [
      {
        id: "approval-1",
        tabId: "tab-1",
        callId: "call-1",
        toolName: "vault_op",
        title: "Rename note",
        description: "notes/source.md -> notes/destination.md",
        details: "Backlinks detected",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          kind: "rename",
          targetPath: "notes/source.md",
          destinationPath: "notes/destination.md",
          impact: null,
        },
      },
    ];
    const tabTwo = {
      ...state.tabs[0]!,
      id: "tab-2",
      title: "Chat 2",
      pendingApprovals: [],
      messages: [{ id: "m-tab-2", kind: "assistant" as const, text: "Tab two content", createdAt: 2 }],
      toolLog: [],
      patchBasket: [],
      summary: null,
      waitingState: null,
      lastError: null,
      status: "ready" as const,
    };
    state.tabs = [state.tabs[0]!, tabTwo];
    const approvalGate = createDeferred<ApprovalResult>();
    const respondToApproval = vi.fn(() => approvalGate.promise);
    const root = document.createElement("div");
    const callbacks = createCallbacks();
    const renderer = new TranscriptRenderer(root, callbacks);
    const currentContext = () =>
      createContext(
        state,
        state.tabs.findIndex((tab) => tab.id === state.activeTabId),
        "en",
        { respondToApproval },
      );
    callbacks.requestRender = () => renderer.render(currentContext());

    renderer.render(currentContext());

    const approveButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".obsidian-codex__approval-btn")).find(
      (button) => button.textContent === currentContext().copy.workspace.approve,
    );
    approveButton?.click();
    await Promise.resolve();

    state.activeTabId = "tab-2";
    renderer.render(currentContext());
    expect(root.textContent).toContain("Tab two content");

    approvalGate.resolve("applied");
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain("Tab two content");
    expect(root.textContent).not.toContain("Rename note");
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

  it("does not render removed modifier metadata on a user message", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "user",
        text: "Summarize this note.",
        createdAt: 1,
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-skill-meta")).toBeNull();
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

  it("maps system message tones to explicit visual classes and leaves untoned messages neutral", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      { id: "m1", kind: "system", text: "Informational note.", createdAt: 1 },
      { id: "m2", kind: "system", text: "Saved successfully.", createdAt: 2, meta: { tone: "success" } },
      { id: "m3", kind: "system", text: "Review before applying.", createdAt: 3, meta: { tone: "warning" } },
      { id: "m4", kind: "system", text: "Failed to apply.", createdAt: 4, meta: { tone: "error" } },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));

    const contents = Array.from(root.querySelectorAll(".obsidian-codex__message-content--system"));
    expect(contents[0]?.classList.contains("is-success")).toBe(false);
    expect(contents[0]?.classList.contains("is-warning")).toBe(false);
    expect(contents[0]?.classList.contains("is-error")).toBe(false);
    expect(contents[1]?.classList.contains("is-success")).toBe(true);
    expect(contents[2]?.classList.contains("is-warning")).toBe(true);
    expect(contents[3]?.classList.contains("is-error")).toBe(true);
  });

  it("keeps untoned system message CSS neutral instead of using the error color", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/10-layout.css"), "utf8");
    const baseBlock = css.match(/\.obsidian-codex__message-content--system\s*\{[^}]+\}/u)?.[0] ?? "";

    expect(baseBlock).not.toContain("var(--text-error)");
    expect(baseBlock).not.toContain("rgba(220, 53, 69");
    expect(css).toContain(".obsidian-codex__message-content--system.is-error");
    expect(css).toContain(".obsidian-codex__message-content--system.is-warning");
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
            question: "Want me to apply this to the note now?",
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
      rewriteQuestion: "Want me to apply this to the note now?",
      createdAt: 2,
    };
    const callbacks = createCallbacks();
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, callbacks);
    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain("Want me to apply this to the note now?");
    const actions = Array.from(root.querySelectorAll(".obsidian-codex__chat-suggestion-actions button")).map((element) => element.textContent);
    expect(actions).toEqual(["Apply to note", "Skip"]);
  });

  it("renders polluted internal rewrite user prompts as the short reflect label", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "user",
        text: [
          "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
          "Target resolution order for this rewrite: an explicitly mentioned note or path, then the selection source note, then prefer the active note for this turn, then the current session target note.",
          "If a selection snapshot is attached, limit the rewrite to that selected section or the nearest matching section instead of rewriting the whole note.",
          "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
          "Add concise evidence lines to the patch header when possible using `evidence: kind|label|sourceRef|snippet`.",
          "Prefer vault-note and attachment evidence first. If that is insufficient, you may use web research and mark those evidence lines with `kind` = `web` and a source URL.",
          "Do not ask whether to apply the change. Emit the patch now and keep any visible chat summary to at most 2 short sentences.",
          "Assistant answer to convert:",
          "Summarize Step 1 cleanly.",
        ].join("\n\n"),
        createdAt: 1,
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain("Apply to note");
    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).not.toContain(
      "Turn your immediately previous assistant answer",
    );
  });

  it("hides leaked repair scaffolding from assistant transcript rendering", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: [
          "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
          "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
          "Assistant answer to convert:",
          "Here is the cleaned-up explanation for Step 1.",
        ].join("\n\n"),
        createdAt: 1,
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain(
      "Here is the cleaned-up explanation for Step 1.",
    );
    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).not.toContain(
      "Turn your immediately previous assistant answer",
    );
  });

  it("hides leaked legacy rewrite scaffolding from assistant transcript rendering", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: [
          "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
          "Target the current session target note if one is set; otherwise target the active note for this turn.",
          "If a selection snapshot is attached, limit the rewrite to that selected section or the nearest matching section instead of rewriting the whole note.",
          "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
          "Add concise evidence lines to the patch header when possible using `evidence: kind|label|sourceRef|snippet`.",
          "Prefer vault-note and attachment evidence first. If that is insufficient, you may use web research and mark those evidence lines with `kind` = `web` and a source URL.",
          "Do not ask whether to apply the change. Emit the patch now and keep any visible chat summary to at most 2 short sentences.",
          "Assistant answer to convert: This -3.95 V is the input-side form of the earlier v_{O,min} = -4.65 V result.",
        ].join("\n\n"),
        createdAt: 1,
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain(
      "This -3.95 V is the input-side form of the earlier v_{O,min} = -4.65 V result.",
    );
    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).not.toContain(
      "Target the current session target note if one is set",
    );
  });

  it("uses the localized fallback rewrite question when an inferred CTA omits one", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: "この説明で Step 1 を整理できます。",
        createdAt: 1,
        meta: {
          editOutcome: "explanation_only",
        },
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
      rewriteSummary: "Step 1 に短い補足を追記する。",
      rewriteQuestion: null,
      createdAt: 2,
    };
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());
    renderer.render(createContext(state, 0, "ja"));

    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain("この内容を今のノートに適用しますか？");
    const actions = Array.from(root.querySelectorAll(".obsidian-codex__chat-suggestion-actions button")).map((element) => element.textContent);
    expect(actions).toEqual(["ノートに適用", "今はしない"]);
  });

  it("prepends a review-needed line to assistant edit replies", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: "I tightened the section wording and cleaned up the heading hierarchy.",
        createdAt: 1,
        meta: {
          editOutcome: "review_required",
          editTargetPath: "notes/source.md",
        },
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));

    expect(root.querySelector(".obsidian-codex__message-markdown")?.textContent).toContain("Review needed: source.md.");
  });

  it("does not prepend readability-specific review copy when the tray already shows markdown risk", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: "I tightened the section wording and cleaned up the heading hierarchy.",
        createdAt: 1,
        meta: {
          editOutcome: "review_required",
          editTargetPath: "notes/source.md",
          editReviewReason: "readability_risk",
        },
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));

    const text = root.querySelector(".obsidian-codex__message-markdown")?.textContent ?? "";
    expect(text).toContain("I tightened the section wording and cleaned up the heading hierarchy.");
    expect(text).not.toContain("Readability review needed: source.md.");
  });

  it("does not prepend auto-healed review copy when the tray already shows markdown risk", () => {
    const state = createState();
    state.tabs[0]!.messages = [
      {
        id: "m1",
        kind: "assistant",
        text: "I normalized the structure and held the patch for review.",
        createdAt: 1,
        meta: {
          editOutcome: "review_required",
          editTargetPath: "notes/source.md",
          editReviewReason: "auto_healed",
        },
      },
    ];
    const root = document.createElement("div");
    const renderer = new TranscriptRenderer(root, createCallbacks());

    renderer.render(createContext(state));

    const text = root.querySelector(".obsidian-codex__message-markdown")?.textContent ?? "";
    expect(text).toContain("I normalized the structure and held the patch for review.");
    expect(text).not.toContain("Auto-healed structure: review source.md before applying.");
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
