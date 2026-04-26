import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexService } from "../app/codexService";
import {
  DEFAULT_SETTINGS,
  type PluginSettings,
  type StudyRecipe,
  type TurnContextSnapshot,
} from "../model/types";
import {
  CALLOUT_MATH_COLLISION_SAMPLE,
  CALLOUT_MATH_MIXED_CONTEXT_SAMPLE,
  CALLOUT_MATH_SAMPLE,
} from "./fixtures/calloutMathFixture";
import { createEmptyAccountUsageSummary, createEmptyUsageSummary } from "../util/usage";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createApp(basePath: string) {
  return {
    vault: {
      adapter: { basePath },
      getAbstractFileByPath: () => null,
    },
    workspace: {
      getActiveFile: () => null,
      getMostRecentLeaf: () => null,
    },
  } as never;
}

function createWritableApp(basePath: string, initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const folders = new Set<string>();
  return {
    app: {
      vault: {
        adapter: { basePath },
        getAbstractFileByPath(path: string) {
          if (files.has(path) || folders.has(path)) {
            return { path };
          }
          return null;
        },
        cachedRead: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
        create: vi.fn(async (path: string, content: string) => {
          files.set(path, content);
          return { path };
        }),
        modify: vi.fn(async (file: { path: string }, content: string) => {
          files.set(file.path, content);
        }),
        createFolder: vi.fn(async (path: string) => {
          folders.add(path);
        }),
      },
      fileManager: {
        renameFile: vi.fn(async (file: { path: string }, nextPath: string) => {
          const content = files.get(file.path);
          files.delete(file.path);
          files.set(nextPath, content ?? "");
        }),
        processFrontMatter: vi.fn(async (_file: { path: string }, updater: (frontmatter: Record<string, unknown>) => void) => {
          updater({});
        }),
      },
      workspace: {
        getActiveFile: () => null,
        getMostRecentLeaf: () => null,
        getLeaf: vi.fn(() => ({
          openFile: vi.fn(async () => {}),
        })),
      },
      metadataCache: {
        resolvedLinks: {},
        unresolvedLinks: {},
      },
    } as never,
    files,
  };
}

function createPanel(id: string, linkedSkillNames: string[]): StudyRecipe {
  return {
    id,
    title: "Paper",
    description: "Read attached papers with panel-selected skills.",
    commandAlias: "paper",
    workflow: "paper",
    promptTemplate: "Explain this paper carefully.",
    linkedSkillNames,
    contextContract: {
      summary: "",
      requireTargetNote: false,
      recommendAttachments: true,
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
  };
}

function createWatchdogError(
  message: string,
  stage: "stall_recovery" | "stall_abort",
  threadId: string | null,
): Error {
  const error = new Error(message) as Error & {
    noTurnEvents?: boolean;
    noAssistantOutput?: boolean;
    noMeaningfulProgress?: boolean;
    resolvedCommand?: string;
    watchdogStage?: "stall_recovery" | "stall_abort";
    codexThreadId?: string | null;
  };
  error.noTurnEvents = false;
  error.noAssistantOutput = true;
  error.noMeaningfulProgress = false;
  error.resolvedCommand = "codex";
  error.watchdogStage = stage;
  error.codexThreadId = threadId;
  return error;
}

function createAbortError(reason: "user_interrupt" | "approval_abort" | "tab_close" | "plugin_unload" | "runtime_abort"): Error {
  const error = new Error("Turn interrupted.") as Error & { abortReason?: string };
  error.name = "AbortError";
  error.abortReason = reason;
  return error;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type PrivateRunTurn = (
  tabId: string,
  prompt: string,
  mode: "normal" | "skill",
  composeMode: "chat" | "plan",
  skillNames: string[],
  turnContext: TurnContextSnapshot,
  images: string[],
  workingDirectory: string,
  runtime: "native" | "wsl",
  executablePath: string,
  launcherOverrideParts: string[] | undefined,
  allowVaultWrite: boolean,
  draftBackup: string,
  allowEmptyReplyRecovery?: boolean,
  watchdogRecoveryAttempted?: boolean,
  turnId?: string | null,
  userMessageId?: string | null,
) => Promise<void>;

function createNoteTurnContext(vaultRoot: string, overrides: Partial<TurnContextSnapshot> = {}): TurnContextSnapshot {
  return {
    activeFilePath: "notes/current.md",
    targetNotePath: "notes/current.md",
    studyWorkflow: null,
    conversationSummaryText: null,
    sourceAcquisitionMode: "vault_note",
    sourceAcquisitionContractText: "Source acquisition is already complete.",
    workflowText: null,
    pluginFeatureText: null,
    paperStudyRuntimeOverlayText: null,
    skillGuideText: null,
    paperStudyGuideText: null,
    mentionContextText: null,
    selection: null,
    selectionSourcePath: "notes/current.md",
    vaultRoot,
    dailyNotePath: null,
    contextPackText: null,
    attachmentManifestText: null,
    attachmentContentText: null,
    noteSourcePackText: "Target note source pack",
    attachmentMissingPdfTextNames: [],
    attachmentMissingSourceNames: [],
    ...overrides,
  };
}

describe("CodexService sendPrompt skill context", () => {
  it.each([
    "Improve this note.",
    "Translate this note into Japanese.",
    "Clean up this note.",
  ])("treats common edit phrasing as vault-write intent: %s", async (promptText) => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-edit-intent-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    await service.sendPrompt(tabId, promptText);

    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    expect(runTurnSpy.mock.calls[0]?.[11]).toBe(true);
  });

  it("arms a new pending turn when a duplicate visible prompt is suppressed", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-duplicate-prompt-pending-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    await service.sendPrompt(tabId, "Repeat this prompt.");
    await tick();
    await service.sendPrompt(tabId, "Repeat this prompt.");
    await tick();

    const userMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "user") ?? [];
    const secondTurnId = runTurnSpy.mock.calls[1]?.[15] as string | null | undefined;
    const secondUserMessageId = runTurnSpy.mock.calls[1]?.[16] as string | null | undefined;
    const pendingTurn = (
      service as unknown as {
        pendingTurns: Map<string, { turnId: string; userMessageId: string | null }>;
      }
    ).pendingTurns.get(tabId);

    expect(userMessages).toHaveLength(1);
    expect(runTurnSpy).toHaveBeenCalledTimes(2);
    expect(secondTurnId).toEqual(expect.stringMatching(/^turn-/));
    expect(secondUserMessageId).toEqual(expect.stringMatching(/^user-/));
    expect(pendingTurn).toMatchObject({
      turnId: secondTurnId,
      userMessageId: secondUserMessageId,
    });
  });

  it("hydrates panel-selected skills before building the turn context", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-sendprompt-"));
    tempRoots.push(vaultRoot);
    const extraSkillRoot = join(vaultRoot, "extra-skills");
    const skillDir = join(extraSkillRoot, "panel-test-skill");
    const skillPath = join(skillDir, "SKILL.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, "# Panel Test Skill\nUse this guide.", "utf8");

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      extraSkillRoots: [extraSkillRoot],
    };
    const service = new CodexService(
      createApp(vaultRoot),
      () => settings,
      () => "en",
      null,
      async () => {},
      async () => {},
    );
    const panelSkillDefinition = {
      name: "panel-test-skill",
      description: "Panel-only skill.",
      path: skillPath,
    };

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const refreshSpy = vi.spyOn(service as never, "refreshCodexCatalogs").mockImplementation(async () => {
      (service as unknown as { installedSkillCatalog: typeof panelSkillDefinition[] }).installedSkillCatalog = [panelSkillDefinition];
    });
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.setStudyRecipes([createPanel("panel-1", ["panel-test-skill"])]);
    service.store.setActiveStudyPanel(tabId, "panel-1", ["panel-test-skill"]);

    await service.sendPrompt(tabId, "Explain this paper carefully.");

    expect(refreshSpy).toHaveBeenCalled();
    expect(runTurnSpy).toHaveBeenCalledTimes(1);

    const skillNames = runTurnSpy.mock.calls[0]?.[4] as string[];
    const turnContext = runTurnSpy.mock.calls[0]?.[5] as TurnContextSnapshot;
    expect(skillNames).toEqual(["panel-test-skill"]);
    expect(turnContext.skillGuideText).toContain("Skill guide: $panel-test-skill");
    expect(turnContext.skillGuideText).toContain("# Panel Test Skill\nUse this guide.");
    const userMessage = service.getActiveTab()?.messages.find((message) => message.kind === "user");
    expect(userMessage?.meta?.effectiveSkillsCsv).toBe("panel-test-skill");
    expect(userMessage?.meta?.effectiveSkillCount).toBe(1);
  });

  it("syncs learning mode across open tabs", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-modifiers-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const secondTab = service.createTab();
    if (!secondTab) {
      throw new Error("Missing second tab");
    }

    expect(service.getActiveTab()?.learningMode).toBe(false);
    expect(service.toggleTabLearningMode(tabId)).toBe(true);
    expect(service.store.getState().tabs.every((tab) => tab.learningMode === true)).toBe(true);
    service.activateTab(secondTab.id);
    expect(service.getActiveTab()?.learningMode).toBe(true);
    expect(service.setTabLearningMode(tabId, false)).toBe(false);
    expect(service.store.getState().tabs.every((tab) => tab.learningMode === false)).toBe(true);
    expect(runTurnSpy).not.toHaveBeenCalled();
  });

  it("syncs fast and learning modes across sessions and reuses them for new tabs and sessions", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-sticky-modes-"));
    tempRoots.push(vaultRoot);

    let settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      defaultFastMode: false,
      defaultLearningMode: false,
    };
    const updateSettings = vi.fn(async (next: PluginSettings) => {
      settings = next;
    });

    const service = new CodexService(
      createApp(vaultRoot),
      () => settings,
      () => "en",
      null,
      async () => {},
      updateSettings,
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const existingTab = service.createTab();
    if (!existingTab) {
      throw new Error("Missing existing tab");
    }

    service.setTabFastMode(tabId, true);
    expect(service.setTabLearningMode(tabId, true)).toBe(true);
    await Promise.resolve();

    expect(updateSettings).toHaveBeenCalled();
    expect(settings.defaultFastMode).toBe(true);
    expect(settings.defaultLearningMode).toBe(true);
    expect(service.getActiveTab()?.fastMode).toBe(true);
    expect(service.getActiveTab()?.learningMode).toBe(true);
    expect(service.store.getState().tabs.every((tab) => tab.fastMode === true)).toBe(true);
    expect(service.store.getState().tabs.every((tab) => tab.learningMode === true)).toBe(true);

    service.activateTab(existingTab.id);
    expect(service.getActiveTab()?.fastMode).toBe(true);
    expect(service.getActiveTab()?.learningMode).toBe(true);

    const createdTab = service.createTab();
    expect(createdTab?.fastMode).toBe(true);
    expect(createdTab?.learningMode).toBe(true);

    service.setTabFastMode(existingTab.id, false);
    expect(service.setTabLearningMode(existingTab.id, false)).toBe(false);
    await Promise.resolve();
    expect(settings.defaultFastMode).toBe(false);
    expect(settings.defaultLearningMode).toBe(false);
    expect(service.store.getState().tabs.every((tab) => tab.fastMode === false)).toBe(true);
    expect(service.store.getState().tabs.every((tab) => tab.learningMode === false)).toBe(true);

    expect(service.startNewSession(tabId)).toBe(true);
    expect(service.store.getState().tabs.find((tab) => tab.id === tabId)?.fastMode).toBe(false);
    expect(service.store.getState().tabs.find((tab) => tab.id === tabId)?.learningMode).toBe(false);
  });

  it("reuses in-memory global modes for new sessions before settings persistence resolves", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-sticky-modes-race-"));
    tempRoots.push(vaultRoot);

    let settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      defaultFastMode: false,
      defaultLearningMode: false,
    };
    let releasePersist!: () => void;
    const persistGate = new Promise<void>((resolve) => {
      releasePersist = () => resolve();
    });
    const updateSettings = vi.fn(async (next: PluginSettings) => {
      await persistGate;
      settings = next;
    });

    const service = new CodexService(
      createApp(vaultRoot),
      () => settings,
      () => "en",
      null,
      async () => {},
      updateSettings,
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.setTabFastMode(tabId, true);
    expect(service.setTabLearningMode(tabId, true)).toBe(true);

    const createdTab = service.createTab();
    expect(createdTab?.fastMode).toBe(true);
    expect(createdTab?.learningMode).toBe(true);

    expect(service.startNewSession(tabId)).toBe(true);
    expect(service.store.getState().tabs.find((tab) => tab.id === tabId)?.fastMode).toBe(true);
    expect(service.store.getState().tabs.find((tab) => tab.id === tabId)?.learningMode).toBe(true);

    releasePersist();
    await Promise.resolve();
  });

  it("stores rewrite-followup suggestions and turns them into a formatting rewrite prompt", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-rewrite-followup-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const assistantText = [
      "Here is the cleaned-up explanation.",
      "",
      "Want me to apply this to the note now?",
      "",
      "```obsidian-suggest",
      JSON.stringify({
        kind: "rewrite_followup",
        summary: "Turn this answer into a formatting-focused note patch.",
        question: "Want me to apply this to the note now?",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-1",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-1", assistantText);

    expect(service.getActiveTab()?.chatSuggestion?.kind).toBe("rewrite_followup");

    const sendPromptSpy = vi.spyOn(service, "sendPrompt").mockResolvedValue();
    await service.respondToChatSuggestion(tabId, "rewrite_note", { file: null, editor: null });

    expect(sendPromptSpy).toHaveBeenCalledTimes(1);
    const prompt = sendPromptSpy.mock.calls[0]?.[1];
    expect(prompt).toContain("Formatting bundle");
    expect(prompt).toContain("evidence: kind|label|sourceRef|snippet");
    expect(prompt).toContain("prefer the active note for this turn");
    expect(prompt).toContain("Here is the cleaned-up explanation.");
  });

  it("stores a short visible rewrite label while sending the full rewrite execution prompt", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-rewrite-followup-visible-label-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const assistantText = [
      "Here is the cleaned-up explanation.",
      "",
      "Want me to apply this to the note now?",
      "",
      "```obsidian-suggest",
      JSON.stringify({
        kind: "rewrite_followup",
        summary: "Turn this answer into a formatting-focused note patch.",
        question: "Want me to apply this to the note now?",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-1",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-1", assistantText);

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    await service.respondToChatSuggestion(tabId, "rewrite_note", { file: null, editor: null });

    const userMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "user") ?? [];
    expect(userMessages.at(-1)?.text).toBe("Apply to note");
    expect(userMessages.at(-1)?.meta?.internalPromptKind).toBe("rewrite_followup");
    expect(userMessages.at(-1)?.text.includes("Turn your immediately previous assistant answer")).toBe(false);

    const prompt = runTurnSpy.mock.calls[0]?.[1];
    expect(prompt).toContain("Turn your immediately previous assistant answer in this same thread");
    expect(prompt).toContain("Here is the cleaned-up explanation.");
  });

  it("treats Japanese affirmation as accepting a pending apply-to-note suggestion", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-rewrite-followup-affirmation-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "ja",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const assistantText = [
      "平均負荷電力の導出を短く整理できます。",
      "",
      "この内容を今のノートに適用しますか？",
      "",
      "```obsidian-suggest",
      JSON.stringify({
        kind: "rewrite_followup",
        summary: "Turn the previous explanation into a concise note patch.",
        question: "この内容を今のノートに適用しますか？",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-affirmation-1",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-affirmation-1", assistantText);

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    await service.sendPrompt(tabId, "はい", { file: null, editor: null });

    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    expect(runTurnSpy.mock.calls[0]?.[1]).toContain("Turn your immediately previous assistant answer");
    expect(runTurnSpy.mock.calls[0]?.[1]).not.toBe("はい");
    const userMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "user") ?? [];
    expect(userMessages.at(-1)?.text).toBe("ノートに適用");
    expect(userMessages.at(-1)?.meta?.internalPromptKind).toBe("rewrite_followup");
  });

  it("applies the only pending patch when the user sends an affirmative reply", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-pending-patch-affirmation-"));
    tempRoots.push(vaultRoot);

    const writable = createWritableApp(vaultRoot, { "notes/current.md": "# Current\n\nOriginal" });
    const service = new CodexService(writable.app, () => DEFAULT_SETTINGS, () => "en", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.setPatchBasket(tabId, [
      {
        id: "patch-affirm-1",
        threadId: null,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        targetPath: "notes/current.md",
        kind: "update",
        baseSnapshot: "# Current\n\nOriginal",
        proposedText: "# Current\n\nOriginal\n\nAdded line.",
        unifiedDiff: "@@",
        summary: "Add one line.",
        status: "pending",
        createdAt: Date.now(),
      },
    ]);

    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    await service.sendPrompt(tabId, "yes", { file: null, editor: null });

    expect(runTurnSpy).not.toHaveBeenCalled();
    expect(writable.files.get("notes/current.md")).toBe("# Current\n\nOriginal\n\nAdded line.");
    expect(service.getActiveTab()?.patchBasket[0]?.status).toBe("applied");
  });

  it("treats affirmative replies to Panel Studio suggestions as local panel updates", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-panel-affirmation-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "ja",
      null,
      async () => {},
      async () => {},
    );
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const panel = createPanel("panel-1", ["note-refiner"]);
    service.store.setStudyRecipes([panel]);
    service.store.setChatSuggestion(tabId, {
      id: "panel-suggestion-1",
      kind: "panel_completion",
      status: "pending",
      messageId: "assistant-panel-suggestion",
      panelId: panel.id,
      panelTitle: panel.title,
      promptSnapshot: "Explain this paper with a short exam checklist.",
      matchedSkillName: "note-refiner",
      canUpdatePanel: true,
      canSaveCopy: true,
      planSummary: null,
      planStatus: null,
      createdAt: Date.now(),
    });

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    await service.sendPrompt(tabId, "はい", { file: null, editor: null });
    await tick();

    expect(runTurnSpy).not.toHaveBeenCalled();
    expect(service.getStudyRecipes()[0]?.promptTemplate).toBe("Explain this paper with a short exam checklist.");
    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
    expect(service.getActiveTab()?.messages.at(-1)?.text).toContain("Panel");
    expect(service.getActiveTab()?.messages.at(-1)?.meta?.tone).toBe("success");
  });

  it("marks suggestion-only note edit replies as proposal_only with the resolved target path", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-edit-outcome-proposal-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const assistantText = [
      "Applied the requested cleanup.",
      "",
      "```obsidian-patch",
      "path: notes/source.md",
      "kind: create",
      "summary: Create a cleaned-up note",
      "",
      "---content",
      "# Source",
      "",
      "Cleaned note.",
      "---end",
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-proposal",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-proposal", assistantText);

    const assistantMessage = service.getActiveTab()?.messages.find((message) => message.id === "assistant-proposal");
    expect(assistantMessage?.meta?.editOutcome).toBe("proposal_only");
    expect(assistantMessage?.meta?.editTargetPath).toBe("notes/source.md");
  });

  it("marks explanation-only replies while keeping the rewrite CTA", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-edit-outcome-explanation-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const assistantText = [
      "This explanation clarifies the note.",
      "",
      "Want me to apply this to the note now?",
      "",
      "```obsidian-suggest",
      JSON.stringify({
        kind: "rewrite_followup",
        summary: "Apply the explanation to the note.",
        question: "Want me to apply this to the note now?",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-explanation",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-explanation", assistantText);

    const assistantMessage = service.getActiveTab()?.messages.find((message) => message.id === "assistant-explanation");
    expect(assistantMessage?.meta?.editOutcome).toBe("explanation_only");
    expect(service.getActiveTab()?.chatSuggestion?.kind).toBe("rewrite_followup");
  });

  it("rescues the reported missing-note-reflection shape with a hidden repair on non-edit prompts", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-reflection-rescue-"));
    tempRoots.push(vaultRoot);

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      permissionMode: "auto-edit",
    };
    const service = new CodexService(
      createApp(vaultRoot),
      () => settings,
      () => "ja",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "ここで決めているのは n=11 ではなく、まず総ダブラ数の指数 N=11 です。",
              "",
              "この説明を Step 1 の直後に短く追記しますか？",
              "",
              "Changes proposed below.",
            ].join("\n"),
          },
        });
        return { threadId: "thread-reflection-repair-1" };
      })
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "```obsidian-patch",
              "path: notes/current.md",
              "kind: update",
              "summary: Add the N=11 justification after Step 1",
              "",
              "---content",
              "Step 1 updated content.",
              "---end",
              "```",
            ].join("\n"),
          },
        });
        return { threadId: "thread-reflection-repair-1" };
      });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "なぜ N=11 が唯一の成立値なのか説明して。",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    expect(service.getActiveTab()?.patchBasket).toEqual([
      expect.objectContaining({
        targetPath: "notes/current.md",
        status: "pending",
      }),
    ]);
    const assistantMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.meta?.editOutcome).toBe("review_required");
    expect(assistantMessages[0]?.meta?.editTargetPath).toBe("notes/current.md");
    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
    expect(assistantMessages.some((message) => message.text.includes("Turn your immediately previous assistant answer"))).toBe(false);
  }, 20000);

  it("falls back to an inferred rewrite CTA when hidden reflection repair still fails", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-reflection-fallback-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "ja",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "ここで決めているのは n=11 ではなく、まず総ダブラ数の指数 N=11 です。",
              "",
              "この説明を Step 1 の直後に短く追記しますか？",
              "",
              "Changes proposed below.",
            ].join("\n"),
          },
        });
        return { threadId: "thread-reflection-fallback-1" };
      })
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: "ここではまだ説明だけに留めます。",
          },
        });
        return { threadId: "thread-reflection-fallback-1" };
      });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "なぜ N=11 が唯一の成立値なのか説明して。",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    expect(service.getActiveTab()?.status).not.toBe("error");
    expect(service.getActiveTab()?.patchBasket).toEqual([]);
    expect(service.getActiveTab()?.chatSuggestion).toMatchObject({
      kind: "rewrite_followup",
      messageId: expect.any(String),
      rewriteQuestion: "この説明を Step 1 の直後に短く追記しますか？",
    });
    const assistantMessage = service.getActiveTab()?.messages.find((message) => message.kind === "assistant");
    expect(assistantMessage?.meta?.editOutcome).toBe("explanation_only");
  }, 20000);

  it("infers a conservative rewrite CTA for note-ready explanations without strong repair markers", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-reflection-cta-only-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: "This explanation clarifies the note and tightens Step 1.",
          },
        });
        return { threadId: "thread-reflection-cta-only-1" };
      });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Explain why Step 1 uses N=11.",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(1);
    expect(service.getActiveTab()?.chatSuggestion).toMatchObject({
      kind: "rewrite_followup",
      rewriteQuestion: "Want me to apply this to the note now?",
    });
    const assistantMessage = service.getActiveTab()?.messages.find((message) => message.kind === "assistant");
    expect(assistantMessage?.meta?.editOutcome).toBe("explanation_only");
  });

  it("does not infer note reflection rescue when no note target is resolvable", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-reflection-no-target-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    vi.spyOn(service as never, "runCodexStream").mockImplementationOnce(async (request) => {
      (request as { onEvent: (event: unknown) => void }).onEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "This explanation clarifies the note and tightens Step 1.",
        },
      });
      return { threadId: "thread-reflection-no-target-1" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Explain why Step 1 uses N=11.",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot, {
        activeFilePath: null,
        targetNotePath: null,
        selectionSourcePath: null,
        sourceAcquisitionMode: "workspace_generic",
        noteSourcePackText: null,
      }),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
    const assistantMessage = service.getActiveTab()?.messages.find((message) => message.kind === "assistant");
    expect(assistantMessage?.meta?.editOutcome).toBeUndefined();
  });

  it("does not infer note reflection rescue when the user explicitly asked not to edit", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-reflection-opt-out-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.addMessage(tabId, {
      id: "user-opt-out",
      kind: "user",
      text: "Don't edit the note. Just explain why Step 1 uses N=11.",
      createdAt: Date.now(),
    });

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi.spyOn(service as never, "runCodexStream").mockImplementationOnce(async (request) => {
      (request as { onEvent: (event: unknown) => void }).onEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "This explanation clarifies the note and tightens Step 1.",
        },
      });
      return { threadId: "thread-reflection-opt-out-1" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Don't edit the note. Just explain why Step 1 uses N=11.",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(1);
    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
    const assistantMessage = service.getActiveTab()?.messages.find((message) => message.kind === "assistant");
    expect(assistantMessage?.meta?.editOutcome).toBeUndefined();
  });

  it("updates hidden adaptation memory and queues a skill-update approval after a successful applied note edit", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-growth-"));
    tempRoots.push(vaultRoot);
    const extraSkillRoot = join(vaultRoot, "extra-skills");
    const skillDir = join(extraSkillRoot, "note-refiner");
    const skillPath = join(skillDir, "SKILL.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, "# Note Refiner\n\nUse concise structural rewrites.\n", "utf8");

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      extraSkillRoots: [extraSkillRoot],
    };
    const writable = createWritableApp(vaultRoot);
    const service = new CodexService(
      writable.app,
      () => settings,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const panel = createPanel("panel-1", ["note-refiner"]);
    service.store.setStudyRecipes([panel]);
    service.store.setActiveStudyPanel(tabId, panel.id, ["note-refiner"]);
    (service as unknown as { allInstalledSkillCatalog: Array<{ name: string; description: string; path: string }> }).allInstalledSkillCatalog = [
      { name: "note-refiner", description: "User-owned note rewrite skill.", path: skillPath },
    ];
    (service as unknown as { installedSkillCatalog: Array<{ name: string; description: string; path: string }> }).installedSkillCatalog = [
      { name: "note-refiner", description: "User-owned note rewrite skill.", path: skillPath },
    ];

    service.store.addMessage(tabId, {
      id: "user-1",
      kind: "user",
      text: "Rewrite the active note so the explanation is step-by-step with clear bullets and one pitfall.",
      createdAt: Date.now(),
      meta: {
        turnId: "turn-1",
        turnStatus: "submitted",
        effectiveSkillsCsv: "note-refiner",
        effectiveSkillCount: 1,
        activePanelId: "panel-1",
      },
    });

    const assistantText = [
      "Applied the requested rewrite.",
      "",
      "```obsidian-patch",
      "path: Notes/Active.md",
      "kind: create",
      "summary: Create a cleaner study note",
      "",
      "---content",
      "# Active",
      "",
      "- Step 1: Define the key concept.",
      "- Step 2: Walk through the example.",
      "",
      "## Pitfall",
      "- Do not confuse the two symbols.",
      "---end",
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-1",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-1", assistantText);

    const patchId = service.getActiveTab()?.patchBasket[0]?.id;
    expect(patchId).toBeTruthy();
    await service.applyPatchProposal(tabId, patchId ?? "");

    const state = service.store.getState() as ReturnType<typeof service.store.getState> & { userAdaptationMemory?: any };
    expect(state.userAdaptationMemory?.globalProfile?.preferredFocusTags).toContain("pitfalls");
    expect(state.userAdaptationMemory?.panelOverlays?.["panel-1"]?.preferredSkillNames).toContain("note-refiner");
    const skillApprovals = service.getActiveTab()?.pendingApprovals.filter((approval) => approval.toolName === ("skill_update" as never)) ?? [];
    expect(skillApprovals).toHaveLength(1);
    expect(skillApprovals[0]?.title).toContain("note-refiner");
    expect(skillApprovals[0]?.description).toContain(skillPath);
  });

  it("stores study checkpoints and carries weak-point context into the next turn", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-checkpoint-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.setTabLearningMode(tabId, true);
    service.store.setTabStudyWorkflow(tabId, "review");

    const assistantText = [
      "Convolution becomes multiplication in frequency space because the transform turns the sliding integral into algebraic multiplication.",
      "",
      "Quick check: why is that conversion useful when you analyze a system?",
      "",
      "```obsidian-study-checkpoint",
      JSON.stringify({
        workflow: "review",
        mastered: ["Can explain the headline reason convolution becomes multiplication."],
        unclear: ["Still unclear on why the transform changes a sliding integral into multiplication."],
        next_step: "Explain the bridge between convolution and multiplication in one sentence.",
        confidence_note: "The learner understands the headline result but cannot justify the bridge yet.",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-study-1",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-study-1", assistantText);

    expect(service.getActiveTab()?.studyCoachState).toEqual({
      latestRecap: {
        workflow: "review",
        mastered: ["Can explain the headline reason convolution becomes multiplication."],
        unclear: ["Still unclear on why the transform changes a sliding integral into multiplication."],
        nextStep: "Explain the bridge between convolution and multiplication in one sentence.",
        confidenceNote: "The learner understands the headline result but cannot justify the bridge yet.",
      },
      weakPointLedger: [
        expect.objectContaining({
          conceptLabel: "Still unclear on why the transform changes a sliding integral into multiplication.",
          workflow: "review",
          explanationSummary: "The learner understands the headline result but cannot justify the bridge yet.",
          nextQuestion: "Explain the bridge between convolution and multiplication in one sentence.",
          resolved: false,
        }),
      ],
      lastCheckpointAt: expect.any(Number),
    });

    const captureTurnContext = (
      service as unknown as Record<
        string,
        (
          tabId: string,
          file: null,
          editor: null,
          prompt: string,
          slashCommand: string | null,
          attachments: [],
          mentionContextText: string | null,
          explicitTargetNotePath: string | null,
          skillNames: string[],
          resolvedSkillDefinitions: [],
        ) => Promise<TurnContextSnapshot>
      >
    )["captureTurnContext"];
    const context = await captureTurnContext.call(service, tabId, null, null, "Continue helping me review this topic.", null, [], null, null, [], []);

    expect(context.studyCoachText).toContain("Study coach carry-forward:");
    expect(context.studyCoachText).toContain("Workflow-specific coach guidance:");
    expect(context.studyCoachText).toContain("Weak point: The learner understands the headline result but cannot justify the bridge yet.");
    expect(context.studyCoachText).toContain("Next check: Explain the bridge between convolution and multiplication in one sentence.");
  });

  it("does not auto-inject grill-me in plan mode", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-planmode-"));
    tempRoots.push(vaultRoot);

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
    };
    const service = new CodexService(
      createApp(vaultRoot),
      () => settings,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.setTabComposeMode(tabId, "plan");
    await service.sendPrompt(tabId, "Refine this implementation plan.");

    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    expect(runTurnSpy.mock.calls[0]?.[1]).toBe("Refine this implementation plan.");
    expect(runTurnSpy.mock.calls[0]?.[4]).toEqual([]);
    const userMessage = service.getActiveTab()?.messages.find((message) => message.kind === "user");
    expect(userMessage?.meta?.effectiveSkillsCsv).toBeNull();
    expect(userMessage?.meta?.effectiveSkillCount).toBeUndefined();
  });

  it("keeps explicit $grill-me in plan mode", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-planmode-explicit-"));
    tempRoots.push(vaultRoot);

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
    };
    const service = new CodexService(
      createApp(vaultRoot),
      () => settings,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.setTabComposeMode(tabId, "plan");
    await service.sendPrompt(tabId, "$grill-me refine this implementation plan");

    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    expect(runTurnSpy.mock.calls[0]?.[1]).toBe("$grill-me refine this implementation plan");
    expect(runTurnSpy.mock.calls[0]?.[4]).toEqual(["grill-me"]);
    const userMessage = service.getActiveTab()?.messages.find((message) => message.kind === "user");
    expect(userMessage?.meta?.effectiveSkillsCsv).toBe("grill-me");
    expect(userMessage?.meta?.effectiveSkillCount).toBe(1);
  });

  it("auto-compacts long conversations before sending the next turn", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-compact-send-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.setCodexThreadId(tabId, "thread-1");
    for (let index = 0; index < 40; index += 1) {
      service.store.addMessage(tabId, {
        id: `m${index}`,
        kind: index % 2 === 0 ? "user" : "assistant",
        text: `Message ${index}`,
        createdAt: index,
      });
    }

    await service.sendPrompt(tabId, "Continue the discussion.");

    const activeTab = service.getActiveTab();
    const turnContext = runTurnSpy.mock.calls[0]?.[5] as TurnContextSnapshot;
    expect(activeTab?.summary?.text).toContain("Recent user requests:");
    expect(activeTab?.lineage.pendingThreadReset).toBe(true);
    expect(activeTab?.messages.some((message) => message.kind === "system" && message.text.includes("auto-compacted"))).toBe(true);
    expect(turnContext.conversationSummaryText).toContain("Conversation carry-forward summary");
  });

  it("replaces leaked internal rewrite prompts inside compaction summaries", () => {
    const service = new CodexService(
      createApp("/vault"),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.addMessage(tabId, {
      id: "rewrite-user",
      kind: "user",
      text: [
        "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
        "Target the current session target note if one is set; otherwise target the active note for this turn.",
        "If a selection snapshot is attached, limit the rewrite to that selected section or the nearest matching section instead of rewriting the whole note.",
        "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
        "Add concise evidence lines to the patch header when possible using `evidence: kind|label|sourceRef|snippet`.",
        "Prefer vault-note and attachment evidence first. If that is insufficient, you may use web research and mark those evidence lines with `kind` = `web` and a source URL.",
        "Do not ask whether to apply the change. Emit the patch now and keep any visible chat summary to at most 2 short sentences.",
        "Assistant answer to convert:",
        "Summarize Step 1 cleanly.",
      ].join("\n\n"),
      createdAt: 1,
    });
    service.store.addMessage(tabId, {
      id: "assistant-1",
      kind: "assistant",
      text: "Here is the concise Step 1 explanation.",
      createdAt: 2,
    });

    service.compactTab(tabId);

    expect(service.getActiveTab()?.summary?.text).toContain("- Apply to note");
    expect(service.getActiveTab()?.summary?.text).not.toContain("Turn your immediately previous assistant answer");
  });

  it("retries once on a fresh thread when the first run finishes without a visible reply", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-empty-reply-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    vi.spyOn(service as never, "waitForTranscriptSyncRetryDelay").mockResolvedValue(undefined);
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async () => ({ threadId: "thread-empty" }))
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "Recovered reply",
            phase: "final_answer",
          },
        });
        return { threadId: "thread-fresh" };
      });

    const context: TurnContextSnapshot = {
      activeFilePath: null,
      targetNotePath: null,
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "workspace_generic",
      sourceAcquisitionContractText: null,
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: null,
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: null,
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Continue the discussion.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    const firstRun = runCodexStreamSpy.mock.calls[0]?.[0] as { threadId: string | null } | undefined;
    const secondRun = runCodexStreamSpy.mock.calls[1]?.[0] as { threadId: string | null } | undefined;
    expect(firstRun?.threadId ?? null).toBeNull();
    expect(secondRun?.threadId ?? null).toBeNull();
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "system" && message.text.includes("retried on a fresh thread"))).toBe(false);
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "assistant" && message.text === "Recovered reply")).toBe(true);
    expect(service.getActiveTab()?.codexThreadId).toBe("thread-fresh");
    expect(service.getActiveTab()?.lineage.pendingThreadReset).toBe(false);
  });

  it("backfills the last visible assistant reply instead of a later internal rewrite prompt tail", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-session-visible-backfill-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.addMessage(tabId, {
      id: "user-1",
      kind: "user",
      text: "Explain this note.",
      createdAt: Date.now(),
    });

    const sessionFile = join(vaultRoot, "rollout-session-visible-thread.jsonl");
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ text: "Recovered visible answer." }],
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "task_complete",
            last_agent_message: [
              "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
              "Target the current session target note if one is set; otherwise target the active note for this turn.",
              "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
              "Add concise evidence lines to the patch header when possible using evidence: kind|label|sourceRef|snippet.",
              "Do not ask whether to apply the change.",
            ].join("\n"),
          },
        }),
      ].join("\n"),
      "utf8",
    );

    vi.spyOn(service as never, "resolveSessionFile").mockResolvedValue(sessionFile);

    await expect(
      (
        service as unknown as {
          syncTranscriptFromSession: (tabId: string, threadId: string, visibility: "visible" | "artifact_only") => Promise<string>;
        }
      ).syncTranscriptFromSession(tabId, "thread-visible", "visible"),
    ).resolves.toBe("appended_reply");

    const assistantMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.text).toBe("Recovered visible answer.");
    expect(assistantMessages[0]?.text.includes("Turn your immediately previous assistant answer")).toBe(false);
  });

  it("uses distinct ids for multiple recovered replies in the same thread", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-session-distinct-backfill-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.addMessage(tabId, {
      id: "user-1",
      kind: "user",
      text: "Explain this note.",
      createdAt: Date.now(),
    });

    const sessionFile = join(vaultRoot, "rollout-session-repeat-thread.jsonl");
    const writeRecoveredMessage = async (text: string) => {
      await writeFile(
        sessionFile,
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ text }],
          },
        }),
        "utf8",
      );
    };
    await writeRecoveredMessage("First recovered answer.");

    vi.spyOn(service as never, "resolveSessionFile").mockResolvedValue(sessionFile);
    const syncTranscriptFromSession = (
      service as unknown as {
        syncTranscriptFromSession: (tabId: string, threadId: string, visibility: "visible" | "artifact_only") => Promise<string>;
      }
    ).syncTranscriptFromSession.bind(service);

    await expect(syncTranscriptFromSession(tabId, "thread-repeat", "visible")).resolves.toBe("appended_reply");
    service.store.addMessage(tabId, {
      id: "user-2",
      kind: "user",
      text: "Follow up.",
      createdAt: Date.now(),
    });
    await writeRecoveredMessage("Second recovered answer.");

    await expect(syncTranscriptFromSession(tabId, "thread-repeat", "visible")).resolves.toBe("appended_reply");

    const assistantMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(assistantMessages.map((message) => message.text)).toEqual(["First recovered answer.", "Second recovered answer."]);
    expect(new Set(assistantMessages.map((message) => message.id)).size).toBe(2);
  });

  it("suppresses duplicate assistant backfill when the visible answer is already in the transcript", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-session-duplicate-backfill-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.addMessage(tabId, {
      id: "user-1",
      kind: "user",
      text: "Explain this note.",
      createdAt: Date.now(),
    });
    service.store.addMessage(tabId, {
      id: "assistant-live",
      kind: "assistant",
      text: "Already visible answer.",
      createdAt: Date.now(),
    });

    const sessionFile = join(vaultRoot, "rollout-session-duplicate-thread.jsonl");
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ text: "Already visible answer." }],
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "task_complete",
            last_agent_message: [
              "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
              "Target the current session target note if one is set; otherwise target the active note for this turn.",
              "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
              "Add concise evidence lines to the patch header when possible using evidence: kind|label|sourceRef|snippet.",
              "Do not ask whether to apply the change.",
              "Assistant answer to convert: Already visible answer.",
            ].join("\n"),
          },
        }),
      ].join("\n"),
      "utf8",
    );

    vi.spyOn(service as never, "resolveSessionFile").mockResolvedValue(sessionFile);

    await expect(
      (
        service as unknown as {
          syncTranscriptFromSession: (tabId: string, threadId: string, visibility: "visible" | "artifact_only") => Promise<string>;
        }
      ).syncTranscriptFromSession(tabId, "thread-duplicate", "visible"),
    ).resolves.toBe("duplicate_reply");

    const assistantMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.text).toBe("Already visible answer.");
  });

  it("waits for a late session reply before compact retrying", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-late-session-reply-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "waitForTranscriptSyncRetryDelay").mockResolvedValue(undefined);
    const syncTranscriptSpy = vi
      .spyOn(service as never, "syncTranscriptFromSession")
      .mockImplementationOnce(async () => "session_missing")
      .mockImplementationOnce(async () => {
        service.store.addMessage(tabId, {
          id: "assistant-late",
          kind: "assistant",
          text: "Recovered from late session flush",
          createdAt: Date.now(),
        });
        return "appended_reply";
      });
    const runCodexStreamSpy = vi.spyOn(service as never, "runCodexStream").mockResolvedValue({ threadId: "thread-late" });

    const context: TurnContextSnapshot = {
      activeFilePath: null,
      targetNotePath: null,
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "workspace_generic",
      sourceAcquisitionContractText: null,
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: null,
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: null,
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Continue the discussion.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(1);
    expect(syncTranscriptSpy).toHaveBeenCalledTimes(2);
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "assistant" && message.text === "Recovered from late session flush")).toBe(true);
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "system" && message.text.includes("retried on a fresh thread"))).toBe(false);
  });

  it("gives vault-note turns a longer transcript reconciliation grace window", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-note-grace-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "waitForTranscriptSyncRetryDelay").mockResolvedValue(undefined);
    const syncTranscriptSpy = vi
      .spyOn(service as never, "syncTranscriptFromSession")
      .mockImplementationOnce(async () => "session_missing")
      .mockImplementationOnce(async () => "session_missing")
      .mockImplementationOnce(async () => "session_missing")
      .mockImplementationOnce(async () => "session_missing")
      .mockImplementationOnce(async () => "session_missing")
      .mockImplementationOnce(async () => "session_missing")
      .mockImplementationOnce(async () => {
        service.store.addMessage(tabId, {
          id: "assistant-vault-note",
          kind: "assistant",
          text: "Recovered from delayed vault-note session flush",
          createdAt: Date.now(),
        });
        return "appended_reply";
      });
    const runCodexStreamSpy = vi.spyOn(service as never, "runCodexStream").mockResolvedValue({ threadId: "thread-vault-note" });

    const context: TurnContextSnapshot = {
      activeFilePath: "notes/current.md",
      targetNotePath: "notes/current.md",
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "vault_note",
      sourceAcquisitionContractText: "Source acquisition is already complete.",
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: "notes/current.md",
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: "Target note source pack",
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Explain this note.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(1);
    expect(syncTranscriptSpy).toHaveBeenCalledTimes(7);
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "assistant" && message.text === "Recovered from delayed vault-note session flush")).toBe(true);
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "system" && message.text.includes("retried on a fresh thread"))).toBe(false);
  });

  it("leaves a single normalized error when retry also ends with no visible reply", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-empty-reply-failure-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "waitForTranscriptSyncRetryDelay").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("session_missing");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockResolvedValueOnce({ threadId: "thread-empty-1" })
      .mockResolvedValueOnce({ threadId: "thread-empty-2" });

    const context: TurnContextSnapshot = {
      activeFilePath: null,
      targetNotePath: null,
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "workspace_generic",
      sourceAcquisitionContractText: null,
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: null,
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: null,
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Continue the discussion.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    const systemMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "system") ?? [];
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]?.text).toContain("Codex finished the turn without leaving a visible assistant reply.");
    expect(systemMessages[0]?.text).toContain("could not confirm a recoverable reply from session data");
    expect(systemMessages.some((message) => message.text.includes("retried on a fresh thread"))).toBe(false);
  });

  it("recovers a stalled turn on the same thread without compacting the conversation", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-watchdog-recovery-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("session_missing");
    vi.spyOn(service as never, "waitForTranscriptSyncRetryDelay").mockResolvedValue(undefined);
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockRejectedValueOnce(
        createWatchdogError(
          "Codex has been quiet for 300 seconds, so the plugin will try to recover this turn on the same thread.",
          "stall_recovery",
          "thread-stalled",
        ),
      )
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "Recovered after the stall.",
            phase: "final_answer",
          },
        });
        return { threadId: "thread-stalled" };
      });

    const context: TurnContextSnapshot = {
      activeFilePath: null,
      targetNotePath: null,
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "workspace_generic",
      sourceAcquisitionContractText: null,
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: null,
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: null,
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Keep working on this.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
      true,
      false,
      "turn-recovery",
      "user-recovery",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    const firstRequest = runCodexStreamSpy.mock.calls[0]?.[0] as { threadId: string | null } | undefined;
    const secondRequest = runCodexStreamSpy.mock.calls[1]?.[0] as { threadId: string | null } | undefined;
    expect(firstRequest?.threadId ?? null).toBeNull();
    expect(secondRequest?.threadId ?? null).toBe("thread-stalled");
    const systemMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "system") ?? [];
    expect(systemMessages.some((message) => message.text.includes("fresh thread"))).toBe(false);
    expect(systemMessages.some((message) => message.text === "Turn interrupted.")).toBe(false);
    expect(systemMessages.some((message) => message.text.includes("could not be recovered"))).toBe(false);
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "assistant" && message.text === "Recovered after the stall.")).toBe(true);
    expect(service.getActiveTab()?.codexThreadId).toBe("thread-stalled");
    expect((service as unknown as { pendingTurns: Map<string, unknown> }).pendingTurns.has(tabId)).toBe(false);
  });

  it("clears pending turn state when a running turn is interrupted by the user", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-user-interrupt-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "runCodexStream").mockImplementationOnce(
      async (request: unknown) =>
        await new Promise<never>((_, reject) => {
          const signal = (request as { signal: AbortSignal }).signal;
          signal.addEventListener("abort", () => reject(createAbortError("user_interrupt")), { once: true });
        }),
    );

    const context: TurnContextSnapshot = {
      activeFilePath: null,
      targetNotePath: null,
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "workspace_generic",
      sourceAcquisitionContractText: null,
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: null,
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: null,
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    const runTurnPromise = ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Keep working on this.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
      true,
      false,
      "turn-interrupt",
      "user-interrupt",
    );

    await tick();
    (service as unknown as { interruptActiveTurn: (tabId: string) => void }).interruptActiveTurn(tabId);
    await runTurnPromise;

    expect((service as unknown as { pendingTurns: Map<string, unknown> }).pendingTurns.has(tabId)).toBe(false);
  });

  it("surfaces a single normalized error when a stalled turn still cannot be recovered", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-watchdog-abort-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockRejectedValue(
        createWatchdogError(
          "Codex stopped responding long enough that this turn could not be recovered.",
          "stall_abort",
          "thread-stalled",
        ),
      );

    const context: TurnContextSnapshot = {
      activeFilePath: null,
      targetNotePath: null,
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "workspace_generic",
      sourceAcquisitionContractText: null,
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: null,
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: null,
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Keep working on this.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(1);
    const systemMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "system") ?? [];
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]?.text).toContain("could not be recovered");
    expect(systemMessages[0]?.text).not.toBe("Turn interrupted.");
    expect(systemMessages[0]?.text).not.toContain("fresh thread");
  });

  it("does not treat generic interrupted wording as a user interrupt", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-interrupted-error-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    vi.spyOn(service as never, "runCodexStream").mockRejectedValue(new Error("Session interrupted while parsing output."));

    const context: TurnContextSnapshot = {
      activeFilePath: null,
      targetNotePath: null,
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "workspace_generic",
      sourceAcquisitionContractText: null,
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: null,
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: null,
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Improve this note.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
    );

    const systemMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "system") ?? [];
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]?.text).not.toBe("Turn interrupted.");
    expect(service.getActiveTab()?.status).toBe("error");
  });

  it("repairs malformed note patch replies once and stores the recovered patch", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-patch-repair-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: 'I cleaned up the math formatting.\\n\\n"path": "notes/current.md",\\n"replacement": "updated"',
          },
        });
        return { threadId: "thread-repair-1" };
      })
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
              "Assistant answer to convert:",
              "I cleaned up the math formatting.",
              "",
              "```obsidian-patch",
              JSON.stringify({
                path: "notes/generated.md",
                kind: "create",
                summary: "Create repaired note patch",
                content: "# Repaired",
              }),
              "```",
            ].join("\n"),
          },
        });
        return { threadId: "thread-repair-1" };
      });

    const context: TurnContextSnapshot = {
      activeFilePath: "notes/current.md",
      targetNotePath: "notes/current.md",
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "vault_note",
      sourceAcquisitionContractText: "Source acquisition is already complete.",
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: "notes/current.md",
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: "Target note source pack",
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Improve this note.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    expect(service.getActiveTab()?.patchBasket).toEqual([
      expect.objectContaining({
        targetPath: "notes/generated.md",
        status: "pending",
      }),
    ]);
    const messages = service.getActiveTab()?.messages ?? [];
    expect(messages.some((message) => message.kind === "system" && message.text.includes("requesting a repaired proposal"))).toBe(
      false,
    );
    expect(messages.some((message) => message.text.includes("Assistant answer to convert:"))).toBe(false);
    expect(messages.some((message) => message.text.includes("Turn your immediately previous assistant answer"))).toBe(false);
    expect(messages.filter((message) => message.kind === "assistant")).toHaveLength(1);
  }, 10000);

  it("retries parseable but low-quality patches with a hidden readability repair", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-patch-readability-repair-"));
    tempRoots.push(vaultRoot);

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      permissionMode: "auto-edit",
    };
    const service = new CodexService(
      createApp(vaultRoot),
      () => settings,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "Applied the requested cleanup.",
              "",
              "```obsidian-patch",
              "path: notes/current.md",
              "kind: update",
              "summary: Add the maximum-dissipation explanation",
              "",
              "---content",
              CALLOUT_MATH_COLLISION_SAMPLE,
              "---end",
              "```",
            ].join("\n"),
          },
        });
        return { threadId: "thread-readability-repair-1" };
      })
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "```obsidian-patch",
              "path: notes/current.md",
              "kind: update",
              "summary: Add the maximum-dissipation explanation",
              "",
              "---content",
              [
                "> [!example]- Collision",
                ">",
                "> $$",
                "> x = y",
                "> $$",
                ">",
                "> keep this quoted explanation",
              ].join("\n"),
              "---end",
              "```",
            ].join("\n"),
          },
        });
        return { threadId: "thread-readability-repair-1" };
      });

    const context = createNoteTurnContext(vaultRoot);

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Improve this note.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    expect(service.getActiveTab()?.patchBasket).toEqual([
      expect.objectContaining({
        targetPath: "notes/current.md",
        qualityState: "clean",
        status: "pending",
      }),
    ]);
    const messages = service.getActiveTab()?.messages ?? [];
    expect(messages.some((message) => message.text.includes("Detected issues:"))).toBe(false);
    expect(messages.some((message) => message.text.includes("Turn your immediately previous assistant answer"))).toBe(false);
    expect(messages.filter((message) => message.kind === "assistant")).toHaveLength(1);
  }, 10000);

  it("keeps auto-healed callout-math patches pending and skips auto-apply in full-auto mode", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-patch-readability-review-"));
    tempRoots.push(vaultRoot);

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      permissionMode: "full-auto",
    };
    const writable = createWritableApp(vaultRoot, { "notes/current.md": "# Current\n\nOriginal" });
    const service = new CodexService(
      writable.app,
      () => settings,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi.spyOn(service as never, "runCodexStream").mockImplementationOnce(async (request) => {
      (request as { onEvent: (event: unknown) => void }).onEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: [
            "Applied the requested cleanup.",
            "",
            "```obsidian-patch",
            "path: notes/current.md",
            "kind: update",
            "operation: augment",
            "summary: Rewrite the note body",
            "",
            "---anchorBefore",
            "# Current",
            "",
            "Original",
            "---anchorAfter",
            "",
            "---replacement",
            "",
            "",
            CALLOUT_MATH_SAMPLE,
            "---end",
            "```",
          ].join("\n"),
        },
      });
      return { threadId: "thread-readability-review-1" };
    });

    const context = createNoteTurnContext(vaultRoot);

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Improve this note.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(1);
    expect(writable.files.get("notes/current.md")).toBe("# Current\n\nOriginal");
    expect(service.getActiveTab()?.patchBasket).toEqual([
      expect.objectContaining({
        targetPath: "notes/current.md",
        qualityState: "auto_healed",
        healedByPlugin: true,
        status: "pending",
      }),
    ]);
    const assistantMessage = service.getActiveTab()?.messages.find((message) => message.kind === "assistant");
    expect(assistantMessage?.meta?.editOutcome).toBe("review_required");
    expect(assistantMessage?.meta?.editReviewReason).toBe("auto_healed");
  }, 10000);

  it("keeps readability-risk patches pending in full-auto but applies them after explicit affirmation", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-readability-explicit-apply-"));
    tempRoots.push(vaultRoot);

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      permissionMode: "full-auto",
    };
    const writable = createWritableApp(vaultRoot, { "notes/current.md": "# Current\n\nOriginal" });
    const service = new CodexService(writable.app, () => settings, () => "en", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    vi.spyOn(service as never, "runCodexStream").mockImplementationOnce(async (request) => {
      (request as { onEvent: (event: unknown) => void }).onEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: [
            "Prepared the note change.",
            "",
            "```obsidian-patch",
            "path: notes/current.md",
            "kind: update",
            "operation: augment",
            "summary: Add mixed-context callout math",
            "",
            "---anchorBefore",
            "# Current",
            "",
            "Original",
            "---anchorAfter",
            "",
            "---replacement",
            "",
            "",
            CALLOUT_MATH_MIXED_CONTEXT_SAMPLE,
            "---end",
            "```",
          ].join("\n"),
        },
      });
      return { threadId: "thread-readability-explicit-1" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Improve this note.",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
    );

    expect(writable.files.get("notes/current.md")).toBe("# Current\n\nOriginal");
    expect(service.getActiveTab()?.patchBasket[0]).toEqual(
      expect.objectContaining({
        qualityState: "review_required",
        status: "pending",
      }),
    );

    await service.sendPrompt(tabId, "yes", { file: null, editor: null });

    expect(writable.files.get("notes/current.md")).toContain("Outside the callout");
    expect(service.getActiveTab()?.patchBasket[0]?.status).toBe("applied");
    expect(service.getActiveTab()?.messages.some((message) => message.text.startsWith("Review needed:"))).toBe(false);
  }, 10000);

  it("blocks unsafe content-only updates and keeps the existing note unchanged when repair finds no anchors", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-unsafe-full-update-"));
    tempRoots.push(vaultRoot);

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      permissionMode: "full-auto",
    };
    const writable = createWritableApp(vaultRoot, {
      "notes/current.md": "# Current\n\nExisting derivation.\n\nTail.",
    });
    const service = new CodexService(writable.app, () => settings, () => "en", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "Added the missing derivation.",
              "",
              "```obsidian-patch",
              "path: notes/current.md",
              "kind: update",
              "summary: Add supporting derivation",
              "---content",
              "## Supporting derivation",
              "",
              "New derivation only.",
              "---end",
              "```",
            ].join("\n"),
          },
        });
        return { threadId: "thread-unsafe-full-update-1" };
      })
      .mockImplementationOnce(async () => ({ threadId: "thread-unsafe-full-update-1" }));

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "このノートに補足して",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    expect(writable.files.get("notes/current.md")).toBe("# Current\n\nExisting derivation.\n\nTail.");
    expect(service.getActiveTab()?.patchBasket).toEqual([
      expect.objectContaining({
        targetPath: "notes/current.md",
        status: "blocked",
        intent: "augment",
        safetyIssues: expect.arrayContaining([
          expect.objectContaining({ code: "unsafe_full_update" }),
        ]),
      }),
    ]);
  }, 10000);

  it("repairs unsafe content-only updates into anchored patch proposals when hidden repair succeeds", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-unsafe-full-update-repair-"));
    tempRoots.push(vaultRoot);

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      permissionMode: "auto-edit",
    };
    const writable = createWritableApp(vaultRoot, {
      "notes/current.md": "# Current\n\nExisting derivation.\n\nTail.",
    });
    const service = new CodexService(writable.app, () => settings, () => "en", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "Added the missing derivation.",
              "",
              "```obsidian-patch",
              "path: notes/current.md",
              "kind: update",
              "summary: Add supporting derivation",
              "---content",
              "## Supporting derivation",
              "",
              "New derivation only.",
              "---end",
              "```",
            ].join("\n"),
          },
        });
        return { threadId: "thread-unsafe-full-update-repair-1" };
      })
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "```obsidian-patch",
              "path: notes/current.md",
              "kind: update",
              "operation: augment",
              "summary: Add supporting derivation",
              "---anchorBefore",
              "Existing derivation.",
              "---anchorAfter",
              "",
              "---replacement",
              "",
              "",
              "## Supporting derivation",
              "",
              "New derivation only.",
              "---end",
              "```",
            ].join("\n"),
          },
        });
        return { threadId: "thread-unsafe-full-update-repair-1" };
      });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "このノートに補足して",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    expect(writable.files.get("notes/current.md")).toBe("# Current\n\nExisting derivation.\n\nTail.");
    expect(service.getActiveTab()?.patchBasket).toEqual([
      expect.objectContaining({
        targetPath: "notes/current.md",
        status: "pending",
        intent: "augment",
        anchors: expect.any(Array),
        safetyIssues: [],
      }),
    ]);
  }, 10000);

  it("keeps explicit full-note replacement waiting for review in full-auto mode", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-explicit-full-replace-"));
    tempRoots.push(vaultRoot);

    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      permissionMode: "full-auto",
    };
    const writable = createWritableApp(vaultRoot, {
      "notes/current.md": "# Current\n\nExisting derivation.\n\nTail.",
    });
    const service = new CodexService(writable.app, () => settings, () => "en", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi.spyOn(service as never, "runCodexStream").mockImplementationOnce(async (request) => {
      (request as { onEvent: (event: unknown) => void }).onEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: [
            "Rewrote the whole note.",
            "",
            "```obsidian-patch",
            "path: notes/current.md",
            "kind: update",
            "operation: full_replace",
            "summary: Rewrite the whole note",
            "---content",
            "# Rewritten note",
            "",
            "Replacement body.",
            "---end",
            "```",
          ].join("\n"),
        },
      });
      return { threadId: "thread-explicit-full-replace-1" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "ノート全体を書き換えて",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(1);
    expect(writable.files.get("notes/current.md")).toBe("# Current\n\nExisting derivation.\n\nTail.");
    expect(service.getActiveTab()?.patchBasket).toEqual([
      expect.objectContaining({
        status: "pending",
        intent: "full_replace",
        safetyIssues: expect.arrayContaining([
          expect.objectContaining({ code: "full_replace_requires_review" }),
        ]),
      }),
    ]);
  }, 10000);

  it("keeps proposal-repair scaffolding hidden when the retry still fails", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-patch-repair-hidden-fail-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: "I will return a patch in the next reply.",
          },
        });
        return { threadId: "thread-repair-fail-1" };
      })
      .mockImplementationOnce(async (request) => {
        (request as { onEvent: (event: unknown) => void }).onEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
              "Output exactly one fenced `obsidian-patch` block and nothing else.",
              "Assistant answer to convert:",
              "I will return a patch in the next reply.",
            ].join("\n\n"),
          },
        });
        return { threadId: "thread-repair-fail-1" };
      });

    const context: TurnContextSnapshot = {
      activeFilePath: "notes/current.md",
      targetNotePath: "notes/current.md",
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "vault_note",
      sourceAcquisitionContractText: "Source acquisition is already complete.",
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: "notes/current.md",
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: "Target note source pack",
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Improve this note.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    expect(service.getActiveTab()?.patchBasket).toEqual([]);
    expect(service.getActiveTab()?.status).toBe("error");
    const messages = service.getActiveTab()?.messages ?? [];
    expect(messages.some((message) => message.kind === "system" && message.text.includes("requesting a repaired proposal"))).toBe(
      false,
    );
    expect(messages.some((message) => message.text.includes("Assistant answer to convert:"))).toBe(false);
    expect(messages.some((message) => message.text.includes("Turn your immediately previous assistant answer"))).toBe(false);
    expect(messages.filter((message) => message.kind === "assistant")).toHaveLength(1);
    expect(messages.filter((message) => message.kind === "system")).toEqual([
      expect.objectContaining({
        text: "Codex did not return a valid note patch. Nothing was applied.",
      }),
    ]);
  }, 10000);

  it("marks submitted user turns as errored instead of leaving them orphaned when the run throws", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-orphan-prevent-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const turnId = "turn-submitted";
    const userMessageId = "user-submitted";
    service.store.addMessage(tabId, {
      id: userMessageId,
      kind: "user",
      text: "Improve this note.",
      createdAt: Date.now(),
      meta: {
        turnId,
        turnStatus: "submitted",
      },
    });

    vi.spyOn(service as never, "runCodexStream").mockRejectedValue(new Error("Synthetic runtime failure."));

    const context: TurnContextSnapshot = {
      activeFilePath: null,
      targetNotePath: null,
      studyWorkflow: null,
      conversationSummaryText: null,
      sourceAcquisitionMode: "workspace_generic",
      sourceAcquisitionContractText: null,
      workflowText: null,
      pluginFeatureText: null,
      paperStudyRuntimeOverlayText: null,
      skillGuideText: null,
      paperStudyGuideText: null,
      mentionContextText: null,
      selection: null,
      selectionSourcePath: null,
      vaultRoot,
      dailyNotePath: null,
      contextPackText: null,
      attachmentManifestText: null,
      attachmentContentText: null,
      noteSourcePackText: null,
      attachmentMissingPdfTextNames: [],
      attachmentMissingSourceNames: [],
    };

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Improve this note.",
      "normal",
      "chat",
      [],
      context,
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      true,
      "draft",
      true,
      false,
      turnId,
      userMessageId,
    );

    const updatedUserMessage = service.getActiveTab()?.messages.find((message) => message.id === userMessageId);
    expect(updatedUserMessage?.meta?.turnStatus).toBe("error");
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "system" && message.text.includes("Synthetic runtime failure"))).toBe(true);
  });

  it("recovers persisted orphaned user turns on startup with a single normalized error", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-orphan-restore-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      {
        tabs: [
          {
            id: "tab-a",
            title: "A",
            draft: "",
            cwd: vaultRoot,
            studyWorkflow: null,
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
            composeMode: "chat",
            learningMode: false,
            contextPaths: [],
            lastResponseId: null,
            sessionItems: [],
            codexThreadId: null,
            model: "gpt-5.4",
            reasoningEffort: "xhigh",
            usageSummary: createEmptyUsageSummary(),
            messages: [
              {
                id: "user-orphaned",
                kind: "user",
                text: "Improve this note.",
                createdAt: Date.now(),
                meta: {
                  turnId: "turn-orphaned",
                  turnStatus: "submitted",
                },
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
      async () => {},
      async () => {},
    );

    vi.spyOn(service as never, "refreshModelCatalog").mockResolvedValue(undefined);
    vi.spyOn(service as never, "refreshCodexCatalogs").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncKnownUsageFromSessions").mockResolvedValue(undefined);
    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);

    await service.ensureStarted();

    const activeTab = service.getActiveTab();
    const systemMessages = activeTab?.messages.filter((message) => message.kind === "system") ?? [];
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]?.text).toContain("ended without leaving a visible result");
    expect(activeTab?.messages.find((message) => message.id === "user-orphaned")?.meta?.turnStatus).toBe("orphaned_turn_error");
  });

  it("does not close a busy tab from the standard close path", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-busy-close-"));
    tempRoots.push(vaultRoot);

    const service = new CodexService(
      createApp(vaultRoot),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.setStatus(tabId, "busy");
    service.closeTab(tabId);

    expect(service.getActiveTab()?.id).toBe(tabId);
    expect(service.getActiveTab()?.status).toBe("busy");
  });
});
