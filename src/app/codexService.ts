import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { Notice, TFile, type App, type Editor } from "obsidian";
import { AgentStore } from "../model/store";
import type {
  AccountUsageSummary,
  ChatMessage,
  ChatSuggestionAction,
  CodexRuntime,
  ComposerAttachment,
  ComposerAttachmentInput,
  ConversationTabState,
  ComposeMode,
  EditOutcome,
  ModelCatalogEntry,
  PendingApproval,
  PatchProposal,
  RecentStudySource,
  SkillFeedbackRecord,
  StudyRecipe,
  PersistedWorkspaceState,
  PluginSettings,
  RuntimeMode,
  SelectionContext,
  StudyWorkflowKind,
  TurnContextSnapshot,
  WaitingPhase,
} from "../model/types";
import { DEFAULT_PRIMARY_MODEL as DEFAULT_MODEL } from "../model/types";
import { getLocalizedCopy, type SupportedLocale } from "../util/i18n";
import { resolveEditTarget } from "../util/editTarget";
import { makeId } from "../util/id";
import {
  buildCodexSpawnSpec,
  isUnsupportedJsonFlagError,
  type JsonOutputFlag,
} from "../util/codexCli";
import { isWindowsUncPath, isWslPathLike, normalizeRuntimePath } from "../util/command";
import { DEFAULT_CODEX_EXECUTABLE, isUnsafeCodexExecutablePath, sanitizeCodexExecutablePath } from "../util/codexLauncher";
import {
  coerceModelForRuntime,
  coerceModelForPicker,
  getFallbackModelCatalog,
  parseModelCatalog,
  resolveReasoningEffortForModel,
} from "../util/models";
import {
  compareCodexVersions,
  extractModelCacheClientVersion,
  isCodexUpgradeRequiredError,
  isModelRuntimeCompatible,
  parseCodexCliVersion,
} from "../util/codexVersion";
import { buildContextPackText, MAX_CONTEXT_PATHS, normalizeContextPaths } from "../util/contextPack";
import { loadCodexPromptCatalog, type CodexPromptDefinition } from "../util/codexPrompts";
import {
  chooseHighestReasoningEffort,
  extractApiErrorDetails,
  extractSupportedReasoningEfforts,
  getCompatibleReasoningEffort,
  isUnsupportedReasoningEffortError,
  normalizeReasoningEffort,
  unwrapApiErrorMessage,
  type ReasoningEffort,
} from "../util/reasoning";
import { getPermissionModeProfile, type NoteApplyPolicy, type PermissionMode } from "../util/permissionMode";
import {
  buildAttachmentContentPackResult,
  buildAttachmentPromptManifest,
  buildAttachmentSummaryText,
  cleanupComposerAttachments,
  DEFAULT_ATTACHMENT_PROMPT,
  DEFAULT_SELECTION_AND_ATTACHMENT_PROMPT,
  PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS,
  PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS_PER_FILE,
  normalizeComposerAttachments,
  resolveComposerAttachmentStageRoot,
  stageComposerAttachment,
} from "../util/composerAttachments";
import {
  AUTO_COMPACT_MESSAGE_THRESHOLD,
  AUTO_COMPACT_VISIBLE_CHAR_THRESHOLD,
  shouldAutoCompactConversation,
} from "../util/conversationCompaction";
import {
  isUserOwnedSkillDefinition,
  loadInstalledSkillCatalog,
  type InstalledSkillDefinition,
} from "../util/skillCatalog";
import { getDefaultWslBridgeSkillRoots, normalizeConfiguredSkillRoots } from "../util/skillRoots";
import { parseEnvironmentEntries } from "../util/pluginSettings";
import { extractSkillReferences } from "../util/skillRouting";
import { getSlashCommandCatalog, type SlashCommandDefinition } from "../util/slashCommandCatalog";
import { expandSlashCommand } from "../util/slashCommands";
import { buildRequestedSkillGuideText, resolveRequestedSkillDefinitions } from "../util/skillGuides";
import { collectTurnRequestedSkillRefs } from "../util/turnSkillSelection";
import {
  DEFAULT_WSL_FALLBACK_LAUNCHER_PARTS,
  isWslCodexMissingError,
  shouldPreferWslForTurn,
  shouldRetryWithWslFallback,
} from "../util/runtimeFallback";
import { normalizeVisibleUserPromptText, sanitizeOperationalAssistantText } from "../util/assistantChatter";
import {
  buildCodexRunWatchdogMessage,
  getCodexRunWatchdogStage,
  type CodexRunWatchdogStage,
} from "../util/codexRunWatchdog";
import { buildPaperStudyRuntimeOverlayText } from "../util/paperStudyRuntimeOverlay";
import {
  buildSourceAcquisitionContractText,
  buildVaultNoteSourcePackText,
  dedupeNoteFiles,
  extractSourcePackPriorityTerms,
  type SourceAcquisitionMode,
} from "../util/sourceAcquisition";
import {
  extractAssistantProposals,
  type ParsedAssistantProposalResult,
  type ParsedAssistantPatch,
} from "../util/assistantProposals";
import { applyAnchorReplacements } from "../util/patchApply";
import { PatchConflictError } from "../util/patchConflicts";
import {
  assessPatchReadability,
  PatchReadabilityError,
  shouldBlockAutomaticPatchApply,
} from "../util/patchReadability";
import { buildSkillImprovementDiff, buildSkillImprovementProposal } from "../util/skillImprovement";
import {
  buildDelimiterPatchExample,
  buildPatchMathFormattingRules,
  buildQuotedPatchMathFormattingRules,
} from "../util/patchPromptContract";
import { buildUnifiedDiff } from "../util/unifiedDiff";
import { buildUserAdaptationMemoryText, updateUserAdaptationMemory } from "../util/userAdaptation";
import { validateManagedNotePath } from "../util/vaultPathPolicy";
import { AUTO_APPLY_CONSENT_VERSION } from "../util/permissionLifecycle";
import {
  createEmptyAccountUsageSummary,
  createEmptyUsageSummary,
  deriveAccountUsageFreshness,
  hasAccountUsageSummaryData,
  mergeAccountUsageSummary,
  normalizeAccountUsageSummary,
  shouldPreferAccountUsageSummary,
} from "../util/usage";
import { promptAutoApplyConsent } from "../views/permissionModals";
import { openPatchConflictModal } from "../views/patchConflictUi";
import { resolveEffectiveExecutionState } from "../util/planExecution";
import {
  findSessionFileForThread,
  listRecentSessionFiles as listRecentUsageSessionFiles,
  readLastVisibleAssistantMessageFromSessionFile,
  readSessionUsageSnapshot,
} from "../util/usageSessions";
import { allowsVaultWrite } from "../util/vaultEdit";
import { pickWaitingCopy } from "../util/waiting";
import {
  buildStudyRecipeChatPrompt,
  buildStudyRecipeMentionContext,
  type StudyRecipePreflight,
} from "../util/studyRecipes";
import {
  buildStudyWorkflowDraft,
  buildStudyWorkflowRuntimeBrief,
  getStudyRecipeWorkflowLabel,
  getStudyWorkflowDefinition,
  type StudyWorkflowPromptContext,
} from "../util/studyWorkflows";
import { buildPaperStudyGuideText, shouldAttachPaperStudyGuide } from "../util/studyTurnGuides";
import { buildPluginFeatureGuideText } from "../util/pluginFeatureGuides";
import { shouldSuppressImmediateDuplicateUserPrompt } from "../util/messageDedup";
import { getRecoveredDraftValue } from "../util/draftRecovery";
import {
  extractPromptMetadata,
  formatPlanModePrompt,
  normalizePromptInput,
  type MentionEntityKind,
  type ParsedMention,
} from "./promptPipeline";
import { buildTurnPrompt } from "./turnPrompt";
import type { ComposerHistoryState } from "../util/composerHistory";
import {
  StudyPanelCoordinator,
  type StudyRecipeSavePreview,
  type StudyRecipeSkillDraft,
} from "./studyPanelCoordinator";
import { ThreadEventReducer, type AssistantOutputVisibility } from "./threadEventReducer";
import { ApprovalCoordinator, type ApprovalResult, type ToolDecision } from "./approvalCoordinator";
import { UsageSyncCoordinator } from "./usageSyncCoordinator";

type JsonRecord = Record<string, unknown>;

type AbortReason = "user_interrupt" | "approval_abort" | "tab_close" | "plugin_unload" | "runtime_abort";

interface ActiveRunState {
  controller: AbortController;
  mode: RuntimeMode;
  abortReason: AbortReason | null;
  lastLivenessAt?: number | null;
  lastMeaningfulProgressAt?: number | null;
  stallWarnedAt?: number | null;
  watchdogRecoveryAttempted?: boolean;
  watchdogState?: "healthy" | "stalled" | "recovering";
}

type TurnOutcomeKind =
  | "assistant_text"
  | "patch_only"
  | "ops_only"
  | "approval_pending"
  | "error"
  | "orphaned_turn_error";

interface PendingTurnState {
  turnId: string;
  userMessageId: string | null;
  submittedAt: number;
  hasVisibleOutcome: boolean;
  hasArtifactOutcome: boolean;
  autoApplyProposalCount: number;
  autoApplyGuardNotified: boolean;
}

interface SendPromptContext {
  file: TFile | null;
  editor: Editor | null;
  images?: string[];
  transcriptPrompt?: string | null;
  transcriptMeta?: Record<string, string | number | boolean | null | undefined>;
}

interface CodexRunRequest {
  prompt: string;
  tabId: string;
  threadId: string | null;
  workingDirectory: string;
  runtime: CodexRuntime;
  executablePath: string;
  launcherOverrideParts?: string[];
  sandboxMode: "read-only" | "workspace-write";
  approvalPolicy: "untrusted" | "on-failure" | "never";
  images: string[];
  model: string;
  reasoningEffort: ReasoningEffort | null;
  fastMode: boolean;
  signal: AbortSignal;
  onEvent: (event: JsonRecord) => void;
  watchdogRecoveryAttempted?: boolean;
  onWatchdogStageChange?: (stage: Exclude<CodexRunWatchdogStage, "healthy">) => void;
}

interface CodexRunResult {
  threadId: string | null;
}

interface ResolvedTurnCodexLauncher {
  runtime: CodexRuntime;
  executablePath: string;
  launcherOverrideParts?: string[];
  cliVersion?: string | null;
}

interface CodexVersionProbeResult {
  stdout: string;
  stderr: string;
  cliVersion: string | null;
}

interface RuntimeMetadataSnapshot {
  resolvedCommand: string | null;
  cliVersion: string | null;
  modelCacheClientVersion: string | null;
  modelCatalogSource: "native" | "wsl" | "fallback";
}

const MAX_AUTO_APPLY_PROPOSALS_PER_TURN = 5;

interface ResolvedTurnSkillContext {
  skillNames: string[];
  resolvedSkillDefinitions: InstalledSkillDefinition[];
}

type TranscriptSyncResult =
  | "appended_reply"
  | "duplicate_reply"
  | "no_reply_found"
  | "no_visible_reply_found"
  | "session_missing"
  | "session_read_error";

type ProposalRepairReason = "malformed" | "empty" | "promise_without_block";
type ProposalRepairFailureMode = "error" | "silent";
type NoteReflectionRescueStrength = "strong_repair" | "cta_only";

interface NoteReflectionRescueCandidate {
  message: ChatMessage;
  parsed: ParsedAssistantProposalResult;
  strength: NoteReflectionRescueStrength;
  targetPath: string;
  rewriteSummary: string | null;
  rewriteQuestion: string | null;
}

interface TurnArtifactSnapshot {
  patchIds: Set<string>;
  approvalIds: Set<string>;
}

const PATCH_PROMISE_PATTERNS: RegExp[] = [
  /パッチ/,
  /差し替え/,
  /差分/,
  /obsidian-patch/i,
  /反映/,
  /適用/,
  /編集版/,
  /修正版/,
  /\bpatch\b/i,
  /\bapply\b/i,
  /\bupdate(?:d)?\s+the\s+note\b/i,
  /\breplace(?:ment)?\b/i,
  /\bfence(?:d)?\s+block\b/i,
  /\brewrit(?:e|ten)\b/i,
];

const STRONG_NOTE_REFLECTION_PATTERNS: RegExp[] = [
  /changes proposed below\.?$/im,
  /\bwant me to apply this to the note now\??$/im,
  /(?:この|この説明を|この内容を).{0,80}(?:追記|反映|適用|書き加え|追加).{0,24}(?:しますか|しましょうか|していいですか|してよいですか)[？?]?/u,
  /(?:note|ノート).{0,32}(?:was not changed yet|まだ変更していません)/iu,
  /\b(?:applied|updated|reflected|revised|rewritten)\b.{0,40}\b(?:note|section|step)\b/iu,
];

const CTA_ONLY_NOTE_REFLECTION_PATTERNS: RegExp[] = [
  /\bclarif(?:y|ies|ied)\b.{0,40}\bnote\b/iu,
  /\btighten(?:ed|s)?\b.{0,40}\b(?:note|section|step|explanation)\b/iu,
  /\breorgani[sz](?:e|ed|es)\b.{0,40}\b(?:note|section|explanation)\b/iu,
  /\bclean(?:ed)?\s+up\b.{0,40}\b(?:note|section|explanation)\b/iu,
  /(?:この説明|この内容|この整理).{0,40}(?:ノート|step|ステップ|節|セクション)/iu,
];

const REWRITE_APPLY_QUESTION_PATTERNS: RegExp[] = [
  /\bwant me to apply this to the note now\??$/im,
  /\bapply this to the note\??$/im,
  /(?:この|この説明を|この内容を).{0,80}(?:追記|反映|適用|書き加え|追加).{0,24}(?:しますか|しましょうか|していいですか|してよいですか)[？?]?/u,
];

const NOTE_REFLECTION_OPT_OUT_PATTERNS: RegExp[] = [
  /\bdon't edit\b/iu,
  /\bdo not edit\b/iu,
  /\bjust explain\b/iu,
  /\bdon't apply\b/iu,
  /\bdo not apply\b/iu,
  /編集しない/iu,
  /反映しない/iu,
  /適用しない/iu,
  /説明だけ/iu,
  /追記しない/iu,
];

const NOTE_REFLECTION_SUMMARY_DROP_PATTERNS: RegExp[] = [
  /changes proposed below\.?$/im,
  ...REWRITE_APPLY_QUESTION_PATTERNS,
  /(?:note|ノート).{0,32}(?:was not changed yet|まだ変更していません)/iu,
];

function hasPatchPromiseKeywords(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return PATCH_PROMISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export type { StudyRecipeSavePreview, StudyRecipeSkillDraft } from "./studyPanelCoordinator";

const CODEX_HOME = join(homedir(), ".codex");
const CODEX_AUTH_PATH = join(CODEX_HOME, "auth.json");
const CODEX_SESSION_ROOT = join(CODEX_HOME, "sessions");
const SESSION_FILE_RESOLVE_MAX_ATTEMPTS = 6;
const SESSION_FILE_RESOLVE_BASE_DELAY_MS = 200;
const DEFAULT_SKILL_ROOT = join(CODEX_HOME, "skills");
const DEFAULT_AGENT_SKILL_ROOT = join(homedir(), ".agents", "skills");
const DEFAULT_PLUGIN_CACHE_SKILL_ROOT = join(CODEX_HOME, "plugins", "cache");
const DEFAULT_SELECTION_PROMPT = "Explain this selection and stay focused on the selected text.";
const MAX_RECENT_STUDY_SOURCES = 8;
const EMPTY_REPLY_SESSION_SETTLE_ATTEMPTS = 4;
const EMPTY_REPLY_SESSION_SETTLE_DELAY_MS = 350;
const VAULT_NOTE_EMPTY_REPLY_SESSION_SETTLE_ATTEMPTS = 8;
const VAULT_NOTE_EMPTY_REPLY_SESSION_SETTLE_DELAY_MS = 500;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function getAbortReason(error: unknown): AbortReason | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const reason = (error as Error & { abortReason?: unknown }).abortReason;
  if (
    reason === "user_interrupt" ||
    reason === "approval_abort" ||
    reason === "tab_close" ||
    reason === "plugin_unload" ||
    reason === "runtime_abort"
  ) {
    return reason;
  }
  return null;
}

function extractAssistantResponseText(payload: JsonRecord): string | null {
  const content = Array.isArray(payload.content) ? payload.content : [];
  const parts = content
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => asString(entry.text))
    .filter((entry): entry is string => Boolean(entry?.trim()));

  if (parts.length > 0) {
    return parts.join("\n\n");
  }

  const directText = asString(payload.text);
  return directText?.trim() ? directText : null;
}

function createAbortError(reason: AbortReason = "runtime_abort"): Error {
  const error = new Error("Turn interrupted.");
  const typedError = error as Error & { abortReason?: AbortReason };
  typedError.name = "AbortError";
  typedError.abortReason = reason;
  return typedError;
}

function getVaultBasePath(app: App): string {
  const adapter = app.vault.adapter as { basePath?: string };
  return adapter.basePath ?? "";
}

function sanitizeTitle(input: string, fallback = "New chat"): string {
  const collapsed = input.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, 48) || fallback;
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return unwrapApiErrorMessage(value.message);
  }
  if (typeof value === "string") {
    return unwrapApiErrorMessage(value);
  }
  if (asRecord(value)) {
    const message = asString(asRecord(value)?.message);
    if (message) {
      return unwrapApiErrorMessage(message);
    }
  }
  return "Unknown Codex error.";
}

function annotateCodexRunError(
  error: Error,
  resolvedCommand: string,
  sawOutputEvent: boolean,
  threadId: string | null,
  options: {
    sawAssistantOutput?: boolean;
    sawMeaningfulProgress?: boolean;
    retryableInTurnShellBootstrapFailure?: boolean;
    watchdogStage?: Exclude<CodexRunWatchdogStage, "healthy"> | null;
  } = {},
): Error {
  const annotated = error as Error & {
    noTurnEvents?: boolean;
    noAssistantOutput?: boolean;
    noMeaningfulProgress?: boolean;
    resolvedCommand?: string;
    retryableInTurnShellBootstrapFailure?: boolean;
    watchdogStage?: Exclude<CodexRunWatchdogStage, "healthy"> | null;
    codexThreadId?: string | null;
  };
  annotated.noTurnEvents = !sawOutputEvent && !threadId;
  annotated.noAssistantOutput = !options.sawAssistantOutput;
  annotated.noMeaningfulProgress = !options.sawMeaningfulProgress;
  annotated.resolvedCommand = resolvedCommand;
  annotated.retryableInTurnShellBootstrapFailure = options.retryableInTurnShellBootstrapFailure ?? false;
  annotated.watchdogStage = options.watchdogStage ?? null;
  annotated.codexThreadId = threadId;
  return annotated;
}

function getCodexWatchdogStageFromError(error: unknown): Exclude<CodexRunWatchdogStage, "healthy"> | null {
  const stage = asString(asRecord(error)?.watchdogStage);
  if (
    stage === "boot_timeout" ||
    stage === "stall_warn" ||
    stage === "stall_recovery" ||
    stage === "stall_abort" ||
    stage === "max_duration"
  ) {
    return stage;
  }
  return null;
}

function getThreadIdFromCodexError(error: unknown): string | null {
  return asString(asRecord(error)?.codexThreadId);
}

function extractCodexSessionId(event: JsonRecord): string | null {
  if (asString(event.type) === "thread.started") {
    return asString(event.thread_id);
  }

  if (asString(event.type) === "session_meta") {
    return asString(asRecord(event.payload)?.id);
  }

  return null;
}

function extractAssistantOutputText(event: JsonRecord): string | null {
  const eventType = asString(event.type);
  const payload = asRecord(event.payload);
  const item = asRecord(event.item);

  if (eventType === "assistant_message") {
    return asString(event.text)?.trim() || null;
  }
  if (eventType === "event_msg" && asString(payload?.type) === "agent_message") {
    return asString(payload?.message)?.trim() || null;
  }
  if (
    eventType === "response_item" &&
    payload &&
    asString(payload?.type) === "message" &&
    asString(payload?.role) === "assistant"
  ) {
    return extractAssistantResponseText(payload)?.trim() || null;
  }
  if (asString(item?.type) === "agent_message") {
    return asString(item?.text)?.trim() || null;
  }
  return null;
}

function resolveSpawnCwd(cwd: string | undefined): string | undefined {
  if (!cwd) {
    return undefined;
  }
  if (process.platform === "win32" && isWindowsUncPath(cwd)) {
    return process.env.SystemRoot ?? "C:\\Windows";
  }
  return cwd;
}

function buildPatchProposalId(messageId: string, sourceIndex: number, index: number): string {
  return `patch-${messageId}-${sourceIndex}-${index}`;
}

function normalizeProposalText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export class CodexService {
  readonly store: AgentStore;
  private readonly activeRuns = new Map<string, ActiveRunState>();
  private readonly assistantArtifactSyncs = new Map<string, Promise<void>>();
  private readonly assistantArtifactMessageIds = new Map<string, Set<string>>();
  private readonly pendingTurns = new Map<string, PendingTurnState>();
  private readonly sessionFileCache = new Map<string, string>();
  private readonly pendingPromptSends = new Set<string>();
  private readonly saveListeners: Array<() => void> = [];
  private readonly studyPanels: StudyPanelCoordinator;
  private readonly threadEventReducer: ThreadEventReducer;
  private readonly approvalCoordinator: ApprovalCoordinator;
  private readonly usageSync: UsageSyncCoordinator;
  private lastResolvedSessionSearchRoots: string[] = [CODEX_SESSION_ROOT];
  private wslBridgeSessionRootsPromise: Promise<string[]> | null = null;
  private saveQueued = false;
  private jsonOutputFlag: JsonOutputFlag = "--json";
  private preferredNativeLauncher: (ResolvedTurnCodexLauncher & { cliVersion: string | null }) | null = null;
  private runtimeMetadata: RuntimeMetadataSnapshot = {
    resolvedCommand: null,
    cliVersion: null,
    modelCacheClientVersion: null,
    modelCatalogSource: "fallback",
  };
  private customPromptCatalog: CodexPromptDefinition[] = [];
  private allInstalledSkillCatalog: InstalledSkillDefinition[] = [];
  private installedSkillCatalog: InstalledSkillDefinition[] = [];
  private readonly processedApprovedEditKeys = new Set<string>();
  private readonly queuedSkillUpdateApprovalKeys = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly settingsProvider: () => PluginSettings,
    private readonly localeProvider: () => SupportedLocale,
    initialWorkspaceState: PersistedWorkspaceState | null,
    private readonly saveWorkspaceState: (state: PersistedWorkspaceState) => Promise<void>,
    private readonly updateSettings: (next: PluginSettings) => Promise<void>,
  ) {
    this.store = new AgentStore(initialWorkspaceState, this.resolveVaultRoot(), this.hasAuthEvidence(), this.resolveModeDefaults());
    this.studyPanels = new StudyPanelCoordinator({
      app: this.app,
      store: this.store,
      getLocale: () => this.getLocale(),
      getLocalizedCopy: () => this.getLocalizedCopy(),
      getActiveTab: () => this.getActiveTab(),
      findTab: (tabId) => this.findTab(tabId),
      getStudyRecipes: () => this.getStudyRecipes(),
      getActiveStudyWorkflow: () => this.getActiveStudyWorkflow(),
      getPreferredTargetFile: () => this.getPreferredTargetFile(),
      resolveTargetNotePath: (tabId) => this.resolveTargetNotePath(tabId),
      getTabSessionItems: (tabId) => this.getTabSessionItems(tabId),
      buildWorkflowPromptContext: (tabId, workflow, currentFilePath) =>
        this.buildWorkflowPromptContext(tabId, workflow, currentFilePath),
      refreshCodexCatalogs: () => this.refreshCodexCatalogs(),
      resolveVaultRoot: () => this.resolveVaultRoot(),
      getInstalledSkillCatalog: () => this.installedSkillCatalog,
    });
    this.threadEventReducer = new ThreadEventReducer({
      store: this.store,
      getLocale: () => this.getLocale(),
      getShowReasoning: () => this.settingsProvider().showReasoning,
      findTab: (tabId) => this.findTab(tabId),
      setWaitingPhase: (tabId, phase, mode) => this.setWaitingPhase(tabId, phase, mode),
      updateAccountUsageFromPatch: (limits, threadId, source, updatedAt) =>
        this.updateAccountUsageFromPatch(limits, threadId, source, updatedAt),
      queueAssistantArtifactSync: (tabId, messageId, text, visibility) =>
        this.queueAssistantArtifactSync(tabId, messageId, text, visibility),
    });
    this.approvalCoordinator = new ApprovalCoordinator({
      app: this.app,
      store: this.store,
      findTab: (tabId) => this.findTab(tabId),
      getLocalizedCopy: () => this.getLocalizedCopy(),
      getUserOwnedInstalledSkills: () => this.getUserOwnedInstalledSkills(),
      abortTabRun: (tabId, addMessage, reason) => this.abortTabRun(tabId, addMessage, reason),
      hasCodexLogin: () => this.hasAuthEvidence(),
      getMissingLoginMessage: () => this.getMissingLoginMessage(),
      isTabRunning: (tabId) => this.activeRuns.has(tabId),
      onApprovedEditApplied: async (event) => {
        await this.handleApprovedEditApplied(event).catch((error) => {
          console.error("Failed to process approved edit follow-up", error);
        });
      },
    });
    this.usageSync = new UsageSyncCoordinator({
      getTabs: () => this.store.getState().tabs,
      resolveSessionFile: (threadId) => this.resolveSessionFile(threadId),
      listRecentSessionFiles: () => this.listRecentSessionFilesForUsageSync(),
      applyUsageSnapshot: ({ threadId, summary, source, observedAt, checkedAt }) => {
        for (const tab of this.store.getState().tabs) {
          if (threadId && tab.codexThreadId === threadId) {
            this.store.setUsageSummary(tab.id, summary);
          }
        }
        this.updateAccountUsageFromSummary(summary, threadId, source, observedAt ?? checkedAt, checkedAt);
      },
    });
    this.saveListeners.push(
      this.store.subscribe(() => {
        void this.persistWorkspace();
      }),
    );
  }

  async dispose(): Promise<void> {
    for (const listener of this.saveListeners) {
      listener();
    }
    this.usageSync.stop();
    for (const [tabId] of this.activeRuns) {
      this.abortTabRun(tabId, false, "plugin_unload");
    }
    this.activeRuns.clear();
  }

  refreshSettings(): void {
    this.wslBridgeSessionRootsPromise = null;
    this.lastResolvedSessionSearchRoots = [CODEX_SESSION_ROOT];
    this.sessionFileCache.clear();
    void this.refreshCodexCatalogs();
    void this.refreshRuntimeHealth();
  }

  getLocale(): SupportedLocale {
    return this.localeProvider();
  }

  getLocalizedCopy() {
    return getLocalizedCopy(this.getLocale());
  }

  getRuntimeIssue(): string | null {
    return this.store.getState().runtimeIssue;
  }

  getRuntimeStatusSummaryParts(): string[] {
    return [
      this.runtimeMetadata.resolvedCommand ? `Command: ${this.runtimeMetadata.resolvedCommand}` : null,
      this.runtimeMetadata.cliVersion ? `CLI: ${this.runtimeMetadata.cliVersion}` : "CLI: unknown",
      this.runtimeMetadata.modelCacheClientVersion ? `Model cache: ${this.runtimeMetadata.modelCacheClientVersion}` : "Model cache: fallback",
      `Catalog: ${this.runtimeMetadata.modelCatalogSource}`,
    ].filter((entry): entry is string => Boolean(entry));
  }

  getAuthState(): "ready" | "missing_login" {
    return this.store.getState().authState;
  }

  getActiveTab() {
    return this.store.getActiveTab();
  }

  getActiveStudyWorkflow(): StudyWorkflowKind | null {
    return this.store.getActiveTab()?.studyWorkflow ?? null;
  }

  getTabStudyWorkflow(tabId: string): StudyWorkflowKind | null {
    return this.findTab(tabId)?.studyWorkflow ?? null;
  }

  getRecentStudySources(): RecentStudySource[] {
    return this.store.getState().recentStudySources.map((source) => ({ ...source }));
  }

  getStudyHubState() {
    return { ...this.store.getState().studyHubState };
  }

  getStudyRecipes(): StudyRecipe[] {
    return this.store.getState().studyRecipes.map((recipe) => structuredClone(recipe));
  }

  getCustomStudyRecipes(): StudyRecipe[] {
    return this.getStudyRecipes().filter((recipe) => recipe.workflow === "custom");
  }

  getHubPanels(): StudyRecipe[] {
    return this.getStudyRecipes();
  }

  getActiveStudyRecipeId(): string | null {
    return this.store.getState().activeStudyRecipeId;
  }

  activateStudyRecipe(recipeId: string | null): void {
    this.store.activateStudyRecipe(recipeId);
  }

  getActivePanelId(tabId: string | null = this.getActiveTab()?.id ?? null): string | null {
    if (!tabId) {
      return this.getActiveStudyRecipeId();
    }
    return this.findTab(tabId)?.activeStudyRecipeId ?? null;
  }

  getActivePanelSkillNames(tabId: string | null = this.getActiveTab()?.id ?? null): string[] {
    return tabId ? [...(this.findTab(tabId)?.activeStudySkillNames ?? [])] : [];
  }

  getActivePanelSkillName(tabId: string | null = this.getActiveTab()?.id ?? null): string | null {
    return this.getActivePanelSkillNames(tabId)[0] ?? null;
  }

  getStudyRecipePreflight(recipeId: string, tabId: string | null = this.getActiveTab()?.id ?? null): StudyRecipePreflight {
    return this.studyPanels.getStudyRecipePreflight(recipeId, tabId);
  }

  markStudyHubOpened(): void {
    const studyHubState = this.store.getState().studyHubState;
    this.store.setStudyHubState({
      lastOpenedAt: Date.now(),
      isCollapsed: studyHubState.isCollapsed,
    });
  }

  openStudyHub(): void {
    this.store.setStudyHubState({
      lastOpenedAt: Date.now(),
      isCollapsed: false,
    });
  }

  setStudyHubCollapsed(isCollapsed: boolean): void {
    const studyHubState = this.store.getState().studyHubState;
    this.store.setStudyHubState({
      lastOpenedAt: studyHubState.lastOpenedAt,
      isCollapsed,
    });
  }

  toggleStudyHubCollapsed(): boolean {
    const nextCollapsed = !this.store.getState().studyHubState.isCollapsed;
    this.setStudyHubCollapsed(nextCollapsed);
    return nextCollapsed;
  }

  private ensureDefaultStudyPanels(): void {
    this.studyPanels.ensureDefaultStudyPanels();
  }

  createHubPanel(
    initialDraft: Partial<Pick<StudyRecipe, "title" | "description" | "promptTemplate" | "linkedSkillNames">> = {},
  ): StudyRecipe {
    return this.studyPanels.createHubPanel(initialDraft);
  }

  updateHubPanel(
    panelId: string,
    patch: Partial<Pick<StudyRecipe, "title" | "description" | "promptTemplate" | "linkedSkillNames">>,
  ): StudyRecipe {
    return this.studyPanels.updateHubPanel(panelId, patch);
  }

  clearActivePanelContext(tabId: string): void {
    if (!this.findTab(tabId)) {
      return;
    }
    this.store.setActiveStudyPanel(tabId, null, []);
    this.store.setTabStudyWorkflow(tabId, null);
    this.store.setPanelSessionOrigin(tabId, null);
    this.store.setChatSuggestion(tabId, null);
  }

  seedHubPanelPrompt(
    tabId: string,
    panelId: string,
    file: TFile | null = this.getPreferredTargetFile(),
  ): string {
    return this.studyPanels.seedHubPanelPrompt(tabId, panelId, file);
  }

  seedHubPanelSkill(tabId: string, panelId: string, skillName: string, file: TFile | null = this.getPreferredTargetFile()): string {
    return this.studyPanels.seedHubPanelSkills(tabId, panelId, [skillName], file);
  }

  seedHubPanelSkills(tabId: string, panelId: string, skillNames: string[], file: TFile | null = this.getPreferredTargetFile()): string {
    return this.studyPanels.seedHubPanelSkills(tabId, panelId, skillNames, file);
  }

  startStudyWorkflow(
    tabId: string,
    workflow: StudyWorkflowKind,
    file: TFile | null = this.getPreferredTargetFile(),
  ): string {
    const tab = this.findTab(tabId);
    if (!tab) {
      return "";
    }
    const targetFile = file ?? this.getPreferredTargetFile();
    if (targetFile) {
      this.store.setTargetNotePath(tabId, targetFile.path);
    }
    const workflowContext = this.buildWorkflowPromptContext(tabId, workflow, targetFile?.path ?? null);
    const locale = this.getLocale();
    const draft = buildStudyWorkflowDraft(workflow, workflowContext, locale);

    this.store.setTabStudyWorkflow(tabId, workflow);
    this.store.setActiveStudyPanel(tabId, null, []);
    this.store.setPanelSessionOrigin(tabId, null);
    this.store.setChatSuggestion(tabId, null);
    this.markStudyHubOpened();
    this.store.setDraft(tabId, draft);
    this.store.setComposeMode(tabId, "chat");
    if (targetFile) {
      this.noteRecentStudySource({
        id: makeId("study-source"),
        label: targetFile.basename,
        path: targetFile.path,
        kind: "note",
        createdAt: Date.now(),
      });
    }
    return draft;
  }

  shouldAutoRestoreTabs(): boolean {
    return this.settingsProvider().autoRestoreTabs;
  }

  shouldAutoScrollStreaming(): boolean {
    return this.settingsProvider().autoScrollStreaming;
  }

  shouldOpenInMainEditor(): boolean {
    return this.settingsProvider().openInMainEditor;
  }

  getTabBarPosition(): "header" | "composer" {
    return this.settingsProvider().tabBarPosition;
  }

  getVimMappings(): string[] {
    return [...this.settingsProvider().vimMappings];
  }

  getModel(): string {
    return this.settingsProvider().codex.model;
  }

  async setModel(model: string): Promise<void> {
    const nextModel = coerceModelForPicker(this.getAvailableModels(), model.trim() || DEFAULT_MODEL);
    const current = this.settingsProvider();
    if (current.codex.model === nextModel && current.defaultModel === nextModel) {
      return;
    }

    await this.updateSettings({
      ...current,
      defaultModel: nextModel,
      codex: {
        ...current.codex,
        model: nextModel,
      },
    });
  }

  getAvailableModels(): ModelCatalogEntry[] {
    return this.store.getState().availableModels;
  }

  getPermissionMode(): PermissionMode {
    return this.settingsProvider().permissionMode;
  }

  getNoteApplyPolicy(composeMode: ComposeMode = "chat"): NoteApplyPolicy {
    if (composeMode === "plan") {
      return "manual";
    }
    return getPermissionModeProfile(this.settingsProvider().permissionMode).noteApplyPolicy;
  }

  getShowReasoning(): boolean {
    return this.settingsProvider().showReasoning;
  }

  async refreshRuntimeMetadata(): Promise<void> {
    await this.refreshModelCatalog();
    await this.refreshCodexCatalogs();
    await this.refreshRuntimeHealth();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    const current = this.settingsProvider();
    if (current.permissionMode === mode) {
      return;
    }

    await this.updateSettings({
      ...current,
      permissionMode: mode,
    });
  }

  private canImplementReadyPlan(tabId: string | null = this.getActiveTab()?.id ?? null): boolean {
    const tab = tabId ? this.findTab(tabId) : this.getActiveTab();
    if (!tab) {
      return false;
    }
    return resolveEffectiveExecutionState({
      composeMode: tab.composeMode,
      permissionMode: this.settingsProvider().permissionMode,
      status: tab.status,
      chatSuggestion: tab.chatSuggestion ?? null,
    }).canImplementReadyPlan;
  }

  private needsAutoApplyConsent(prompt: string, composeMode: ComposeMode): boolean {
    if (composeMode === "plan") {
      return false;
    }
    const settings = this.settingsProvider();
    return (
      settings.permissionMode === "full-auto" &&
      settings.autoApplyConsentVersionSeen !== AUTO_APPLY_CONSENT_VERSION &&
      allowsVaultWrite(prompt)
    );
  }

  private async ensureAutoApplyConsent(prompt: string, composeMode: ComposeMode): Promise<boolean> {
    if (!this.needsAutoApplyConsent(prompt, composeMode)) {
      return true;
    }

    const copy = this.getLocalizedCopy().prompts;
    const result = await promptAutoApplyConsent(this.app, {
      title: copy.autoApplyConsentTitle,
      body: copy.autoApplyConsentBody,
      keepAutomatic: copy.autoApplyConsentKeep,
      switchToApproval: copy.autoApplyConsentSwitch,
      cancel: copy.cancel,
    });
    if (result === "cancel") {
      return false;
    }

    const current = this.settingsProvider();
    await this.updateSettings({
      ...current,
      permissionMode: result === "switch" ? "auto-edit" : current.permissionMode,
      autoApplyConsentVersionSeen: AUTO_APPLY_CONSENT_VERSION,
    });
    return true;
  }

  getSlashCommandCatalog(): SlashCommandDefinition[] {
    const catalog = [...getSlashCommandCatalog(this.getLocale())];
    const seen = new Set(catalog.map((entry) => entry.command.toLowerCase()));
    for (const prompt of this.customPromptCatalog) {
      if (!seen.has(prompt.command.toLowerCase())) {
        catalog.push({
          command: prompt.command,
          label: prompt.label,
          description: prompt.description,
          source: "custom_prompt",
          mode: "prompt",
        });
        seen.add(prompt.command.toLowerCase());
      }
      for (const alias of prompt.aliases) {
        if (seen.has(alias.toLowerCase())) {
          continue;
        }
        catalog.push({
          command: alias,
          label: prompt.label,
          description: prompt.description,
          source: "custom_prompt",
          mode: "prompt",
        });
        seen.add(alias.toLowerCase());
      }
    }
    for (const skill of this.installedSkillCatalog) {
      const command = `/${skill.name}`;
      if (seen.has(command.toLowerCase())) {
        continue;
      }
      catalog.push({
        command,
        label: skill.name,
        description: skill.description,
        source: "skill_alias",
        mode: "skill_alias",
        skillName: skill.name,
      });
      seen.add(command.toLowerCase());
    }
    for (const recipe of this.getStudyRecipes()) {
      if (seen.has(recipe.commandAlias.toLowerCase())) {
        continue;
      }
      catalog.push({
        command: recipe.commandAlias,
        label: recipe.title,
        description: recipe.description,
        source: "study_recipe",
        mode: "study_recipe",
        recipeId: recipe.id,
        recipePrompt: buildStudyRecipeChatPrompt(recipe, this.getLocale()),
        studyWorkflow: recipe.workflow === "custom" ? undefined : recipe.workflow,
      });
      seen.add(recipe.commandAlias.toLowerCase());
    }
    return catalog;
  }

  getUserOwnedInstalledSkills(): InstalledSkillDefinition[] {
    return this.allInstalledSkillCatalog
      .filter((skill) => isUserOwnedSkillDefinition(skill))
      .map((entry) => ({ ...entry }));
  }

  getInstalledSkills(): InstalledSkillDefinition[] {
    return this.allInstalledSkillCatalog.map((entry) => ({ ...entry }));
  }

  getConfiguredMcpServers() {
    return this.settingsProvider().mcpServers
      .filter((server) => server.enabled && server.name.trim().length > 0)
      .map((server) => ({
        ...server,
        args: [...server.args],
        env: [...server.env],
      }));
  }

  async refreshInstalledSkills(): Promise<void> {
    await this.refreshInstalledSkillCatalog();
  }

  getTabComposerHistory(tabId: string) {
    const history = this.findTab(tabId)?.composerHistory;
    return history
      ? {
          entries: [...history.entries],
          index: history.index,
          draft: history.draft,
        }
      : null;
  }

  setTabComposerHistory(tabId: string, composerHistory: ComposerHistoryState): void {
    this.store.setComposerHistory(tabId, composerHistory);
  }

  getTabSummary(tabId: string): { id: string; text: string; createdAt: number } | null {
    const summary = this.findTab(tabId)?.summary ?? null;
    return summary ? { ...summary } : null;
  }

  forkTab(tabId: string): string | null {
    const tab = this.findTab(tabId);
    if (!tab || this.store.getState().tabs.length >= this.getMaxOpenTabs()) {
      return null;
    }
    const fork = this.store.createTab(tab.cwd, `${tab.title} (fork)`, {
      ...this.resolveTabDefaults(),
      draft: "",
      studyWorkflow: tab.studyWorkflow,
      activeStudyRecipeId: tab.activeStudyRecipeId,
      activeStudySkillNames: [...tab.activeStudySkillNames],
      targetNotePath: tab.targetNotePath,
      selectionContext: tab.selectionContext ? { ...tab.selectionContext } : null,
      panelSessionOrigin: tab.panelSessionOrigin ? structuredClone(tab.panelSessionOrigin) : null,
      chatSuggestion: null,
      composeMode: tab.composeMode,
      learningMode: tab.learningMode,
      contextPaths: [...tab.contextPaths],
      lastResponseId: null,
      sessionItems: [],
      codexThreadId: null,
      fastMode: tab.fastMode ?? false,
      messages: tab.messages.map((message) => ({ ...message })),
      diffText: tab.diffText,
      toolLog: tab.toolLog.map((entry) => ({ ...entry })),
      patchBasket: tab.patchBasket.map((proposal) => ({ ...proposal, id: makeId("patch-fork") })),
      summary: tab.summary ? { ...tab.summary } : null,
      lineage: {
        parentTabId: tab.id,
        forkedFromThreadId: tab.codexThreadId,
        resumedFromThreadId: null,
        compactedAt: tab.lineage.compactedAt,
      },
      usageSummary: createEmptyUsageSummary(),
    });
    return fork.id;
  }

  resumeTab(tabId: string): string | null {
    const tab = this.findTab(tabId);
    if (!tab?.codexThreadId || this.store.getState().tabs.length >= this.getMaxOpenTabs()) {
      return null;
    }
    const resumed = this.store.createTab(tab.cwd, `${tab.title} (resume)`, {
      ...this.resolveTabDefaults(),
      draft: "",
      studyWorkflow: tab.studyWorkflow,
      activeStudyRecipeId: tab.activeStudyRecipeId,
      activeStudySkillNames: [...tab.activeStudySkillNames],
      targetNotePath: tab.targetNotePath,
      selectionContext: tab.selectionContext ? { ...tab.selectionContext } : null,
      panelSessionOrigin: tab.panelSessionOrigin ? structuredClone(tab.panelSessionOrigin) : null,
      chatSuggestion: null,
      composeMode: tab.composeMode,
      learningMode: tab.learningMode,
      contextPaths: [...tab.contextPaths],
      lastResponseId: null,
      sessionItems: [],
      codexThreadId: tab.codexThreadId,
      fastMode: tab.fastMode ?? false,
      messages: tab.messages.map((message) => ({ ...message })),
      diffText: "",
      toolLog: [],
      patchBasket: [],
      summary: tab.summary ? { ...tab.summary } : null,
      lineage: {
        parentTabId: tab.id,
        forkedFromThreadId: null,
        resumedFromThreadId: tab.codexThreadId,
        compactedAt: tab.lineage.compactedAt,
      },
      usageSummary: createEmptyUsageSummary(),
    });
    return resumed.id;
  }

  compactTab(tabId: string, reason: "manual" | "auto" | "retry" = "manual"): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const lines = this.buildConversationSummaryLines(tab);
    this.store.setSummary(tabId, {
      id: makeId("summary"),
      text: lines.join("\n"),
      createdAt: Date.now(),
    });
    this.store.setLineage(tabId, {
      ...tab.lineage,
      compactedAt: Date.now(),
      pendingThreadReset: true,
      compactedFromThreadId: tab.codexThreadId ?? tab.lineage.compactedFromThreadId ?? null,
    });
    if (reason === "auto") {
      this.store.addMessage(tabId, {
        id: makeId("system"),
        kind: "system",
        text: this.buildCompactionSystemNote(reason),
        createdAt: Date.now(),
      });
    }
  }

  private buildConversationSummaryLines(tab: ConversationTabState): string[] {
    const locale = this.getLocale();
    const activePanelTitle =
      tab.activeStudyRecipeId
        ? this.getHubPanels().find((panel) => panel.id === tab.activeStudyRecipeId)?.title.trim() || null
        : null;
    const latestRecap = tab.studyCoachState?.latestRecap ?? null;
    const unresolvedWeakPoints = (tab.studyCoachState?.weakPointLedger ?? []).filter((entry) => !entry.resolved).slice(0, 3);
    const userPrompts = tab.messages
      .map((message) =>
        message.kind === "user"
          ? this.getVisibleUserPromptText(
              message.text,
              typeof message.meta?.internalPromptKind === "string" ? message.meta.internalPromptKind : null,
            )
          : "",
      )
      .filter((text) => text.trim())
      .slice(-6)
      .map((text) => `- ${text}`);
    const assistantReplies = tab.messages
      .map((message) => (message.kind === "assistant" ? this.getVisibleAssistantText(message.text) : ""))
      .filter((text) => text.trim())
      .slice(-6)
      .map((text) => `- ${text}`);
    const lines = [
      `Conversation: ${tab.title}`,
      locale === "ja" ? `Compose mode: ${tab.composeMode}` : `Compose mode: ${tab.composeMode}`,
      tab.studyWorkflow ? (locale === "ja" ? `Workflow: ${tab.studyWorkflow}` : `Workflow: ${tab.studyWorkflow}`) : null,
      activePanelTitle ? (locale === "ja" ? `Panel: ${activePanelTitle}` : `Panel: ${activePanelTitle}`) : null,
      tab.learningMode ? (locale === "ja" ? "Learning mode: on" : "Learning mode: on") : null,
      tab.activeStudySkillNames.length > 0
        ? locale === "ja"
          ? `Active skills: ${tab.activeStudySkillNames.map((name) => `/${name}`).join(", ")}`
          : `Active skills: ${tab.activeStudySkillNames.map((name) => `/${name}`).join(", ")}`
        : null,
      tab.targetNotePath ? (locale === "ja" ? `Reference note: ${tab.targetNotePath}` : `Reference note: ${tab.targetNotePath}`) : null,
      latestRecap ? (locale === "ja" ? "Current understanding state:" : "Current understanding state:") : null,
      latestRecap?.mastered.length ? `- Mastered: ${latestRecap.mastered.join(" / ")}` : null,
      latestRecap?.unclear.length ? `- Still unclear: ${latestRecap.unclear.join(" / ")}` : null,
      latestRecap?.nextStep ? `- Next study step: ${latestRecap.nextStep}` : null,
      latestRecap?.confidenceNote ? `- Confidence note: ${latestRecap.confidenceNote}` : null,
      unresolvedWeakPoints.length > 0 ? (locale === "ja" ? "Open weak points:" : "Open weak points:") : null,
      ...unresolvedWeakPoints.map((entry) => `- ${entry.conceptLabel}: ${entry.explanationSummary}`),
      userPrompts.length > 0 ? (locale === "ja" ? "Recent user requests:" : "Recent user requests:") : null,
      ...userPrompts,
      assistantReplies.length > 0 ? (locale === "ja" ? "Recent Codex replies:" : "Recent Codex replies:") : null,
      ...assistantReplies,
    ];
    return lines.filter((entry): entry is string => Boolean(entry));
  }

  private buildStudyCoachCarryForwardText(tab: ConversationTabState | null): string | null {
    if (!tab?.learningMode) {
      return null;
    }
    const locale = this.getLocale();
    const studyCoachState = tab.studyCoachState;
    const workflowKind = tab.studyWorkflow ?? studyCoachState?.latestRecap?.workflow ?? null;
    const lines: string[] = ["Study coach carry-forward:"];

    if (workflowKind) {
      const definition = getStudyWorkflowDefinition(workflowKind, locale);
      const coachContract = definition.coachContract ?? [];
      if (coachContract.length > 0) {
        lines.push("Workflow-specific coach guidance:");
        lines.push(...coachContract.map((entry) => `- ${entry}`));
      }
    }

    if (!studyCoachState) {
      return lines.length > 1 ? lines.join("\n") : null;
    }

    if (studyCoachState.latestRecap?.mastered.length) {
      lines.push(`- Latest recap: ${studyCoachState.latestRecap.mastered.join(" / ")}`);
    }
    if (studyCoachState.latestRecap?.confidenceNote) {
      lines.push(`- Confidence note: ${studyCoachState.latestRecap.confidenceNote}`);
    }
    const activeWeakPoint = studyCoachState.weakPointLedger.find((entry) => !entry.resolved) ?? null;
    if (activeWeakPoint) {
      lines.push(`- Weak point: ${activeWeakPoint.explanationSummary}`);
      lines.push(`- Next check: ${activeWeakPoint.nextQuestion}`);
    } else if (studyCoachState.latestRecap?.nextStep) {
      lines.push(`- Next check: ${studyCoachState.latestRecap.nextStep}`);
    }
    if (studyCoachState.latestRecap?.unclear.length) {
      lines.push(`- Current unclear points: ${studyCoachState.latestRecap.unclear.join(" / ")}`);
    }

    return lines.length > 1 ? lines.join("\n") : null;
  }

  private buildCompactionSystemNote(reason: "auto" | "retry"): string {
    if (this.getLocale() === "ja") {
      return reason === "retry"
        ? "返信が空だったため、この会話を compact して fresh thread で再試行しました。"
        : `会話が長くなったため、自動で compact して fresh thread に切り替えます。閾値: ${AUTO_COMPACT_MESSAGE_THRESHOLD} messages / ${AUTO_COMPACT_VISIBLE_CHAR_THRESHOLD} chars.`;
    }
    return reason === "retry"
      ? "The reply came back empty, so this conversation was compacted and retried on a fresh thread."
      : `This conversation was auto-compacted and will continue on a fresh thread. Thresholds: ${AUTO_COMPACT_MESSAGE_THRESHOLD} messages / ${AUTO_COMPACT_VISIBLE_CHAR_THRESHOLD} chars.`;
  }

  private armPendingTurn(tabId: string, turnId: string, userMessageId: string | null, submittedAt: number): void {
    this.pendingTurns.set(tabId, {
      turnId,
      userMessageId,
      submittedAt,
      hasVisibleOutcome: false,
      hasArtifactOutcome: false,
      autoApplyProposalCount: 0,
      autoApplyGuardNotified: false,
    });
  }

  private updateTurnMessageMeta(
    tabId: string,
    messageId: string | null,
    patch: Record<string, string | number | boolean | null | undefined>,
  ): void {
    if (!messageId || !this.findTab(tabId)?.messages.some((message) => message.id === messageId)) {
      return;
    }
    this.store.upsertMessage(tabId, messageId, (current) => {
      if (!current) {
        throw new Error(`Cannot update turn meta for missing message ${messageId}`);
      }
      const nextMeta = {
        ...(current.meta ?? {}),
        ...patch,
      };
      return {
        ...current,
        meta: nextMeta,
      };
    });
  }

  private completePendingTurn(tabId: string, outcome: TurnOutcomeKind): void {
    const pending = this.pendingTurns.get(tabId);
    if (!pending) {
      return;
    }
    this.updateTurnMessageMeta(tabId, pending.userMessageId, {
      turnId: pending.turnId,
      turnStatus: outcome,
      turnCompletedAt: Date.now(),
    });
    this.pendingTurns.delete(tabId);
  }

  private resolveSuccessfulTurnOutcomeKind(
    tabId: string,
    hasVisibleAssistantReply: boolean,
    hasArtifactOutcome: boolean,
  ): Exclude<TurnOutcomeKind, "error" | "orphaned_turn_error" | "ops_only"> | "ops_only" | null {
    if (hasVisibleAssistantReply) {
      return "assistant_text";
    }
    if (!hasArtifactOutcome) {
      return null;
    }
    const tab = this.findTab(tabId);
    if (!tab) {
      return "patch_only";
    }
    if (tab.pendingApprovals.length > 0) {
      return "approval_pending";
    }
    if (tab.patchBasket.length > 0) {
      return "patch_only";
    }
    return "ops_only";
  }

  private buildOrphanedTurnMessage(): string {
    return this.getLocale() === "ja"
      ? "直前の turn は visible な結果を残さないまま終了しました。plugin は outcome を回復できませんでした。"
      : "The previous turn ended without leaving a visible result. The plugin could not recover the outcome.";
  }

  private resolveLastSubmittedUserMessage(tabId: string): { id: string; status: string | null } | null {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }
    for (let index = tab.messages.length - 1; index >= 0; index -= 1) {
      const message = tab.messages[index];
      if (message?.kind !== "user") {
        continue;
      }
      return {
        id: message.id,
        status: typeof message.meta?.turnStatus === "string" ? message.meta.turnStatus : null,
      };
    }
    return null;
  }

  private finalizeOrphanedTurn(tabId: string, existingMessage: string | null = null): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const message = existingMessage ?? this.buildOrphanedTurnMessage();
    const lastSubmittedUser = this.resolveLastSubmittedUserMessage(tabId);
    if (lastSubmittedUser) {
      this.updateTurnMessageMeta(tabId, lastSubmittedUser.id, {
        turnStatus: "orphaned_turn_error",
        turnCompletedAt: Date.now(),
      });
    }
    this.store.setRuntimeIssue(message);
    this.store.setStatus(tabId, "error", message);
    if (!tab.messages.some((entry) => entry.kind === "system" && entry.text === message)) {
      this.store.addMessage(tabId, {
        id: makeId("error"),
        kind: "system",
        text: message,
        createdAt: Date.now(),
      });
    }
    this.pendingTurns.delete(tabId);
  }

  private shouldAutoCompactTab(tab: ConversationTabState): boolean {
    return shouldAutoCompactConversation({
      codexThreadId: tab.codexThreadId,
      pendingThreadReset: tab.lineage.pendingThreadReset ?? false,
      compactedAt: tab.lineage.compactedAt ?? null,
      messages: tab.messages,
    });
  }

  private countVisibleAssistantReplies(tabId: string): number {
    return (
      this.findTab(tabId)?.messages.filter(
        (message) => message.kind === "assistant" && !message.pending && message.text.trim().length > 0,
      ).length ?? 0
    );
  }

  private shouldStartFreshThread(tabId: string): boolean {
    return Boolean(this.findTab(tabId)?.lineage.pendingThreadReset);
  }

  private buildEmptyAssistantReplyMessage(result: TranscriptSyncResult): string {
    if (this.getLocale() === "ja") {
      const detail =
        result === "session_missing"
          ? "session 由来の visible reply を確認できませんでした。"
          : result === "session_read_error"
            ? "session 由来の visible reply を読み出せませんでした。"
            : result === "no_reply_found" || result === "no_visible_reply_found"
              ? "session に visible reply がありませんでした。"
              : result === "duplicate_reply"
                ? "session 側の reply は既に transcript に反映済みでした。"
              : "visible reply の復元に失敗しました。";
      return `Codex の turn は終了しましたが、visible な assistant reply が残りませんでした。${detail}`;
    }
    const detail =
      result === "session_missing"
        ? "The plugin could not confirm a recoverable reply from session data."
        : result === "session_read_error"
          ? "The plugin could not read a recoverable reply from session data."
          : result === "no_reply_found" || result === "no_visible_reply_found"
            ? "No visible assistant reply was found in the session."
            : result === "duplicate_reply"
              ? "The recoverable reply was already present in the transcript."
            : "Visible assistant reply recovery failed.";
    return `Codex finished the turn without leaving a visible assistant reply. ${detail}`;
  }

  private getSessionSearchRoots(): string[] {
    return [...this.lastResolvedSessionSearchRoots];
  }

  private async resolveSessionSearchRoots(): Promise<string[]> {
    const roots = [CODEX_SESSION_ROOT];
    if (process.platform === "win32" && this.settingsProvider().codex.runtime === "wsl") {
      roots.push(...(await this.resolveWslBridgeSessionRoots()));
    }
    this.lastResolvedSessionSearchRoots = [...new Set(roots.map((entry) => entry.trim()).filter(Boolean))];
    return this.lastResolvedSessionSearchRoots;
  }

  private async resolveWslBridgeSessionRoots(): Promise<string[]> {
    if (process.platform !== "win32") {
      return [];
    }
    if (!this.wslBridgeSessionRootsPromise) {
      this.wslBridgeSessionRootsPromise = (async () => {
        const distro = (await this.runWslPrintenv("WSL_DISTRO_NAME"))?.trim() ?? "";
        const home = (await this.runWslPrintenv("HOME"))?.trim() ?? "";
        if (!distro || !home.startsWith("/")) {
          return [];
        }
        const uncPath = `${home.replace(/\//g, "\\")}\\.codex\\sessions`;
        return [
          `\\\\wsl.localhost\\${distro}${uncPath}`,
          `\\\\wsl$\\${distro}${uncPath}`,
        ];
      })().catch(() => []);
    }
    return this.wslBridgeSessionRootsPromise;
  }

  private async runWslPrintenv(name: string): Promise<string | null> {
    return await new Promise<string | null>((resolve) => {
      const child = spawn("wsl.exe", ["-e", "printenv", name], {
        cwd: this.resolveVaultRoot(),
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.on("error", () => resolve(null));
      child.on("close", (code) => {
        resolve(code === 0 ? stdout.trim() || null : null);
      });
    });
  }

  private setWatchdogWaitingState(
    tabId: string,
    stage: "stall_warn" | "stall_recovery",
  ): void {
    const current = this.findTab(tabId)?.waitingState;
    const phase = current?.phase ?? "reasoning";
    const text =
      this.getLocale() === "ja"
        ? stage === "stall_warn"
          ? "まだ作業を続けています。しばらく待ってから必要なら同じ thread で回復を試みます。"
          : "応答が止まっているため、同じ thread で回復を試みます。"
        : stage === "stall_warn"
          ? "Still working. The plugin will keep waiting before attempting recovery."
          : "This turn went quiet, so the plugin is attempting recovery on the same thread.";
    this.store.setWaitingState(tabId, { phase, text });
  }

  private async collectTurnOutcome(params: {
    tabId: string;
    threadId: string | null;
    assistantCountBefore: number;
    assistantMessageIdsBefore: ReadonlySet<string>;
    turnContext: TurnContextSnapshot;
    assistantOutputVisibility: AssistantOutputVisibility;
  }): Promise<{
    transcriptSyncResult: TranscriptSyncResult;
    assistantCountAfter: number;
    hasArtifactOutcome: boolean;
    newAssistantMessageIds: Set<string>;
  }> {
    let transcriptSyncResult: TranscriptSyncResult = "no_reply_found";
    if (params.threadId) {
      this.store.setCodexThreadId(params.tabId, params.threadId);
      this.usageSync.noteThread(params.threadId);
      await this.syncUsageFromSession(params.threadId, "session_backfill");
      transcriptSyncResult = await this.reconcileTranscriptAfterTurn(
        params.tabId,
        params.threadId,
        params.assistantCountBefore,
        params.turnContext,
        params.assistantOutputVisibility,
      );
    }
    const newAssistantMessageIds = await this.ensureAssistantArtifactsReady(params.tabId, params.assistantMessageIdsBefore);
    return {
      transcriptSyncResult,
      assistantCountAfter: this.countVisibleAssistantReplies(params.tabId),
      hasArtifactOutcome: this.hasSuccessfulArtifactOutcome(params.tabId, newAssistantMessageIds),
      newAssistantMessageIds,
    };
  }

  private getNewAssistantMessages(tabId: string, assistantMessageIds: ReadonlySet<string>): ChatMessage[] {
    const tab = this.findTab(tabId);
    if (!tab || assistantMessageIds.size === 0) {
      return [];
    }
    return tab.messages.filter((message) => message.kind === "assistant" && assistantMessageIds.has(message.id));
  }

  private getResolvedNoteReflectionTargetPath(turnContext: TurnContextSnapshot): string | null {
    return resolveEditTarget({
      selectionSourcePath: turnContext.selectionSourcePath ?? null,
      activeFilePath: turnContext.activeFilePath ?? null,
      sessionTargetPath: turnContext.targetNotePath ?? null,
    }).path;
  }

  private getCurrentTurnUserPromptMessage(tabId: string): ChatMessage | null {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }
    const pending = this.pendingTurns.get(tabId);
    if (pending) {
      const direct = tab.messages.find((message) => message.id === pending.userMessageId && message.kind === "user") ?? null;
      if (direct) {
        return direct;
      }
    }
    return [...tab.messages]
      .reverse()
      .find((message) => message.kind === "user" && message.meta?.selectionContext !== true) ?? null;
  }

  private shouldSkipInferredNoteReflection(tabId: string): boolean {
    const promptText = this.getCurrentTurnUserPromptMessage(tabId)?.text.trim() ?? "";
    if (!promptText) {
      return false;
    }
    return NOTE_REFLECTION_OPT_OUT_PATTERNS.some((pattern) => pattern.test(promptText));
  }

  private getVisibleAssistantText(text: string): string {
    return extractAssistantProposals(text).sanitizedDisplayText.trim();
  }

  private normalizeVisibleAssistantReplyForCompare(text: string): string {
    return this.getVisibleAssistantText(text)
      .replace(/\s+/gu, " ")
      .trim();
  }

  private getAssistantRepliesSinceLastPrompt(tabId: string): ChatMessage[] {
    const tab = this.findTab(tabId);
    if (!tab) {
      return [];
    }

    const lastPromptIndex = [...tab.messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.kind === "user" && message.meta?.selectionContext !== true)?.index;

    const messages = typeof lastPromptIndex === "number" ? tab.messages.slice(lastPromptIndex + 1) : tab.messages;
    return messages.filter((message) => message.kind === "assistant" && !message.pending && message.text.trim().length > 0);
  }

  private hasDuplicateVisibleAssistantReply(tabId: string, candidateText: string): boolean {
    const normalizedCandidate = this.normalizeVisibleAssistantReplyForCompare(candidateText);
    if (!normalizedCandidate) {
      return false;
    }

    return this.getAssistantRepliesSinceLastPrompt(tabId).some(
      (message) => this.normalizeVisibleAssistantReplyForCompare(message.text) === normalizedCandidate,
    );
  }

  private getVisibleUserPromptText(text: string, internalPromptKind: string | null | undefined = null): string {
    return normalizeVisibleUserPromptText(text, this.getLocalizedCopy().workspace.reflectInNote, internalPromptKind).trim();
  }

  private inferRewriteFollowupQuestion(text: string): string | null {
    const paragraphs = this.getVisibleAssistantText(text)
      .split(/\n{2,}/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const paragraph of paragraphs.reverse()) {
      if (REWRITE_APPLY_QUESTION_PATTERNS.some((pattern) => pattern.test(paragraph))) {
        return paragraph;
      }
    }
    return null;
  }

  private inferRewriteFollowupSummary(text: string): string | null {
    const cleaned = this.getVisibleAssistantText(text)
      .split(/\n{2,}/u)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => !NOTE_REFLECTION_SUMMARY_DROP_PATTERNS.some((pattern) => pattern.test(entry)))
      .join("\n\n")
      .trim();
    if (!cleaned) {
      return null;
    }
    return cleaned.slice(0, 280);
  }

  private isStrongNoteReflectionSignal(text: string): boolean {
    return STRONG_NOTE_REFLECTION_PATTERNS.some((pattern) => pattern.test(text));
  }

  private looksLikeNoteReadyRewrite(text: string, turnContext: TurnContextSnapshot): boolean {
    if (this.isStrongNoteReflectionSignal(text)) {
      return true;
    }
    if (CTA_ONLY_NOTE_REFLECTION_PATTERNS.some((pattern) => pattern.test(text))) {
      return true;
    }
    return (
      turnContext.sourceAcquisitionMode === "vault_note" &&
      /(?:note|ノート|step|ステップ|section|セクション|説明|内容)/iu.test(text)
    );
  }

  private classifyNoteReflectionRescueCandidate(
    tabId: string,
    assistantMessageIds: ReadonlySet<string>,
    turnContext: TurnContextSnapshot,
  ): NoteReflectionRescueCandidate | null {
    const targetPath = this.getResolvedNoteReflectionTargetPath(turnContext);
    if (!targetPath || this.shouldSkipInferredNoteReflection(tabId)) {
      return null;
    }
    const messages = this.getNewAssistantMessages(tabId, assistantMessageIds);
    for (const message of [...messages].reverse()) {
      const parsed = extractAssistantProposals(message.text);
      if (parsed.patches.length > 0 || parsed.ops.length > 0 || parsed.plan || parsed.suggestion) {
        continue;
      }
      const visibleText = parsed.sanitizedDisplayText.trim();
      if (!visibleText || !this.looksLikeNoteReadyRewrite(visibleText, turnContext)) {
        continue;
      }
      return {
        message,
        parsed,
        strength: this.isStrongNoteReflectionSignal(visibleText) ? "strong_repair" : "cta_only",
        targetPath,
        rewriteSummary: this.inferRewriteFollowupSummary(visibleText),
        rewriteQuestion: this.inferRewriteFollowupQuestion(visibleText) ?? this.getLocalizedCopy().workspace.reflectInNoteQuestion,
      };
    }
    return null;
  }

  private captureTurnArtifacts(tabId: string): TurnArtifactSnapshot {
    const tab = this.findTab(tabId);
    return {
      patchIds: new Set(tab?.patchBasket.map((proposal) => proposal.id) ?? []),
      approvalIds: new Set(tab?.pendingApprovals.map((approval) => approval.id) ?? []),
    };
  }

  private collectNewTurnArtifacts(
    tabId: string,
    snapshot: TurnArtifactSnapshot,
  ): { patchBasket: PatchProposal[]; approvals: PendingApproval[] } {
    const tab = this.findTab(tabId);
    if (!tab) {
      return { patchBasket: [], approvals: [] };
    }
    return {
      patchBasket: tab.patchBasket.filter((proposal) => !snapshot.patchIds.has(proposal.id)),
      approvals: tab.pendingApprovals.filter((approval) => !snapshot.approvalIds.has(approval.id)),
    };
  }

  private setRewriteFollowupSuggestion(
    tabId: string,
    messageId: string,
    rewriteSummary: string | null,
    rewriteQuestion: string | null,
  ): void {
    const tab = this.findTab(tabId);
    if (!tab || tab.composeMode === "plan") {
      return;
    }
    this.store.setChatSuggestion(tabId, {
      id: makeId("chat-suggestion"),
      kind: "rewrite_followup",
      status: "pending",
      messageId,
      panelId: null,
      panelTitle: null,
      promptSnapshot: "",
      matchedSkillName: null,
      canUpdatePanel: false,
      canSaveCopy: false,
      planSummary: null,
      planStatus: null,
      rewriteSummary,
      rewriteQuestion,
      createdAt: Date.now(),
    });
  }

  private getProposalRepairCandidate(
    tabId: string,
    assistantMessageIds: ReadonlySet<string>,
  ): { message: ChatMessage; parsed: ParsedAssistantProposalResult; reason: ProposalRepairReason } | null {
    const messages = this.getNewAssistantMessages(tabId, assistantMessageIds);
    for (const message of [...messages].reverse()) {
      const parsed = extractAssistantProposals(message.text);
      if (parsed.patches.length > 0 || parsed.ops.length > 0 || parsed.plan) {
        continue;
      }
      if (parsed.suggestion) {
        continue;
      }
      if (parsed.hasMalformedProposal) {
        return { message, parsed, reason: "malformed" };
      }
      const trimmed = message.text.trim();
      if (!trimmed) {
        return { message, parsed, reason: "empty" };
      }
      if (parsed.hasProposalMarkers) {
        return { message, parsed, reason: "malformed" };
      }
      if (hasPatchPromiseKeywords(parsed.sanitizedDisplayText || trimmed)) {
        return { message, parsed, reason: "promise_without_block" };
      }
      return { message, parsed, reason: "empty" };
    }
    return null;
  }

  private buildProposalRepairPrompt(
    turnContext: TurnContextSnapshot,
    message: ChatMessage,
    parsed: ParsedAssistantProposalResult,
    reason: ProposalRepairReason,
  ): string {
    const targetPath = turnContext.targetNotePath ?? turnContext.activeFilePath ?? "the current target note";
    const visibleSummary = parsed.sanitizedDisplayText.trim();
    const rawExcerpt = message.text.trim().slice(0, 6000);
    const reasonText =
      reason === "promise_without_block"
        ? [
            "The previous reply in this same thread announced a note patch but did not emit any parseable Obsidian proposal block.",
            "Emit the patch NOW. Do not explain, do not apologize, do not ask a question, and do not promise a future patch.",
            "Output exactly one fenced `obsidian-patch` block and nothing else.",
          ].join("\n\n")
        : reason === "empty"
          ? [
              "The previous reply in this same thread did not produce a visible or parseable Obsidian proposal.",
              "Retry immediately by emitting exactly one valid fenced `obsidian-patch` block and nothing else.",
            ].join("\n\n")
          : [
              "The previous reply in this same thread did not produce a valid Obsidian proposal. The plugin could not parse the patch block — most likely because a JSON string literal contained unescaped newlines, backslashes, or `$`/`\"` characters.",
              "DO NOT retry with JSON. Re-emit using the DELIMITER-BASED `obsidian-patch` format, which requires ZERO escaping. Inside the block, write field bodies VERBATIM: real newlines, real `$$math$$`, real quotes — the plugin reads raw text between `---anchorBefore` / `---anchorAfter` / `---replacement` / `---end` markers.",
            ].join("\n\n");
    return [
      reasonText,
      "Output exactly one fenced ```obsidian-patch``` block. No prose, no markdown headings, no other code fences.",
      `Target note path: ${targetPath}`,
      "Required delimiter format — copy the shape exactly:",
      buildDelimiterPatchExample(targetPath),
      "For multiple regions, repeat `---anchorBefore` ... `---end` for each region inside the same fenced block.",
      "Formatting rules for the patch body:",
      ...buildPatchMathFormattingRules().map((line) => `- ${line}`),
      ...buildQuotedPatchMathFormattingRules().map((line) => `- ${line}`),
      visibleSummary ? `Visible summary from the prior reply:\n${visibleSummary}` : null,
      rawExcerpt ? `Previous invalid reply (for context only — do not copy its JSON):\n\`\`\`text\n${rawExcerpt}\n\`\`\`` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private buildPatchReadabilityRepairPrompt(
    turnContext: TurnContextSnapshot,
    message: ChatMessage,
    proposal: PatchProposal,
  ): string {
    const targetPath = proposal.targetPath || turnContext.targetNotePath || turnContext.activeFilePath || "the current target note";
    const visibleSummary = this.getVisibleAssistantText(message.text).trim();
    const rawExcerpt = message.text.trim().slice(0, 6000);
    const currentText = proposal.proposedText.trim().slice(0, 6000);
    const qualityIssues = proposal.qualityIssues ?? [];
    const issueSummary =
      qualityIssues.length > 0
        ? qualityIssues.map((issue) => issue.code).join(", ")
        : "structural markdown readability issues";
    return [
      "The previous reply produced a parseable Obsidian patch, but the markdown structure is still unsafe to auto-apply.",
      `Detected issues: ${issueSummary}.`,
      "Re-emit exactly one fenced `obsidian-patch` block and nothing else.",
      `Target note path: ${targetPath}`,
      "Required delimiter format — copy the shape exactly:",
      buildDelimiterPatchExample(targetPath),
      "Use canonical markdown structure for math-heavy notes:",
      ...buildPatchMathFormattingRules().map((line) => `- ${line}`),
      ...buildQuotedPatchMathFormattingRules().map((line) => `- ${line}`),
      visibleSummary ? `Visible summary from the prior reply:\n${visibleSummary}` : null,
      currentText ? `Current low-quality patch body (repair its structure, do not repeat these mistakes):\n\`\`\`markdown\n${currentText}\n\`\`\`` : null,
      rawExcerpt ? `Previous assistant reply for context:\n\`\`\`text\n${rawExcerpt}\n\`\`\`` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private buildInvalidPatchRepairFailedMessage(): string {
    return this.getLocalizedCopy().service.invalidPatchRepairFailed;
  }

  private async attemptHiddenNoteReflectionRepair(params: {
    tabId: string;
    candidate: NoteReflectionRescueCandidate;
    mode: RuntimeMode;
    composeMode: ComposeMode;
    skillNames: string[];
    turnContext: TurnContextSnapshot;
    images: string[];
    workingDirectory: string;
    runtime: CodexRuntime;
    executablePath: string;
    launcherOverrideParts: string[] | undefined;
    draftBackup: string;
    watchdogRecoveryAttempted: boolean;
    turnId: string | null;
    userMessageId: string | null;
  }): Promise<boolean> {
    const beforeArtifacts = this.captureTurnArtifacts(params.tabId);
    const beforeSuggestion = this.findTab(params.tabId)?.chatSuggestion ?? null;
    await this.runTurn(
      params.tabId,
      this.buildRewriteFollowupPromptFromMessage(
        params.tabId,
        params.candidate.message.id,
        params.candidate.rewriteSummary,
      ),
      params.mode,
      params.composeMode,
      params.skillNames,
      params.turnContext,
      params.images,
      params.workingDirectory,
      params.runtime,
      params.executablePath,
      params.launcherOverrideParts,
      true,
      params.draftBackup,
      false,
      params.watchdogRecoveryAttempted,
      params.turnId,
      params.userMessageId,
      true,
      "silent",
    );
    const createdArtifacts = this.collectNewTurnArtifacts(params.tabId, beforeArtifacts);
    if (createdArtifacts.patchBasket.length === 0 && createdArtifacts.approvals.length === 0) {
      const liveSuggestion = this.findTab(params.tabId)?.chatSuggestion ?? null;
      if (liveSuggestion && liveSuggestion.messageId !== params.candidate.message.id) {
        this.store.setChatSuggestion(params.tabId, beforeSuggestion);
      }
      return false;
    }
    this.recordAssistantEditOutcome(
      params.tabId,
      params.candidate.message.id,
      this.resolveAssistantEditOutcome(
        params.tabId,
        params.candidate.message.text,
        params.candidate.parsed,
        createdArtifacts.patchBasket,
        createdArtifacts.approvals,
      ),
    );
    return true;
  }

  private getLowQualityPatchRepairCandidate(
    tabId: string,
    newAssistantMessageIds: ReadonlySet<string>,
  ): { message: ChatMessage; proposals: PatchProposal[] } | null {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }
    for (const messageId of newAssistantMessageIds) {
      const proposals = tab.patchBasket.filter(
        (proposal) => proposal.sourceMessageId === messageId && proposal.status === "pending" && proposal.qualityState === "review_required",
      );
      if (proposals.length === 0) {
        continue;
      }
      const message = tab.messages.find((entry) => entry.id === messageId && entry.kind === "assistant") ?? null;
      if (!message) {
        continue;
      }
      return { message, proposals };
    }
    return null;
  }

  private async attemptHiddenLowQualityPatchRepair(params: {
    tabId: string;
    candidate: { message: ChatMessage; proposals: PatchProposal[] };
    mode: RuntimeMode;
    composeMode: ComposeMode;
    skillNames: string[];
    turnContext: TurnContextSnapshot;
    images: string[];
    workingDirectory: string;
    runtime: CodexRuntime;
    executablePath: string;
    launcherOverrideParts: string[] | undefined;
    draftBackup: string;
    watchdogRecoveryAttempted: boolean;
    turnId: string | null;
    userMessageId: string | null;
  }): Promise<boolean> {
    if (params.candidate.proposals.length !== 1) {
      return false;
    }
    const beforeArtifacts = this.captureTurnArtifacts(params.tabId);
    await this.runTurn(
      params.tabId,
      this.buildPatchReadabilityRepairPrompt(params.turnContext, params.candidate.message, params.candidate.proposals[0]!),
      params.mode,
      params.composeMode,
      params.skillNames,
      params.turnContext,
      params.images,
      params.workingDirectory,
      params.runtime,
      params.executablePath,
      params.launcherOverrideParts,
      true,
      params.draftBackup,
      false,
      params.watchdogRecoveryAttempted,
      params.turnId,
      params.userMessageId,
      true,
      "silent",
    );
    const createdArtifacts = this.collectNewTurnArtifacts(params.tabId, beforeArtifacts);
    if (createdArtifacts.patchBasket.length === 0) {
      return false;
    }
    this.store.replacePatchProposals(params.tabId, params.candidate.message.id, []);
    this.recordAssistantEditOutcome(
      params.tabId,
      params.candidate.message.id,
      this.resolveAssistantEditOutcome(
        params.tabId,
        params.candidate.message.text,
        extractAssistantProposals(params.candidate.message.text),
        createdArtifacts.patchBasket,
        createdArtifacts.approvals,
      ),
    );
    return true;
  }

  private rescueMissingNoteReflection(tabId: string, candidate: NoteReflectionRescueCandidate): void {
    this.setRewriteFollowupSuggestion(tabId, candidate.message.id, candidate.rewriteSummary, candidate.rewriteQuestion);
    this.recordAssistantEditOutcome(tabId, candidate.message.id, {
      outcome: "explanation_only",
      targetPath: null,
    });
  }

  private async finalizeSuccessfulTurn(tabId: string): Promise<void> {
    await this.clearComposerArtifacts(tabId);
    this.store.setLineage(tabId, {
      ...(this.findTab(tabId)?.lineage ?? {
        parentTabId: null,
        forkedFromThreadId: null,
        resumedFromThreadId: null,
        compactedAt: null,
        pendingThreadReset: false,
        compactedFromThreadId: null,
      }),
      pendingThreadReset: false,
    });
    this.studyPanels.armPanelCompletionSignal(tabId);
    this.approvalCoordinator.reconcileApprovalStatus(tabId);
  }

  private getTranscriptSyncSettlePolicy(turnContext: TurnContextSnapshot): {
    attempts: number;
    delayMs: number;
  } {
    if (turnContext.sourceAcquisitionMode === "vault_note") {
      return {
        attempts: VAULT_NOTE_EMPTY_REPLY_SESSION_SETTLE_ATTEMPTS,
        delayMs: VAULT_NOTE_EMPTY_REPLY_SESSION_SETTLE_DELAY_MS,
      };
    }
    return {
      attempts: EMPTY_REPLY_SESSION_SETTLE_ATTEMPTS,
      delayMs: EMPTY_REPLY_SESSION_SETTLE_DELAY_MS,
    };
  }

  private async waitForTranscriptSyncRetryDelay(delayMs = EMPTY_REPLY_SESSION_SETTLE_DELAY_MS): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private async reconcileTranscriptAfterTurn(
    tabId: string,
    threadId: string,
    assistantCountBefore: number,
    turnContext: TurnContextSnapshot,
    assistantOutputVisibility: AssistantOutputVisibility,
  ): Promise<TranscriptSyncResult> {
    let result = await this.syncTranscriptFromSession(tabId, threadId, assistantOutputVisibility);
    if (this.countVisibleAssistantReplies(tabId) > assistantCountBefore || result === "appended_reply") {
      return result;
    }
    if (result !== "session_missing" && result !== "no_reply_found" && result !== "no_visible_reply_found") {
      return result;
    }

    const settlePolicy = this.getTranscriptSyncSettlePolicy(turnContext);
    for (let attempt = 0; attempt < settlePolicy.attempts; attempt += 1) {
      await this.waitForTranscriptSyncRetryDelay(settlePolicy.delayMs);
      result = await this.syncTranscriptFromSession(tabId, threadId, assistantOutputVisibility);
      if (this.countVisibleAssistantReplies(tabId) > assistantCountBefore || result === "appended_reply") {
        return result;
      }
      if (result !== "session_missing" && result !== "no_reply_found" && result !== "no_visible_reply_found") {
        return result;
      }
    }

    return result;
  }

  getMentionCandidates(): Array<{ kind: MentionEntityKind; token: string; label: string; description: string }> {
    const locale = this.getLocale();
    const noteCandidates = this.app.vault.getMarkdownFiles().slice(0, 300).map((file) => ({
      kind: "note" as const,
      token: `@note(${file.path})`,
      label: basename(file.path),
      description: file.path,
    }));
    const skillCandidates = this.installedSkillCatalog.map((skill) => ({
      kind: "skill" as const,
      token: `@skill(${skill.name})`,
      label: skill.name,
      description: skill.description,
    }));
    const recipeCandidates = this.getStudyRecipes().map((recipe) => ({
      kind: "recipe" as const,
      token: `@recipe(${recipe.title})`,
      label: recipe.title,
      description: `${getStudyRecipeWorkflowLabel(recipe.workflow, locale)} · ${recipe.commandAlias}`,
    }));
    const externalCandidates = [...new Set([this.resolveVaultRoot(), ...this.store.getState().tabs.map((entry) => entry.cwd)])]
      .filter((path) => path.trim().length > 0)
      .map((path) => ({
        kind: "external_dir" as const,
        token: `@dir(${path})`,
        label: basename(path) || path,
        description: path,
      }));
    const mcpCandidates = this.getConfiguredMcpServers().map((server) => ({
      kind: "mcp" as const,
      token: `@mcp(${server.name})`,
      label: server.name,
      description: locale === "ja" ? "MCP サーバー" : "MCP server",
    }));
    return [...noteCandidates, ...skillCandidates, ...recipeCandidates, ...externalCandidates, ...mcpCandidates];
  }

  suggestStudyRecipeTitle(tabId: string): string {
    return this.studyPanels.suggestStudyRecipeTitle(tabId);
  }

  previewStudyRecipeSave(tabId: string, requestedTitle: string, existingRecipeId: string | null = null): StudyRecipeSavePreview {
    return this.studyPanels.previewStudyRecipeSave(tabId, requestedTitle, existingRecipeId);
  }

  saveStudyRecipe(preview: StudyRecipeSavePreview): StudyRecipe {
    return this.studyPanels.saveStudyRecipe(preview);
  }

  upsertStudyRecipe(recipe: StudyRecipe): void {
    this.store.upsertStudyRecipe(structuredClone(recipe));
  }

  removeStudyRecipe(recipeId: string): void {
    this.studyPanels.removeStudyRecipe(recipeId);
  }

  seedStudyRecipeInComposer(tabId: string, recipeId: string): string {
    return this.studyPanels.seedStudyRecipeInComposer(tabId, recipeId);
  }

  prepareStudyRecipeSkillDraft(recipeId: string): StudyRecipeSkillDraft {
    return this.studyPanels.prepareStudyRecipeSkillDraft(recipeId);
  }

  async saveStudyRecipeSkillDraft(recipeId: string, nextContent: string): Promise<StudyRecipeSkillDraft> {
    return this.studyPanels.saveStudyRecipeSkillDraft(recipeId, nextContent);
  }

  async setTabModel(tabId: string, model: string): Promise<void> {
    const nextModel = model.trim();
    const tab = this.findTab(tabId);
    if (!nextModel || !tab) {
      return;
    }

    const resolvedModel = coerceModelForPicker(this.getAvailableModels(), nextModel);
    const nextEffort = resolveReasoningEffortForModel(this.getAvailableModels(), resolvedModel, tab.reasoningEffort);
    this.store.setTabModel(tabId, resolvedModel);
    this.store.setTabReasoningEffort(tabId, nextEffort);
    if (
      resolvedModel === DEFAULT_MODEL &&
      !isModelRuntimeCompatible(resolvedModel, {
        cliVersion: this.runtimeMetadata.cliVersion,
        modelCacheClientVersion: this.runtimeMetadata.modelCacheClientVersion,
      })
    ) {
      this.store.setRuntimeIssue(this.buildCodexModelCompatibilityMessage(resolvedModel, coerceModelForRuntime(this.getAvailableModels(), resolvedModel, {
        allowPrimaryModel: false,
      })));
      return;
    }
    await this.persistDefaults(resolvedModel, nextEffort);
  }

  async setTabReasoningEffort(tabId: string, effort: string): Promise<void> {
    const normalized = normalizeReasoningEffort(effort);
    const tab = this.findTab(tabId);
    if (!normalized || !tab) {
      return;
    }

    const nextEffort = resolveReasoningEffortForModel(this.getAvailableModels(), tab.model, normalized);
    this.store.setTabReasoningEffort(tabId, nextEffort);
    await this.persistDefaults(tab.model, nextEffort);
  }

  setTabFastMode(tabId: string, enabled: boolean): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    this.store.setSessionModeDefaults({ fastMode: enabled });
    this.store.setAllTabsFastMode(enabled);
    this.persistModeDefaults({ defaultFastMode: enabled });
  }

  setTabLearningMode(tabId: string, enabled: boolean): boolean {
    const tab = this.findTab(tabId);
    if (!tab) {
      return false;
    }
    this.store.setSessionModeDefaults({ learningMode: enabled });
    this.store.setAllTabsLearningMode(enabled);
    this.persistModeDefaults({ defaultLearningMode: enabled });
    return enabled;
  }

  toggleTabLearningMode(tabId: string): boolean {
    const tab = this.findTab(tabId);
    if (!tab) {
      return false;
    }
    const next = !tab.learningMode;
    return this.setTabLearningMode(tabId, next);
  }

  setTabComposeMode(tabId: string, composeMode: ComposeMode): ComposeMode | null {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }
    this.store.setComposeMode(tabId, composeMode);
    if (composeMode !== "plan" && tab.chatSuggestion?.kind === "plan_execute" && tab.chatSuggestion.status === "pending") {
      this.store.setChatSuggestion(tabId, null);
    }
    return composeMode;
  }

  toggleTabComposeMode(tabId: string): ComposeMode | null {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }
    const nextMode: ComposeMode = tab.composeMode === "plan" ? "chat" : "plan";
    this.store.setComposeMode(tabId, nextMode);
    if (nextMode !== "plan" && tab.chatSuggestion?.kind === "plan_execute" && tab.chatSuggestion.status === "pending") {
      this.store.setChatSuggestion(tabId, null);
    }
    return nextMode;
  }

  createTab() {
    if (this.store.getState().tabs.length >= this.getMaxOpenTabs()) {
      return null;
    }
    const activeFile = this.getPreferredTargetFile();
    return this.store.createTab(this.resolveVaultRoot(), this.getLocalizedCopy().service.newChatTitle, {
      ...this.resolveTabDefaults(),
      targetNotePath: activeFile?.path ?? null,
      usageSummary: createEmptyUsageSummary(),
    });
  }

  getMaxOpenTabs(): number {
    return this.settingsProvider().maxChatTabs;
  }

  closeTab(tabId: string): void {
    const tab = this.findTab(tabId);
    if (!tab || tab.status === "busy" || tab.status === "waiting_approval") {
      return;
    }
    const attachments = this.getTabSessionItems(tabId);
    this.abortTabRun(tabId, false, "tab_close");
    this.usageSync.untrackTab(tabId, tab.codexThreadId);
    this.clearAssistantArtifactTracking(tabId);
    this.store.clearApprovals(tabId);
    this.store.closeTab(tabId, this.resolveVaultRoot(), this.resolveModeDefaults());
    void this.cleanupSessionItems(attachments);
  }

  startNewSession(tabId: string): boolean {
    const tab = this.findTab(tabId);
    if (!tab || tab.status === "busy" || tab.status === "waiting_approval") {
      return false;
    }

    const defaults = this.resolveTabDefaults();
    const activeFile = this.getPreferredTargetFile();
    const attachments = this.getTabSessionItems(tabId);
    const copy = this.getLocalizedCopy();
    this.usageSync.untrackTab(tabId, tab.codexThreadId);
    this.clearAssistantArtifactTracking(tabId);
    this.store.resetTab(tabId, {
      title: copy.service.newChatTitle,
      draft: "",
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
      targetNotePath: activeFile?.path ?? null,
      selectionContext: null,
      panelSessionOrigin: null,
      chatSuggestion: null,
      composeMode: "chat",
      contextPaths: [],
      lastResponseId: null,
      sessionItems: [],
      codexThreadId: null,
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort,
      learningMode: defaults.learningMode,
      fastMode: defaults.fastMode,
      usageSummary: createEmptyUsageSummary(),
      messages: [],
      diffText: "",
      status: this.hasCodexLogin() ? "ready" : "missing_login",
      runtimeMode: "normal",
      lastError: null,
      pendingApprovals: [],
      toolLog: [],
      patchBasket: [],
      sessionApprovals: { write: false, shell: false },
      waitingState: null,
    });
    void this.cleanupSessionItems(attachments);
    return true;
  }

  activateTab(tabId: string): void {
    this.store.activateTab(tabId);
  }

  setDraft(tabId: string, draft: string): void {
    this.store.setDraft(tabId, draft);
  }

  setTabTargetNote(tabId: string, path: string | null): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const nextPath = this.normalizeTargetNotePath(path);
    this.store.setTargetNotePath(tabId, nextPath);
  }

  getTabSelectionContext(tabId: string): SelectionContext | null {
    const selectionContext = this.findTab(tabId)?.selectionContext ?? null;
    return selectionContext ? { ...selectionContext } : null;
  }

  getTabAttachments(tabId: string): ComposerAttachment[] {
    return this.getTabSessionItems(tabId).map((attachment) => ({ ...attachment }));
  }

  getTabPatchBasket(tabId: string): PatchProposal[] {
    return (this.findTab(tabId)?.patchBasket ?? []).map((proposal) => ({ ...proposal }));
  }

  setTabSelectionContext(tabId: string, selectionContext: SelectionContext | null): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    this.store.setSelectionContext(tabId, selectionContext ? { ...selectionContext } : null);
  }

  async addComposerAttachments(tabId: string, inputs: ComposerAttachmentInput[]): Promise<ComposerAttachment[]> {
    const tab = this.findTab(tabId);
    if (!tab || inputs.length === 0) {
      return [];
    }

    const vaultRoot = this.resolveVaultRoot();
    const stageDir = this.resolveAttachmentStageDirectory(tabId);
    const stagedAttachments: ComposerAttachment[] = [];
    for (const input of inputs) {
      const staged = await stageComposerAttachment(vaultRoot, stageDir, {
        ...input,
        id: makeId("attachment"),
      });
      stagedAttachments.push(staged);
    }

    this.store.setSessionItems(tabId, [...this.getTabSessionItems(tabId), ...stagedAttachments]);
    for (const attachment of stagedAttachments) {
      this.noteRecentStudySource({
        id: makeId("study-source"),
        label: attachment.displayName,
        path: attachment.originalPath ?? attachment.vaultPath,
        kind: "attachment",
        createdAt: attachment.createdAt,
      });
    }
    return stagedAttachments;
  }

  async removeComposerAttachment(tabId: string, attachmentId: string): Promise<void> {
    const attachments = this.getTabSessionItems(tabId);
    const next = attachments.filter((attachment) => attachment.id !== attachmentId);
    if (next.length === attachments.length) {
      return;
    }

    const removed = attachments.filter((attachment) => attachment.id === attachmentId);
    this.store.setSessionItems(tabId, next);
    await this.cleanupSessionItems(removed);
  }

  ensureAccountUsage(tabId: string): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const usage = normalizeAccountUsageSummary(this.store.getState().accountUsage);
    const freshness = deriveAccountUsageFreshness(usage);
    if (!hasAccountUsageSummaryData(usage) || freshness === "stale" || freshness === "unknown") {
      this.usageSync.refreshUsageForTab(tabId);
    }
  }

  captureSelectionContext(tabId: string, file: TFile | null, editor: Editor | null): boolean {
    const selection = editor?.getSelection().trim() || "";
    if (!selection) {
      return false;
    }

    this.store.setSelectionContext(tabId, {
      text: selection,
      sourcePath: file?.path ?? null,
      createdAt: Date.now(),
    });
    this.noteRecentStudySource({
      id: makeId("study-source"),
      label: file?.basename ? this.getLocalizedCopy().service.fileSelectionLabel(file.basename) : this.getLocalizedCopy().service.selectionLabel,
      path: file?.path ?? null,
      kind: "selection",
      createdAt: Date.now(),
    });
    return true;
  }

  async setTabTargetToCurrentNote(tabId: string, file: TFile | null): Promise<void> {
    const targetFile = file ?? this.getPreferredTargetFile();
    if (!targetFile) {
      throw new Error("No active note to set as target.");
    }
    this.store.setTargetNotePath(tabId, targetFile.path);
  }

  getTabTargetNotePath(tabId: string): string | null {
    return this.resolveTargetNotePath(tabId);
  }

  private noteRecentStudySource(source: RecentStudySource): void {
    this.store.addRecentStudySource(source, MAX_RECENT_STUDY_SOURCES);
  }

  async respondToChatSuggestion(
    tabId: string,
    action: ChatSuggestionAction,
    context?: Pick<SendPromptContext, "file" | "editor">,
  ): Promise<void> {
    const tab = this.findTab(tabId);
    const suggestion = tab?.chatSuggestion;
    if (!tab || !suggestion) {
      return;
    }
    if (suggestion.kind === "plan_execute") {
      await this.respondToPlanExecutionSuggestion(tabId, action, context);
      return;
    }
    if (suggestion.kind === "rewrite_followup") {
      await this.respondToRewriteSuggestion(tabId, action, context);
      return;
    }
    if (action === "implement_now") {
      return;
    }
    if (action === "update_panel" || action === "save_panel_copy" || action === "update_skill" || action === "dismiss") {
      await this.studyPanels.respondToChatSuggestion(tabId, action);
    }
  }

  private async respondToPlanExecutionSuggestion(
    tabId: string,
    action: ChatSuggestionAction,
    context?: Pick<SendPromptContext, "file" | "editor">,
  ): Promise<void> {
    const tab = this.findTab(tabId);
    const suggestion = tab?.chatSuggestion;
    if (!tab || !suggestion || suggestion.kind !== "plan_execute" || suggestion.status !== "pending") {
      return;
    }

    if (action === "dismiss") {
      this.store.setChatSuggestion(tabId, null);
      return;
    }
    if (action !== "implement_now") {
      return;
    }
    if (!this.canImplementReadyPlan(tabId)) {
      throw new Error(this.getLocalizedCopy().service.planImplementationRequiresYolo);
    }

    const nextSuggestion = {
      ...suggestion,
      status: "applied" as const,
    };
    const previousMode = tab.composeMode;
    this.store.setChatSuggestion(tabId, nextSuggestion);
    this.store.setComposeMode(tabId, "chat");
    this.store.addMessage(tabId, {
      id: makeId("plan-implementation"),
      kind: "system",
      text: this.getLocalizedCopy().service.planImplementationStarted,
      createdAt: Date.now(),
    });

    try {
      await this.sendPrompt(tabId, this.buildPlanImplementationPrompt(suggestion.planSummary), {
        file: context?.file ?? null,
        editor: context?.editor ?? null,
      });
    } catch (error) {
      this.store.setComposeMode(tabId, previousMode);
      this.store.setChatSuggestion(tabId, suggestion);
      throw error;
    }
  }

  private async respondToRewriteSuggestion(
    tabId: string,
    action: ChatSuggestionAction,
    context?: Pick<SendPromptContext, "file" | "editor">,
  ): Promise<void> {
    const tab = this.findTab(tabId);
    const suggestion = tab?.chatSuggestion;
    if (!tab || !suggestion || suggestion.kind !== "rewrite_followup" || suggestion.status !== "pending") {
      return;
    }

    if (action === "dismiss") {
      this.store.setChatSuggestion(tabId, null);
      return;
    }
    if (action !== "rewrite_note") {
      return;
    }

    const nextSuggestion = {
      ...suggestion,
      status: "applied" as const,
    };
    this.store.setChatSuggestion(tabId, nextSuggestion);
    try {
      await this.sendPrompt(tabId, this.buildRewriteFollowupPrompt(tabId, suggestion), {
        file: context?.file ?? null,
        editor: context?.editor ?? null,
        transcriptPrompt: this.getLocalizedCopy().workspace.reflectInNote,
        transcriptMeta: {
          internalPromptKind: "rewrite_followup",
        },
      });
    } catch (error) {
      this.store.setChatSuggestion(tabId, suggestion);
      throw error;
    }
  }

  private buildPlanImplementationPrompt(summary: string | null): string {
    const trimmedSummary = summary?.trim() ?? "";
    const lines = [
      "Implement the agreed plan now.",
      "Use the existing discussion in this tab as context.",
      "Do not continue the planning interview unless a critical blocker remains.",
    ];
    if (trimmedSummary) {
      lines.push("Agreed plan summary:", trimmedSummary);
    }
    return lines.join("\n\n");
  }

  private buildRewriteFollowupPrompt(
    tabId: string,
    suggestion: NonNullable<ConversationTabState["chatSuggestion"]>,
  ): string {
    return this.buildRewriteFollowupPromptFromMessage(tabId, suggestion.messageId, suggestion.rewriteSummary ?? null);
  }

  private buildRewriteFollowupPromptFromMessage(
    tabId: string,
    messageId: string,
    fallbackSummary: string | null,
  ): string {
    const assistantMessage = this.findTab(tabId)?.messages.find((message) => message.id === messageId) ?? null;
    const visibleAnswer = assistantMessage ? this.getVisibleAssistantText(assistantMessage.text) : "";
    const summary = visibleAnswer || fallbackSummary?.trim() || "";
    const lines = [
      "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
      "Target resolution order for this rewrite: an explicitly mentioned note or path, then the selection source note, then prefer the active note for this turn, then the current session target note.",
      "If a selection snapshot is attached, limit the rewrite to that selected section or the nearest matching section instead of rewriting the whole note.",
      "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
      ...buildPatchMathFormattingRules(),
      ...buildQuotedPatchMathFormattingRules(),
      "Add concise evidence lines to the patch header when possible using `evidence: kind|label|sourceRef|snippet`.",
      "Prefer vault-note and attachment evidence first. If that is insufficient, you may use web research and mark those evidence lines with `kind` = `web` and a source URL.",
      "Do not ask whether to apply the change. Emit the patch now and keep any visible chat summary to at most 2 short sentences.",
    ];
    if (summary) {
      lines.push("Assistant answer to convert:", summary);
    }
    return lines.join("\n\n");
  }

  async addCurrentNoteToContext(tabId: string, file: TFile | null): Promise<void> {
    if (!file) {
      throw new Error(this.getLocalizedCopy().service.noActiveNoteToPin);
    }
    this.appendContextPath(tabId, file.path);
  }

  async addDailyNoteToContext(tabId: string): Promise<void> {
    const file = await this.findDailyNoteFile();
    if (!file) {
      throw new Error(this.getLocalizedCopy().service.dailyNoteNotFound);
    }
    this.appendContextPath(tabId, file.path);
  }

  removeContextPath(tabId: string, path: string): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    this.store.setContextPaths(tabId, normalizeContextPaths(tab.contextPaths.filter((entry) => entry !== path)));
  }

  clearContextPack(tabId: string): void {
    this.store.setContextPaths(tabId, []);
  }

  restoreTabs(): Promise<void> {
    this.store.setAuthState(this.hasAuthEvidence());
    return Promise.resolve();
  }

  async ensureStarted(): Promise<void> {
    await this.refreshModelCatalog();
    await this.refreshCodexCatalogs();
    this.ensureDefaultStudyPanels();
    await this.refreshRuntimeHealth();
    this.normalizeTabTargetNotes();
    this.seedInitialTargetNote();
    this.recoverPersistedOrphanedTurns();
    this.usageSync.start();
    await this.syncKnownUsageFromSessions();
  }

  private recoverPersistedOrphanedTurns(): void {
    for (const tab of this.store.getState().tabs) {
      if (tab.status === "busy" || tab.status === "waiting_approval" || tab.waitingState) {
        continue;
      }
      if (tab.pendingApprovals.length > 0 || tab.patchBasket.length > 0) {
        continue;
      }
      const lastUserIndex = [...tab.messages]
        .map((message, index) => ({ message, index }))
        .reverse()
        .find(({ message }) => message.kind === "user")?.index;
      if (typeof lastUserIndex !== "number") {
        continue;
      }
      const lastUser = tab.messages[lastUserIndex];
      if (!lastUser) {
        continue;
      }
      const turnStatus = typeof lastUser.meta?.turnStatus === "string" ? lastUser.meta.turnStatus : null;
      if (turnStatus && turnStatus !== "submitted") {
        continue;
      }
      const hasOutcomeMessage = tab.messages
        .slice(lastUserIndex + 1)
        .some((message) => message.kind === "assistant" || message.kind === "system");
      if (hasOutcomeMessage) {
        continue;
      }
      this.finalizeOrphanedTurn(tab.id);
    }
  }

  async sendPrompt(
    tabId: string,
    input: string,
    context?: SendPromptContext,
  ): Promise<void> {
    const initialTab = this.findTab(tabId);
    if (!initialTab) {
      return;
    }
    const getCurrentTab = () => this.findTab(tabId);
    const selectionContext = initialTab.selectionContext ?? null;
    const attachments = this.getTabSessionItems(tabId);
    const normalizedInput = normalizePromptInput(input, {
      hasSelection: Boolean(selectionContext),
      attachmentCount: attachments.length,
      selectionPrompt: DEFAULT_SELECTION_PROMPT,
      attachmentPrompt: DEFAULT_ATTACHMENT_PROMPT,
      selectionAndAttachmentPrompt: DEFAULT_SELECTION_AND_ATTACHMENT_PROMPT,
    });
    if (!normalizedInput) {
      return;
    }
    if (initialTab.status === "busy" || initialTab.status === "waiting_approval" || this.pendingPromptSends.has(tabId)) {
      throw new Error(this.getLocalizedCopy().service.tabAlreadyRunning);
    }
    this.pendingPromptSends.add(tabId);
    let scheduledRun = false;

    try {
      if (this.studyPanels.maybeHandlePanelCompletionSignal(tabId, normalizedInput)) {
        this.store.setDraft(tabId, "");
        return;
      }

      const expanded = await expandSlashCommand(normalizedInput, {
        app: this.app,
        currentFile: context?.file ?? null,
        targetFile:
          (() => {
            const targetPath = this.resolveTargetNotePath(tabId);
            const abstractFile = targetPath ? this.app.vault.getAbstractFileByPath(targetPath) : null;
            return abstractFile instanceof TFile ? abstractFile : null;
          })(),
        editor: context?.editor ?? null,
        selectionText: selectionContext?.text ?? null,
        selectionSourcePath: selectionContext?.sourcePath ?? null,
        customPrompts: this.customPromptCatalog,
        installedSkills: this.installedSkillCatalog,
        commands: this.getSlashCommandCatalog(),
        patchBasket: initialTab.patchBasket,
      });

      if (expanded.localAction) {
        if (expanded.localAction.type === "fork") {
          if (!this.forkTab(tabId)) {
            throw new Error(this.getLocalizedCopy().notices.cannotForkConversation);
          }
        } else if (expanded.localAction.type === "resume") {
          if (!this.resumeTab(tabId)) {
            throw new Error(this.getLocalizedCopy().notices.noResumableThread);
          }
        } else if (expanded.localAction.type === "compact") {
          this.compactTab(tabId);
        } else {
          await this.applyLatestPendingPatch(tabId);
        }
        this.store.setDraft(tabId, "");
        return;
      }

      if (!this.hasCodexLogin()) {
        const message = this.getMissingLoginMessage();
        this.store.setAuthState(false);
        this.store.setRuntimeIssue(message);
        throw new Error(message);
      }

      if (expanded.studyRecipeId) {
        this.studyPanels.applyStudyRecipeContext(tabId, this.studyPanels.requireStudyRecipe(expanded.studyRecipeId));
      }

      const promptMetadata = extractPromptMetadata(expanded.prompt.trim());
      const prompt = promptMetadata.cleanedPrompt.trim();
      const executionPromptBase = promptMetadata.executionPrompt.trim() || prompt;
      if (!prompt) {
        throw new Error(this.getLocalizedCopy().service.promptEmptyAfterExpansion);
      }
      const visiblePrompt = (context?.transcriptPrompt?.trim() || prompt).trim();

      this.studyPanels.capturePanelSessionOrigin(tabId, normalizedInput);

      const mentionResolution = await this.resolveMentionContext(promptMetadata.mentions);
      const currentTab = getCurrentTab();
      const workflowSkillRefs = currentTab?.studyWorkflow
        ? getStudyWorkflowDefinition(currentTab.studyWorkflow, this.getLocale()).safeAutoSkillRefs.map((name) => `$${name}`)
        : [];
      const composeMode = currentTab?.composeMode ?? "chat";
      if (currentTab && this.shouldAutoCompactTab(currentTab)) {
        this.compactTab(tabId, "auto");
      }
      const { skillNames, resolvedSkillDefinitions } = await this.resolveRequestedSkillContext(
        getCurrentTab(),
        expanded.skillPrompt.trim() ? [expanded.skillPrompt.trim()] : [],
        mentionResolution.skillNames.map((name) => `$${name}`),
        workflowSkillRefs,
      );
      const paperStudyGuideNeeded = shouldAttachPaperStudyGuide({
        locale: this.getLocale(),
        studyWorkflow: currentTab?.studyWorkflow ?? null,
        skillNames,
        attachmentKinds: attachments.map((attachment) => attachment.kind),
      });
      const executionPrompt =
        composeMode === "plan" ? formatPlanModePrompt(executionPromptBase, skillNames) : executionPromptBase;
      const runtimeMode: RuntimeMode = skillNames.length > 0 ? "skill" : "normal";
      const contextSnapshot = await this.captureTurnContext(
        tabId,
        context?.file ?? null,
        context?.editor ?? null,
        normalizedInput,
        expanded.command,
        attachments,
        mentionResolution.contextText,
        mentionResolution.explicitTargetNotePath,
        skillNames,
        resolvedSkillDefinitions,
      );
      if (paperStudyGuideNeeded) {
        if (contextSnapshot.attachmentMissingSourceNames.length > 0 || contextSnapshot.attachmentMissingPdfTextNames.length > 0) {
          throw new Error(
            this.buildPaperStudyAttachmentFailureMessage({
              missingSourceNames: contextSnapshot.attachmentMissingSourceNames,
              missingPdfTextNames: contextSnapshot.attachmentMissingPdfTextNames,
            }),
          );
        }
      }
      const allowVaultWrite = composeMode === "plan" ? false : allowsVaultWrite(prompt);
      if (!(await this.ensureAutoApplyConsent(prompt, composeMode))) {
        return;
      }
      const defaultWorkingDirectory = currentTab?.cwd || this.resolveVaultRoot();
      const launcher = this.resolveTurnCodexLauncher({
        defaultWorkingDirectory,
        workingDirectoryHint: mentionResolution.workingDirectoryHint,
        sourcePathHints: this.collectTurnSourcePathHints(mentionResolution.sourcePathHints, attachments),
      });
      const workingDirectory = this.resolveTurnWorkingDirectory(
        defaultWorkingDirectory,
        mentionResolution.workingDirectoryHint,
        launcher.runtime,
      );
      const imagePaths = [
        ...attachments.filter((attachment) => attachment.kind === "image").map((attachment) => attachment.stagedPath),
        ...(context?.images ?? []),
      ];

      this.store.setDraft(tabId, "");
      this.store.setRuntimeIssue(null);
      this.store.setRuntimeMode(tabId, runtimeMode);
      if (this.settingsProvider().autoGenerateTitle && !(getCurrentTab()?.messages.length ?? 0)) {
        this.store.setTitle(tabId, sanitizeTitle(visiblePrompt, this.getLocalizedCopy().service.newChatTitle));
      }

      this.appendSelectionContextMessage(tabId, selectionContext);
      this.appendAttachmentSummaryMessage(tabId, attachments);
      const createdAt = Date.now();
      const turnId = makeId("turn");
      const userMessageId = makeId("user");
      const effectiveSkillsCsv = skillNames.length > 0 ? skillNames.join(",") : null;
      const activePanelId = currentTab?.activeStudyRecipeId ?? null;
      if (!shouldSuppressImmediateDuplicateUserPrompt(getCurrentTab()?.messages ?? [], visiblePrompt, createdAt)) {
        this.store.addMessage(tabId, {
          id: userMessageId,
          kind: "user",
          text: visiblePrompt,
          createdAt,
          meta: {
            turnId,
            turnStatus: "submitted",
            effectiveSkillsCsv,
            effectiveSkillCount: effectiveSkillsCsv ? skillNames.length : undefined,
            activePanelId,
            ...(context?.transcriptMeta ?? {}),
          },
        });
      }
      this.armPendingTurn(tabId, turnId, userMessageId, createdAt);

      scheduledRun = true;
      void this.runTurn(
        tabId,
        executionPrompt,
        runtimeMode,
        composeMode,
        skillNames,
        contextSnapshot,
        imagePaths,
        workingDirectory,
        launcher.runtime,
        launcher.executablePath,
        launcher.launcherOverrideParts,
        allowVaultWrite,
        input,
        true,
        false,
        turnId,
        userMessageId,
      ).finally(() => {
        this.pendingPromptSends.delete(tabId);
      });
    } finally {
      if (!scheduledRun) {
        this.pendingPromptSends.delete(tabId);
      }
    }
  }

  async askAboutCurrentNote(tabId: string, prompt: string, file: TFile | null, editor: Editor | null): Promise<void> {
    const fallback = this.getLocalizedCopy().service.reviewThisNoteFallback;
    await this.sendPrompt(tabId, `/note ${prompt.trim() || fallback}`, { file, editor });
  }

  async askAboutSelection(tabId: string, prompt: string, file: TFile | null, editor: Editor | null): Promise<void> {
    if (!this.captureSelectionContext(tabId, file, editor)) {
      throw new Error(this.getLocalizedCopy().service.selectTextBeforeAsking);
    }
    await this.sendPrompt(tabId, prompt.trim() || DEFAULT_SELECTION_PROMPT, { file, editor: null });
  }

  async interruptActiveTurn(tabId: string): Promise<void> {
    this.abortTabRun(tabId, true, "user_interrupt");
  }

  async respondToApproval(approvalId: string, decision: ToolDecision): Promise<ApprovalResult> {
    return this.approvalCoordinator.respondToApproval(approvalId, decision);
  }

  async respondToAllApprovals(tabId: string, decision: "approve" | "approve_session" | "deny"): Promise<void> {
    await this.approvalCoordinator.respondToAllApprovals(tabId, decision);
  }

  async applyPatchProposal(tabId: string, patchId: string): Promise<void> {
    await this.approvalCoordinator.applyPatchProposal(tabId, patchId);
  }

  async overwritePatchProposal(
    tabId: string,
    patchId: string,
    expectedCurrentContentHash: string | null,
    force = false,
  ): Promise<"applied" | "changed"> {
    return await this.approvalCoordinator.overwritePatchProposal(tabId, patchId, expectedCurrentContentHash, force);
  }

  rejectPatchProposal(tabId: string, patchId: string): void {
    this.approvalCoordinator.rejectPatchProposal(tabId, patchId);
  }

  async openPatchTarget(tabId: string, patchId: string): Promise<void> {
    await this.approvalCoordinator.openPatchTarget(tabId, patchId);
  }

  private async applyLatestPendingPatch(tabId: string): Promise<void> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const candidates = tab.patchBasket.filter((entry) => entry.status === "pending" || entry.status === "conflicted");
    if (candidates.length === 0) {
      throw new Error(this.getLocalizedCopy().notices.noPendingPatch);
    }
    if (candidates.length > 1) {
      throw new Error(this.getLocalizedCopy().service.applyLatestPatchAmbiguous(candidates.length));
    }
    const proposal = candidates[0];
    if (!proposal) {
      throw new Error(this.getLocalizedCopy().notices.noPendingPatch);
    }
    try {
      await this.approvalCoordinator.applyPatchProposal(tabId, proposal.id);
    } catch (error) {
      if (error instanceof PatchConflictError) {
        openPatchConflictModal(this.app, this, this.getLocalizedCopy().workspace, error);
        return;
      }
      if (error instanceof PatchReadabilityError) {
        return;
      }
      throw error;
    }
  }

  private async runTurn(
    tabId: string,
    prompt: string,
    mode: RuntimeMode,
    composeMode: ComposeMode,
    skillNames: string[],
    turnContext: TurnContextSnapshot,
    images: string[],
    workingDirectory: string,
    runtime: CodexRuntime,
    executablePath: string,
    launcherOverrideParts: string[] | undefined,
    allowVaultWrite: boolean,
    draftBackup: string,
    allowEmptyReplyRecovery = true,
    watchdogRecoveryAttempted = false,
    turnId: string | null = null,
    userMessageId: string | null = null,
    proposalRepairPhase = false,
    proposalRepairFailureMode: ProposalRepairFailureMode = "error",
  ): Promise<void> {
    if (turnId && userMessageId && !this.pendingTurns.has(tabId)) {
      this.armPendingTurn(tabId, turnId, userMessageId, Date.now());
    }
    const controller = new AbortController();
    this.activeRuns.set(tabId, {
      controller,
      mode,
      abortReason: null,
      lastLivenessAt: Date.now(),
      lastMeaningfulProgressAt: Date.now(),
      stallWarnedAt: null,
      watchdogRecoveryAttempted,
      watchdogState: "healthy",
    });
    this.usageSync.armActiveRun(tabId, this.shouldStartFreshThread(tabId) ? null : this.findTab(tabId)?.codexThreadId ?? null);
    this.store.setRuntimeMode(tabId, mode);
    this.store.setStatus(tabId, "busy");
    this.store.setWaitingState(tabId, this.createWaitingState("boot", mode));
    this.store.clearApprovals(tabId);

    let terminalError: string | null = null;
    let transcriptSyncResult: TranscriptSyncResult = "no_reply_found";
    const assistantCountBefore = this.countVisibleAssistantReplies(tabId);
    const assistantMessageIdsBefore = this.collectAssistantMessageIds(tabId);
    const assistantOutputVisibility: AssistantOutputVisibility = proposalRepairPhase ? "artifact_only" : "visible";
    const requestedModel = this.resolveSelectedModel(tabId);
    const model = this.resolveRuntimeCompatibleModel(requestedModel, runtime);
    if (model !== requestedModel) {
      this.store.setRuntimeIssue(this.buildCodexModelCompatibilityMessage(requestedModel, model));
    }
    const reasoningEffort = this.resolveSelectedReasoningEffort(tabId, model);
    const fastMode = Boolean(this.findTab(tabId)?.fastMode);
    const permissionProfile =
      composeMode === "plan"
        ? {
            sandboxMode: "read-only" as const,
            approvalPolicy: "untrusted" as const,
          }
        : getPermissionModeProfile(this.settingsProvider().permissionMode);

    try {
      const { threadId } = await this.runCodexStream({
        prompt: buildTurnPrompt(prompt, turnContext, mode, skillNames, composeMode, allowVaultWrite, this.getNoteApplyPolicy(composeMode), {
          preferredName: this.settingsProvider().preferredName,
          customSystemPrompt: this.settingsProvider().customSystemPrompt,
          learningMode: this.findTab(tabId)?.learningMode ?? false,
          shellBlocklist: this.settingsProvider().securityPolicy.commandBlacklistEnabled
            ? [
                ...this.settingsProvider().securityPolicy.blockedCommandsWindows,
                ...this.settingsProvider().securityPolicy.blockedCommandsUnix,
              ]
            : [],
        }),
        tabId,
        threadId: this.shouldStartFreshThread(tabId) ? null : this.findTab(tabId)?.codexThreadId ?? null,
        workingDirectory,
        runtime,
        executablePath,
        launcherOverrideParts,
        sandboxMode: permissionProfile.sandboxMode,
        approvalPolicy: permissionProfile.approvalPolicy,
        images,
        model,
        reasoningEffort,
        fastMode,
        signal: controller.signal,
        watchdogRecoveryAttempted,
        onEvent: (event) => {
          terminalError = this.threadEventReducer.handleThreadEvent(tabId, event, assistantOutputVisibility) ?? terminalError;
        },
        onWatchdogStageChange: (stage) => {
          const run = this.activeRuns.get(tabId);
          if (!run) {
            return;
          }
          const now = Date.now();
          if (stage === "stall_warn") {
            run.stallWarnedAt = now;
            run.watchdogState = "stalled";
            this.setWatchdogWaitingState(tabId, "stall_warn");
            return;
          }
          if (stage === "stall_recovery") {
            run.watchdogRecoveryAttempted = true;
            run.watchdogState = "recovering";
            this.setWatchdogWaitingState(tabId, "stall_recovery");
          }
        },
      });

      this.activeRuns.delete(tabId);
      this.usageSync.disarmActiveRun(tabId);
      this.finalizePendingMessages(tabId);
      this.store.setWaitingState(tabId, null);
      this.store.setLastResponseId(tabId, null);
      const outcome = await this.collectTurnOutcome({
        tabId,
        threadId,
        assistantCountBefore,
        assistantMessageIdsBefore,
        turnContext,
        assistantOutputVisibility,
      });
      transcriptSyncResult = outcome.transcriptSyncResult;
      if (terminalError) {
        if (proposalRepairPhase && proposalRepairFailureMode === "silent") {
          return;
        }
        this.store.setRuntimeIssue(terminalError);
        this.store.setStatus(tabId, this.isLoginError(terminalError) ? "missing_login" : "error", terminalError);
        if (this.isLoginError(terminalError)) {
          this.store.setAuthState(false);
        }
        this.restoreDraftIfStillEmpty(tabId, draftBackup);
        this.store.addMessage(tabId, {
          id: makeId("error"),
          kind: "system",
          text: terminalError,
          createdAt: Date.now(),
        });
        this.completePendingTurn(tabId, "error");
        this.studyPanels.disarmPanelCompletionSignal(tabId);
        return;
      }

      if (allowVaultWrite && !proposalRepairPhase && !outcome.hasArtifactOutcome) {
        const repairCandidate = this.getProposalRepairCandidate(tabId, outcome.newAssistantMessageIds);
        if (repairCandidate) {
          await this.runTurn(
            tabId,
            this.buildProposalRepairPrompt(turnContext, repairCandidate.message, repairCandidate.parsed, repairCandidate.reason),
            mode,
            composeMode,
            skillNames,
            turnContext,
            images,
            workingDirectory,
            runtime,
            executablePath,
            launcherOverrideParts,
            allowVaultWrite,
            draftBackup,
            false,
            watchdogRecoveryAttempted,
            turnId,
            userMessageId,
            true,
          );
          return;
        }
      }

      if (allowVaultWrite && !proposalRepairPhase && outcome.hasArtifactOutcome) {
        const lowQualityCandidate = this.getLowQualityPatchRepairCandidate(tabId, outcome.newAssistantMessageIds);
        if (lowQualityCandidate) {
          const repaired = await this.attemptHiddenLowQualityPatchRepair({
            tabId,
            candidate: lowQualityCandidate,
            mode,
            composeMode,
            skillNames,
            turnContext,
            images,
            workingDirectory,
            runtime,
            executablePath,
            launcherOverrideParts,
            draftBackup,
            watchdogRecoveryAttempted,
            turnId,
            userMessageId,
          });
          if (repaired) {
            return;
          }
        }
      }

      if (!allowVaultWrite && !proposalRepairPhase && !outcome.hasArtifactOutcome) {
        const reflectionRescue = this.classifyNoteReflectionRescueCandidate(tabId, outcome.newAssistantMessageIds, turnContext);
        if (reflectionRescue) {
          if (reflectionRescue.strength === "strong_repair") {
            const repaired = await this.attemptHiddenNoteReflectionRepair({
              tabId,
              candidate: reflectionRescue,
              mode,
              composeMode,
              skillNames,
              turnContext,
              images,
              workingDirectory,
              runtime,
              executablePath,
              launcherOverrideParts,
              draftBackup,
              watchdogRecoveryAttempted,
              turnId,
              userMessageId,
            });
            if (repaired) {
              return;
            }
          }
          this.rescueMissingNoteReflection(tabId, reflectionRescue);
        }
      }

      if (outcome.assistantCountAfter <= assistantCountBefore && !outcome.hasArtifactOutcome) {
        if (proposalRepairPhase) {
          if (proposalRepairFailureMode === "silent") {
            return;
          }
          const repairFailedMessage = this.buildInvalidPatchRepairFailedMessage();
          this.store.setRuntimeIssue(repairFailedMessage);
          this.store.setStatus(tabId, "error", repairFailedMessage);
          this.restoreDraftIfStillEmpty(tabId, draftBackup);
          this.store.addMessage(tabId, {
            id: makeId("error"),
            kind: "system",
            text: repairFailedMessage,
            createdAt: Date.now(),
          });
          this.completePendingTurn(tabId, "error");
          this.studyPanels.disarmPanelCompletionSignal(tabId);
          return;
        }
        if (allowEmptyReplyRecovery) {
          this.compactTab(tabId, "retry");
          await this.runTurn(
            tabId,
            prompt,
            mode,
            composeMode,
            skillNames,
            {
              ...turnContext,
              conversationSummaryText: this.findTab(tabId)?.summary?.text.trim()
                ? ["Conversation carry-forward summary", this.findTab(tabId)!.summary!.text.trim()].join("\n\n")
                : turnContext.conversationSummaryText,
            },
            images,
            workingDirectory,
            runtime,
            executablePath,
            launcherOverrideParts,
            allowVaultWrite,
            draftBackup,
            false,
            watchdogRecoveryAttempted,
            turnId,
            userMessageId,
            proposalRepairPhase,
            proposalRepairFailureMode,
          );
          return;
        }
        const emptyReplyMessage = this.buildEmptyAssistantReplyMessage(transcriptSyncResult);
        this.store.setRuntimeIssue(emptyReplyMessage);
        this.store.setStatus(tabId, "error", emptyReplyMessage);
        this.restoreDraftIfStillEmpty(tabId, draftBackup);
        this.store.addMessage(tabId, {
          id: makeId("error"),
          kind: "system",
          text: emptyReplyMessage,
          createdAt: Date.now(),
        });
        this.completePendingTurn(tabId, "error");
        this.studyPanels.disarmPanelCompletionSignal(tabId);
        return;
      }

      if (proposalRepairPhase && !outcome.hasArtifactOutcome) {
        if (proposalRepairFailureMode === "silent") {
          return;
        }
        const repairFailedMessage = this.buildInvalidPatchRepairFailedMessage();
        this.store.setRuntimeIssue(repairFailedMessage);
        this.store.setStatus(tabId, "error", repairFailedMessage);
        this.restoreDraftIfStillEmpty(tabId, draftBackup);
        this.store.addMessage(tabId, {
          id: makeId("error"),
          kind: "system",
          text: repairFailedMessage,
          createdAt: Date.now(),
        });
        this.completePendingTurn(tabId, "error");
        this.studyPanels.disarmPanelCompletionSignal(tabId);
        return;
      }

      const outcomeKind = this.resolveSuccessfulTurnOutcomeKind(
        tabId,
        outcome.assistantCountAfter > assistantCountBefore,
        outcome.hasArtifactOutcome,
      );
      if (!outcomeKind) {
        this.restoreDraftIfStillEmpty(tabId, draftBackup);
        this.finalizeOrphanedTurn(tabId);
        this.studyPanels.disarmPanelCompletionSignal(tabId);
        return;
      }
      this.completePendingTurn(tabId, outcomeKind);
      await this.finalizeSuccessfulTurn(tabId);
    } catch (error) {
      const abortReason = getAbortReason(error) ?? this.activeRuns.get(tabId)?.abortReason ?? null;
      this.activeRuns.delete(tabId);
      this.usageSync.disarmActiveRun(tabId);
      this.finalizePendingMessages(tabId);
      this.store.setWaitingState(tabId, null);
      if (isAbortError(error)) {
        if (proposalRepairPhase && proposalRepairFailureMode === "silent") {
          this.approvalCoordinator.reconcileApprovalStatus(tabId);
          return;
        }
        if (abortReason === "user_interrupt") {
          this.store.addMessage(tabId, {
            id: makeId("aborted"),
            kind: "system",
            text: this.getLocalizedCopy().service.turnInterrupted,
            createdAt: Date.now(),
          });
        }
        this.completePendingTurn(tabId, "error");
        this.studyPanels.disarmPanelCompletionSignal(tabId);
        this.approvalCoordinator.reconcileApprovalStatus(tabId);
        return;
      }

      const watchdogStage = getCodexWatchdogStageFromError(error);
      if (watchdogStage === "stall_recovery") {
        const recoveryThreadId = getThreadIdFromCodexError(error) ?? this.findTab(tabId)?.codexThreadId ?? null;
        if (recoveryThreadId) {
          const recovered = await this.collectTurnOutcome({
            tabId,
            threadId: recoveryThreadId,
            assistantCountBefore,
            assistantMessageIdsBefore,
            turnContext,
            assistantOutputVisibility,
          });
          if (recovered.assistantCountAfter > assistantCountBefore || recovered.hasArtifactOutcome) {
            this.store.setWaitingState(tabId, null);
            const recoveredOutcomeKind = this.resolveSuccessfulTurnOutcomeKind(
              tabId,
              recovered.assistantCountAfter > assistantCountBefore,
              recovered.hasArtifactOutcome,
            );
            this.completePendingTurn(tabId, recoveredOutcomeKind ?? "error");
            await this.finalizeSuccessfulTurn(tabId);
            return;
          }
        }
        if (!watchdogRecoveryAttempted) {
          await this.runTurn(
            tabId,
            prompt,
            mode,
            composeMode,
            skillNames,
            turnContext,
            images,
            workingDirectory,
            runtime,
            executablePath,
            launcherOverrideParts,
            allowVaultWrite,
            draftBackup,
            allowEmptyReplyRecovery,
            true,
            turnId,
            userMessageId,
            proposalRepairPhase,
            proposalRepairFailureMode,
          );
          return;
        }
      }

      const message = getErrorMessage(error);
      const normalizedMessage = this.normalizeCodexError(message);
      if (proposalRepairPhase && proposalRepairFailureMode === "silent") {
        return;
      }
      const missingLogin = this.isLoginError(normalizedMessage);
      if (missingLogin) {
        this.store.setAuthState(false);
      }
      this.store.setRuntimeIssue(normalizedMessage);
      this.store.setStatus(tabId, missingLogin ? "missing_login" : "error", normalizedMessage);
      this.restoreDraftIfStillEmpty(tabId, draftBackup);
      this.store.addMessage(tabId, {
        id: makeId("error"),
        kind: "system",
        text: normalizedMessage,
        createdAt: Date.now(),
      });
      this.completePendingTurn(tabId, "error");
      this.studyPanels.disarmPanelCompletionSignal(tabId);
    }
  }

  private restoreDraftIfStillEmpty(tabId: string, draftBackup: string | null | undefined): void {
    const nextDraft = getRecoveredDraftValue(draftBackup, this.findTab(tabId)?.draft ?? null);
    if (!nextDraft) {
      return;
    }
    this.store.setDraft(tabId, nextDraft);
  }

  private async runCodexStream(request: CodexRunRequest): Promise<CodexRunResult> {
    const flags: JsonOutputFlag[] =
      this.jsonOutputFlag === "--experimental-json" ? ["--experimental-json"] : ["--json", "--experimental-json"];
    let lastError: unknown = null;
    let requestForAllFlags = request;

    for (const jsonOutputFlag of flags) {
      let currentEffort = request.reasoningEffort;
      let currentRequest = requestForAllFlags;
      const attemptedEfforts = new Set<string>([currentEffort ?? "__none__"]);

      while (true) {
        try {
          const threadId = await this.executeCodexStream(currentRequest, jsonOutputFlag, currentEffort);
          this.jsonOutputFlag = jsonOutputFlag;
          return {
            threadId,
          };
        } catch (error) {
          lastError = error;
          if (getCodexWatchdogStageFromError(error)) {
            throw error;
          }
          const message = getErrorMessage(error);
          if (
            shouldRetryWithWslFallback({
              platform: process.platform,
              configuredCommand: this.getConfiguredCommandText(),
              currentCommand: this.describeCodexLauncher({
                runtime: currentRequest.runtime,
                executablePath: currentRequest.executablePath,
                launcherOverrideParts: currentRequest.launcherOverrideParts,
              }),
              errorMessage: message,
            })
          ) {
            currentRequest = this.createWslFallbackRequest(currentRequest);
            requestForAllFlags = currentRequest;
            continue;
          }
          if (jsonOutputFlag === "--json" && isUnsupportedJsonFlagError(message, jsonOutputFlag)) {
            break;
          }

          const fallbackEffort = this.getFallbackReasoningEffort(currentRequest.model, message, currentEffort);
          if (fallbackEffort && !attemptedEfforts.has(fallbackEffort)) {
            attemptedEfforts.add(fallbackEffort);
            currentEffort = fallbackEffort;
            continue;
          }

          break;
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(lastError ? getErrorMessage(lastError) : this.getLocale() === "ja" ? "不明な Codex エラーです。" : "Unknown Codex error.");
  }

  private async executeCodexStream(
    request: CodexRunRequest,
    jsonOutputFlag: JsonOutputFlag,
    reasoningEffort: ReasoningEffort | null,
  ): Promise<string | null> {
    const resolvedExecutablePath = sanitizeCodexExecutablePath(request.executablePath);
    const spec = buildCodexSpawnSpec({
      runtime: request.runtime,
      executablePath: resolvedExecutablePath,
      launcherOverrideParts: request.launcherOverrideParts,
      jsonOutputFlag,
      model: request.model,
      threadId: request.threadId,
      workingDirectory: request.workingDirectory,
      sandboxMode: request.sandboxMode,
      approvalPolicy: request.approvalPolicy,
      images: request.images,
      reasoningEffort,
      fastMode: request.fastMode,
    });
    const resolvedCommand = spec.launcherParts.join(" ");

    const child = spawn(spec.command, spec.args, {
      cwd: resolveSpawnCwd(spec.cwd),
      env: this.resolveProcessEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stderrChunks: Buffer[] = [];
    let threadId = request.threadId;
    let spawnError: Error | null = null;
    let watchdogError: Error | null = null;
    let terminalEventError: string | null = null;
    let sawOutputEvent = false;
    let sawAssistantOutput = false;
    let sawMeaningfulProgress = false;
    const startedAt = Date.now();
    let lastLivenessAt = startedAt;
    let lastMeaningfulProgressAt = startedAt;
    let stallWarned = false;
    let recoveryAttempted = request.watchdogRecoveryAttempted ?? false;
    let lastSessionMtimeMs = 0;

    child.once("error", (error) => {
      spawnError = error;
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      lastLivenessAt = Date.now();
      const activeRun = this.activeRuns.get(request.tabId);
      if (activeRun) {
        activeRun.lastLivenessAt = lastLivenessAt;
      }
    });

    if (!child.stdin) {
      throw new Error(this.getLocale() === "ja" ? "Codex process に stdin がありません。" : "Codex process has no stdin.");
    }
    if (!child.stdout) {
      throw new Error(this.getLocale() === "ja" ? "Codex process に stdout がありません。" : "Codex process has no stdout.");
    }

    const abortListener = () => {
      try {
        child.kill();
      } catch {
        // ignore best-effort kill failures
      }
    };

    if (request.signal.aborted) {
      abortListener();
      throw createAbortError(this.activeRuns.get(request.tabId)?.abortReason ?? "runtime_abort");
    }
    request.signal.addEventListener("abort", abortListener, { once: true });

    child.stdin.write(request.prompt);
    child.stdin.end();

    const reader = createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    const watchdog = setInterval(() => {
      if (threadId) {
        const cachedSessionFile = this.sessionFileCache.get(threadId);
        if (cachedSessionFile && existsSync(cachedSessionFile)) {
          try {
            const mtimeMs = statSync(cachedSessionFile).mtimeMs;
            if (mtimeMs > lastSessionMtimeMs) {
              lastSessionMtimeMs = mtimeMs;
              lastLivenessAt = Date.now();
            }
          } catch {
            // ignore session mtime polling failures
          }
        }
      }
      const stage = getCodexRunWatchdogStage({
        startedAt,
        lastLivenessAt,
        now: Date.now(),
        sawOutputEvent,
        stallWarned,
        recoveryAttempted,
      });
      if (stage === "healthy" || watchdogError) {
        return;
      }
      if (stage === "stall_warn") {
        stallWarned = true;
        request.onWatchdogStageChange?.("stall_warn");
        return;
      }
      if (stage === "stall_recovery") {
        recoveryAttempted = true;
        request.onWatchdogStageChange?.("stall_recovery");
      }
      watchdogError = annotateCodexRunError(
        new Error(buildCodexRunWatchdogMessage(stage, this.getLocale())),
        resolvedCommand,
        sawOutputEvent,
        threadId,
        {
          sawAssistantOutput,
          sawMeaningfulProgress,
          watchdogStage: stage,
        },
      );
      try {
        child.kill();
      } catch {
        // ignore best-effort cleanup failures
      }
    }, 1_000);
    const exitResult = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    });

    try {
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        sawOutputEvent = true;
        lastLivenessAt = Date.now();

        let event: JsonRecord;
        try {
          event = JSON.parse(trimmed) as JsonRecord;
        } catch {
          throw new Error(
            this.getLocale() === "ja" ? `Codex event の解析に失敗しました: ${trimmed}` : `Failed to parse Codex event: ${trimmed}`,
          );
        }

        const sessionId = extractCodexSessionId(event);
        if (sessionId) {
          threadId = sessionId;
          void this.resolveSessionFile(sessionId).catch((error: unknown) => {
            console.warn("[obsidian-codex-study] resolveSessionFile after session_id event failed", error);
          });
          this.usageSync.updateActiveRunThread(request.tabId, sessionId);
        } else if (this.isAssistantOutputEvent(event)) {
          sawAssistantOutput = true;
          sawMeaningfulProgress = true;
          lastMeaningfulProgressAt = Date.now();
        } else if (asString(event.type) === "turn.failed") {
          terminalEventError = getErrorMessage(asRecord(event.error));
        } else if (asString(event.type) === "error") {
          terminalEventError = unwrapApiErrorMessage(asString(event.message) ?? "");
        } else if (asString(asRecord(event.item)?.type) === "error") {
          terminalEventError = unwrapApiErrorMessage(
            asString(asRecord(event.item)?.message) ?? getErrorMessage(asRecord(asRecord(event.item)?.error)),
          );
        } else {
          const itemType = asString(asRecord(event.item)?.type);
          if (
            itemType &&
            itemType !== "reasoning" &&
            itemType !== "agent_message"
          ) {
            sawMeaningfulProgress = true;
            lastMeaningfulProgressAt = Date.now();
          }
        }
        if (!sawMeaningfulProgress && this.isAssistantOutputEvent(event)) {
          sawMeaningfulProgress = true;
          lastMeaningfulProgressAt = Date.now();
        }
        const activeRun = this.activeRuns.get(request.tabId);
        if (activeRun) {
          activeRun.lastLivenessAt = lastLivenessAt;
          activeRun.lastMeaningfulProgressAt = sawMeaningfulProgress ? lastMeaningfulProgressAt : activeRun.lastMeaningfulProgressAt;
          activeRun.watchdogState = "healthy";
        }
        request.onEvent(event);
      }

      const { code, signal } = await exitResult;
      if (request.signal.aborted) {
        throw createAbortError(this.activeRuns.get(request.tabId)?.abortReason ?? "runtime_abort");
      }
      if (spawnError) {
        throw annotateCodexRunError(spawnError, resolvedCommand, sawOutputEvent, threadId, {
          sawAssistantOutput,
          sawMeaningfulProgress,
        });
      }
      if (watchdogError) {
        throw watchdogError;
      }
      if (code !== 0 || signal) {
        throw annotateCodexRunError(
          new Error(this.threadEventReducer.buildCliExitMessage(stderrChunks, code, signal, spec, terminalEventError)),
          resolvedCommand,
          sawOutputEvent,
          threadId,
          { sawAssistantOutput, sawMeaningfulProgress },
        );
      }
      return threadId;
    } finally {
      clearInterval(watchdog);
      request.signal.removeEventListener("abort", abortListener);
      reader.close();
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr?.removeAllListeners();
      if (!child.killed && child.exitCode === null) {
        try {
          child.kill();
        } catch {
          // ignore best-effort cleanup failures
        }
      }
    }
  }

  private async resolveRequestedSkills(prompt: string): Promise<string[]> {
    const requested = extractSkillReferences(prompt).map((reference) => reference.name);
    if (!requested.length) {
      return [];
    }
    void this.listInstalledSkills().catch(() => {
      // Skill catalog hydration is best-effort for autocomplete. Unknown skills should pass through to Codex CLI.
    });
    return requested;
  }

  private async resolveRequestedSkillContext(
    tab: ConversationTabState | null,
    explicitSkillRefs: readonly string[],
    mentionSkillRefs: readonly string[],
    workflowSkillRefs: readonly string[],
  ): Promise<ResolvedTurnSkillContext> {
    const requestedSkillNames = await this.resolveRequestedSkills(
      collectTurnRequestedSkillRefs({
        explicitSkillRefs,
        mentionSkillRefs,
        workflowSkillRefs,
        tab,
      }).join("\n"),
    );
    const skillNames = this.resolveTurnSkillNames(requestedSkillNames);
    const resolvedSkillDefinitions = await resolveRequestedSkillDefinitions(skillNames, this.installedSkillCatalog, {
      refreshInstalledSkills: async () => {
        await this.refreshCodexCatalogs();
        return this.installedSkillCatalog;
      },
    });
    return {
      skillNames,
      resolvedSkillDefinitions,
    };
  }

  private resolveTurnSkillNames(requestedSkills: string[]): string[] {
    return [...new Set(requestedSkills)];
  }

  private isAssistantOutputEvent(event: JsonRecord): boolean {
    return Boolean(extractAssistantOutputText(event));
  }

  private async listInstalledSkills(): Promise<Set<string>> {
    if (this.installedSkillCatalog.length === 0) {
      await this.refreshCodexCatalogs();
    }
    return new Set(this.installedSkillCatalog.map((entry) => entry.name));
  }

  private appendSelectionContextMessage(tabId: string, selectionContext: SelectionContext | null): void {
    if (!selectionContext) {
      return;
    }

    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }

    const alreadyRecorded = tab.messages.some(
      (message) => message.meta?.selectionContext === true && message.meta?.selectionCreatedAt === selectionContext.createdAt,
    );
    if (alreadyRecorded) {
      return;
    }

    this.store.addMessage(tabId, {
      id: makeId("selection"),
      kind: "user",
      text: selectionContext.text,
      createdAt: selectionContext.createdAt,
      meta: {
        selectionContext: true,
        selectionCreatedAt: selectionContext.createdAt,
        sourcePath: selectionContext.sourcePath,
      },
    });
  }

  private appendAttachmentSummaryMessage(tabId: string, attachments: readonly ComposerAttachment[]): void {
    if (attachments.length === 0) {
      return;
    }

    this.store.addMessage(tabId, {
      id: makeId("attachments"),
      kind: "user",
      text: buildAttachmentSummaryText(attachments),
      createdAt: Date.now(),
      meta: {
        attachmentSummary: true,
        attachmentCount: attachments.length,
      },
    });
  }

  private appendAssistantFallbackMessageWithVisibility(
    tabId: string,
    text: string,
    messageId: string,
    visibility: AssistantOutputVisibility,
  ): boolean {
    const normalizedText = sanitizeOperationalAssistantText(text) ?? "";
    if (!normalizedText) {
      return false;
    }

    if (visibility === "artifact_only") {
      this.queueAssistantArtifactSync(tabId, messageId, normalizedText, visibility);
      return true;
    }

    const tab = this.findTab(tabId);
    if (!tab) {
      return false;
    }

    if (this.hasDuplicateVisibleAssistantReply(tabId, normalizedText)) {
      return false;
    }

    if (this.getAssistantRepliesSinceLastPrompt(tabId).length > 0) {
      return false;
    }

    this.store.upsertMessage(tabId, messageId, (current) => ({
      id: current?.id ?? messageId,
      kind: "assistant",
      text: normalizedText,
      createdAt: current?.createdAt ?? Date.now(),
      pending: false,
    }));
    this.queueAssistantArtifactSync(tabId, messageId, normalizedText, visibility);
    return true;
  }

  private async syncAssistantArtifacts(
    tabId: string,
    messageId: string,
    text: string,
    visibility: AssistantOutputVisibility = "visible",
  ): Promise<void> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const originTurnId = this.pendingTurns.get(tabId)?.turnId ?? null;

    const parsed = extractAssistantProposals(text);
    const patchBasket = (
      await Promise.all(
        parsed.patches.map((patch, index) => this.buildPatchProposalFromParsed(tabId, messageId, patch, index, originTurnId)),
      )
    ).filter((proposal): proposal is PatchProposal => Boolean(proposal));
    this.store.replacePatchProposals(tabId, messageId, patchBasket);

    const approvals = await this.approvalCoordinator.buildVaultOpApprovals(tabId, messageId, parsed.ops, true, originTurnId);
    this.store.replaceProposalApprovals(tabId, messageId, approvals);
    this.maybeStoreStudyCheckpoint(tabId, parsed);
    this.maybeStorePlanExecutionSuggestion(tabId, messageId, parsed.plan);
    this.maybeStoreRewriteSuggestion(tabId, messageId, parsed, patchBasket, approvals, visibility);
    await this.maybeAutoApplyArtifacts(tabId, patchBasket, approvals, originTurnId);
    this.recordAssistantEditOutcome(
      tabId,
      messageId,
      this.resolveAssistantEditOutcome(tabId, text, parsed, patchBasket, approvals),
      visibility,
    );
    if (!this.activeRuns.has(tabId)) {
      this.approvalCoordinator.reconcileApprovalStatus(tabId);
    }
  }

  private findUserMessageForApprovedEdit(
    tabId: string,
    originTurnId: string | null,
    sourceMessageId: string | null,
  ): ChatMessage | null {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }
    if (originTurnId) {
      const directMatch =
        [...tab.messages]
          .reverse()
          .find(
            (message) =>
              message.kind === "user" &&
              message.meta?.turnId === originTurnId &&
              message.meta?.selectionContext !== true,
          ) ?? null;
      if (directMatch) {
        return directMatch;
      }
    }
    if (sourceMessageId) {
      const assistantIndex = tab.messages.findIndex((message) => message.id === sourceMessageId);
      if (assistantIndex > 0) {
        for (let index = assistantIndex - 1; index >= 0; index -= 1) {
          const candidate = tab.messages[index];
          if (candidate?.kind === "user" && candidate.meta?.selectionContext !== true) {
            return candidate;
          }
        }
      }
    }
    return [...tab.messages].reverse().find((message) => message.kind === "user" && message.meta?.selectionContext !== true) ?? null;
  }

  private findAssistantMessage(tabId: string, messageId: string | null): ChatMessage | null {
    if (!messageId) {
      return null;
    }
    return this.findTab(tabId)?.messages.find((message) => message.id === messageId && message.kind === "assistant") ?? null;
  }

  private resolveSelectedSkillNamesForApprovedEdit(tabId: string, userMessage: ChatMessage | null): string[] {
    const rawCsv = typeof userMessage?.meta?.effectiveSkillsCsv === "string" ? userMessage.meta.effectiveSkillsCsv : "";
    const csvNames = rawCsv
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (csvNames.length > 0) {
      return [...new Set(csvNames)];
    }
    const tab = this.findTab(tabId);
    return [...new Set([...(tab?.panelSessionOrigin?.selectedSkillNames ?? []), ...(tab?.activeStudySkillNames ?? [])].map((entry) => entry.trim()).filter(Boolean))];
  }

  private resolveActivePanelIdForApprovedEdit(tabId: string, userMessage: ChatMessage | null): string | null {
    const userPanelId =
      typeof userMessage?.meta?.activePanelId === "string" && userMessage.meta.activePanelId.trim().length > 0
        ? userMessage.meta.activePanelId.trim()
        : null;
    if (userPanelId) {
      return userPanelId;
    }
    const tab = this.findTab(tabId);
    return tab?.panelSessionOrigin?.panelId ?? tab?.activeStudyRecipeId ?? null;
  }

  private resolveAppliedContentForApprovedEdit(
    tabId: string,
    sourceMessageId: string | null,
    originTurnId: string | null,
    targetPath: string,
  ): string {
    const tab = this.findTab(tabId);
    if (!tab) {
      return "";
    }
    const patchProposal =
      tab.patchBasket.find(
        (proposal) =>
          proposal.targetPath === targetPath &&
          (sourceMessageId ? proposal.sourceMessageId === sourceMessageId : true) &&
          (originTurnId ? proposal.originTurnId === originTurnId : true),
      ) ?? null;
    if (patchProposal?.proposedText?.trim()) {
      return patchProposal.proposedText;
    }
    const assistantMessage = this.findAssistantMessage(tabId, sourceMessageId);
    if (!assistantMessage) {
      return "";
    }
    return (
      extractAssistantProposals(assistantMessage.text).patches.find((patch) => patch.targetPath === targetPath)?.proposedText?.trim() ?? ""
    );
  }

  private async queueSkillImprovementApprovals(
    tabId: string,
    sourceMessageId: string | null,
    originTurnId: string | null,
    selectedSkillNames: readonly string[],
    feedback: SkillFeedbackRecord,
  ): Promise<void> {
    if (selectedSkillNames.length === 0) {
      return;
    }
    const userOwnedSkills = new Map(this.getUserOwnedInstalledSkills().map((skill) => [skill.name, skill] as const));
    for (const skillName of [...new Set(selectedSkillNames)]) {
      const skill = userOwnedSkills.get(skillName);
      if (!skill) {
        continue;
      }
      const currentContent = await fs.readFile(skill.path, "utf8");
      const proposal = buildSkillImprovementProposal({
        skill,
        currentContent,
        feedback: {
          ...feedback,
          selectedSkillNames: [skillName],
          attributionReason:
            feedback.attributionReason ??
            `This refinement is attributed to ${skillName} because it was explicitly selected during a successful applied note edit.`,
        },
      });
      if (!proposal) {
        continue;
      }
      const approvalKey = `${tabId}::${proposal.skillPath}::${proposal.baseContentHash}`;
      const alreadyQueued =
        this.findTab(tabId)?.pendingApprovals.some(
          (approval) =>
            approval.toolName === "skill_update" &&
            approval.decisionTarget === proposal.skillPath &&
            approval.originTurnId === originTurnId &&
            approval.sourceMessageId === sourceMessageId,
        ) ?? false;
      if (alreadyQueued || this.queuedSkillUpdateApprovalKeys.has(approvalKey)) {
        continue;
      }
      this.queuedSkillUpdateApprovalKeys.add(approvalKey);
      this.store.addApproval(tabId, {
        id: makeId("approval-skill"),
        tabId,
        callId: makeId("skill-update-call"),
        toolName: "skill_update",
        title: `Update skill: ${proposal.skillName}`,
        description: proposal.skillPath,
        details: proposal.feedbackSummary,
        diffText: buildSkillImprovementDiff(proposal),
        createdAt: Date.now(),
        sourceMessageId: sourceMessageId ?? undefined,
        originTurnId,
        transport: "plugin_proposal",
        decisionTarget: proposal.skillPath,
        scopeEligible: false,
        scope: "write",
        toolPayload: proposal,
      });
    }
  }

  private async handleApprovedEditApplied(event: {
    tabId: string;
    targetPath: string;
    sourceMessageId: string | null;
    originTurnId: string | null;
    summary: string;
    kind: "patch" | "vault_op";
  }): Promise<void> {
    const tab = this.findTab(event.tabId);
    if (!tab) {
      return;
    }
    const processedKey = [
      event.tabId,
      event.kind,
      event.targetPath,
      event.sourceMessageId ?? "",
      event.originTurnId ?? "",
      event.summary,
    ].join("::");
    if (this.processedApprovedEditKeys.has(processedKey)) {
      return;
    }
    this.processedApprovedEditKeys.add(processedKey);

    const userMessage = this.findUserMessageForApprovedEdit(event.tabId, event.originTurnId, event.sourceMessageId);
    const assistantMessage = this.findAssistantMessage(event.tabId, event.sourceMessageId);
    const selectedSkillNames = this.resolveSelectedSkillNamesForApprovedEdit(event.tabId, userMessage);
    const panelId = this.resolveActivePanelIdForApprovedEdit(event.tabId, userMessage);
    const assistantSummary = assistantMessage ? this.getVisibleAssistantText(assistantMessage.text) : event.summary.trim();
    const appliedContent = this.resolveAppliedContentForApprovedEdit(
      event.tabId,
      event.sourceMessageId,
      event.originTurnId,
      event.targetPath,
    );
    const feedback: SkillFeedbackRecord = {
      prompt: userMessage?.text?.trim() || assistantSummary || event.summary,
      summary: assistantSummary || event.summary,
      targetNotePath: event.targetPath,
      panelId,
      selectedSkillNames: [...selectedSkillNames],
      conversationSummary: tab.summary?.text ?? null,
      appliedChangeSummary: event.summary,
      attributionReason:
        selectedSkillNames.length > 0
          ? "This feedback comes from a successful applied note edit that used explicitly selected user-owned skills."
          : "This feedback comes from a successful applied note edit.",
    };
    const nextMemory = updateUserAdaptationMemory(this.store.getState().userAdaptationMemory ?? null, {
      prompt: feedback.prompt,
      assistantSummary: feedback.summary,
      appliedChangeSummary: event.summary,
      appliedContent,
      panelId,
      targetNotePath: event.targetPath,
      selectedSkillNames,
      occurredAt: Date.now(),
    });
    this.store.setUserAdaptationMemory(nextMemory);
    await this.queueSkillImprovementApprovals(event.tabId, event.sourceMessageId, event.originTurnId, selectedSkillNames, feedback);
    if (!this.activeRuns.has(event.tabId)) {
      this.approvalCoordinator.reconcileApprovalStatus(event.tabId);
    }
  }

  private recordAssistantEditOutcome(
    tabId: string,
    messageId: string,
    outcome: { outcome: EditOutcome; targetPath: string | null; reviewReason?: "approval_mode" | "readability_risk" | "auto_healed" | null } | null,
    visibility: AssistantOutputVisibility = "visible",
  ): void {
    if (!outcome) {
      return;
    }
    const current = this.findAssistantMessage(tabId, messageId);
    if (!current && visibility === "artifact_only") {
      return;
    }
    this.store.upsertMessage(tabId, messageId, (current) => ({
      ...(current ?? {
        id: messageId,
        kind: "assistant",
        text: "",
        createdAt: Date.now(),
      }),
      meta: {
        ...(current?.meta ?? {}),
        editOutcome: outcome.outcome,
        editTargetPath: outcome.targetPath,
        editReviewReason: outcome.reviewReason ?? null,
      },
    }));
  }

  private resolvePatchReviewReason(
    patchBasket: readonly PatchProposal[],
    approvals: readonly PendingApproval[],
  ): "approval_mode" | "readability_risk" | "auto_healed" | null {
    if (patchBasket.some((proposal) => proposal.qualityState === "review_required")) {
      return "readability_risk";
    }
    if (patchBasket.some((proposal) => proposal.healedByPlugin === true || proposal.qualityState === "auto_healed")) {
      return "auto_healed";
    }
    return approvals.length > 0 || patchBasket.length > 0 ? "approval_mode" : null;
  }

  private resolveAssistantEditOutcome(
    tabId: string,
    text: string,
    parsed: ParsedAssistantProposalResult,
    patchBasket: readonly PatchProposal[],
    approvals: readonly PendingApproval[],
  ): { outcome: EditOutcome; targetPath: string | null; reviewReason?: "approval_mode" | "readability_risk" | "auto_healed" | null } | null {
    const targetPath = patchBasket[0]?.targetPath ?? approvals[0]?.decisionTarget ?? null;
    const hasProposalBlocks = /```obsidian-(?:patch|ops)\b/.test(text);
    if (patchBasket.length === 0 && approvals.length === 0) {
      if (parsed.suggestion?.kind === "rewrite_followup") {
        return { outcome: "explanation_only", targetPath: null };
      }
      if (hasProposalBlocks) {
        return {
          outcome: "failed",
          targetPath: this.extractFirstProposalTargetPath(text),
        };
      }
      return null;
    }

    const tab = this.findTab(tabId);
    const noteApplyPolicy = tab ? this.getNoteApplyPolicy(tab.composeMode) : "manual";
    if (noteApplyPolicy === "manual") {
      return { outcome: "proposal_only", targetPath };
    }

    if (noteApplyPolicy === "approval") {
      return {
        outcome: "review_required",
        targetPath,
        reviewReason: this.resolvePatchReviewReason(patchBasket, approvals),
      };
    }

    const liveTab = this.findTab(tabId);
    const pendingPatchReview = patchBasket.some((proposal) => {
      const currentProposal = liveTab?.patchBasket.find((entry) => entry.id === proposal.id) ?? proposal;
      return currentProposal.status !== "applied";
    });
    const pendingApprovalReview = approvals.some((approval) =>
      Boolean(liveTab?.pendingApprovals.some((entry) => entry.id === approval.id)),
    );
    return {
      outcome: pendingPatchReview || pendingApprovalReview ? "review_required" : "applied",
      targetPath,
      reviewReason:
        pendingPatchReview || pendingApprovalReview ? this.resolvePatchReviewReason(patchBasket, approvals) : null,
    };
  }

  private extractFirstProposalTargetPath(text: string): string | null {
    const match =
      text.match(/^path:\s*(.+)$/m) ??
      text.match(/"path"\s*:\s*"([^"]+)"/) ??
      text.match(/"targetPath"\s*:\s*"([^"]+)"/) ??
      text.match(/"destinationPath"\s*:\s*"([^"]+)"/);
    return match?.[1]?.trim() ?? null;
  }

  private async maybeAutoApplyArtifacts(
    tabId: string,
    patchBasket: readonly PatchProposal[],
    approvals: readonly PendingApproval[],
    originTurnId: string | null,
  ): Promise<void> {
    const tab = this.findTab(tabId);
    const pendingTurn = originTurnId ? this.pendingTurns.get(tabId) ?? null : null;
    if (!tab || !pendingTurn || pendingTurn.turnId !== originTurnId) {
      return;
    }
    if (this.getNoteApplyPolicy(tab.composeMode) !== "auto") {
      return;
    }

    const arrivals = [
      ...patchBasket
        .filter((proposal) => !shouldBlockAutomaticPatchApply(proposal))
        .map((proposal) => ({ kind: "patch" as const, id: proposal.id, path: proposal.targetPath })),
      ...approvals.map((approval) => ({ kind: "approval" as const, id: approval.id, path: approval.decisionTarget ?? approval.title })),
    ];
    if (arrivals.length === 0) {
      return;
    }

    const remainingBudget = Math.max(0, MAX_AUTO_APPLY_PROPOSALS_PER_TURN - pendingTurn.autoApplyProposalCount);
    const autoApplyCount = Math.min(remainingBudget, arrivals.length);
    if (arrivals.length > remainingBudget && !pendingTurn.autoApplyGuardNotified) {
      pendingTurn.autoApplyGuardNotified = true;
      const message = this.getLocalizedCopy().service.autoApplyReviewFallback(MAX_AUTO_APPLY_PROPOSALS_PER_TURN);
      this.store.addMessage(tabId, {
        id: makeId("auto-apply-guard"),
        kind: "system",
        text: message,
        createdAt: Date.now(),
      });
      new Notice(message);
    }

    pendingTurn.autoApplyProposalCount += autoApplyCount;
    for (const item of arrivals.slice(0, autoApplyCount)) {
      try {
        if (item.kind === "patch") {
          await this.approvalCoordinator.applyPatchProposal(tabId, item.id);
        } else {
          await this.approvalCoordinator.respondToApproval(item.id, "approve");
        }
      } catch (error) {
        if (error instanceof PatchConflictError) {
          this.store.addMessage(tabId, {
            id: makeId("patch-review-needed"),
            kind: "system",
            text: this.getLocalizedCopy().service.patchNeedsReview(error.details.targetPath),
            createdAt: Date.now(),
          });
          continue;
        }
        if (error instanceof PatchReadabilityError) {
          this.store.addMessage(tabId, {
            id: makeId("patch-readability-review-needed"),
            kind: "system",
            text: error.message,
            createdAt: Date.now(),
          });
          continue;
        }
        throw error;
      }
    }
  }

  private maybeStorePlanExecutionSuggestion(
    tabId: string,
    messageId: string,
    plan: ReturnType<typeof extractAssistantProposals>["plan"],
  ): void {
    const tab = this.findTab(tabId);
    if (!tab || tab.composeMode !== "plan" || !plan) {
      return;
    }
    this.store.setChatSuggestion(tabId, {
      id: makeId("chat-suggestion"),
      kind: "plan_execute",
      status: "pending",
      messageId,
      panelId: null,
      panelTitle: null,
      promptSnapshot: "",
      matchedSkillName: null,
      canUpdatePanel: false,
      canSaveCopy: false,
      planSummary: plan.summary,
      planStatus: plan.status,
      createdAt: Date.now(),
    });
  }

  private maybeStoreStudyCheckpoint(tabId: string, parsed: ParsedAssistantProposalResult): void {
    const tab = this.findTab(tabId);
    if (!tab || !tab.learningMode || !parsed.studyCheckpoint) {
      return;
    }
    this.store.setStudyCoachState(tabId, this.mergeStudyCheckpointIntoCoachState(tab, parsed.studyCheckpoint));
  }

  private mergeStudyCheckpointIntoCoachState(
    tab: ConversationTabState,
    checkpoint: NonNullable<ParsedAssistantProposalResult["studyCheckpoint"]>,
  ): ConversationTabState["studyCoachState"] {
    const now = Date.now();
    const previous = tab.studyCoachState ?? {
      latestRecap: null,
      weakPointLedger: [],
      lastCheckpointAt: null,
    };
    const ledger = previous.weakPointLedger.map((entry) => ({ ...entry }));
    const findWeakPointIndex = (label: string): number =>
      ledger.findIndex((entry) => entry.conceptLabel.trim().toLowerCase() === label.trim().toLowerCase());

    for (const unclear of checkpoint.unclear) {
      const conceptLabel = unclear.trim();
      if (!conceptLabel) {
        continue;
      }
      const nextEntry = {
        conceptLabel,
        workflow: checkpoint.workflow,
        updatedAt: now,
        explanationSummary: checkpoint.confidenceNote,
        nextQuestion: checkpoint.nextStep,
        resolved: false,
      };
      const existingIndex = findWeakPointIndex(conceptLabel);
      if (existingIndex >= 0) {
        ledger[existingIndex] = nextEntry;
      } else {
        ledger.push(nextEntry);
      }
    }

    for (const mastered of checkpoint.mastered) {
      const conceptLabel = mastered.trim();
      if (!conceptLabel) {
        continue;
      }
      const existingIndex = findWeakPointIndex(conceptLabel);
      if (existingIndex >= 0) {
        ledger[existingIndex] = {
          ...ledger[existingIndex],
          workflow: checkpoint.workflow,
          updatedAt: now,
          explanationSummary: checkpoint.confidenceNote,
          nextQuestion: checkpoint.nextStep,
          resolved: true,
        };
      }
    }

    ledger.sort((left, right) => Number(left.resolved) - Number(right.resolved) || right.updatedAt - left.updatedAt);

    return {
      latestRecap: {
        workflow: checkpoint.workflow,
        mastered: [...checkpoint.mastered],
        unclear: [...checkpoint.unclear],
        nextStep: checkpoint.nextStep,
        confidenceNote: checkpoint.confidenceNote,
      },
      weakPointLedger: ledger,
      lastCheckpointAt: now,
    };
  }

  private maybeStoreRewriteSuggestion(
    tabId: string,
    messageId: string,
    parsed: ParsedAssistantProposalResult,
    patchBasket: readonly PatchProposal[],
    approvals: readonly PendingApproval[],
    visibility: AssistantOutputVisibility = "visible",
  ): void {
    const tab = this.findTab(tabId);
    if (!tab || tab.composeMode === "plan" || visibility === "artifact_only") {
      return;
    }
    if (patchBasket.length > 0 || approvals.length > 0 || parsed.plan || !parsed.suggestion) {
      return;
    }
    this.setRewriteFollowupSuggestion(tabId, messageId, parsed.suggestion.summary, parsed.suggestion.question);
  }

  private trackAssistantArtifactMessage(tabId: string, messageId: string): void {
    const tracked = this.assistantArtifactMessageIds.get(tabId) ?? new Set<string>();
    tracked.add(messageId);
    this.assistantArtifactMessageIds.set(tabId, tracked);
  }

  private clearAssistantArtifactTracking(tabId: string): void {
    this.assistantArtifactMessageIds.delete(tabId);
    for (const key of [...this.assistantArtifactSyncs.keys()]) {
      if (key.startsWith(`${tabId}:`)) {
        this.assistantArtifactSyncs.delete(key);
      }
    }
  }

  private queueAssistantArtifactSync(
    tabId: string,
    messageId: string,
    text: string,
    visibility: AssistantOutputVisibility = "visible",
  ): void {
    this.trackAssistantArtifactMessage(tabId, messageId);
    const key = `${tabId}:${messageId}`;
    if (this.assistantArtifactSyncs.has(key)) {
      return;
    }
    const promise = this.syncAssistantArtifacts(tabId, messageId, text, visibility)
      .catch((error) => {
        if (/```obsidian-(?:patch|ops)\b/.test(text)) {
          this.recordAssistantEditOutcome(tabId, messageId, {
            outcome: "failed",
            targetPath: this.extractFirstProposalTargetPath(text),
          }, visibility);
        }
        if (visibility === "visible") {
          this.store.addMessage(tabId, {
            id: makeId("proposal-error"),
            kind: "system",
            text: this.getLocalizedCopy().service.proposalProcessingFailed(getErrorMessage(error)),
            createdAt: Date.now(),
          });
        }
      })
      .finally(() => {
        this.assistantArtifactSyncs.delete(key);
      });
    this.assistantArtifactSyncs.set(key, promise);
  }

  private async buildPatchProposalFromParsed(
    tabId: string,
    messageId: string,
    patch: ParsedAssistantPatch,
    index: number,
    originTurnId: string | null,
  ): Promise<PatchProposal | null> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }

    const rawTargetPath = patch.targetPath.trim();
    if (!rawTargetPath) {
      return null;
    }
    const validatedTargetPath = validateManagedNotePath(this.app, rawTargetPath);
    if (!validatedTargetPath.ok) {
      this.store.addMessage(tabId, {
        id: makeId("unsafe-patch-path"),
        kind: "system",
        text: this.getLocalizedCopy().service.unsafeNotePathBlocked(rawTargetPath),
        createdAt: Date.now(),
      });
      return null;
    }
    const targetPath = validatedTargetPath.normalizedPath;

    const id = buildPatchProposalId(messageId, patch.sourceIndex, index);
    const existing = tab.patchBasket.find((entry) => entry.id === id) ?? null;
    const abstractFile = this.app.vault.getAbstractFileByPath(targetPath);
    const file = abstractFile instanceof TFile ? abstractFile : null;
    const baseSnapshot = file ? await this.app.vault.cachedRead(file) : null;
    const kind = patch.kind === "create" || !file ? "create" : "update";
    let proposedText = normalizeProposalText(patch.proposedText);
    const anchors = patch.anchors && patch.anchors.length > 0 ? patch.anchors : undefined;
    if (anchors && kind === "update" && baseSnapshot !== null) {
      const result = applyAnchorReplacements(baseSnapshot, anchors);
      if (result.ok) {
        proposedText = normalizeProposalText(result.text);
      } else {
        console.warn("[obsidian-codex-study] anchor patch failed at parse time; will retry at apply", {
          targetPath,
          failure: result.failure,
          hasProposedText: Boolean(patch.proposedText.trim()),
        });
        if (!proposedText.trim()) {
          proposedText = normalizeProposalText(baseSnapshot);
        }
      }
    }
    if (!anchors && kind === "update" && baseSnapshot !== null && proposedText) {
      const baseLength = baseSnapshot.length;
      if (baseLength > 2_000 && proposedText.length < baseLength * 0.5) {
        console.warn("[obsidian-codex-study] rejecting proposal: suspected truncation", {
          targetPath,
          baseLength,
          proposedLength: proposedText.length,
        });
        return null;
      }
    }
    const readability = assessPatchReadability(proposedText);
    return {
      anchors,
      id,
      threadId: tab.codexThreadId ?? null,
      sourceMessageId: messageId,
      originTurnId,
      targetPath: file?.path ?? targetPath,
      kind,
      baseSnapshot,
      proposedText: readability.text,
      unifiedDiff: buildUnifiedDiff(file?.path ?? targetPath, baseSnapshot, readability.text),
      summary: patch.summary || `${kind === "create" ? "Create" : "Update"} ${basename(targetPath)}`,
      status: existing?.status ?? "pending",
      createdAt: existing?.createdAt ?? Date.now(),
      qualityState: readability.qualityState,
      qualityIssues: readability.qualityIssues.map((issue) => ({ ...issue })),
      healedByPlugin: readability.healedByPlugin,
      evidence: patch.evidence ? patch.evidence.map((entry) => ({ ...entry })) : existing?.evidence,
    };
  }

  private getMissingLoginMessage(): string {
    return this.getLocale() === "ja"
      ? `Codex login が ${CODEX_AUTH_PATH} に見つかりません。このマシンで codex login を実行してください。`
      : `Codex login not found at ${CODEX_AUTH_PATH}. Run codex login on this machine.`;
  }

  private updateAccountUsageFromPatch(
    limits: Partial<AccountUsageSummary["limits"]> | null,
    threadId: string | null,
    source: AccountUsageSummary["source"],
    updatedAt: number,
    checkedAt = updatedAt,
  ): void {
    this.usageSync.noteLiveUsage(threadId);
    if (!limits || Object.keys(limits).length === 0) {
      return;
    }

    const current = normalizeAccountUsageSummary(this.store.getState().accountUsage ?? createEmptyAccountUsageSummary());
    const candidate = mergeAccountUsageSummary(current, {
      limits,
      source,
      updatedAt,
      lastObservedAt: updatedAt,
      lastCheckedAt: checkedAt,
      threadId,
    });
    if (!shouldPreferAccountUsageSummary(current, candidate) && hasAccountUsageSummaryData(current)) {
      return;
    }

    this.store.setAccountUsage(candidate);
  }

  private updateAccountUsageFromSummary(
    summary: ReturnType<typeof createEmptyUsageSummary>,
    threadId: string | null,
    source: AccountUsageSummary["source"],
    updatedAt: number,
    checkedAt = updatedAt,
  ): void {
    this.updateAccountUsageFromPatch(summary.limits, threadId, source, updatedAt, checkedAt);
  }

  private resolveSelectedModel(tabId: string): string {
    const selected = this.findTab(tabId)?.model?.trim();
    if (selected) {
      return coerceModelForPicker(this.getAvailableModels(), selected);
    }
    const settings = this.settingsProvider();
    const preferredModel = settings.codex.model.trim() || settings.defaultModel.trim() || DEFAULT_MODEL;
    return coerceModelForPicker(
      this.getAvailableModels(),
      this.resolvePreferredDefaultModel(preferredModel),
    );
  }

  private resolveRuntimeCompatibleModel(model: string, runtime: CodexRuntime): string {
    const metadata =
      runtime === this.settingsProvider().codex.runtime
        ? this.runtimeMetadata
        : {
            cliVersion: null,
            modelCacheClientVersion: null,
          };
    const allowPrimaryModel = isModelRuntimeCompatible(model, {
      cliVersion: metadata.cliVersion,
      modelCacheClientVersion: metadata.modelCacheClientVersion,
    });
    return coerceModelForRuntime(this.getAvailableModels(), model, { allowPrimaryModel });
  }

  private resolveSelectedReasoningEffort(tabId: string, model: string): ReasoningEffort {
    const tab = this.findTab(tabId);
    const desired = tab?.reasoningEffort ?? this.settingsProvider().defaultReasoningEffort;
    return resolveReasoningEffortForModel(this.getAvailableModels(), model, desired);
  }

  private async refreshModelCatalog(): Promise<void> {
    try {
      const raw =
        this.settingsProvider().codex.runtime === "wsl"
          ? await this.readWslCodexHomeFile("models_cache.json")
          : await fs.readFile(join(CODEX_HOME, "models_cache.json"), "utf8");
      this.runtimeMetadata = {
        ...this.runtimeMetadata,
        modelCacheClientVersion: extractModelCacheClientVersion(raw),
        modelCatalogSource: this.settingsProvider().codex.runtime === "wsl" ? "wsl" : "native",
      };
      this.store.setAvailableModels(parseModelCatalog(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || this.settingsProvider().codex.runtime === "wsl") {
        this.runtimeMetadata = {
          ...this.runtimeMetadata,
          modelCacheClientVersion: null,
          modelCatalogSource: "fallback",
        };
        this.store.setAvailableModels(getFallbackModelCatalog());
      } else {
        throw error;
      }
    }
    this.normalizeTabModels();
  }

  private async readWslCodexHomeFile(relativePath: string): Promise<string> {
    const safeRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!safeRelativePath || safeRelativePath.includes("..")) {
      throw new Error("Invalid WSL Codex home path.");
    }
    return await new Promise<string>((resolve, reject) => {
      const child = spawn("wsl.exe", ["-e", "bash", "-lc", `cat "$HOME/.codex/${safeRelativePath}"`], {
        env: this.resolveProcessEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        const error = new Error(stderr.trim() || `WSL Codex home read exited with code ${code ?? "unknown"}.`) as NodeJS.ErrnoException;
        if (/No such file or directory/i.test(error.message)) {
          error.code = "ENOENT";
        }
        reject(error);
      });
    });
  }

  private async refreshCodexCatalogs(): Promise<void> {
    const vaultRoot = this.resolveVaultRoot();
    this.customPromptCatalog = await loadCodexPromptCatalog([
      join(vaultRoot, ".codex", "prompts"),
      ...(this.settingsProvider().securityPolicy.inheritGlobalCodexHomeAssets ? [join(CODEX_HOME, "prompts")] : []),
    ]);
    await this.refreshInstalledSkillCatalog(vaultRoot);
  }

  private async refreshInstalledSkillCatalog(vaultRoot = this.resolveVaultRoot()): Promise<void> {
    const loadedCatalog = await loadInstalledSkillCatalog(this.resolveSkillRoots(vaultRoot));
    this.allInstalledSkillCatalog = loadedCatalog.map((skill) => ({ ...skill }));
    const disabled = new Set(
      this.settingsProvider()
        .pluginOverrides.filter((entry) => entry.enabled === false)
        .map((entry) => entry.key.trim())
        .filter(Boolean),
    );
    this.installedSkillCatalog = loadedCatalog.filter((skill) => !disabled.has(skill.name));
  }

  private resolveSkillRoots(vaultRoot: string): string[] {
    const settings = this.settingsProvider();
    return normalizeConfiguredSkillRoots([
      join(vaultRoot, ".codex", "skills"),
      ...(settings.securityPolicy.inheritGlobalCodexHomeAssets
        ? [DEFAULT_SKILL_ROOT, DEFAULT_AGENT_SKILL_ROOT, ...getDefaultWslBridgeSkillRoots(), DEFAULT_PLUGIN_CACHE_SKILL_ROOT]
        : []),
      ...settings.extraSkillRoots,
    ]);
  }

  private resolveProcessEnv(extraEntries: readonly string[] = []): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...parseEnvironmentEntries([...this.settingsProvider().customEnv, ...extraEntries]),
    };
  }

  private getFallbackReasoningEffort(
    model: string,
    message: string,
    currentEffort: ReasoningEffort | null,
  ): ReasoningEffort | null {
    if (!isUnsupportedReasoningEffortError(message)) {
      return null;
    }

    const supportedEfforts = extractSupportedReasoningEfforts(message);
    const fallback = chooseHighestReasoningEffort(supportedEfforts);
    if (!fallback) {
      return getCompatibleReasoningEffort(model, currentEffort);
    }
    return fallback === currentEffort ? null : fallback;
  }

  private collectTurnSourcePathHints(sourcePathHints: readonly string[], attachments: readonly ComposerAttachment[]): string[] {
    const hints = new Set(sourcePathHints.map((value) => value.trim()).filter(Boolean));
    for (const attachment of attachments) {
      const candidate = attachment.originalPath?.trim();
      if (candidate) {
        hints.add(candidate);
      }
    }
    return [...hints];
  }

  private getConfiguredCommandText(): string {
    const runtime = this.settingsProvider().codex.runtime;
    const configuredExecutablePath = this.settingsProvider().codex.executablePath.trim();
    if (runtime === "wsl") {
      const executablePath = sanitizeCodexExecutablePath(configuredExecutablePath);
      return `wsl.exe -e ${executablePath}`;
    }
    return configuredExecutablePath;
  }

  private createWslFallbackLauncher(): ResolvedTurnCodexLauncher {
    return {
      runtime: "wsl",
      executablePath: DEFAULT_CODEX_EXECUTABLE,
      launcherOverrideParts: [...DEFAULT_WSL_FALLBACK_LAUNCHER_PARTS],
    };
  }

  private resolveTurnCodexLauncher(options: {
    defaultWorkingDirectory: string;
    workingDirectoryHint: string | null;
    sourcePathHints: readonly string[];
  }): ResolvedTurnCodexLauncher {
    const launcher = this.resolveConfiguredCodexLauncher();
    if (
      shouldPreferWslForTurn({
        platform: process.platform,
        configuredCommand: this.getConfiguredCommandText(),
        currentCommand: this.describeCodexLauncher(launcher),
        workingDirectory: options.workingDirectoryHint ?? options.defaultWorkingDirectory,
        sourcePathHints: options.sourcePathHints,
      })
    ) {
      return this.createWslFallbackLauncher();
    }
    return launcher;
  }

  private resolveConfiguredCodexLauncher(): ResolvedTurnCodexLauncher {
    const runtime = this.settingsProvider().codex.runtime;
    const configuredExecutablePath = sanitizeCodexExecutablePath(this.settingsProvider().codex.executablePath);
    const safeExecutablePath = isUnsafeCodexExecutablePath(configuredExecutablePath)
      ? DEFAULT_CODEX_EXECUTABLE
      : configuredExecutablePath;
    if (runtime !== "native" || safeExecutablePath !== DEFAULT_CODEX_EXECUTABLE) {
      return {
        runtime,
        executablePath: safeExecutablePath,
      };
    }

    if (this.preferredNativeLauncher) {
      return {
        runtime,
        executablePath: this.preferredNativeLauncher.executablePath,
        cliVersion: this.preferredNativeLauncher.cliVersion,
      };
    }

    for (const candidate of this.getCodexCommandCandidates()) {
      if (candidate === DEFAULT_CODEX_EXECUTABLE || existsSync(candidate)) {
        return {
          runtime,
          executablePath: candidate,
        };
      }
    }

    return {
      runtime,
      executablePath: safeExecutablePath,
    };
  }

  private createWslFallbackRequest(request: CodexRunRequest): CodexRunRequest {
    return {
      ...request,
      runtime: "wsl",
      executablePath: DEFAULT_CODEX_EXECUTABLE,
      launcherOverrideParts: [...DEFAULT_WSL_FALLBACK_LAUNCHER_PARTS],
    };
  }

  private describeCodexLauncher(launcher = this.resolveConfiguredCodexLauncher()): string {
    if (launcher.launcherOverrideParts?.length) {
      return launcher.launcherOverrideParts.join(" ");
    }
    if (launcher.runtime === "wsl") {
      return `wsl.exe -e ${launcher.executablePath}`;
    }
    return launcher.executablePath;
  }

  private resolveTurnWorkingDirectory(
    defaultWorkingDirectory: string,
    workingDirectoryHint: string | null,
    runtime: CodexRuntime,
  ): string {
    if (!workingDirectoryHint) {
      return defaultWorkingDirectory;
    }

    if (!isWslPathLike(workingDirectoryHint)) {
      return workingDirectoryHint;
    }

    return runtime === "wsl" ? workingDirectoryHint : defaultWorkingDirectory;
  }

  private getCodexCommandCandidates(): string[] {
    const binary = process.platform === "win32" ? "codex.exe" : "codex";
    const wrapper = process.platform === "win32" ? "codex.cmd" : "codex";
    const candidates = [
      join(CODEX_HOME, ".sandbox-bin", binary),
      join(homedir(), "AppData", "Roaming", "npm", wrapper),
      join(homedir(), ".local", "bin", binary),
      join(homedir(), "bin", binary),
      "/usr/local/bin/codex",
      "/usr/bin/codex",
      DEFAULT_CODEX_EXECUTABLE,
    ];
    return [...new Set(candidates)];
  }

  private async refreshRuntimeHealth(): Promise<void> {
    const hasLogin = this.hasAuthEvidence();
    this.store.setAuthState(hasLogin);
    this.preferredNativeLauncher = null;
    if (
      this.settingsProvider().codex.runtime === "native" &&
      sanitizeCodexExecutablePath(this.settingsProvider().codex.executablePath) === DEFAULT_CODEX_EXECUTABLE
    ) {
      this.preferredNativeLauncher = await this.resolveBestNativeCodexLauncher();
    }
    const cliIssue = await this.probeCodexCliIssue();
    this.store.setRuntimeIssue(cliIssue ?? (hasLogin ? null : this.getMissingLoginMessage()));
  }

  private async resolveBestNativeCodexLauncher(): Promise<(ResolvedTurnCodexLauncher & { cliVersion: string | null }) | null> {
    let best: (ResolvedTurnCodexLauncher & { cliVersion: string | null }) | null = null;
    for (const candidate of this.getCodexCommandCandidates()) {
      if (candidate !== DEFAULT_CODEX_EXECUTABLE && !existsSync(candidate)) {
        continue;
      }
      try {
        const probe = await this.runCodexVersionProbe("native", candidate);
        if (!best || compareCodexVersions(probe.cliVersion, best.cliVersion) > 0) {
          best = {
            runtime: "native",
            executablePath: candidate,
            cliVersion: probe.cliVersion,
          };
        }
      } catch {
        // Keep probing other candidates. A PATH entry can exist but be inaccessible from Obsidian.
      }
    }
    return best;
  }

  private buildVersionProbeSpawnSpec(
    runtime: CodexRuntime,
    executablePath: string,
  ): { command: string; args: string[]; cwd?: string } {
    const normalizedExecutablePath = sanitizeCodexExecutablePath(executablePath);
    if (runtime === "wsl") {
      return {
        command: "wsl.exe",
        args: ["-e", normalizedExecutablePath, "--version"],
      };
    }

    return {
      command: normalizedExecutablePath,
      args: ["--version"],
      cwd: this.resolveVaultRoot(),
    };
  }

  private async runCodexVersionProbe(runtime: CodexRuntime, executablePath: string): Promise<CodexVersionProbeResult> {
    const spec = this.buildVersionProbeSpawnSpec(runtime, executablePath);
    return await new Promise<CodexVersionProbeResult>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: this.resolveProcessEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          child.kill();
        } catch {
          // Best-effort timeout cleanup.
        }
        reject(new Error("Timed out while probing `codex --version`."));
      }, 5000);
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (code === 0) {
          resolve({
            stdout,
            stderr,
            cliVersion: parseCodexCliVersion(`${stdout}\n${stderr}`),
          });
          return;
        }
        reject(new Error(stderr.trim() || stdout.trim() || `Codex version probe exited with code ${code ?? "unknown"}.`));
      });
    });
  }

  private async probeCodexCliIssue(): Promise<string | null> {
    const launcher = this.resolveConfiguredCodexLauncher();
    const resolvedCommand = this.describeCodexLauncher(launcher);
    try {
      const probe = await this.runCodexVersionProbe(launcher.runtime, launcher.executablePath);
      this.runtimeMetadata = {
        ...this.runtimeMetadata,
        resolvedCommand,
        cliVersion: probe.cliVersion,
      };
      const configuredModel = coerceModelForPicker(this.getAvailableModels(), this.settingsProvider().codex.model);
      if (
        configuredModel === DEFAULT_MODEL &&
        !isModelRuntimeCompatible(configuredModel, {
          cliVersion: probe.cliVersion,
          modelCacheClientVersion: this.runtimeMetadata.modelCacheClientVersion,
        })
      ) {
        return this.buildCodexModelCompatibilityMessage(configuredModel, coerceModelForRuntime(this.getAvailableModels(), configuredModel, {
          allowPrimaryModel: false,
        }));
      }
      return null;
    } catch (error) {
      const detail = getErrorMessage(error);
      this.runtimeMetadata = {
        ...this.runtimeMetadata,
        resolvedCommand,
        cliVersion: null,
      };
      const lines =
        this.getLocale() === "ja"
          ? [
              "Codex CLI が見つからないか起動できません。",
              `Resolved command: ${resolvedCommand}`,
              ...this.getPlatformCodexInstallHintLines("ja"),
              detail ? `Detail: ${detail}` : null,
            ]
          : [
              "Codex CLI was not found or could not be started.",
              `Resolved command: ${resolvedCommand}`,
              ...this.getPlatformCodexInstallHintLines("en"),
              detail ? `Detail: ${detail}` : null,
            ];
      return lines.filter((line): line is string => Boolean(line)).join("\n");
    }
  }

  private buildCodexModelCompatibilityMessage(model: string, fallbackModel: string): string {
    const command = this.runtimeMetadata.resolvedCommand ?? this.describeCodexLauncher();
    const version = this.runtimeMetadata.cliVersion ?? "unknown";
    const cacheVersion = this.runtimeMetadata.modelCacheClientVersion ?? "unknown";
    const lines =
      this.getLocale() === "ja"
        ? [
            `${model} を使うには、実行中の Codex が古すぎます。`,
            `Fallback model: ${fallbackModel}`,
            `Resolved command: ${command}`,
            `Codex CLI version: ${version}`,
            `Model cache client version: ${cacheVersion}`,
            "Codex app/CLI を最新版に更新するか、plugin 設定の Codex executable path を新しい Codex 実行ファイルへ向けてください。",
          ]
        : [
            `${model} requires a newer Codex runtime than the one this plugin is launching.`,
            `Fallback model: ${fallbackModel}`,
            `Resolved command: ${command}`,
            `Codex CLI version: ${version}`,
            `Model cache client version: ${cacheVersion}`,
            'Update the Codex app/CLI or set "Codex executable path" to a newer Codex executable in plugin settings.',
          ];
    return lines.join("\n");
  }

  private getPlatformCodexInstallHintLines(locale: SupportedLocale): string[] {
    if (process.platform === "win32") {
      return locale === "ja"
        ? [
            "Windows では native の Codex install（`codex` / `codex.cmd` / `codex.exe`）を優先してください。",
            "確認には `where codex` を使ってください。WSL は fallback と WSL-native path 用の補助経路です。",
            "Codex CLI は https://github.com/openai/codex からインストールし、このマシンで `codex login` を実行してください。",
          ]
        : [
            "On Windows, prefer a native Codex install (`codex`, `codex.cmd`, or `codex.exe`).",
            "Verify it with `where codex`. WSL is only an optional fallback and helper path for WSL-native source paths.",
            "Install the Codex CLI from https://github.com/openai/codex and run `codex login` on this machine.",
          ];
    }
    return locale === "ja"
      ? [
          "Codex CLI は https://github.com/openai/codex からインストールし、このマシンで `codex login` を実行してください。",
          "確認には `which codex` を使ってください。",
        ]
      : [
          "Install the Codex CLI from https://github.com/openai/codex and run `codex login` on this machine.",
          "Verify it with `which codex`.",
        ];
  }

  private normalizeCodexError(message: string): string {
    const launcher = this.resolveConfiguredCodexLauncher();
    const resolvedCommand = this.describeCodexLauncher(launcher);
    const apiError = extractApiErrorDetails(message);
    if (apiError?.param === "reasoning.effort") {
      return apiError.message;
    }
    if (isCodexUpgradeRequiredError(message)) {
      const modelMatch = message.match(/'([^']+)' model/i);
      const model = modelMatch?.[1] ?? (this.settingsProvider().codex.model.trim() || DEFAULT_MODEL);
      const fallbackModel = coerceModelForRuntime(this.getAvailableModels(), model, { allowPrimaryModel: false });
      return this.buildCodexModelCompatibilityMessage(model, fallbackModel);
    }
    if (/Access is denied|Permission denied|EACCES/i.test(message)) {
      return this.getLocale() === "ja"
        ? [
            "Codex 実行ファイルを起動できませんでした。権限または WindowsApps の実行制限により拒否されています。",
            `Resolved command: ${resolvedCommand}`,
            "plugin 設定の Codex executable path を、PowerShell/Obsidian から直接実行できる Codex CLI に向けてください。",
            message.trim(),
          ].join("\n")
        : [
            "Codex executable could not be started because the OS denied access.",
            `Resolved command: ${resolvedCommand}`,
            'Set "Codex executable path" to a Codex CLI executable that PowerShell/Obsidian can run directly.',
            message.trim(),
          ].join("\n");
    }
    if (isWslCodexMissingError(message)) {
      return this.getLocale() === "ja"
        ? [
            "設定された WSL runtime 内で Codex 実行ファイルを見つけられませんでした。",
            `Resolved command: ${resolvedCommand}`,
            "WSL 側で `codex` が PATH に載るようにするか、Codex executable path を正しい WSL 実行ファイルへ設定してください。",
          ].join("\n")
        : [
            "The configured WSL runtime could not find the Codex executable.",
            `Resolved command: ${resolvedCommand}`,
            'Ensure `codex` is on the WSL PATH or set "Codex executable path" to the correct WSL executable.',
          ].join("\n");
    }
    if (/windows sandbox.*spawn setup refresh|sandbox bootstrap/i.test(message)) {
      return this.getLocale() === "ja"
        ? [
            "Windows sandbox の初期化に失敗しました。",
            "既定の launcher を使っている場合は、native Windows 側の `where codex` と WSL 側の `wsl which codex` の両方を確認してください。",
            "custom runtime / executable を使っている場合は、その設定値を確認してから再試行してください。",
          ].join("\n")
        : [
            "Windows sandbox bootstrap failed before Codex could start.",
            "If you use the default launcher, verify both the native Windows install with `where codex` and the WSL install with `wsl which codex`.",
            'If you use custom settings, verify the selected "Codex runtime" and "Codex executable path", then retry.',
          ].join("\n");
    }
    if (isUnsupportedJsonFlagError(message, "--json")) {
      return this.getLocale() === "ja"
        ? "この Codex install は plugin が必要とする JSON event stream をサポートしていません。"
        : "This Codex installation does not support the JSON event stream required by the plugin.";
    }
    if (/ENOENT|spawn .*codex/i.test(message)) {
      const lines =
        this.getLocale() === "ja"
          ? [
              "Codex 実行ファイルが見つかりません。",
              `Resolved command: ${resolvedCommand}`,
              "Obsidian から Codex install が見えない場合は、plugin 設定で Codex executable path を指定してください。",
              ...this.getPlatformCodexInstallHintLines("ja").slice(0, 2),
            ]
          : [
              "Codex executable not found.",
              `Resolved command: ${resolvedCommand}`,
              'Set "Codex executable path" in plugin settings if Obsidian cannot see your Codex install.',
              ...this.getPlatformCodexInstallHintLines("en").slice(0, 2),
            ];
      return lines.join("\n");
    }
    return message.trim() || (this.getLocale() === "ja" ? "不明な Codex エラーです。" : "Unknown Codex error.");
  }

  commitHubPanelSkillSelection(tabId: string, panelId: string, skillNames: readonly string[]): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const nextSkillNames = [...new Set(skillNames.map((entry) => entry.trim()).filter(Boolean))];
    this.store.setActiveStudyPanel(tabId, panelId, nextSkillNames);
    const nextTab = this.findTab(tabId);
    if (nextTab?.panelSessionOrigin?.panelId === panelId) {
      this.store.setPanelSessionOrigin(tabId, {
        ...nextTab.panelSessionOrigin,
        selectedSkillNames: [...(nextTab.activeStudySkillNames ?? [])],
      });
    }
  }

  private buildPaperStudyExtractionFailureMessage(fileNames: readonly string[]): string {
    const names = fileNames.join(", ");
    if (this.getLocale() === "ja") {
      return [
        "この PDF は本文抽出に失敗したため、paper/deep-read 系の読み込みを開始できません。",
        names ? `対象: ${names}` : null,
        "再添付するか、抽出可能な PDF を使ってください。",
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }
    return [
      "This PDF could not be text-extracted, so the paper/deep-read flow cannot start.",
      names ? `Affected file(s): ${names}` : null,
      "Re-attach the file or use a PDF with extractable text.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  private buildPaperStudyAttachmentFailureMessage(params: {
    missingSourceNames: readonly string[];
    missingPdfTextNames: readonly string[];
  }): string {
    const { missingSourceNames, missingPdfTextNames } = params;
    if (missingSourceNames.length > 0) {
      const names = missingSourceNames.join(", ");
      if (this.getLocale() === "ja") {
        return [
          "この PDF の添付元ファイルが見つからないため、paper/deep-read 系の読み込みを開始できません。",
          names ? `対象: ${names}` : null,
          "PDF を一度外して、もう一度添付してください。",
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n");
      }
      return [
        "The raw source file for this PDF attachment is unavailable, so the paper/deep-read flow cannot start.",
        names ? `Affected file(s): ${names}` : null,
        "Remove the attachment and attach the PDF again.",
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    return this.buildPaperStudyExtractionFailureMessage(missingPdfTextNames);
  }

  private hasAuthEvidence(): boolean {
    return existsSync(CODEX_AUTH_PATH);
  }

  private hasCodexLogin(): boolean {
    return this.hasAuthEvidence();
  }

  private isLoginError(message: string): boolean {
    return !this.hasCodexLogin() || /log in|login|authenticate|authentication|not logged in/i.test(message);
  }

  private async captureTurnContext(
    tabId: string,
    file: TFile | null,
    _editor: Editor | null,
    prompt: string,
    slashCommand: string | null,
    attachments: readonly ComposerAttachment[],
    mentionContextText: string | null,
    explicitTargetNotePath: string | null,
    skillNames: readonly string[],
    resolvedSkillDefinitions: readonly InstalledSkillDefinition[],
  ): Promise<TurnContextSnapshot> {
    const dailyNoteFile = await this.findDailyNoteFile();
    const dailyNotePath = dailyNoteFile?.path ?? null;
    const tab = this.findTab(tabId);
    const selectionContext = slashCommand === "/selection" ? null : tab?.selectionContext ?? null;
    const selection = selectionContext?.text ?? null;
    const targetNotePath = resolveEditTarget({
      explicitTargetPath: explicitTargetNotePath,
      selectionSourcePath: selectionContext?.sourcePath ?? null,
      activeFilePath: file?.path ?? null,
      sessionTargetPath: this.resolveTargetNotePath(tabId),
    }).path;
    const studyWorkflow = tab?.studyWorkflow ?? null;
    const activePanelId = tab?.activeStudyRecipeId ?? this.getActivePanelId(tabId);
    const workflowContext = this.buildWorkflowPromptContext(tabId, studyWorkflow, file?.path ?? null);
    const pluginFeatureText = buildPluginFeatureGuideText({
      prompt,
      locale: this.getLocale(),
      copy: this.getLocalizedCopy(),
      panels: this.getHubPanels(),
      activePanelId,
      isCollapsed: this.getStudyHubState().isCollapsed,
      targetNotePath,
    });
    const excludedContextPaths = [
      slashCommand === "/note" ? file?.path ?? null : null,
      slashCommand === "/daily" ? dailyNotePath : null,
    ].filter((entry): entry is string => Boolean(entry));
    const contextPackText = await this.captureContextPackText(tabId, excludedContextPaths);
    const noteSourcePackText = await this.captureVaultNoteSourcePackText(
      file,
      targetNotePath,
      selectionContext?.sourcePath ?? file?.path ?? null,
      prompt,
    );
    const attachmentManifestText = buildAttachmentPromptManifest(attachments);
    const paperStudyTurn = shouldAttachPaperStudyGuide({
      locale: this.getLocale(),
      studyWorkflow,
      skillNames,
      attachmentKinds: attachments.map((attachment) => attachment.kind),
    });
    const attachmentContentPack = await buildAttachmentContentPackResult(this.resolveVaultRoot(), attachments, paperStudyTurn
      ? {
          maxChars: PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS,
          maxCharsPerFile: PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS_PER_FILE,
        }
      : undefined);
    const attachmentContentText = attachmentContentPack.text;
    const studyCoachText = this.buildStudyCoachCarryForwardText(tab);
    const conversationSummaryText =
      tab?.lineage.pendingThreadReset && tab.summary?.text.trim()
        ? ["Conversation carry-forward summary", tab.summary.text.trim()].join("\n\n")
        : null;
    const sourceAcquisitionMode: SourceAcquisitionMode = attachmentContentText
      ? "paper_attachment"
      : noteSourcePackText
        ? "vault_note"
        : mentionContextText?.includes("Mentioned external directory") || mentionContextText?.includes("Mentioned external directory (provenance)")
          ? "external_bundle"
          : "workspace_generic";
    const sourceAcquisitionContractText = buildSourceAcquisitionContractText({
      locale: this.getLocale(),
      mode: sourceAcquisitionMode,
      hasSourcePackage: Boolean(attachmentContentText || noteSourcePackText),
    });
    const paperStudyRuntimeOverlayText = buildPaperStudyRuntimeOverlayText({
      locale: this.getLocale(),
      studyWorkflow,
      skillNames,
      hasAttachmentContent: Boolean(attachmentContentText),
    });
    const skillGuideText = await buildRequestedSkillGuideText(skillNames, resolvedSkillDefinitions, {
      paperStudyAttachmentTurn: Boolean(attachmentContentText) && paperStudyTurn,
    });
    const paperStudyGuideText = buildPaperStudyGuideText({
      locale: this.getLocale(),
      studyWorkflow,
      skillNames,
      attachmentKinds: attachments.map((attachment) => attachment.kind),
    });
    const userAdaptationText = buildUserAdaptationMemoryText(this.store.getState().userAdaptationMemory ?? null, activePanelId);
    return {
      activeFilePath: file?.path ?? null,
      targetNotePath,
      studyWorkflow,
      studyCoachText,
      userAdaptationText,
      conversationSummaryText,
      sourceAcquisitionMode,
      sourceAcquisitionContractText,
      workflowText: studyWorkflow ? buildStudyWorkflowRuntimeBrief(studyWorkflow, workflowContext, this.getLocale()) : null,
      pluginFeatureText,
      paperStudyRuntimeOverlayText,
      skillGuideText,
      paperStudyGuideText,
      mentionContextText,
      selection: selection || null,
      selectionSourcePath: selectionContext?.sourcePath ?? file?.path ?? null,
      vaultRoot: this.resolveVaultRoot(),
      dailyNotePath,
      contextPackText,
      attachmentManifestText,
      attachmentContentText,
      noteSourcePackText,
      attachmentMissingPdfTextNames: attachmentContentPack.missingPdfTextAttachmentNames,
      attachmentMissingSourceNames: attachmentContentPack.missingSourceAttachmentNames,
    };
  }

  private buildWorkflowPromptContext(
    tabId: string,
    workflow: StudyWorkflowKind | null,
    currentFilePath: string | null,
  ): StudyWorkflowPromptContext {
    const tab = this.findTab(tabId);
    if (!tab || !workflow) {
      return {
        currentFilePath,
        targetNotePath: this.resolveTargetNotePath(tabId),
      };
    }

    return {
      currentFilePath,
      targetNotePath: this.resolveTargetNotePath(tabId),
      hasAttachments: this.getTabSessionItems(tabId).length > 0,
      hasSelection: Boolean(tab.selectionContext),
      pinnedContextCount: 0,
    };
  }

  private async resolveMentionContext(
    mentions: readonly ParsedMention[],
  ): Promise<{
    contextText: string | null;
    skillNames: string[];
    workingDirectoryHint: string | null;
    sourcePathHints: string[];
    explicitTargetNotePath: string | null;
  }> {
    if (mentions.length === 0) {
      return { contextText: null, skillNames: [], workingDirectoryHint: null, sourcePathHints: [], explicitTargetNotePath: null };
    }

    const contextBlocks: string[] = [];
    const skillNames = new Set<string>();
    const sourcePathHints: string[] = [];
    const seenSourcePaths = new Set<string>();
    let explicitTargetNotePath: string | null = null;
    const isLikelyDirectoryPath = (value: string): boolean => !/\.[a-z0-9]{1,8}$/i.test(value.trim());

    for (const mention of mentions) {
      if (mention.kind === "note") {
        const abstractFile = this.app.vault.getAbstractFileByPath(mention.value);
        if (abstractFile instanceof TFile) {
          explicitTargetNotePath ??= abstractFile.path;
          const content = await this.app.vault.cachedRead(abstractFile);
          contextBlocks.push(`Mentioned note: ${abstractFile.path}\n\n\`\`\`md\n${content}\n\`\`\``);
        }
        continue;
      }

      if (mention.kind === "skill") {
        skillNames.add(mention.value);
        continue;
      }

      if (mention.kind === "recipe") {
        const recipe =
          this.getStudyRecipes().find(
            (entry) =>
              entry.id === mention.value ||
              entry.title === mention.value ||
              entry.commandAlias.toLowerCase() === mention.value.trim().toLowerCase(),
          ) ?? null;
        if (recipe) {
          contextBlocks.push(buildStudyRecipeMentionContext(recipe, this.getLocale()));
        }
        continue;
      }

      if (mention.kind === "external_dir") {
        const normalizedRuntimePath = normalizeRuntimePath(mention.value);
        const normalizedKey = normalizedRuntimePath.toLowerCase();
        if (!seenSourcePaths.has(normalizedKey)) {
          seenSourcePaths.add(normalizedKey);
          sourcePathHints.push(normalizedRuntimePath);
        }
        contextBlocks.push(
          [
            `Mentioned external directory (provenance): ${mention.value}`,
            normalizedRuntimePath !== mention.value ? `Runtime path hint for WSL/Codex tools: ${normalizedRuntimePath}` : null,
            "Treat this as read-only source provenance. When attached source text is already present, do not re-ingest this path or inspect the source bundle again.",
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
        );
        continue;
      }

      contextBlocks.push(`Mentioned MCP server: ${mention.value}\nPrefer this MCP server when it is relevant.`);
    }

    return {
      contextText: contextBlocks.length > 0 ? contextBlocks.join("\n\n") : null,
      skillNames: [...skillNames],
      workingDirectoryHint:
        sourcePathHints.length === 1 && isLikelyDirectoryPath(sourcePathHints[0] ?? "")
          ? sourcePathHints[0] ?? null
          : null,
      sourcePathHints,
      explicitTargetNotePath,
    };
  }

  private async captureVaultNoteSourcePackText(
    activeFile: TFile | null,
    targetNotePath: string | null,
    selectionSourcePath: string | null,
    prompt: string,
  ): Promise<string | null> {
    const entries = dedupeNoteFiles(
      [
        activeFile ? { file: activeFile, role: "Current note" } : null,
        (() => {
          const targetFile = targetNotePath ? this.app.vault.getAbstractFileByPath(targetNotePath) : null;
          return targetFile instanceof TFile ? { file: targetFile, role: "Target note" } : null;
        })(),
        (() => {
          const selectionFile = selectionSourcePath ? this.app.vault.getAbstractFileByPath(selectionSourcePath) : null;
          return selectionFile instanceof TFile ? { file: selectionFile, role: "Selection source note" } : null;
        })(),
      ].filter((entry): entry is { file: TFile; role: string } => Boolean(entry)),
    );

    if (entries.length === 0) {
      return null;
    }

    const sources = await Promise.all(
      entries.map(async (entry) => ({
        path: entry.file.path,
        role: entry.role,
        content: await this.app.vault.cachedRead(entry.file),
      })),
    );

    return buildVaultNoteSourcePackText(sources, {
      locale: this.getLocale(),
      priorityTerms: extractSourcePackPriorityTerms(prompt),
    });
  }

  private async findDailyNoteFile(): Promise<TFile | null> {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(
      2,
      "0",
    )}.md`;
    const direct = this.app.vault.getAbstractFileByPath(stamp);
    if (direct instanceof TFile) {
      return direct;
    }
    const nested = this.app.vault.getAbstractFileByPath(`daily/${stamp}`);
    return nested instanceof TFile ? nested : null;
  }

  private getTabSessionItems(tabId: string): ComposerAttachment[] {
    return normalizeComposerAttachments(this.findTab(tabId)?.sessionItems ?? [], this.resolveVaultRoot());
  }

  private resolveAttachmentStageDirectory(tabId: string): string {
    const namespace = createHash("sha1").update(tabId).digest("hex").slice(0, 24);
    return join(resolveComposerAttachmentStageRoot(this.resolveVaultRoot()), namespace);
  }

  private async cleanupSessionItems(attachments: readonly ComposerAttachment[]): Promise<void> {
    if (attachments.length === 0) {
      return;
    }
    await cleanupComposerAttachments(this.resolveVaultRoot(), attachments);
  }

  private async clearComposerArtifacts(tabId: string): Promise<void> {
    const attachments = this.getTabSessionItems(tabId);
    this.store.setSessionItems(tabId, []);
    this.store.setSelectionContext(tabId, null);
    await this.cleanupSessionItems(attachments);
  }

  private finalizePendingMessages(tabId: string): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    for (const message of tab.messages.filter((entry) => Boolean(entry.pending))) {
      this.store.upsertMessage(tabId, message.id, (current) => ({
        ...(current ?? message),
        pending: false,
      }));
      if (message.kind === "assistant") {
        this.queueAssistantArtifactSync(tabId, message.id, message.text);
      }
    }
  }

  private collectAssistantMessageIds(tabId: string): Set<string> {
    const ids = new Set(
      (this.findTab(tabId)?.messages ?? [])
        .filter((message) => message.kind === "assistant")
        .map((message) => message.id),
    );
    for (const messageId of this.assistantArtifactMessageIds.get(tabId) ?? []) {
      ids.add(messageId);
    }
    return ids;
  }

  private async ensureAssistantArtifactsReady(tabId: string, previousAssistantMessageIds: ReadonlySet<string>): Promise<Set<string>> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return new Set();
    }
    const newAssistantMessageIds = [...this.collectAssistantMessageIds(tabId)].filter(
      (messageId) => !previousAssistantMessageIds.has(messageId),
    );
    await Promise.all(
      newAssistantMessageIds.map((messageId) => {
        const key = `${tabId}:${messageId}`;
        const pending = this.assistantArtifactSyncs.get(key);
        if (pending) {
          return pending;
        }
        const message = tab.messages.find((entry) => entry.kind === "assistant" && entry.id === messageId) ?? null;
        if (!message) {
          return Promise.resolve();
        }
        this.queueAssistantArtifactSync(tabId, message.id, message.text);
        return this.assistantArtifactSyncs.get(key) ?? Promise.resolve();
      }),
    );
    return new Set(newAssistantMessageIds);
  }

  private hasSuccessfulArtifactOutcome(tabId: string, assistantMessageIds: ReadonlySet<string>): boolean {
    if (assistantMessageIds.size === 0) {
      return false;
    }
    const tab = this.findTab(tabId);
    if (!tab) {
      return false;
    }
    return (
      tab.patchBasket.some((proposal) => assistantMessageIds.has(proposal.sourceMessageId)) ||
      tab.pendingApprovals.some((approval) => Boolean(approval.sourceMessageId && assistantMessageIds.has(approval.sourceMessageId)))
    );
  }

  private abortTabRun(
    tabId: string,
    addMessage: boolean,
    reason: AbortReason = addMessage ? "user_interrupt" : "runtime_abort",
  ): boolean {
    const run = this.activeRuns.get(tabId);
    if (!run?.controller) {
      return false;
    }

    run.abortReason = reason;
    run.controller.abort();
    if (addMessage) {
      this.store.addMessage(tabId, {
        id: makeId("interrupt"),
        kind: "system",
        text: this.getLocalizedCopy().service.interruptRequested,
        createdAt: Date.now(),
      });
    }
    this.store.setWaitingState(tabId, null);
    return true;
  }

  private findTab(tabId: string) {
    return this.store.getState().tabs.find((tab) => tab.id === tabId) ?? null;
  }

  private resolveVaultRoot(): string {
    return getVaultBasePath(this.app);
  }

  private getPreferredTargetFile(): TFile | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      return activeFile;
    }

    const recentLeaf = this.app.workspace.getMostRecentLeaf();
    const recentFile = recentLeaf?.view && "file" in recentLeaf.view ? recentLeaf.view.file : null;
    return recentFile instanceof TFile ? recentFile : null;
  }

  private normalizeTargetNotePath(path: string | null): string | null {
    const nextPath = path?.trim() ?? "";
    if (!nextPath) {
      return null;
    }
    const abstractFile = this.app.vault.getAbstractFileByPath(nextPath);
    return abstractFile instanceof TFile ? abstractFile.path : null;
  }

  private resolveTargetNotePath(tabId: string): string | null {
    const targetNotePath = this.findTab(tabId)?.targetNotePath ?? null;
    const resolved = this.normalizeTargetNotePath(targetNotePath);
    if (targetNotePath && !resolved) {
      this.store.setTargetNotePath(tabId, null);
    }
    return resolved;
  }

  private normalizeTabTargetNotes(): void {
    for (const tab of this.store.getState().tabs) {
      const resolved = this.normalizeTargetNotePath(tab.targetNotePath);
      if (resolved !== tab.targetNotePath) {
        this.store.setTargetNotePath(tab.id, resolved);
      }
    }
  }

  private seedInitialTargetNote(): void {
    const state = this.store.getState();
    if (state.tabs.length !== 1) {
      return;
    }
    const tab = state.tabs[0];
    if (!tab || tab.targetNotePath || tab.messages.length > 0 || tab.draft.trim()) {
      return;
    }
    const activeFile = this.getPreferredTargetFile();
    if (activeFile) {
      this.store.setTargetNotePath(tab.id, activeFile.path);
    }
  }

  private appendContextPath(tabId: string, path: string): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }

    const nextPath = path.trim();
    if (!nextPath) {
      return;
    }

    const currentPaths = normalizeContextPaths(tab.contextPaths);
    if (currentPaths.includes(nextPath)) {
      return;
    }
    if (currentPaths.length >= MAX_CONTEXT_PATHS) {
      throw new Error(`Context pack is full. Keep at most ${MAX_CONTEXT_PATHS} notes pinned per chat.`);
    }

    this.store.setContextPaths(tabId, [...currentPaths, nextPath]);
  }

  private async captureContextPackText(tabId: string, excludedPaths: string[]): Promise<string | null> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }

    const persistentPaths: string[] = [];
    const excludedPathSet = new Set(
      excludedPaths.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
    );
    const sources: Array<{ path: string; content: string }> = [];

    for (const path of normalizeContextPaths(tab.contextPaths).slice(0, MAX_CONTEXT_PATHS)) {
      const abstractFile = this.app.vault.getAbstractFileByPath(path);
      if (!(abstractFile instanceof TFile)) {
        continue;
      }
      persistentPaths.push(abstractFile.path);
      if (excludedPathSet.has(abstractFile.path)) {
        continue;
      }
      sources.push({
        path: abstractFile.path,
        content: await this.app.vault.cachedRead(abstractFile),
      });
    }

    const normalizedPersistentPaths = normalizeContextPaths(persistentPaths);
    if (
      normalizedPersistentPaths.length !== tab.contextPaths.length ||
      normalizedPersistentPaths.some((path, index) => path !== tab.contextPaths[index])
    ) {
      this.store.setContextPaths(tabId, normalizedPersistentPaths);
    }

    return buildContextPackText(sources);
  }

  private createWaitingState(phase: WaitingPhase, mode: RuntimeMode) {
    return {
      phase,
      text: pickWaitingCopy(phase, mode),
    };
  }

  private setWaitingPhase(tabId: string, phase: WaitingPhase, mode: RuntimeMode): void {
    const current = this.findTab(tabId)?.waitingState;
    if (current?.phase === phase) {
      return;
    }
    this.store.setWaitingState(tabId, this.createWaitingState(phase, mode));
  }

  private resolveModeDefaults() {
    const runtimeDefaults =
      this.store?.getSessionModeDefaults?.() ?? {
        fastMode: this.settingsProvider().defaultFastMode === true,
        learningMode: this.settingsProvider().defaultLearningMode === true,
      };
    return {
      fastMode: runtimeDefaults.fastMode === true,
      learningMode: runtimeDefaults.learningMode === true,
    };
  }

  private persistModeDefaults(
    partial: Partial<Pick<PluginSettings, "defaultFastMode" | "defaultLearningMode">>,
  ): void {
    const current = this.settingsProvider();
    const nextSettings: PluginSettings = {
      ...current,
      defaultFastMode: partial.defaultFastMode ?? current.defaultFastMode,
      defaultLearningMode: partial.defaultLearningMode ?? current.defaultLearningMode,
    };
    if (
      nextSettings.defaultFastMode === current.defaultFastMode &&
      nextSettings.defaultLearningMode === current.defaultLearningMode
    ) {
      return;
    }
    void this.updateSettings(nextSettings).catch((error) => {
      console.error("[obsidian-codex-study] failed to persist sticky mode defaults", error);
    });
  }

  private resolveTabDefaults(modelOverride?: string | null, effortOverride?: ReasoningEffort | null) {
    const settings = this.settingsProvider();
    const model = coerceModelForPicker(
      this.getAvailableModels(),
      modelOverride?.trim() || this.resolvePreferredDefaultModel(settings.codex.model.trim() || settings.defaultModel.trim() || DEFAULT_MODEL),
    );
    return {
      model,
      reasoningEffort: resolveReasoningEffortForModel(
        this.getAvailableModels(),
        model,
        effortOverride ?? settings.defaultReasoningEffort,
      ),
      ...this.resolveModeDefaults(),
    };
  }

  private normalizeTabModels(): void {
    for (const tab of this.store.getState().tabs) {
      const normalizedModel = coerceModelForPicker(this.getAvailableModels(), tab.model);
      const normalizedEffort = resolveReasoningEffortForModel(this.getAvailableModels(), normalizedModel, tab.reasoningEffort);
      if (normalizedModel !== tab.model) {
        this.store.setTabModel(tab.id, normalizedModel);
      }
      if (normalizedEffort !== tab.reasoningEffort) {
        this.store.setTabReasoningEffort(tab.id, normalizedEffort);
      }
    }
  }

  private resolvePreferredDefaultModel(fallbackModel: string): string {
    if (!this.settingsProvider().securityPolicy.preferLongContextModel) {
      return fallbackModel;
    }
    const preferred = this.getAvailableModels().find((entry) => !/mini|nano|small/i.test(entry.slug));
    return preferred?.slug ?? fallbackModel;
  }

  private async persistDefaults(model: string, defaultReasoningEffort: ReasoningEffort): Promise<void> {
    const current = this.settingsProvider();
    await this.updateSettings({
      ...current,
      defaultModel: model,
      defaultReasoningEffort,
      codex: {
        ...current.codex,
        model,
      },
    });
  }

  private async persistWorkspace(): Promise<void> {
    if (this.saveQueued) {
      return;
    }
    this.saveQueued = true;
    queueMicrotask(async () => {
      this.saveQueued = false;
      await this.saveWorkspaceState(this.store.serialize());
    });
  }

  private async syncKnownUsageFromSessions(): Promise<void> {
    await this.usageSync.syncKnownThreadsNow("idle_poll");
  }

  private async listRecentSessionFilesForUsageSync() {
    const roots = await this.resolveSessionSearchRoots();
    const files = await Promise.all(
      roots.map(async (root) => await listRecentUsageSessionFiles(root, { limit: 8, lookbackDays: 2 })),
    );
    return files
      .flat()
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, 8);
  }

  private async syncUsageFromSession(
    threadId: string,
    source: AccountUsageSummary["source"] = "session_backfill",
  ): Promise<void> {
    try {
      const sessionFile = await this.resolveSessionFile(threadId);
      if (!sessionFile) {
        return;
      }
      const snapshot = await readSessionUsageSnapshot(sessionFile);
      if (!snapshot?.summary) {
        return;
      }
      for (const tab of this.store.getState().tabs) {
        if (tab.codexThreadId === threadId) {
          this.store.setUsageSummary(tab.id, snapshot.summary);
        }
      }
      this.updateAccountUsageFromSummary(
        snapshot.summary,
        threadId,
        source,
        snapshot.lastObservedAt ?? snapshot.lastCheckedAt,
        snapshot.lastCheckedAt,
      );
    } catch {
      // Keep the live stream result if session reconciliation fails.
    }
  }

  private async syncTranscriptFromSession(
    tabId: string,
    threadId: string,
    visibility: AssistantOutputVisibility = "visible",
  ): Promise<TranscriptSyncResult> {
    let sessionFile: string | null;
    try {
      sessionFile = await this.resolveSessionFile(threadId);
    } catch (error) {
      console.warn("[obsidian-codex-study] resolveSessionFile threw", {
        threadId,
        roots: this.getSessionSearchRoots(),
        error,
      });
      return "session_read_error";
    }
    if (!sessionFile) {
      console.warn("[obsidian-codex-study] session file not found for thread", {
        threadId,
        searchedRoots: this.getSessionSearchRoots(),
      });
      return "session_missing";
    }
    try {
      const lastAssistantMessage = await readLastVisibleAssistantMessageFromSessionFile(sessionFile);
      if (!lastAssistantMessage) {
        console.warn("[obsidian-codex-study] session file had no visible assistant reply", {
          threadId,
          sessionFile,
        });
        return "no_visible_reply_found";
      }
      if (visibility === "visible" && this.hasDuplicateVisibleAssistantReply(tabId, lastAssistantMessage.visibleText)) {
        return "duplicate_reply";
      }
      return this.appendAssistantFallbackMessageWithVisibility(
        tabId,
        lastAssistantMessage.rawText,
        makeId(`codex-session-final-${threadId}`),
        visibility,
      )
        ? "appended_reply"
        : "duplicate_reply";
    } catch (error) {
      console.warn("[obsidian-codex-study] readLastVisibleAssistantMessageFromSessionFile threw", {
        threadId,
        sessionFile,
        error,
      });
      return "session_read_error";
    }
  }

  private async resolveSessionFile(threadId: string): Promise<string | null> {
    const cached = this.sessionFileCache.get(threadId);
    if (cached && existsSync(cached)) {
      return cached;
    }
    if (cached) {
      this.sessionFileCache.delete(threadId);
    }

    for (let attempt = 0; attempt < SESSION_FILE_RESOLVE_MAX_ATTEMPTS; attempt += 1) {
      const roots = await this.resolveSessionSearchRoots();
      for (const root of roots) {
        const resolved = await findSessionFileForThread(root, threadId);
        if (resolved) {
          this.sessionFileCache.set(threadId, resolved);
          return resolved;
        }
      }
      if (attempt < SESSION_FILE_RESOLVE_MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, SESSION_FILE_RESOLVE_BASE_DELAY_MS * (attempt + 1)));
      }
    }
    return null;
  }

}
