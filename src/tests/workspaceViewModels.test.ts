import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "../model/types";
import {
  buildComposerDisplayState,
  buildHeaderActionState,
  buildStatusBarDisplayState,
  buildTranscriptRenderState,
} from "../views/renderers/viewModels/workspaceViewModels";

function createState(): WorkspaceState {
  return {
    tabs: [
      {
        id: "tab-1",
        title: "Chat 1",
        draft: "",
        cwd: "/vault",
        studyWorkflow: "lecture",
        activeStudyRecipeId: null,
        activeStudySkillNames: [],
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
        learningMode: false,
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

const workspaceCopy = {
  usageSource: {
    live: "Live",
    recovered: "Recovered",
    restored: "Restored",
  },
  executionPlanning: "Planning",
  executionArmed: "Ready to implement",
  executionEditing: "Apply automatically",
  executionAssisted: "Review before applying",
  executionReadOnly: "Suggest only",
} as const;

describe("workspace view models", () => {
  it("disables header actions for busy tabs and open-tab limits", () => {
    const state = createState();
    state.tabs[0]!.status = "busy";
    state.tabs[0]!.codexThreadId = "thread-1";

    const result = buildHeaderActionState(state, state.tabs[0]!, 1);
    expect(result).toEqual({
      newTabDisabled: true,
      newSessionDisabled: true,
      forkDisabled: true,
      resumeDisabled: true,
      compactDisabled: true,
    });
  });

  it("switches transcript state to summary window when summarized history is long", () => {
    const state = createState();
    state.tabs[0]!.summary = {
      id: "summary-1",
      text: "Summary",
      createdAt: Date.now(),
    };
    state.tabs[0]!.pendingApprovals = [
      {
        id: "approval-1",
        tabId: "tab-1",
        callId: "call-1",
        toolName: "vault_op",
        title: "Rename note",
        description: "Rename",
        details: "",
        diffText: "",
        createdAt: Date.now(),
        sourceMessageId: "assistant-1",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          kind: "rename",
          targetPath: "notes/a.md",
          impact: {
            backlinksCount: 0,
            backlinkSources: [],
            unresolvedSources: [],
            unresolvedWarning: null,
            destinationState: null,
            recoveryNote: null,
          },
        },
      },
      {
        id: "approval-2",
        tabId: "tab-1",
        callId: "call-2",
        toolName: "vault_op",
        title: "Move note",
        description: "Move",
        details: "",
        diffText: "",
        createdAt: Date.now(),
        sourceMessageId: "assistant-2",
        transport: "plugin_proposal",
        scope: "write",
        toolPayload: {
          kind: "move",
          targetPath: "notes/b.md",
          impact: {
            backlinksCount: 0,
            backlinkSources: [],
            unresolvedSources: [],
            unresolvedWarning: null,
            destinationState: null,
            recoveryNote: null,
          },
        },
      },
    ];

    const result = buildTranscriptRenderState(state.tabs[0]!, 21);
    expect(result.showWelcome).toBe(false);
    expect(result.showSummaryWindow).toBe(true);
    expect(result.showApprovalBatchBar).toBe(true);
  });

  it("counts skill-update approvals toward the transcript batch review bar", () => {
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
        createdAt: Date.now(),
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
        createdAt: Date.now() + 1,
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

    const result = buildTranscriptRenderState(state.tabs[0]!, 2);
    expect(result.showApprovalBatchBar).toBe(true);
  });

  it("prefers active panel title over workflow label in composer state", () => {
    const state = createState();
    state.tabs[0]!.activeStudyRecipeId = "panel-1";
    state.tabs[0]!.activeStudySkillNames = ["lecture-read", "deep-read"];
    state.tabs[0]!.composeMode = "plan";

    const result = buildComposerDisplayState(
      state.tabs[0]!,
      [{ id: "panel-1", title: "My Lecture Panel", workflow: "lecture" }],
      "ja",
    );
    expect(result.panelLabel).toBe("My Lecture Panel");
    expect(result.activeSkillLabels).toEqual(["/lecture-read", "/deep-read"]);
    expect(result.canClearPanelContext).toBe(true);
    expect(result.planModeActive).toBe(true);
    expect(result.placeholder.length).toBeGreaterThan(0);
  });

  it("hides the composer panel chip for a blank custom panel", () => {
    const state = createState();
    state.tabs[0]!.studyWorkflow = null;
    state.tabs[0]!.activeStudyRecipeId = "panel-custom";

    const result = buildComposerDisplayState(state.tabs[0]!, [{ id: "panel-custom", title: "", workflow: "custom" }], "en");

    expect(result.placeholder).toContain("lecture, paper, homework, or notes");
    expect(result.panelLabel).toBeNull();
    expect(result.canClearPanelContext).toBe(false);
  });

  it("derives status bar labels and yolo state from tab and account usage", () => {
    const state = createState();
    state.tabs[0]!.status = "waiting_approval";
    state.tabs[0]!.fastMode = true;
    state.accountUsage = {
      limits: {
        fiveHourPercent: null,
        weekPercent: null,
        planType: "plus",
      },
      source: "live",
      updatedAt: Date.now(),
      lastObservedAt: Date.now(),
      lastCheckedAt: Date.now(),
      threadId: "thread-1",
    };

    const result = buildStatusBarDisplayState(
      state.tabs[0]!,
      [],
      state.accountUsage,
      "full-auto",
      "en",
      workspaceCopy as never,
    );
    expect(result.modelLabel).toBe("GPT-5.5");
    expect(result.streaming).toBe(true);
    expect(result.fastModeActive).toBe(true);
    expect(result.yoloActive).toBe(true);
    expect(result.yoloToggleDisabled).toBe(false);
    expect(result.effectivePermissionState).toBe("Apply automatically");
    expect(result.usageSourceLabel).toBe("Live");
  });

  it("keeps the active model label when the model is absent from the catalog", () => {
    const state = createState();
    state.tabs[0]!.model = "gpt-5.6";

    const result = buildStatusBarDisplayState(
      state.tabs[0]!,
      [
        {
          slug: "gpt-5.4",
          displayName: "gpt-5.4",
          defaultReasoningLevel: "medium",
          supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
        },
      ],
      state.accountUsage,
      "suggest",
      "en",
      workspaceCopy as never,
    );

    expect(result.modelLabel).toBe("GPT-5.6");
  });

  it("disables the auto-apply toggle in Suggest only mode", () => {
    const state = createState();

    const result = buildStatusBarDisplayState(
      state.tabs[0]!,
      [],
      state.accountUsage,
      "suggest",
      "en",
      workspaceCopy as never,
    );

    expect(result.fastModeActive).toBe(false);
    expect(result.yoloActive).toBe(false);
    expect(result.yoloToggleDisabled).toBe(false);
    expect(result.effectivePermissionState).toBe("Suggest only");
  });

  it("shows armed state for plan mode with auto-apply enabled", () => {
    const state = createState();
    state.tabs[0]!.composeMode = "plan";

    const result = buildStatusBarDisplayState(
      state.tabs[0]!,
      [],
      state.accountUsage,
      "full-auto",
      "en",
      workspaceCopy as never,
    );

    expect(result.effectivePermissionState).toBe("Ready to implement");
    expect(result.planImplementationArmed).toBe(true);
    expect(result.showPlanYoloWarning).toBe(true);
  });
});
