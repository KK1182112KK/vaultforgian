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
  allowVaultWrite: boolean,
  draftBackup: string,
  allowEmptyReplyRecovery?: boolean,
  watchdogRecoveryAttempted?: boolean,
  turnId?: string | null,
  userMessageId?: string | null,
) => Promise<void>;

describe("CodexService sendPrompt skill context", () => {
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

  it("tracks learning mode per tab", async () => {
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

    expect(service.getActiveTab()?.learningMode).toBe(false);
    expect(service.toggleTabLearningMode(tabId)).toBe(true);
    expect(service.getActiveTab()?.learningMode).toBe(true);
    expect(service.setTabLearningMode(tabId, false)).toBe(false);
    expect(service.getActiveTab()?.learningMode).toBe(false);
    expect(runTurnSpy).not.toHaveBeenCalled();
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
      "Want me to reflect this in the note?",
      "",
      "```obsidian-suggest",
      JSON.stringify({
        kind: "rewrite_followup",
        summary: "Turn this answer into a formatting-focused note patch.",
        question: "Want me to reflect this in the note?",
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
    expect(prompt).toContain("Here is the cleaned-up explanation.");
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
    expect(
      service.getActiveTab()?.messages.some(
        (message) => message.kind === "system" && message.text.includes("requesting a repaired proposal"),
      ),
    ).toBe(true);
  });

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
