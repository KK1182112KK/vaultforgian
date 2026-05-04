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
import type { InstalledSkillDefinition } from "../util/skillCatalog";
import { buildSkillOrchestrationPlan, type SkillOrchestrationPlan } from "../util/skillOrchestration";
import { createStudyQuizSession } from "../util/studyQuiz";

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
  proposalRepairPhase?: boolean,
  proposalRepairFailureMode?: "error" | "silent",
  skillOrchestrationPlan?: SkillOrchestrationPlan | null,
  skillTraceContinuation?: boolean,
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

  it("restarts the quiz session before sending a fresh quiz request", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-quiz-restart-"));
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
    service.store.setStudyCoachState(tabId, {
      latestRecap: null,
      weakPointLedger: [],
      lastCheckpointAt: null,
      quizSession: {
        ...createStudyQuizSession("quiz-old", 1),
        currentIndex: 3,
        answeredCount: 2,
      },
    });

    await service.sendPrompt(tabId, "quiz me on this note");

    const quizSession = service.getActiveTab()?.studyCoachState?.quizSession;
    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    expect(quizSession?.id).not.toBe("quiz-old");
    expect(quizSession?.currentIndex).toBe(1);
    expect(quizSession?.answeredCount).toBe(0);
    expect(quizSession?.lastUserResponseKind).toBe("start");
  });

  it("passes the resolved turn configuration through the runtime adapter boundary", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-runtime-boundary-"));
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
    service.setTabFastMode(tabId, true);

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi.spyOn(service as never, "runCodexStream").mockImplementationOnce(async (request) => {
      const callbacks = request as {
        onJsonEvent: (event: unknown) => void;
        onSessionId: (threadId: string) => void;
        onLiveness: (observedAt: number) => void;
        onMeaningfulProgress: (observedAt: number) => void;
      };
      callbacks.onSessionId("thread-runtime-boundary");
      callbacks.onLiveness(100);
      callbacks.onMeaningfulProgress(120);
      callbacks.onJsonEvent({ type: "thread.started", thread_id: "thread-runtime-boundary" });
      callbacks.onJsonEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "Runtime boundary OK.",
        },
      });
      return { threadId: "thread-runtime-boundary" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Explain this note.",
      "normal",
      "chat",
      [],
      createNoteTurnContext(vaultRoot),
      [join(vaultRoot, "figure.png")],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "Explain this note.",
      false,
      false,
      "turn-runtime-boundary",
      "user-runtime-boundary",
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(1);
    expect(runCodexStreamSpy.mock.calls[0]?.[0]).toMatchObject({
      tabId,
      threadId: null,
      workingDirectory: vaultRoot,
      runtime: "native",
      executablePath: "codex",
      sandboxMode: "read-only",
      approvalPolicy: "untrusted",
      images: [join(vaultRoot, "figure.png")],
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      fastMode: true,
      contextBundle: expect.objectContaining({
        vaultRoot,
        activeNote: expect.objectContaining({ path: "notes/current.md" }),
        targetNote: expect.objectContaining({ path: "notes/current.md" }),
      }),
      capabilities: expect.arrayContaining([
        expect.objectContaining({ trigger: "/note", kind: "slash" }),
      ]),
    });
    const request = runCodexStreamSpy.mock.calls[0]?.[0] as {
      onJsonEvent?: unknown;
      onSessionId?: unknown;
      onLiveness?: unknown;
      onMeaningfulProgress?: unknown;
    };
    expect(typeof request.onJsonEvent).toBe("function");
    expect(typeof request.onSessionId).toBe("function");
    expect(typeof request.onLiveness).toBe("function");
    expect(typeof request.onMeaningfulProgress).toBe("function");
    expect(service.getActiveTab()?.codexThreadId).toBe("thread-runtime-boundary");
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "assistant" && message.text.includes("Runtime boundary OK"))).toBe(true);
  });

  it("passes the resolved plugin locale into the runtime prompt language contract", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-locale-contract-"));
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
    const runCodexStreamSpy = vi.spyOn(service as never, "runCodexStream").mockImplementationOnce(async (request) => {
      const callbacks = request as {
        onJsonEvent: (event: unknown) => void;
      };
      callbacks.onJsonEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "\u3053\u3093\u306b\u3061\u306f\u3002",
        },
      });
      return { threadId: "thread-locale-contract" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "hello",
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
      "hello",
      false,
      false,
      "turn-locale-contract",
      "user-locale-contract",
    );

    const request = runCodexStreamSpy.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    expect(request?.prompt).toContain("Selected plugin display language: Japanese.");
    expect(request?.prompt).toContain("in Japanese unless the user explicitly asks for another language");
  });

  it("keeps study-coach planner guidance out of study panel runtime prompts when Learning Mode is off", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-turn-plan-"));
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
    const panel = {
      ...createPanel("panel-review", ["review-coach"]),
      title: "Review",
      workflow: "review" as const,
      promptTemplate: "Continue review from weak points.",
    };
    service.store.setStudyRecipes([panel]);
    service.store.setActiveStudyPanel(tabId, panel.id, ["review-coach"]);
    service.store.setTabStudyWorkflow(tabId, "review");
    service.store.setUserAdaptationMemory({
      globalProfile: null,
      panelOverlays: {
        [panel.id]: {
          panelId: panel.id,
          preferredFocusTags: [],
          preferredNoteStyleHints: [],
          preferredSkillNames: [],
          lastAppliedTargetPath: null,
          updatedAt: 10,
          studyMemory: {
            weakConcepts: [
              {
                conceptLabel: "frequency response",
                evidence: "Still mixes magnitude and phase.",
                lastStuckPoint: "Phase interpretation is unclear.",
                nextQuestion: "What changes when only phase shifts?",
                workflow: "review",
                updatedAt: 10,
              },
            ],
            understoodConcepts: [],
            nextProblems: [],
            recentStuckPoints: [],
            sourcePreferences: [],
            lastContract: null,
            improvementSignals: [],
          },
        },
      },
      studyMemory: null,
    });

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi.spyOn(service as never, "runCodexStream").mockImplementationOnce(async (request) => {
      (request as { onJsonEvent: (event: unknown) => void }).onJsonEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "Let's review frequency response.",
        },
      });
      return { threadId: "thread-study-plan" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Continue review",
      "normal",
      "chat",
      ["review-coach"],
      createNoteTurnContext(vaultRoot, {
        studyWorkflow: "review",
        workflowText: "Active study workflow: Review",
        studyCoachText: "Panel memory carry-forward:\n- Weak concepts: frequency response",
      }),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "draft",
    );

    const request = runCodexStreamSpy.mock.calls[0]?.[0] as { prompt?: string };
    expect(request.prompt).not.toContain("StudyTurnPlan\n");
    expect(request.prompt).not.toContain("- Check question:");
    expect(request.prompt).not.toContain("- Next action:");
    expect(request.prompt).toContain("Skill orchestration plan");
    expect(request.prompt).toContain("$review-coach [analyze]");
    const reviewCoachLine = (request.prompt ?? "").split("\n").find((line) => line.includes("$review-coach [analyze]")) ?? "";
    expect(reviewCoachLine).not.toContain("frequency response");
    expect(request.prompt).not.toContain("at most one understanding-check question");
  });

  it("hydrates all panel-selected skills before building the turn context", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-sendprompt-"));
    tempRoots.push(vaultRoot);
    const extraSkillRoot = join(vaultRoot, "extra-skills");
    const brainstormingDir = join(extraSkillRoot, "brainstorming");
    const deepReadDir = join(extraSkillRoot, "deep-read");
    const academicPaperDir = join(extraSkillRoot, "academic-paper");
    const homeworkDir = join(extraSkillRoot, "homework");
    await mkdir(brainstormingDir, { recursive: true });
    await mkdir(deepReadDir, { recursive: true });
    await mkdir(academicPaperDir, { recursive: true });
    await mkdir(homeworkDir, { recursive: true });
    const brainstormingPath = join(brainstormingDir, "SKILL.md");
    const deepReadPath = join(deepReadDir, "SKILL.md");
    const academicPaperPath = join(academicPaperDir, "SKILL.md");
    const homeworkPath = join(homeworkDir, "SKILL.md");
    await writeFile(brainstormingPath, "# Brainstorming\nGenerate options first.", "utf8");
    await writeFile(deepReadPath, "# Deep Read\nRead the source deeply.", "utf8");
    await writeFile(academicPaperPath, "# Academic Paper\nWrite the academic paper output.", "utf8");
    await writeFile(homeworkPath, "# Homework\nHelp solve homework after checking the student's goal.", "utf8");

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
    const panelSkillDefinitions = [
      {
        name: "brainstorming",
        description: "Generate options before work.",
        path: brainstormingPath,
      },
      {
        name: "deep-read",
        description: "Read source material deeply.",
        path: deepReadPath,
      },
      {
        name: "academic-paper",
        description: "Academic paper writing skill.",
        path: academicPaperPath,
      },
      {
        name: "homework",
        description: "Homework support skill.",
        path: homeworkPath,
      },
    ];

    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    const refreshSpy = vi.spyOn(service as never, "refreshCodexCatalogs").mockImplementation(async () => {
      (service as unknown as { installedSkillCatalog: typeof panelSkillDefinitions }).installedSkillCatalog = panelSkillDefinitions;
    });
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.setStudyRecipes([createPanel("panel-1", ["brainstorming", "deep-read", "academic-paper", "homework"])]);
    service.store.setActiveStudyPanel(tabId, "panel-1", ["academic-paper", "brainstorming", "deep-read"]);
    service.store.setPanelSessionOrigin(tabId, {
      panelId: "panel-1",
      selectedSkillNames: ["homework"],
      promptSnapshot: "Old prompt",
      awaitingCompletionSignal: false,
      lastAssistantMessageId: null,
      startedAt: 1,
    });

    await service.sendPrompt(tabId, "Explain this paper carefully.");

    expect(refreshSpy).toHaveBeenCalled();
    expect(runTurnSpy).toHaveBeenCalledTimes(1);

    const skillNames = runTurnSpy.mock.calls[0]?.[4] as string[];
    const turnContext = runTurnSpy.mock.calls[0]?.[5] as TurnContextSnapshot;
    expect(skillNames).toEqual(["academic-paper", "brainstorming", "deep-read"]);
    expect(turnContext.skillGuideText).toContain("Skill guide: $academic-paper");
    expect(turnContext.skillGuideText).toContain("Skill guide: $brainstorming");
    expect(turnContext.skillGuideText).toContain("Skill guide: $deep-read");
    expect(turnContext.skillGuideText).not.toContain("Skill guide: $homework");
    expect(turnContext.skillGuideText).toContain("# Academic Paper\nWrite the academic paper output.");
    const userMessage = service.getActiveTab()?.messages.find((message) => message.kind === "user");
    expect(userMessage?.meta?.effectiveSkillsCsv).toBe("brainstorming,deep-read,academic-paper");
    expect(userMessage?.meta?.effectiveSkillCount).toBe(3);
    const skillTrace = service.getActiveTab()?.messages.find((message) => message.meta?.skillTrace === true);
    expect(skillTrace?.kind).toBe("system");
    expect(skillTrace?.text).toBe("Skill route: /brainstorming -> /deep-read -> /academic-paper");
    expect(skillTrace?.text).not.toContain("/homework");
    expect(skillTrace?.meta?.skillTraceDetails).toContain("required: /academic-paper, /brainstorming, /deep-read");
    expect(skillTrace?.meta?.skillTraceDetails).toContain("resolved: /academic-paper, /brainstorming, /deep-read");
    expect(skillTrace?.meta?.skillTraceDetails).not.toContain("/homework");
    expect(skillTrace?.meta?.skillTraceDetails).toContain("missing: none");
  });

  it("compresses repeated skill trace UI for panel skill follow-up turns", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-continuation-"));
    tempRoots.push(vaultRoot);
    const extraSkillRoot = join(vaultRoot, "extra-skills");
    const skillDefinitions: InstalledSkillDefinition[] = [];
    for (const skillName of ["brainstorming", "lecture-read", "paper-visualizer"]) {
      const skillDir = join(extraSkillRoot, skillName);
      await mkdir(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      await writeFile(skillPath, `# ${skillName}\nUse this skill in the panel route.`, "utf8");
      skillDefinitions.push({ name: skillName, description: `${skillName} skill.`, path: skillPath });
    }

    const service = new CodexService(
      createApp(vaultRoot),
      () => ({ ...DEFAULT_SETTINGS, extraSkillRoots: [extraSkillRoot] }),
      () => "en",
      null,
      async () => {},
      async () => {},
    );
    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    vi.spyOn(service as never, "refreshCodexCatalogs").mockImplementation(async () => {
      (service as unknown as { installedSkillCatalog: typeof skillDefinitions }).installedSkillCatalog = skillDefinitions;
    });
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    service.store.setStudyRecipes([createPanel("panel-1", ["brainstorming", "lecture-read", "paper-visualizer"])]);
    service.store.setActiveStudyPanel(tabId, "panel-1", ["brainstorming", "lecture-read", "paper-visualizer"]);

    await service.sendPrompt(tabId, "Help me study this lecture material.");
    await service.sendPrompt(tabId, "2");

    const tab = service.getActiveTab();
    const skillTraceMessages = tab?.messages.filter((message) => message.meta?.skillTrace === true) ?? [];
    expect(skillTraceMessages).toHaveLength(1);
    const userMessages = tab?.messages.filter((message) => message.kind === "user") ?? [];
    expect(userMessages[0]?.meta?.effectiveSkillsCsv).toBe("brainstorming,lecture-read,paper-visualizer");
    expect(userMessages[0]?.meta?.skillTraceContinuation).toBeUndefined();
    expect(userMessages[1]?.text).toBe("2");
    expect(userMessages[1]?.meta?.effectiveSkillsCsv).toBe("brainstorming,lecture-read,paper-visualizer");
    expect(userMessages[1]?.meta?.skillTraceContinuation).toBe(true);
    expect(runTurnSpy).toHaveBeenCalledTimes(2);
    expect(runTurnSpy.mock.calls[0]?.[20]).toBe(false);
    expect(runTurnSpy.mock.calls[1]?.[20]).toBe(true);
  });

  it("uses execution route order for skill trace and user chips even when panel selection order differs", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-route-order-"));
    tempRoots.push(vaultRoot);
    const extraSkillRoot = join(vaultRoot, "extra-skills");
    const skillDefinitions: InstalledSkillDefinition[] = [];
    for (const skillName of ["brainstorming", "paper-visualizer", "lecture-read"]) {
      const skillDir = join(extraSkillRoot, skillName);
      await mkdir(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      const description =
        skillName === "paper-visualizer"
          ? "Create compact visual maps and diagrams."
          : skillName === "lecture-read"
            ? "Read lecture notes and extract key concepts."
            : "Generate options first.";
      await writeFile(skillPath, `# ${skillName}\n${description}`, "utf8");
      skillDefinitions.push({ name: skillName, description, path: skillPath });
    }

    const service = new CodexService(
      createApp(vaultRoot),
      () => ({ ...DEFAULT_SETTINGS, extraSkillRoots: [extraSkillRoot] }),
      () => "en",
      null,
      async () => {},
      async () => {},
    );
    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    vi.spyOn(service as never, "refreshCodexCatalogs").mockImplementation(async () => {
      (service as unknown as { installedSkillCatalog: typeof skillDefinitions }).installedSkillCatalog = skillDefinitions;
    });
    vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    service.store.setStudyRecipes([createPanel("panel-1", ["brainstorming", "paper-visualizer", "lecture-read"])]);
    service.store.setActiveStudyPanel(tabId, "panel-1", ["brainstorming", "paper-visualizer", "lecture-read"]);

    await service.sendPrompt(tabId, "Help me study this lecture material.");

    const tab = service.getActiveTab();
    const userMessage = tab?.messages.find((message) => message.kind === "user");
    const skillTraceMessage = tab?.messages.find((message) => message.meta?.skillTrace === true);
    expect(userMessage?.meta?.effectiveSkillsCsv).toBe("brainstorming,lecture-read,paper-visualizer");
    expect(skillTraceMessage?.text).toBe("Skill route: /brainstorming -> /lecture-read -> /paper-visualizer");
  });

  it("starts a new visible skill trace when the panel skill selection changes", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-continuation-reset-"));
    tempRoots.push(vaultRoot);
    const extraSkillRoot = join(vaultRoot, "extra-skills");
    const skillDefinitions: InstalledSkillDefinition[] = [];
    for (const skillName of ["brainstorming", "lecture-read", "paper-visualizer"]) {
      const skillDir = join(extraSkillRoot, skillName);
      await mkdir(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      await writeFile(skillPath, `# ${skillName}\nUse this skill in the panel route.`, "utf8");
      skillDefinitions.push({ name: skillName, description: `${skillName} skill.`, path: skillPath });
    }

    const service = new CodexService(
      createApp(vaultRoot),
      () => ({ ...DEFAULT_SETTINGS, extraSkillRoots: [extraSkillRoot] }),
      () => "en",
      null,
      async () => {},
      async () => {},
    );
    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    vi.spyOn(service as never, "refreshCodexCatalogs").mockImplementation(async () => {
      (service as unknown as { installedSkillCatalog: typeof skillDefinitions }).installedSkillCatalog = skillDefinitions;
    });
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    service.store.setStudyRecipes([createPanel("panel-1", ["brainstorming", "lecture-read", "paper-visualizer"])]);
    service.store.setActiveStudyPanel(tabId, "panel-1", ["brainstorming", "lecture-read", "paper-visualizer"]);

    await service.sendPrompt(tabId, "Help me study this lecture material.");
    service.store.setActiveStudyPanel(tabId, "panel-1", ["lecture-read", "paper-visualizer"]);
    await service.sendPrompt(tabId, "Use the selected skills instead.");

    const skillTraceMessages = service.getActiveTab()?.messages.filter((message) => message.meta?.skillTrace === true) ?? [];
    expect(skillTraceMessages).toHaveLength(2);
    expect(skillTraceMessages[1]?.text).toContain("/lecture-read");
    expect(skillTraceMessages[1]?.text).not.toContain("/brainstorming");
    expect(runTurnSpy.mock.calls[1]?.[20]).toBe(false);
  });

  it("does not auto-select panel-linked user skills without explicit Panel Studio selection", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-auto-skills-"));
    tempRoots.push(vaultRoot);
    const extraSkillRoot = join(vaultRoot, "extra-skills");
    const skillNames = ["brainstorming", "deep-read", "academic-paper", "verification-before-completion"];
    const skillDefinitions: InstalledSkillDefinition[] = [];
    for (const skillName of skillNames) {
      const skillDir = join(extraSkillRoot, skillName);
      await mkdir(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      const body =
        skillName === "brainstorming"
          ? "# Brainstorming\nGenerate options first."
          : skillName === "deep-read"
            ? "# Deep Read\nRead lecture source material deeply."
            : skillName === "academic-paper"
              ? "# Academic Paper\nCreate the requested study output."
              : "# Verification Before Completion\nVerify the answer before finishing.";
      await writeFile(skillPath, body, "utf8");
      skillDefinitions.push({
        name: skillName,
        description: body.replace(/\n/gu, " "),
        path: skillPath,
      });
    }

    const service = new CodexService(
      createApp(vaultRoot),
      () => ({ ...DEFAULT_SETTINGS, extraSkillRoots: [extraSkillRoot] }),
      () => "en",
      null,
      async () => {},
      async () => {},
    );
    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    vi.spyOn(service as never, "refreshCodexCatalogs").mockImplementation(async () => {
      (service as unknown as { installedSkillCatalog: typeof skillDefinitions }).installedSkillCatalog = skillDefinitions;
    });
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.setStudyRecipes([createPanel("panel-1", skillNames)]);
    service.store.setActiveStudyPanel(tabId, "panel-1", []);

    await service.sendPrompt(tabId, "Help me study this lecture material.");

    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    expect(runTurnSpy.mock.calls[0]?.[2]).toBe("normal");
    expect(runTurnSpy.mock.calls[0]?.[4]).toEqual([]);
    const plan = runTurnSpy.mock.calls[0]?.[19] as { autoSelectedSkillNames?: string[]; skippedSkillNames?: string[] } | null;
    expect(plan).toBeNull();
    const userMessage = service.getActiveTab()?.messages.find((message) => message.kind === "user");
    expect(userMessage?.meta?.effectiveSkillsCsv).toBeNull();
    expect(userMessage?.meta?.effectiveSkillCount).toBeUndefined();
  });

  it("stores required and auto-selected skill usage in waiting states across phase changes", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-waiting-skills-"));
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
    const plan: SkillOrchestrationPlan = {
      selectedSkills: ["brainstorming", "lecture-read", "paper-visualizer"],
      requiredSkillNames: ["brainstorming", "lecture-read"],
      autoSelectedSkillNames: ["paper-visualizer"],
      orderedSteps: [
        { skillName: "brainstorming", phase: "brainstorm", reason: "Use first." },
        { skillName: "lecture-read", phase: "source_read", reason: "Read source." },
        { skillName: "paper-visualizer", phase: "execute", reason: "Create visual support." },
      ],
      primarySkillNames: ["brainstorming", "lecture-read", "paper-visualizer"],
      supportingSkillNames: [],
      deferredSkillNames: [],
      candidateScores: [],
      selectionReasons: {},
      confidence: "high",
      skippedSkillNames: [],
      visiblePolicy: "Do not narrate skill loading.",
    };
    const privateService = service as unknown as {
      buildWaitingSkillUsageMetadata(plan: SkillOrchestrationPlan, skillNames: string[]): object | null;
      createWaitingState(phase: "boot" | "reasoning", mode: "skill", focus: null, usage: object | null): {
        phase: "boot" | "reasoning";
        text: string;
        requiredSkillNames?: string[];
        autoSelectedSkillNames?: string[];
        orderedSkillNames?: string[];
      };
      setWaitingPhase(tabId: string, phase: "reasoning", mode: "skill"): void;
    };
    const usage = privateService.buildWaitingSkillUsageMetadata(plan, ["brainstorming", "lecture-read", "paper-visualizer"]);
    const waitingState = privateService.createWaitingState("boot", "skill", null, usage);

    expect(waitingState.requiredSkillNames).toEqual(["brainstorming", "lecture-read"]);
    expect(waitingState.autoSelectedSkillNames).toEqual(["paper-visualizer"]);
    expect(waitingState.orderedSkillNames).toEqual(["brainstorming", "lecture-read", "paper-visualizer"]);
    expect(waitingState.text).toMatch(/^Using skills: \/brainstorming, \/lecture-read \+1 · /u);

    service.store.setWaitingState(tabId, waitingState);
    privateService.setWaitingPhase(tabId, "reasoning", "skill");

    const nextWaitingState = service.getActiveTab()?.waitingState;
    expect(nextWaitingState?.requiredSkillNames).toEqual(["brainstorming", "lecture-read"]);
    expect(nextWaitingState?.autoSelectedSkillNames).toEqual(["paper-visualizer"]);
    expect(nextWaitingState?.text).toMatch(/^Using skills: \/brainstorming, \/lecture-read \+1 · /u);
  });

  it("omits skill prefixes from waiting copy on panel skill continuation turns", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-waiting-skill-continuation-"));
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
    const plan: SkillOrchestrationPlan = {
      selectedSkills: ["brainstorming", "lecture-read", "paper-visualizer"],
      requiredSkillNames: ["brainstorming", "lecture-read", "paper-visualizer"],
      autoSelectedSkillNames: [],
      orderedSteps: [
        { skillName: "brainstorming", phase: "brainstorm", reason: "Use first." },
        { skillName: "lecture-read", phase: "source_read", reason: "Read source." },
        { skillName: "paper-visualizer", phase: "execute", reason: "Create visual support." },
      ],
      primarySkillNames: ["brainstorming", "lecture-read", "paper-visualizer"],
      supportingSkillNames: [],
      deferredSkillNames: [],
      candidateScores: [],
      selectionReasons: {},
      confidence: "high",
      skippedSkillNames: [],
      visiblePolicy: "Do not narrate skill loading.",
    };
    const privateService = service as unknown as {
      buildWaitingSkillUsageMetadata(plan: SkillOrchestrationPlan | null, skillNames: readonly string[]): object | null;
      createWaitingState(
        phase: "boot",
        mode: "skill",
        focus: null,
        usage: object | null,
        suppressSkillPrefix?: boolean,
      ): { text: string; suppressSkillPrefix?: boolean; requiredSkillNames?: string[] };
    };
    const usage = privateService.buildWaitingSkillUsageMetadata(plan, ["brainstorming", "lecture-read", "paper-visualizer"]);
    const waitingState = privateService.createWaitingState("boot", "skill", null, usage, true);

    expect(waitingState.text).not.toContain("Using skills:");
    expect(waitingState.requiredSkillNames).toBeUndefined();
    expect(waitingState.suppressSkillPrefix).toBe(true);
  });

  it("preserves suppressed skill prefixes when watchdog updates continuation waiting copy", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-watchdog-suppress-prefix-"));
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
    service.store.setWaitingState(tabId, {
      phase: "reasoning",
      text: "Thinking...",
      locale: "en",
      mode: "skill",
      suppressSkillPrefix: true,
      requiredSkillNames: ["brainstorming", "lecture-read"],
      autoSelectedSkillNames: ["paper-visualizer"],
      orderedSkillNames: ["brainstorming", "lecture-read", "paper-visualizer"],
      primarySkillName: "brainstorming",
      skillCount: 3,
    });

    (
      service as unknown as {
        setWatchdogWaitingState(tabId: string, stage: "stall_warn" | "stall_recovery"): void;
      }
    ).setWatchdogWaitingState(tabId, "stall_warn");

    const waitingState = service.getActiveTab()?.waitingState;
    expect(waitingState?.suppressSkillPrefix).toBe(true);
    expect(waitingState?.text).not.toContain("Using skills:");
    expect(waitingState?.requiredSkillNames).toEqual(["brainstorming", "lecture-read"]);
    expect(waitingState?.autoSelectedSkillNames).toEqual(["paper-visualizer"]);
    expect(waitingState?.orderedSkillNames).toEqual(["brainstorming", "lecture-read", "paper-visualizer"]);
  });

  it("blocks unresolved panel-selected skills without clearing the draft", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-missing-skill-"));
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
    vi.spyOn(service as never, "refreshCodexCatalogs").mockImplementation(async () => {
      (service as unknown as { installedSkillCatalog: unknown[] }).installedSkillCatalog = [];
    });
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.setStudyRecipes([createPanel("panel-1", ["missing-skill"])]);
    service.store.setActiveStudyPanel(tabId, "panel-1", ["missing-skill"]);
    service.store.setDraft(tabId, "Explain this paper carefully.");

    await service.sendPrompt(tabId, "Explain this paper carefully.");

    expect(runTurnSpy).not.toHaveBeenCalled();
    expect(service.getActiveTab()?.draft).toBe("Explain this paper carefully.");
    const warning = service.getActiveTab()?.messages.find((message) => message.kind === "system");
    expect(warning?.text).toContain("Selected skill not found: /missing-skill");
    expect(warning?.text).toContain("not loaded");
    expect(warning?.meta?.tone).toBe("warning");
    expect(warning?.meta?.skillTrace).toBe(true);
    expect(warning?.meta?.skillTraceDetails).toContain("missing: /missing-skill");
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
    service.store.setTargetNotePath(tabId, "notes/current.md");

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
    service.store.setTargetNotePath(tabId, "notes/current.md");

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

  it("does not infer an Apply to note CTA for skill brainstorming choice prompts", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-choice-no-cta-"));
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
      (request as { onJsonEvent: (event: unknown) => void }).onJsonEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: [
            "First, I’ll use /brainstorming.",
            "",
            "What do you want first for Pythagorean Theorem.md?",
            "",
            "1. A concise study guide",
            "2. Practice questions with answers",
            "3. A clearer rewrite of the note",
          ].join("\n"),
        },
      });
      return { threadId: "thread-skill-choice-no-cta" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Help me study this lecture material.",
      "skill",
      "chat",
      ["brainstorming", "paper-visualizer", "lecture-read"],
      createNoteTurnContext(vaultRoot, {
        studyWorkflow: "lecture",
        workflowText: "Active study workflow: Lecture",
      }),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "Help me study this lecture material.",
      false,
      false,
      "turn-skill-choice-no-cta",
      "user-skill-choice-no-cta",
    );

    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "assistant" && message.text.includes("/brainstorming"))).toBe(true);
  });

  it("suppresses near-duplicate live brainstorming choice prompts in one skill turn", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-choice-live-duplicate-"));
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
      const callbacks = request as { onJsonEvent: (event: unknown) => void };
      callbacks.onJsonEvent({
        type: "response_item",
        timestamp: "2026-05-02T10:00:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: [
            "First, I’ll use /brainstorming.",
            "",
            "What would help you most right now?",
            "",
            "1. A clean concept summary",
            "2. A step-by-step explanation of the formulas",
            "3. A “what’s confusing / easy to mix up” review",
          ].join("\n"),
        },
      });
      callbacks.onJsonEvent({
        type: "response_item",
        timestamp: "2026-05-02T10:00:00.100Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: [
            "First, I’ll use /brainstorming.",
            "",
            "What would help you most right now?",
            "",
            "1. A clean concept summary",
            "2. A step-by-step explanation of the formulas",
            "3. A review of the confusing points and common mistakes",
          ].join("\n"),
        },
      });
      return { threadId: "thread-skill-choice-live-duplicate" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Help me study this lecture material.",
      "skill",
      "chat",
      ["brainstorming", "paper-visualizer", "lecture-read"],
      createNoteTurnContext(vaultRoot, {
        studyWorkflow: "lecture",
        workflowText: "Active study workflow: Lecture",
      }),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "Help me study this lecture material.",
      false,
      false,
      "turn-skill-choice-live-duplicate",
      "user-skill-choice-live-duplicate",
    );

    const assistantMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.text).toContain("A clean concept summary");
  });

  it("repairs continuation replies that skip the visualizer deliverable", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-visualizer-repair-"));
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
    const skillOrchestrationPlan = buildSkillOrchestrationPlan(["brainstorming", "paper-visualizer", "lecture-read"], {
      definitions: [
        { name: "brainstorming", description: "Generate options first." },
        { name: "paper-visualizer", description: "Create compact visual maps and diagrams." },
        { name: "lecture-read", description: "Read lecture notes and extract key concepts." },
      ],
    });

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onJsonEvent: (event: unknown) => void }).onJsonEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "Next, I’ll use /lecture-read and /paper-visualizer for option 2.",
              "",
              "## Main Topics",
              "",
              "The theorem is about the area relationship behind right triangles.",
              "",
              "## Confusing Points",
              "",
              "The common mistake is choosing c before finding the 90 degree angle.",
            ].join("\n"),
          },
        });
        return { threadId: "thread-skill-visualizer-repair-1" };
      })
      .mockImplementationOnce(async (request) => {
        const prompt = (request as { prompt?: string }).prompt ?? "";
        expect(prompt).toContain("Add exactly one compact visual artifact");
        (request as { onJsonEvent: (event: unknown) => void }).onJsonEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "Next, I’ll use /lecture-read, then /paper-visualizer for option 2.",
              "",
              "## Main Topics",
              "",
              "The theorem is about the area relationship behind right triangles.",
              "",
              "## Visual Map",
              "",
              "| Part | Meaning |",
              "| --- | --- |",
              "| a and b | legs forming the right angle |",
              "| c | hypotenuse opposite the right angle |",
              "",
              "This step is complete. Continue to the next study step?",
            ].join("\n"),
          },
        });
        return { threadId: "thread-skill-visualizer-repair-2" };
      });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "2",
      "skill",
      "chat",
      ["brainstorming", "paper-visualizer", "lecture-read"],
      createNoteTurnContext(vaultRoot, {
        studyWorkflow: "lecture",
        workflowText: "Active study workflow: Lecture",
      }),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "2",
      false,
      false,
      "turn-skill-visualizer-repair",
      "user-skill-visualizer-repair",
      false,
      "error",
      skillOrchestrationPlan,
      true,
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    const assistantMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.text).toContain("## Visual Map");
    expect(assistantMessages[0]?.text).toContain("| Part | Meaning |");
    expect(assistantMessages[0]?.text).toContain("This step is complete. Continue to the next study step?");
  });

  it("repairs completed skill route replies that omit the neutral checkpoint", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-checkpoint-repair-"));
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
    const skillOrchestrationPlan = buildSkillOrchestrationPlan(["brainstorming", "paper-visualizer", "lecture-read"], {
      definitions: [
        { name: "brainstorming", description: "Generate options first." },
        { name: "paper-visualizer", description: "Create compact visual maps and diagrams." },
        { name: "lecture-read", description: "Read lecture notes and extract key concepts." },
      ],
    });

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi
      .spyOn(service as never, "runCodexStream")
      .mockImplementationOnce(async (request) => {
        (request as { onJsonEvent: (event: unknown) => void }).onJsonEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "Next, I’ll use /lecture-read, then /paper-visualizer for option 1.",
              "",
              "## Main Topics",
              "",
              "The theorem is about right triangles and square areas.",
              "",
              "## Visual Map",
              "",
              "| Part | Meaning |",
              "| --- | --- |",
              "| a and b | legs forming the right angle |",
              "| c | hypotenuse opposite the right angle |",
            ].join("\n"),
          },
        });
        return { threadId: "thread-skill-checkpoint-repair-1" };
      })
      .mockImplementationOnce(async (request) => {
        const prompt = (request as { prompt?: string }).prompt ?? "";
        expect(prompt).toContain("Add exactly one neutral skill checkpoint");
        (request as { onJsonEvent: (event: unknown) => void }).onJsonEvent({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: [
              "Next, I’ll use /lecture-read, then /paper-visualizer for option 1.",
              "",
              "## Main Topics",
              "",
              "The theorem is about right triangles and square areas.",
              "",
              "## Visual Map",
              "",
              "| Part | Meaning |",
              "| --- | --- |",
              "| a and b | legs forming the right angle |",
              "| c | hypotenuse opposite the right angle |",
              "",
              "This step is complete. Continue to the next study step?",
            ].join("\n"),
          },
        });
        return { threadId: "thread-skill-checkpoint-repair-2" };
      });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "1",
      "skill",
      "chat",
      ["brainstorming", "paper-visualizer", "lecture-read"],
      createNoteTurnContext(vaultRoot, {
        studyWorkflow: "lecture",
        workflowText: "Active study workflow: Lecture",
      }),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "1",
      false,
      false,
      "turn-skill-checkpoint-repair",
      "user-skill-checkpoint-repair",
      false,
      "error",
      skillOrchestrationPlan,
      true,
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    const assistantMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.text).toContain("## Visual Map");
    expect(assistantMessages[0]?.text).toContain("This step is complete. Continue to the next study step?");
    expect(assistantMessages[0]?.text).not.toContain("apply this to the note");
  });

  it("strips trailing rewrite invitations from non-explicit skill study replies", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-rewrite-text-scrub-"));
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
      (request as { onJsonEvent: (event: unknown) => void }).onJsonEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: [
            "Based on your current Pythagorean Theorem.md, the main thing to lock in is that the note is really about both the formula and the condition.",
            "",
            "## Main topics",
            "",
            "- Identifying the parts of a right triangle",
            "- Remembering that the theorem fails when the triangle is not right",
            "",
            "## Suggested follow-up notes or review tasks",
            "",
            "- Add a labeled triangle diagram with a, b, c, and the 90 degree angle",
            "- Add one real-world application, like a ladder or rectangle diagonal",
            "Do you want me to turn this into a cleaner study-ready rewrite for Pythagorean Theorem.md now?",
          ].join("\n"),
        },
      });
      return { threadId: "thread-skill-rewrite-text-scrub" };
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "Help me study this lecture material.",
      "skill",
      "chat",
      ["brainstorming", "paper-visualizer", "lecture-read"],
      createNoteTurnContext(vaultRoot, {
        studyWorkflow: "lecture",
        workflowText: "Active study workflow: Lecture",
      }),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "Help me study this lecture material.",
      false,
      false,
      "turn-skill-rewrite-text-scrub",
      "user-skill-rewrite-text-scrub",
    );

    const assistantText = service.getActiveTab()?.messages.find((message) => message.kind === "assistant")?.text ?? "";
    expect(assistantText).toContain("Suggested follow-up notes or review tasks");
    expect(assistantText).toContain("Add a labeled triangle diagram");
    expect(assistantText).not.toContain("Do you want me to turn this into");
    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
  });

  it("does not let stale non-explicit panel skill rewrite CTAs start a rewrite turn", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-stale-skill-rewrite-cta-"));
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

    service.store.setStudyRecipes([createPanel("panel-1", ["brainstorming", "paper-visualizer", "lecture-read"])]);
    service.store.setActiveStudyPanel(tabId, "panel-1", ["brainstorming", "paper-visualizer", "lecture-read"]);
    service.store.setPanelSessionOrigin(tabId, {
      panelId: "panel-1",
      selectedSkillNames: ["brainstorming", "paper-visualizer", "lecture-read"],
      promptSnapshot: "Help me study this lecture material.",
      awaitingCompletionSignal: false,
      lastAssistantMessageId: "assistant-stale-skill-cta",
      startedAt: 1,
    });
    service.store.addMessage(tabId, {
      id: "user-skill-route",
      kind: "user",
      text: "Help me study this lecture material.",
      createdAt: Date.now(),
      meta: {
        effectiveSkillsCsv: "brainstorming,paper-visualizer,lecture-read",
        effectiveSkillCount: 3,
      },
    });
    service.store.addMessage(tabId, {
      id: "assistant-stale-skill-cta",
      kind: "assistant",
      text: "Do you want me to turn this into a cleaner study-ready rewrite for Pythagorean Theorem.md now?",
      createdAt: Date.now(),
    });
    service.store.setChatSuggestion(tabId, {
      id: "rewrite-suggestion-stale-skill",
      kind: "rewrite_followup",
      status: "pending",
      messageId: "assistant-stale-skill-cta",
      panelId: null,
      panelTitle: null,
      promptSnapshot: "",
      matchedSkillName: null,
      canUpdatePanel: false,
      canSaveCopy: false,
      planSummary: null,
      planStatus: null,
      rewriteSummary: "Turn this into a cleaner study note.",
      rewriteQuestion: "Do you want me to turn this into a cleaner study-ready rewrite for Pythagorean Theorem.md now?",
      createdAt: Date.now(),
    });

    await service.sendPrompt(tabId, "Apply to note", { file: null, editor: null });

    expect(runTurnSpy).not.toHaveBeenCalled();
    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
  });

  it("drops explicit obsidian-suggest blocks from interim skill questions", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-suggest-no-cta-"));
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
    service.store.setTargetNotePath(tabId, "notes/current.md");
    service.store.setRuntimeMode(tabId, "skill");
    service.store.addMessage(tabId, {
      id: "user-skill-interim",
      kind: "user",
      text: "Help me study this lecture material.",
      createdAt: Date.now(),
      meta: { effectiveSkillsCsv: "brainstorming,lecture-read", effectiveSkillCount: 2 },
    });

    const assistantText = [
      "First, I’ll use /brainstorming.",
      "",
      "What do you want first for this note?",
      "",
      "1. A concise study guide",
      "2. Practice questions with answers",
      "3. A clearer rewrite of the note",
      "",
      "```obsidian-suggest",
      JSON.stringify({
        kind: "rewrite_followup",
        summary: "Apply the selected option to the note.",
        question: "Want me to apply this to the note now?",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-skill-interim",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-skill-interim", assistantText);

    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
  });

  it("drops explicit obsidian-suggest blocks from non-explicit skill final replies", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-final-suggest-no-cta-"));
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
    service.store.setTargetNotePath(tabId, "notes/current.md");
    service.store.setRuntimeMode(tabId, "skill");
    service.store.addMessage(tabId, {
      id: "user-skill-final-no-explicit",
      kind: "user",
      text: "Help me study this lecture material.",
      createdAt: Date.now(),
      meta: { effectiveSkillsCsv: "lecture-read,paper-visualizer", effectiveSkillCount: 2 },
    });

    const assistantText = [
      "Here is the study-focused summary.",
      "",
      "## Suggested follow-up notes or review tasks",
      "",
      "- Add a labeled triangle diagram.",
      "",
      "```obsidian-suggest",
      JSON.stringify({
        kind: "rewrite_followup",
        summary: "Turn this into a stronger study note.",
        question: "Want me to apply this to the note now?",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-skill-final-no-explicit",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-skill-final-no-explicit", assistantText);

    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
  });

  it("keeps rewrite CTA available for final skill outputs and explicit note rewrite requests", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-final-cta-"));
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
    service.store.setTargetNotePath(tabId, "notes/current.md");
    service.store.setRuntimeMode(tabId, "skill");
    service.store.addMessage(tabId, {
      id: "user-skill-final",
      kind: "user",
      text: "rewrite this note with the selected skill",
      createdAt: Date.now(),
      meta: { effectiveSkillsCsv: "lecture-read", effectiveSkillCount: 1 },
    });

    const assistantText = [
      "Here is the cleaned-up note explanation.",
      "",
      "```obsidian-suggest",
      JSON.stringify({
        kind: "rewrite_followup",
        summary: "Turn the cleaned-up explanation into a note patch.",
        question: "Want me to apply this to the note now?",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-skill-final",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-skill-final", assistantText);

    expect(service.getActiveTab()?.chatSuggestion?.kind).toBe("rewrite_followup");
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
    service.store.setTargetNotePath(tabId, "notes/current.md");

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

  it("treats the visible Apply to note CTA as a local rewrite action without carrying stale panel skills", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-apply-cta-stale-skills-"));
    tempRoots.push(vaultRoot);
    const extraSkillRoot = join(vaultRoot, "extra-skills");
    const figmaGenerateDir = join(extraSkillRoot, "figma-generate-design");
    const figmaUseDir = join(extraSkillRoot, "figma-use");
    await mkdir(figmaGenerateDir, { recursive: true });
    await mkdir(figmaUseDir, { recursive: true });
    const figmaGeneratePath = join(figmaGenerateDir, "SKILL.md");
    const figmaUsePath = join(figmaUseDir, "SKILL.md");
    await writeFile(figmaGeneratePath, "# Figma Generate Design\nUse only for Figma design generation.", "utf8");
    await writeFile(figmaUsePath, "# Figma Use\nUse only when fetching Figma context.", "utf8");
    const figmaSkills: InstalledSkillDefinition[] = [
      {
        name: "figma-generate-design",
        description: "Use only for Figma design generation.",
        path: figmaGeneratePath,
      },
      {
        name: "figma-use",
        description: "Use only when fetching Figma context.",
        path: figmaUsePath,
      },
    ];

    const service = new CodexService(
      createApp(vaultRoot),
      () => ({ ...DEFAULT_SETTINGS, extraSkillRoots: [extraSkillRoot] }),
      () => "en",
      null,
      async () => {},
      async () => {},
    );
    vi.spyOn(service as never, "hasCodexLogin").mockReturnValue(true);
    vi.spyOn(service as never, "refreshCodexCatalogs").mockImplementation(async () => {
      (service as unknown as { installedSkillCatalog: InstalledSkillDefinition[]; allInstalledSkillCatalog: InstalledSkillDefinition[] }).installedSkillCatalog = figmaSkills;
      (service as unknown as { installedSkillCatalog: InstalledSkillDefinition[]; allInstalledSkillCatalog: InstalledSkillDefinition[] }).allInstalledSkillCatalog = figmaSkills;
    });
    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const panel = createPanel("panel-figma", ["figma-generate-design", "figma-use"]);
    service.store.setStudyRecipes([panel]);
    service.store.setActiveStudyPanel(tabId, panel.id, ["figma-generate-design", "figma-use"]);
    service.store.setTargetNotePath(tabId, "notes/current.md");
    service.store.addMessage(tabId, {
      id: "assistant-apply-cta",
      kind: "assistant",
      text: "Want me to apply this to the note now?",
      createdAt: Date.now(),
    });
    service.store.setChatSuggestion(tabId, {
      id: "rewrite-suggestion-apply-cta",
      kind: "rewrite_followup",
      status: "pending",
      messageId: "assistant-apply-cta",
      panelId: null,
      panelTitle: null,
      promptSnapshot: "Clarify the right-triangle condition.",
      matchedSkillName: null,
      canUpdatePanel: false,
      canSaveCopy: false,
      planSummary: null,
      planStatus: null,
      rewriteSummary: "Clarify the right-triangle condition.",
      rewriteQuestion: "Want me to apply this to the note now?",
      createdAt: Date.now(),
    });

    await service.sendPrompt(tabId, "Apply to note", { file: null, editor: null });

    expect(runTurnSpy).toHaveBeenCalledTimes(1);
    expect(runTurnSpy.mock.calls[0]?.[1]).toContain("Turn your immediately previous assistant answer");
    expect(runTurnSpy.mock.calls[0]?.[4]).toEqual([]);
    expect(runTurnSpy.mock.calls[0]?.[19]).toBeNull();
    const userMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "user") ?? [];
    expect(userMessages.at(-1)?.text).toBe("Apply to note");
    expect(userMessages.at(-1)?.meta?.internalPromptKind).toBe("rewrite_followup");
    expect(userMessages.at(-1)?.meta?.effectiveSkillsCsv).toBeNull();
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

  it("applies typed Apply to note to the only pending patch without starting a skilled turn", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-pending-patch-apply-cta-"));
    tempRoots.push(vaultRoot);
    const skillRoot = join(vaultRoot, "extra-skills");
    const figmaSkillDir = join(skillRoot, "figma-generate-design");
    await mkdir(figmaSkillDir, { recursive: true });
    const figmaSkillPath = join(figmaSkillDir, "SKILL.md");
    await writeFile(figmaSkillPath, "# Figma Generate Design\nUse only for Figma work.", "utf8");

    const writable = createWritableApp(vaultRoot, { "notes/current.md": "# Current\n\nOriginal" });
    const service = new CodexService(writable.app, () => ({ ...DEFAULT_SETTINGS, extraSkillRoots: [skillRoot] }), () => "en", null, async () => {}, async () => {});
    const userOwnedSkill: InstalledSkillDefinition = {
      name: "figma-generate-design",
      description: "Use only for Figma work.",
      path: figmaSkillPath,
    };
    (service as unknown as { installedSkillCatalog: InstalledSkillDefinition[]; allInstalledSkillCatalog: InstalledSkillDefinition[] }).installedSkillCatalog = [userOwnedSkill];
    (service as unknown as { installedSkillCatalog: InstalledSkillDefinition[]; allInstalledSkillCatalog: InstalledSkillDefinition[] }).allInstalledSkillCatalog = [userOwnedSkill];

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const panel = createPanel("panel-figma", ["figma-generate-design"]);
    service.store.setStudyRecipes([panel]);
    service.store.setActiveStudyPanel(tabId, panel.id, ["figma-generate-design"]);
    service.store.setPatchBasket(tabId, [
      {
        id: "patch-apply-cta-1",
        threadId: null,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-original",
        targetPath: "notes/current.md",
        kind: "update",
        baseSnapshot: "# Current\n\nOriginal",
        proposedText: "# Current\n\nOriginal\n\nAdded line.",
        unifiedDiff: "@@",
        summary: "Update note",
        status: "pending",
        createdAt: Date.now(),
      },
    ]);

    const runTurnSpy = vi.spyOn(service as never, "runTurn").mockResolvedValue(undefined);

    await service.sendPrompt(tabId, "Apply to note", { file: null, editor: null });

    expect(runTurnSpy).not.toHaveBeenCalled();
    expect(writable.files.get("notes/current.md")).toBe("# Current\n\nOriginal\n\nAdded line.");
    expect(service.getActiveTab()?.patchBasket[0]?.status).toBe("applied");
    expect(service.getActiveTab()?.pendingApprovals.some((approval) => approval.toolName === "skill_update")).toBe(false);
    expect(service.getActiveTab()?.messages.some((message) => message.kind === "user" && message.text === "Apply to note")).toBe(false);
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
    service.store.setTargetNotePath(tabId, "notes/current.md");

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

  it("drops rewrite-followup suggestions for greeting-only replies", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-greeting-no-rewrite-"));
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
    service.store.addMessage(tabId, {
      id: "user-greeting",
      kind: "user",
      text: "\u3053\u3093\u306b\u3061\u306f",
      createdAt: Date.now(),
    });

    const assistantText = [
      "No note changes yet.",
      "",
      "\u3053\u3093\u306b\u3061\u306f\u3002\u30ce\u30fc\u30c8\u306e\u78ba\u8a8d\u3001\u8981\u7d04\u3001\u66f8\u304d\u63db\u3048\u6848\u3001obsidian-patch \u4f5c\u6210\u307e\u3067\u5bfe\u5fdc\u3067\u304d\u307e\u3059\u3002",
      "",
      "Want me to apply this to the note now?",
      "",
      "```obsidian-suggest",
      JSON.stringify({
        kind: "rewrite_followup",
        summary: "Apply the greeting to the note.",
        question: "Want me to apply this to the note now?",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-greeting",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-greeting", assistantText);

    expect(service.getActiveTab()?.chatSuggestion).toBeNull();
  });

  it("saves generated SVG diagrams and appends them to the target note", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-diagram-append-"));
    tempRoots.push(vaultRoot);

    const writable = createWritableApp(vaultRoot, { "notes/current.md": "# Current\n\nOriginal" });
    const service = new CodexService(writable.app, () => DEFAULT_SETTINGS, () => "en", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    service.store.setTargetNotePath(tabId, "notes/current.md");

    const assistantText = [
      "Generated and inserted a diagram.",
      "",
      "```obsidian-diagram",
      JSON.stringify({
        title: "Average Load Power",
        alt: "Source feeding a load resistor with average power relation.",
        caption: "Average load power follows from the RMS voltage across the load.",
        insertMode: "auto",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect x="40" y="40" width="560" height="280" fill="white" stroke="black"/><text x="80" y="120">P = V_rms^2 / R</text></svg>',
      }),
      "```",
    ].join("\n");

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-diagram-1", assistantText);

    expect(writable.files.get("assets/vaultforgian/diagrams/average-load-power.svg")).toContain("<svg");
    expect(writable.files.get("notes/current.md")).toContain("## Generated visuals");
    expect(writable.files.get("notes/current.md")).toContain("![[assets/vaultforgian/diagrams/average-load-power.svg]]");
    expect(writable.files.get("notes/current.md")).toContain("*Average load power follows from the RMS voltage across the load.*");
    expect(service.getActiveTab()?.generatedDiagrams).toEqual([
      expect.objectContaining({
        assetPath: "assets/vaultforgian/diagrams/average-load-power.svg",
        targetNotePath: "notes/current.md",
        status: "inserted",
      }),
    ]);
    expect(service.getActiveTab()?.messages.at(-1)).toMatchObject({
      kind: "system",
      meta: { tone: "success" },
    });
  });

  it("stores Learning Mode coach state and escalates repeated stuck responses", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-learning-coach-"));
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

    vi.spyOn(service as never, "syncUsageFromSession").mockResolvedValue(undefined);
    vi.spyOn(service as never, "syncTranscriptFromSession").mockResolvedValue("no_reply_found");
    const runCodexStreamSpy = vi.spyOn(service as never, "runCodexStream").mockImplementation(async (request) => {
      const callbacks = request as {
        onJsonEvent: (event: unknown) => void;
      };
      callbacks.onJsonEvent({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "Try one small hint first.",
        },
      });
      return { threadId: "thread-learning-coach" };
    });

    const context = createNoteTurnContext(vaultRoot, {
      studyWorkflow: "review",
      workflowText: "Active study workflow: Review\nResponse contract:",
    });
    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "I don't know",
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
      "I don't know",
      false,
      false,
      "turn-learning-coach-1",
      "user-learning-coach-1",
    );

    expect(service.getActiveTab()?.studyCoachState).toMatchObject({
      lastCoachMode: "scaffold",
      lastHintLevel: "guided",
      consecutiveStuckCount: 1,
    });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "I don't know",
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
      "I don't know",
      false,
      false,
      "turn-learning-coach-2",
      "user-learning-coach-2",
    );

    const secondRuntimePrompt = (runCodexStreamSpy.mock.calls[1]?.[0] as { prompt?: string } | undefined)?.prompt ?? "";
    expect(secondRuntimePrompt).toContain("LearningCoachPlan");
    expect(secondRuntimePrompt).toContain("Hint level: worked_step");
    expect(service.getActiveTab()?.studyCoachState).toMatchObject({
      lastCoachMode: "scaffold",
      lastHintLevel: "worked_step",
      consecutiveStuckCount: 2,
    });
  });

  it("inserts generated SVG diagrams after the current selection when possible", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-diagram-selection-"));
    tempRoots.push(vaultRoot);

    const writable = createWritableApp(vaultRoot, {
      "notes/current.md": "# Current\n\nBefore\n\nSelected equation\n\nAfter",
    });
    const service = new CodexService(writable.app, () => DEFAULT_SETTINGS, () => "en", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    service.store.setTargetNotePath(tabId, "notes/current.md");
    service.store.setSelectionContext(tabId, {
      text: "Selected equation",
      sourcePath: "notes/current.md",
      createdAt: Date.now(),
    });

    const assistantText = [
      "Generated a diagram.",
      "",
      "```obsidian-diagram",
      JSON.stringify({
        title: "Signal Chain",
        alt: "Signal chain from input to load.",
        insertMode: "auto",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><path d="M80 180 H560" stroke="black" fill="none"/></svg>',
      }),
      "```",
    ].join("\n");

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-diagram-selection", assistantText);

    expect(writable.files.get("notes/current.md")).toContain(
      "Selected equation\n\n![[assets/vaultforgian/diagrams/signal-chain.svg]]\n\nAfter",
    );
  });

  it("saves generated SVG diagrams without inserting when no note target is available", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-diagram-no-target-"));
    tempRoots.push(vaultRoot);

    const writable = createWritableApp(vaultRoot);
    const service = new CodexService(writable.app, () => DEFAULT_SETTINGS, () => "en", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const assistantText = [
      "Generated a standalone diagram.",
      "",
      "```obsidian-diagram",
      JSON.stringify({
        title: "Standalone Concept Map",
        alt: "Concept map with three linked ideas.",
        insertMode: "auto",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><circle cx="320" cy="180" r="80" fill="white" stroke="black"/></svg>',
      }),
      "```",
    ].join("\n");

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-diagram-no-target", assistantText);

    expect(writable.files.get("assets/vaultforgian/diagrams/standalone-concept-map.svg")).toContain("<svg");
    expect(service.getActiveTab()?.generatedDiagrams?.[0]).toMatchObject({
      assetPath: "assets/vaultforgian/diagrams/standalone-concept-map.svg",
      targetNotePath: null,
      status: "saved",
    });
    expect(service.getActiveTab()?.messages.at(-1)).toMatchObject({
      kind: "system",
      meta: { tone: "warning" },
    });
  });

  it("localizes generated diagram system messages with the selected plugin locale", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-diagram-ja-"));
    tempRoots.push(vaultRoot);

    const writable = createWritableApp(vaultRoot);
    const service = new CodexService(writable.app, () => DEFAULT_SETTINGS, () => "ja", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const assistantText = [
      "\u56f3\u3092\u4f5c\u6210\u3057\u307e\u3057\u305f\u3002",
      "",
      "```obsidian-diagram",
      JSON.stringify({
        title: "Standalone Concept Map",
        alt: "Concept map with three linked ideas.",
        insertMode: "auto",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><circle cx="320" cy="180" r="80" fill="white" stroke="black"/></svg>',
      }),
      "```",
    ].join("\n");

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-diagram-ja", assistantText);

    const lastMessage = service.getActiveTab()?.messages.at(-1);
    expect(lastMessage?.text).toContain("\u56f3\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f");
    expect(lastMessage?.text).not.toContain("Generated diagram saved");
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
      latestContract: expect.objectContaining({
        objective: "Continue the review study turn.",
        concepts: [
          expect.objectContaining({
            label: "Can explain the headline reason convolution becomes multiplication.",
            status: "understood",
          }),
          expect.objectContaining({
            label: "Still unclear on why the transform changes a sliding integral into multiplication.",
            status: "weak",
          }),
        ],
        checkQuestion: "Explain the bridge between convolution and multiplication in one sentence.",
        nextAction: "Explain the bridge between convolution and multiplication in one sentence.",
        workflow: "review",
      }),
      lastStuckPoint: expect.objectContaining({
        conceptLabel: "Still unclear on why the transform changes a sliding integral into multiplication.",
        detail: "Still unclear on why the transform changes a sliding integral into multiplication.",
        workflow: "review",
      }),
      nextProblems: [
        expect.objectContaining({
          prompt: "Explain the bridge between convolution and multiplication in one sentence.",
          workflow: "review",
        }),
      ],
    });

    expect(service.store.getState().userAdaptationMemory?.studyMemory?.weakConcepts).toEqual([
      expect.objectContaining({
        conceptLabel: "Still unclear on why the transform changes a sliding integral into multiplication.",
        evidence: "The learner understands the headline result but cannot justify the bridge yet.",
        nextQuestion: "Explain the bridge between convolution and multiplication in one sentence.",
        workflow: "review",
      }),
    ]);
    expect(service.store.getState().userAdaptationMemory?.studyMemory?.understoodConcepts).toEqual([
      expect.objectContaining({
        conceptLabel: "Can explain the headline reason convolution becomes multiplication.",
        workflow: "review",
      }),
    ]);

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

    expect(context.studyCoachText).toContain("Study memory carry-forward:");
    expect(context.studyCoachText).toContain("Workflow-specific coach guidance:");
    expect(context.studyCoachText).toContain("Weak point: The learner understands the headline result but cannot justify the bridge yet.");
    expect(context.studyCoachText).toContain("Next check: Explain the bridge between convolution and multiplication in one sentence.");
  });

  it("stores study contracts into active panel memory and prefers that memory on the next panel turn", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-panel-contract-"));
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

    const panel = createPanel("panel-paper", ["deep-read"]);
    service.store.setStudyRecipes([panel]);
    service.store.setActiveStudyPanel(tabId, panel.id, ["deep-read"]);
    service.store.setTabStudyWorkflow(tabId, "paper");
    service.store.setUserAdaptationMemory({
      globalProfile: null,
      panelOverlays: {
        [panel.id]: {
          panelId: panel.id,
          preferredFocusTags: [],
          preferredNoteStyleHints: [],
          preferredSkillNames: ["deep-read"],
          lastAppliedTargetPath: null,
          updatedAt: 1,
          studyMemory: {
            weakConcepts: [
              {
                conceptLabel: "claims vs interpretation",
                evidence: "Prior turn showed confusion.",
                lastStuckPoint: "Claim wording was treated as interpretation.",
                nextQuestion: "Which sentence is the claim?",
                workflow: "paper",
                updatedAt: 1,
              },
            ],
            understoodConcepts: [],
            nextProblems: [],
            recentStuckPoints: [],
            sourcePreferences: [],
            lastContract: null,
            improvementSignals: [],
          },
        },
      },
      studyMemory: null,
    });

    const assistantText = [
      "The paper distinguishes the author's claim from your interpretation.",
      "",
      "```obsidian-study-contract",
      JSON.stringify({
        objective: "Separate claims from interpretation in the assigned paper.",
        sources: ["paper PDF"],
        concepts: [
          {
            label: "claims vs interpretation",
            status: "understood",
            evidence: "The learner can now identify author claims.",
          },
          {
            label: "method validity",
            status: "weak",
            evidence: "The learner still needs help judging method limits.",
          },
        ],
        likely_stuck_points: ["Method limits are being summarized without evidence."],
        check_question: "Which sentence states the method limit?",
        next_action: "Classify one paragraph as claim, method, or interpretation.",
        next_problems: ["Mark the next paragraph as claim, method, or interpretation."],
        confidence_note: "Claim separation improved, method validity remains weak.",
        workflow: "paper",
      }),
      "```",
    ].join("\n");

    service.store.addMessage(tabId, {
      id: "assistant-panel-study-1",
      kind: "assistant",
      text: assistantText,
      createdAt: Date.now(),
    });

    const syncAssistantArtifacts = (
      service as unknown as Record<string, (tabId: string, messageId: string, text: string) => Promise<void>>
    )["syncAssistantArtifacts"];
    await syncAssistantArtifacts.call(service, tabId, "assistant-panel-study-1", assistantText);

    const overlay = service.store.getState().userAdaptationMemory?.panelOverlays?.[panel.id];
    expect(overlay?.studyMemory?.weakConcepts).toEqual([
      expect.objectContaining({
        conceptLabel: "method validity",
        nextQuestion: "Which sentence states the method limit?",
      }),
    ]);
    expect(overlay?.studyMemory?.understoodConcepts).toEqual([
      expect.objectContaining({
        conceptLabel: "claims vs interpretation",
      }),
    ]);
    expect(overlay?.studyMemory?.sourcePreferences).toEqual([
      expect.objectContaining({
        label: "paper PDF",
        count: 1,
      }),
    ]);
    expect(overlay?.studyMemory?.lastContract?.objective).toContain("Separate claims");
    expect(service.store.getState().userAdaptationMemory?.studyMemory?.weakConcepts?.[0]?.conceptLabel).toBe("method validity");

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
    const context = await captureTurnContext.call(service, tabId, null, null, "Continue the paper panel.", null, [], null, null, [], []);

    expect(context.studyCoachText).toContain("Panel memory carry-forward:");
    expect(context.studyCoachText).toContain("method validity");
    expect(context.studyCoachText).toContain("paper PDF");
    expect(context.studyCoachText).toContain("Mark the next paragraph");
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

  it("suppresses active quiz backfill that exactly repeats the previous assistant bubble", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-quiz-session-duplicate-"));
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

    const repeatedReply = [
      "Correct.",
      "Hint: for a missing leg, use b = sqrt(c^2 - a^2).",
      "If the hypotenuse is 13 and one leg is 5, what is the other leg?",
    ].join("\n\n");
    service.store.setStudyCoachState(tabId, {
      latestRecap: null,
      weakPointLedger: [],
      lastCheckpointAt: null,
      quizSession: {
        ...createStudyQuizSession("quiz-1", 1),
        currentIndex: 2,
      },
    });
    service.store.addMessage(tabId, {
      id: "assistant-previous-quiz",
      kind: "assistant",
      text: repeatedReply,
      createdAt: Date.now(),
    });
    service.store.addMessage(tabId, {
      id: "user-answer",
      kind: "user",
      text: "10",
      createdAt: Date.now(),
    });

    const sessionFile = join(vaultRoot, "quiz-session-duplicate-thread.jsonl");
    await writeFile(
      sessionFile,
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ text: repeatedReply }],
        },
      }),
      "utf8",
    );

    vi.spyOn(service as never, "resolveSessionFile").mockResolvedValue(sessionFile);

    await expect(
      (
        service as unknown as {
          syncTranscriptFromSession: (tabId: string, threadId: string, visibility: "visible" | "artifact_only") => Promise<string>;
        }
      ).syncTranscriptFromSession(tabId, "thread-duplicate-quiz", "visible"),
    ).resolves.toBe("duplicate_reply");

    const assistantMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(assistantMessages.map((message) => message.text)).toEqual([repeatedReply]);
    expect(
      (
        service as unknown as {
          consumeSuppressedDuplicateQuizReply: (tabId: string) => string | null;
        }
      ).consumeSuppressedDuplicateQuizReply(tabId),
    ).toBe(repeatedReply);
  });

  it("allows exact repeat quiz replies when the learner asks to repeat the question", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-quiz-session-repeat-request-"));
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

    const repeatedReply = [
      "Quiz 2/5",
      "If the hypotenuse is 13 and one leg is 5, what is the other leg?",
    ].join("\n\n");
    service.store.setStudyCoachState(tabId, {
      latestRecap: null,
      weakPointLedger: [],
      lastCheckpointAt: null,
      quizSession: {
        ...createStudyQuizSession("quiz-1", 1),
        currentIndex: 2,
      },
    });
    service.store.addMessage(tabId, {
      id: "assistant-previous-quiz",
      kind: "assistant",
      text: repeatedReply,
      createdAt: Date.now(),
    });
    service.store.addMessage(tabId, {
      id: "user-repeat",
      kind: "user",
      text: "repeat the question",
      createdAt: Date.now(),
    });

    const sessionFile = join(vaultRoot, "quiz-session-repeat-request-thread.jsonl");
    await writeFile(
      sessionFile,
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ text: repeatedReply }],
        },
      }),
      "utf8",
    );

    vi.spyOn(service as never, "resolveSessionFile").mockResolvedValue(sessionFile);

    await expect(
      (
        service as unknown as {
          syncTranscriptFromSession: (tabId: string, threadId: string, visibility: "visible" | "artifact_only") => Promise<string>;
        }
      ).syncTranscriptFromSession(tabId, "thread-repeat-quiz", "visible"),
    ).resolves.toBe("appended_reply");

    const assistantMessages = service.getActiveTab()?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(assistantMessages.map((message) => message.text)).toEqual([repeatedReply, repeatedReply]);
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

  it("preserves panel skill continuation prompt rules across empty-reply retry", async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-study-continuation-empty-retry-"));
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
      .mockResolvedValueOnce({ threadId: "thread-skill-empty-1" })
      .mockResolvedValueOnce({ threadId: "thread-skill-empty-2" });

    await ((service as unknown as { runTurn: PrivateRunTurn }).runTurn)(
      tabId,
      "2",
      "skill",
      "chat",
      ["brainstorming", "paper-visualizer", "lecture-read"],
      createNoteTurnContext(vaultRoot),
      [],
      vaultRoot,
      "native",
      "codex",
      undefined,
      false,
      "2",
      true,
      false,
      "turn-skill-empty-retry",
      "user-skill-empty-retry",
      false,
      "error",
      null,
      true,
    );

    expect(runCodexStreamSpy).toHaveBeenCalledTimes(2);
    const retryPrompt = (runCodexStreamSpy.mock.calls[1]?.[0] as { prompt?: string } | undefined)?.prompt ?? "";
    expect(retryPrompt).toContain("This is a continuation of the same Panel Studio skill route.");
    expect(retryPrompt).toContain("do not restart /brainstorming");
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
