import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { createInterface } from "node:readline";
import { TFile, type App, type Editor } from "obsidian";
import { AgentStore } from "../model/store";
import type {
  AccountUsageSummary,
  CampaignExecutionStep,
  CampaignHeatmapNode,
  CampaignItem,
  CampaignSnapshotCapsule,
  CampaignSnapshotFile,
  ComposerAttachment,
  ComposerAttachmentInput,
  ComposeMode,
  ModelCatalogEntry,
  PatchProposal,
  PendingApproval,
  RefactorCampaign,
  RefactorRecipe,
  RecentStudySource,
  ToolActivityKind,
  ToolActivityStatus,
  ToolCallRecord,
  PersistedWorkspaceState,
  PluginSettings,
  RuntimeMode,
  SelectionContext,
  SmartSet,
  SmartSetDrift,
  SmartSetQuery,
  SmartSetResult,
  SmartSetSnapshotReason,
  StudyWorkflowKind,
  TurnContextSnapshot,
  VaultOpProposal,
  WaitingPhase,
} from "../model/types";
import { DEFAULT_PRIMARY_MODEL as DEFAULT_MODEL } from "../model/types";
import { getLocalizedCopy, type SupportedLocale } from "../util/i18n";
import { makeId } from "../util/id";
import {
  buildCodexSpawnSpec,
  isUnsupportedJsonFlagError,
  renderCodexSpawnSpec,
  type JsonOutputFlag,
} from "../util/codexCli";
import { splitCommandString, usesWsl } from "../util/command";
import {
  coerceModelForPicker,
  getFallbackModelCatalog,
  parseModelCatalog,
  resolveReasoningEffortForModel,
} from "../util/models";
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
import { getPermissionModeProfile, type PermissionMode } from "../util/permissionMode";
import {
  buildAttachmentPromptManifest,
  buildAttachmentSummaryText,
  cleanupComposerAttachments,
  DEFAULT_ATTACHMENT_PROMPT,
  DEFAULT_SELECTION_AND_ATTACHMENT_PROMPT,
  normalizeComposerAttachments,
  stageComposerAttachment,
} from "../util/composerAttachments";
import { loadInstalledSkillCatalog, type InstalledSkillDefinition } from "../util/skillCatalog";
import { normalizeConfiguredSkillRoots } from "../util/skillRoots";
import { extractSkillReferences } from "../util/skillRouting";
import { getSlashCommandCatalog, type SlashCommandDefinition } from "../util/slashCommandCatalog";
import { expandSlashCommand } from "../util/slashCommands";
import {
  extractAssistantProposals,
  type ParsedAssistantOp,
  type ParsedAssistantPatch,
} from "../util/assistantProposals";
import { buildUnifiedDiff } from "../util/unifiedDiff";
import {
  createEmptyAccountUsageSummary,
  createEmptyUsageSummary,
  extractUsageSummaryPatch,
  hasAccountUsageSummaryData,
  mergeAccountUsageSummary,
  mergeUsageSummary,
} from "../util/usage";
import { findSessionFileForThread, readLastAssistantMessageFromSessionFile, readUsageSummaryFromSessionFile } from "../util/usageSessions";
import { allowsVaultWrite } from "../util/vaultEdit";
import { pickWaitingCopy } from "../util/waiting";
import {
  buildSmartSetMirrorMarkdown,
  computeSmartSetDrift,
  executeSmartSetQuery,
  MAX_SMART_SET_CAMPAIGN_RESULTS,
  MAX_SMART_SET_RESULTS,
  normalizeSmartSetPrompt,
  parseSmartSetQuery,
  slugifySmartSetTitle,
  type SmartSetCandidate,
} from "../util/smartSets";
import { buildRecipeCampaignPrompt, buildRefactorRecipeFromCampaign } from "../util/refactorRecipes";
import {
  buildStudyWorkflowDraft,
  buildStudyWorkflowRuntimeBrief,
  getStudyWorkflowDefinition,
  type StudyWorkflowPromptContext,
} from "../util/studyWorkflows";

type ToolDecision = "approve" | "approve_session" | "deny" | "abort";
type JsonRecord = Record<string, unknown>;
type ApprovalResult = "applied" | "denied" | "aborted" | "failed" | "ignored";

interface ActiveRunState {
  controller: AbortController;
  mode: RuntimeMode;
}

interface SendPromptContext {
  file: TFile | null;
  editor: Editor | null;
  images?: string[];
  campaignSeed?: PendingCampaignSeed | null;
}

interface CodexRunRequest {
  prompt: string;
  tabId: string;
  threadId: string | null;
  workingDirectory: string;
  sandboxMode: "read-only" | "workspace-write";
  approvalPolicy: "untrusted" | "on-failure" | "never";
  images: string[];
  model: string;
  reasoningEffort: ReasoningEffort | null;
  signal: AbortSignal;
  onEvent: (event: JsonRecord) => void;
}

interface CodexRunResult {
  threadId: string | null;
}

interface VaultTaskMatchResult {
  lineIndex: number;
  lineText: string;
}

interface PendingCampaignSeed {
  query: string;
  targetPaths: string[];
}

type MentionEntityKind = "note" | "smart_set" | "skill" | "external_dir" | "mcp";

interface ParsedMention {
  kind: MentionEntityKind;
  value: string;
}

interface PromptMetadataExtraction {
  cleanedPrompt: string;
  instructionLabels: string[];
  mentions: ParsedMention[];
}

const CODEX_HOME = join(homedir(), ".codex");
const CODEX_AUTH_PATH = join(CODEX_HOME, "auth.json");
const CODEX_SESSION_ROOT = join(CODEX_HOME, "sessions");
const DEFAULT_SKILL_ROOT = join(CODEX_HOME, "skills");
const DEFAULT_AGENT_SKILL_ROOT = join(homedir(), ".agents", "skills");
const DEFAULT_CODEX_COMMAND = "codex";
const MAX_OPEN_TABS = 5;
const DEFAULT_SELECTION_PROMPT = "Explain this selection and stay focused on the selected text.";
const DEFAULT_REFACTOR_SESSION_PROMPT =
  "Review the current note and propose any backlink-safe rename, move, property cleanup, or note-body changes that would materially improve the vault. Use `obsidian-ops` for vault operations and `obsidian-patch` for note text changes.";
const ATTACHMENT_STAGE_ROOT_SEGMENTS = [".obsidian", "plugins", "obsidian-codex-study", ".staging"] as const;
const CAMPAIGN_STAGE_ROOT_SEGMENTS = [".obsidian", "plugins", "obsidian-codex-study", ".campaigns"] as const;
const SMART_SET_NOTE_FOLDER_SEGMENTS = ["Codex Study", "Smart Sets"] as const;
const INSTRUCTION_OPTIONS = ["brief", "steps", "safe", "diff", "focus", "research", "strict", "concise"] as const;
const MAX_RECENT_STUDY_SOURCES = 8;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function formatPlanModePrompt(prompt: string, skillNames: string[]): string {
  if (skillNames.includes("grill-me") && !/\$grill-me\b/i.test(prompt)) {
    return `$grill-me\n\n${prompt}`;
  }
  return prompt;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|interrupted/i.test(error.message));
}

function createAbortError(): Error {
  const error = new Error("Turn interrupted.");
  error.name = "AbortError";
  return error;
}

function getVaultBasePath(app: App): string {
  const adapter = app.vault.adapter as { basePath?: string };
  return adapter.basePath ?? "";
}

function sanitizeTitle(input: string, fallback = "New chat"): string {
  const collapsed = input.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, 48) || fallback;
}

function summarizeCodexChanges(changes: Array<{ path: string; kind: string }>): string {
  if (!changes.length) {
    return "No file changes reported.";
  }
  return changes.map((change) => `${change.kind}: ${change.path}`).join("\n");
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

function extractCodexSessionId(event: JsonRecord): string | null {
  if (asString(event.type) === "thread.started") {
    return asString(event.thread_id);
  }

  if (asString(event.type) === "session_meta") {
    return asString(asRecord(event.payload)?.id);
  }

  return null;
}

function buildEventBackedMessageId(event: JsonRecord, phase: string, fallbackPrefix: string): string {
  const timestamp = asString(event.timestamp)?.replace(/[^a-zA-Z0-9]+/g, "-") ?? makeId(fallbackPrefix);
  return `${fallbackPrefix}-${timestamp}-${phase}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function normalizeUserPromptWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractPromptMetadata(input: string): PromptMetadataExtraction {
  const instructionLabels = new Set<string>();
  const mentions: ParsedMention[] = [];

  const withoutInstructions = input.replace(/(^|[\s(])#([A-Za-z0-9:_-]+)/gu, (_match, prefix: string, label: string) => {
    if (label?.trim()) {
      instructionLabels.add(label.trim().toLowerCase());
    }
    return prefix || "";
  });

  const cleanedPrompt = withoutInstructions.replace(
    /@(?:(note|set|skill|dir|mcp)\(([^)]+)\))/gu,
    (_match, rawKind: string, rawValue: string) => {
      const value = rawValue?.trim() ?? "";
      if (!value) {
        return "";
      }
      const kind: MentionEntityKind =
        rawKind === "note"
          ? "note"
          : rawKind === "set"
            ? "smart_set"
            : rawKind === "skill"
              ? "skill"
              : rawKind === "dir"
                ? "external_dir"
                : "mcp";
      mentions.push({ kind, value });
      return "";
    },
  );

  return {
    cleanedPrompt: normalizeUserPromptWhitespace(cleanedPrompt),
    instructionLabels: [...instructionLabels],
    mentions,
  };
}

function summarizeLines(lines: readonly string[], maxLines = 3): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join("\n");
}

function deriveActivityStatus(pending: boolean, failed = false): ToolActivityStatus {
  if (failed) {
    return "failed";
  }
  return pending ? "running" : "completed";
}

function extractCallId(value: JsonRecord): string | null {
  return asString(value.call_id) ?? asString(value.callId) ?? asString(value.id);
}

function extractStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => asString(entry) ?? "").filter((entry) => entry.trim().length > 0) : [];
}

function summarizeResultText(item: JsonRecord): string | null {
  const candidates = [
    asString(item.output),
    asString(item.result),
    asString(item.stdout),
    asString(item.stderr),
    asString(item.message),
  ].filter((entry): entry is string => Boolean(entry?.trim()));
  return candidates.length > 0 ? candidates.join("\n\n").trim() : null;
}

function summarizeCommand(item: JsonRecord): string {
  const command = asString(item.command) ?? asString(item.cmd);
  if (command?.trim()) {
    return command.trim();
  }
  const args = extractStringList(item.args);
  return args.length > 0 ? args.join(" ") : "Shell command";
}

function summarizeWebSearch(item: JsonRecord): string {
  const query = asString(item.query) ?? asString(item.search_query);
  if (query?.trim()) {
    return query.trim();
  }
  const terms = extractStringList(item.queries);
  return terms.length > 0 ? terms.join(" · ") : "Web search";
}

function summarizeMcpTool(item: JsonRecord): { title: string; summary: string; name: string } {
  const serverName = asString(item.server_name) ?? asString(item.serverName) ?? "mcp";
  const toolName = asString(item.tool_name) ?? asString(item.toolName) ?? asString(item.name) ?? "tool";
  const summaryCandidates = [
    asString(item.summary),
    asString(item.display),
    asString(item.arguments),
  ].filter((entry): entry is string => Boolean(entry?.trim()));
  return {
    title: `${serverName}/${toolName}`,
    summary: summaryCandidates[0] ?? `${serverName} · ${toolName}`,
    name: toolName,
  };
}

function summarizeFileChange(item: JsonRecord): { summary: string; resultText: string } {
  const rawChanges = Array.isArray(item.changes) ? item.changes : [];
  const changes = rawChanges
    .map((change) => asRecord(change))
    .filter((change): change is JsonRecord => Boolean(change))
    .map((change) => ({
      path: asString(change.path) ?? "unknown",
      kind: asString(change.kind) ?? "modified",
    }));
  return {
    summary: summarizeLines(changes.map((change) => `${change.kind}: ${change.path}`), 4) || "Workspace files updated",
    resultText: summarizeCodexChanges(changes),
  };
}

function summarizeTodoList(item: JsonRecord): string {
  const todos = Array.isArray(item.items) ? item.items : Array.isArray(item.todos) ? item.todos : [];
  const lines = todos
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => asString(entry.text) ?? asString(entry.title) ?? "")
    .filter((entry) => entry.trim().length > 0);
  return summarizeLines(lines, 3) || "Todo list updated";
}

function buildActivityRecord(
  current: ToolCallRecord | null,
  callId: string,
  kind: ToolActivityKind,
  name: string,
  title: string,
  summary: string,
  argsJson: string,
  status: ToolActivityStatus,
  resultText?: string,
): ToolCallRecord {
  return {
    id: current?.id ?? makeId("activity"),
    callId,
    kind,
    name,
    title,
    summary,
    argsJson,
    createdAt: current?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    status,
    resultText: resultText ?? current?.resultText,
  };
}

function extractResponseMessageText(payload: JsonRecord): string | null {
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

function extractReasoningText(payload: JsonRecord): string | null {
  const directText = asString(payload.text) ?? asString(payload.content);
  if (directText?.trim()) {
    return directText;
  }

  const summary = Array.isArray(payload.summary) ? payload.summary : [];
  const lines = summary
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => asString(entry.text) ?? asString(entry.summary))
    .filter((entry): entry is string => Boolean(entry?.trim()));

  return lines.length > 0 ? lines.join("\n\n") : null;
}

function extractTaskCompleteMessageText(payload: JsonRecord): string | null {
  const text = asString(payload.last_agent_message) ?? asString(payload.lastAgentMessage);
  return text?.trim() ? text : null;
}

function buildTurnPrompt(
  prompt: string,
  context: TurnContextSnapshot,
  mode: RuntimeMode,
  skillNames: string[],
  composeMode: ComposeMode,
  allowVaultWrite: boolean,
): string {
  const instructions = [
    "You are Codex embedded in an Obsidian vault.",
    "Prefer concise, practical markdown answers.",
    "Use the local workspace directly instead of guessing note contents.",
    composeMode === "plan"
      ? "Planmode is active for this turn. Treat this as a specification interview. Ask exactly one high-impact clarifying question at a time until the request is decision-complete, then summarize the agreed plan. Do not edit files, do not apply patches, and do not make lasting workspace changes."
      : "Chat mode is active for this turn.",
    allowVaultWrite
      ? "The current permission mode allows workspace edits for this turn. For markdown note body changes, do not edit the note directly. Instead, append a fenced `obsidian-patch` JSON block with `path`, optional `kind`, `summary`, and full `content`. For rename, move, property, or task changes, append a fenced `obsidian-ops` JSON block with an `ops` array. Keep human-readable explanation above the blocks."
      : "Default to analysis and explanation unless a concrete workspace change is clearly required by the user and permitted by the active sandbox.",
    `Vault root: ${context.vaultRoot}`,
    `Active note path: ${context.activeFilePath ?? "none"}`,
    `Session target note path: ${context.targetNotePath ?? "none"}`,
    `Active study workflow: ${context.studyWorkflow ?? "none"}`,
    `Instruction chips: ${context.instructionText ? "attached" : "none"}`,
    `Explicit mentions: ${context.mentionContextText ? "attached" : "none"}`,
    `Selection snapshot: ${context.selection ? `attached from ${context.selectionSourcePath ?? "the current note"}` : "none"}`,
    `File/image attachments: ${context.attachmentManifestText ? "attached" : "none"}`,
    `Daily note path: ${context.dailyNotePath ?? "none"}`,
    `Pinned context notes: ${context.contextPackText ? "attached" : "none"}`,
  ];

  if (mode === "skill" && skillNames.length > 0) {
    instructions.push(`Explicit skill references present: ${skillNames.map((name) => `$${name}`).join(", ")}`);
    instructions.push("Honor the explicit $skill references present in the user request.");
  }

  const selectionBlock = context.selection
    ? [
        context.selectionSourcePath ? `Selected text from ${context.selectionSourcePath}` : "Selected text",
        `\`\`\`md\n${context.selection}\n\`\`\``,
      ].join("\n\n")
    : null;

  return [
    instructions.join("\n"),
    context.workflowText,
    context.instructionText,
    context.mentionContextText,
    selectionBlock,
    context.attachmentManifestText,
    context.contextPackText,
    "User request:",
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildPatchProposalId(messageId: string, sourceIndex: number, index: number): string {
  return `patch-${messageId}-${sourceIndex}-${index}`;
}

function buildApprovalId(messageId: string, sourceIndex: number, index: number): string {
  return `approval-${messageId}-${sourceIndex}-${index}`;
}

function buildApprovalTitle(op: VaultOpProposal): string {
  if (op.kind === "rename") {
    return "Rename note";
  }
  if (op.kind === "move") {
    return "Move note";
  }
  if (op.kind === "property_set") {
    return "Set note property";
  }
  if (op.kind === "property_remove") {
    return "Remove note property";
  }
  return "Update task";
}

function buildApprovalDescription(op: VaultOpProposal): string {
  if ((op.kind === "rename" || op.kind === "move") && op.destinationPath) {
    return `${op.targetPath} -> ${op.destinationPath}`;
  }
  if (op.kind === "property_set") {
    return `${op.targetPath} · ${op.propertyKey ?? "property"} = ${op.propertyValue ?? ""}`.trim();
  }
  if (op.kind === "property_remove") {
    return `${op.targetPath} · remove ${op.propertyKey ?? "property"}`;
  }
  if (op.kind === "task_update") {
    const statusLabel = op.checked === true ? "checked" : op.checked === false ? "unchecked" : "updated";
    return `${op.targetPath} · task ${statusLabel}`;
  }
  return op.targetPath;
}

function normalizeProposalText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function getPathStem(path: string): string {
  const fileName = basename(path);
  const extension = extname(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

function parseBacklinkSourceLabel(label: string): { path: string; count: number } | null {
  const match = label.match(/^(.*) \((\d+)\)$/);
  if (!match) {
    return null;
  }
  return {
    path: match[1] ?? label,
    count: Number.parseInt(match[2] ?? "0", 10) || 0,
  };
}

function summarizeCampaignExecution(
  action: "apply" | "rollback",
  applied: number,
  failed: number,
  locale: SupportedLocale,
): string {
  if (locale === "ja") {
    const verb = action === "apply" ? "Campaign を適用しました" : "Campaign を rollback しました";
    return `${verb}。完了: ${applied}、失敗: ${failed}。`;
  }
  const verb = action === "apply" ? "Campaign applied" : "Campaign rolled back";
  return `${verb}. Completed: ${applied}, failed: ${failed}.`;
}

export class CodexService {
  readonly store: AgentStore;
  private readonly activeRuns = new Map<string, ActiveRunState>();
  private readonly pendingCampaignSeeds = new Map<string, PendingCampaignSeed>();
  private readonly sessionFileCache = new Map<string, string>();
  private readonly usageSyncInFlight = new Set<string>();
  private readonly saveListeners: Array<() => void> = [];
  private saveQueued = false;
  private jsonOutputFlag: JsonOutputFlag = "--json";
  private customPromptCatalog: CodexPromptDefinition[] = [];
  private installedSkillCatalog: InstalledSkillDefinition[] = [];

  constructor(
    private readonly app: App,
    private readonly settingsProvider: () => PluginSettings,
    private readonly localeProvider: () => SupportedLocale,
    initialWorkspaceState: PersistedWorkspaceState | null,
    private readonly saveWorkspaceState: (state: PersistedWorkspaceState) => Promise<void>,
    private readonly updateSettings: (next: PluginSettings) => Promise<void>,
  ) {
    this.store = new AgentStore(initialWorkspaceState, this.resolveVaultRoot(), this.hasCodexLogin());
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
    for (const [tabId] of this.activeRuns) {
      this.abortTabRun(tabId, false);
    }
    this.activeRuns.clear();
  }

  refreshSettings(): void {
    this.store.setAuthState(this.hasCodexLogin());
  }

  getLocale(): SupportedLocale {
    return this.localeProvider();
  }

  getLocalizedCopy() {
    return getLocalizedCopy(this.getLocale());
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
    const activeSmartSetId = this.getActiveSmartSetId();
    const activeSmartSet = activeSmartSetId ? this.getSmartSets().find((entry) => entry.id === activeSmartSetId) ?? null : null;
    if (targetFile) {
      this.store.setTargetNotePath(tabId, targetFile.path);
    }
    const workflowContext = this.buildWorkflowPromptContext(tabId, workflow, targetFile?.path ?? null, activeSmartSet?.title ?? null);
    const locale = this.getLocale();
    const draft = buildStudyWorkflowDraft(workflow, workflowContext, locale);
    const workflowDefinition = getStudyWorkflowDefinition(workflow, locale);

    this.store.setTabStudyWorkflow(tabId, workflow);
    this.markStudyHubOpened();
    this.store.setDraft(tabId, draft);
    this.store.setComposeMode(tabId, "chat");
    this.store.setInstructionChips(
      tabId,
      workflowDefinition.instructionLabels.map((label) => ({
        id: makeId("instruction"),
        label,
        createdAt: Date.now(),
      })),
    );
    if (activeSmartSet) {
      this.noteRecentStudySource({
        id: makeId("study-source"),
        label: activeSmartSet.title,
        path: activeSmartSet.savedNotePath,
        kind: "smart_set",
        createdAt: Date.now(),
      });
    }
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

  getShowReasoning(): boolean {
    return this.settingsProvider().showReasoning;
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
    return catalog;
  }

  getInstalledSkills(): InstalledSkillDefinition[] {
    return this.installedSkillCatalog.map((entry) => ({ ...entry }));
  }

  getInstructionOptions(): string[] {
    return [...INSTRUCTION_OPTIONS];
  }

  getTabInstructionChips(tabId: string): Array<{ id: string; label: string; createdAt: number }> {
    return (this.findTab(tabId)?.instructionChips ?? []).map((chip) => ({ ...chip }));
  }

  getTabSummary(tabId: string): { id: string; text: string; createdAt: number } | null {
    const summary = this.findTab(tabId)?.summary ?? null;
    return summary ? { ...summary } : null;
  }

  addInstructionChips(tabId: string, labels: readonly string[]): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const existing = new Set(tab.instructionChips.map((chip) => chip.label.toLowerCase()));
    const additions = labels
      .map((label) => label.trim().toLowerCase())
      .filter((label) => label.length > 0 && !existing.has(label))
      .map((label) => ({
        id: makeId("instruction"),
        label,
        createdAt: Date.now(),
      }));
    if (additions.length === 0) {
      return;
    }
    this.store.setInstructionChips(tabId, [...tab.instructionChips, ...additions]);
  }

  removeInstructionChip(tabId: string, chipId: string): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    this.store.setInstructionChips(
      tabId,
      tab.instructionChips.filter((chip) => chip.id !== chipId),
    );
  }

  forkTab(tabId: string): string | null {
    const tab = this.findTab(tabId);
    if (!tab || this.store.getState().tabs.length >= MAX_OPEN_TABS) {
      return null;
    }
    const fork = this.store.createTab(tab.cwd, `${tab.title} (fork)`, {
      ...this.resolveTabDefaults(),
      draft: "",
      studyWorkflow: tab.studyWorkflow,
      targetNotePath: tab.targetNotePath,
      selectionContext: tab.selectionContext ? { ...tab.selectionContext } : null,
      composeMode: tab.composeMode,
      contextPaths: [...tab.contextPaths],
      lastResponseId: null,
      sessionItems: [],
      codexThreadId: null,
      messages: tab.messages.map((message) => ({ ...message })),
      diffText: tab.diffText,
      toolLog: tab.toolLog.map((entry) => ({ ...entry })),
      patchBasket: tab.patchBasket.map((proposal) => ({ ...proposal, id: makeId("patch-fork") })),
      campaigns: [],
      instructionChips: tab.instructionChips.map((chip) => ({ ...chip })),
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
    if (!tab?.codexThreadId || this.store.getState().tabs.length >= MAX_OPEN_TABS) {
      return null;
    }
    const resumed = this.store.createTab(tab.cwd, `${tab.title} (resume)`, {
      ...this.resolveTabDefaults(),
      draft: "",
      studyWorkflow: tab.studyWorkflow,
      targetNotePath: tab.targetNotePath,
      selectionContext: tab.selectionContext ? { ...tab.selectionContext } : null,
      composeMode: tab.composeMode,
      contextPaths: [...tab.contextPaths],
      lastResponseId: null,
      sessionItems: [],
      codexThreadId: tab.codexThreadId,
      messages: tab.messages.map((message) => ({ ...message })),
      diffText: "",
      toolLog: [],
      patchBasket: [],
      campaigns: [],
      instructionChips: tab.instructionChips.map((chip) => ({ ...chip })),
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

  compactTab(tabId: string): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const locale = this.getLocale();
    const userPrompts = tab.messages.filter((message) => message.kind === "user").slice(-3).map((message) => `- ${message.text.trim()}`);
    const assistantReplies = tab.messages
      .filter((message) => message.kind === "assistant")
      .slice(-3)
      .map((message) => `- ${message.text.trim()}`);
    const lines = [
      locale === "ja" ? `Conversation: ${tab.title}` : `Conversation: ${tab.title}`,
      locale === "ja" ? `Compose mode: ${tab.composeMode}` : `Compose mode: ${tab.composeMode}`,
      tab.targetNotePath ? (locale === "ja" ? `参照ノート: ${tab.targetNotePath}` : `Reference note: ${tab.targetNotePath}`) : null,
      tab.contextPaths.length > 0
        ? locale === "ja"
          ? `追加 context ノート: ${tab.contextPaths.length}`
          : `Extra context notes: ${tab.contextPaths.length}`
        : null,
      tab.instructionChips.length > 0
        ? locale === "ja"
          ? `Instruction chips: ${tab.instructionChips.map((chip) => `#${chip.label}`).join(", ")}`
          : `Instruction chips: ${tab.instructionChips.map((chip) => `#${chip.label}`).join(", ")}`
        : null,
      userPrompts.length > 0 ? (locale === "ja" ? "最近の user リクエスト:" : "Recent user requests:") : null,
      ...userPrompts,
      assistantReplies.length > 0 ? (locale === "ja" ? "最近の Codex 応答:" : "Recent Codex replies:") : null,
      ...assistantReplies,
    ].filter((entry): entry is string => Boolean(entry));
    this.store.setSummary(tabId, {
      id: makeId("summary"),
      text: lines.join("\n"),
      createdAt: Date.now(),
    });
    this.store.setLineage(tabId, {
      ...tab.lineage,
      compactedAt: Date.now(),
    });
  }

  getMentionCandidates(): Array<{ kind: MentionEntityKind; token: string; label: string; description: string }> {
    const locale = this.getLocale();
    const copy = this.getLocalizedCopy();
    const noteCandidates = this.app.vault.getMarkdownFiles().slice(0, 300).map((file) => ({
      kind: "note" as const,
      token: `@note(${file.path})`,
      label: basename(file.path),
      description: file.path,
    }));
    const smartSetCandidates = this.getSmartSets().map((smartSet) => ({
      kind: "smart_set" as const,
      token: `@set(${smartSet.title})`,
      label: smartSet.title,
      description: `Smart Set · ${copy.workspace.notesCount(smartSet.liveResult?.count ?? 0)}`,
    }));
    const skillCandidates = this.installedSkillCatalog.map((skill) => ({
      kind: "skill" as const,
      token: `@skill(${skill.name})`,
      label: skill.name,
      description: skill.description,
    }));
    const externalCandidates = [...new Set([this.resolveVaultRoot(), ...this.store.getState().tabs.map((entry) => entry.cwd)])]
      .filter((path) => path.trim().length > 0)
      .map((path) => ({
        kind: "external_dir" as const,
        token: `@dir(${path})`,
        label: basename(path) || path,
        description: path,
      }));
    const mcpCandidates = [
      {
        kind: "mcp" as const,
        token: "@mcp(github)",
        label: "github",
        description: locale === "ja" ? "MCP サーバー" : "MCP server",
      },
    ];
    return [...noteCandidates, ...smartSetCandidates, ...skillCandidates, ...externalCandidates, ...mcpCandidates];
  }

  getSmartSets(): SmartSet[] {
    return this.store.getState().smartSets.map((entry) => structuredClone(entry));
  }

  getActiveSmartSetId(): string | null {
    return this.store.getState().activeSmartSetId;
  }

  activateSmartSet(smartSetId: string | null): void {
    this.store.activateSmartSet(smartSetId);
  }

  getRefactorRecipes(): RefactorRecipe[] {
    return this.store.getState().refactorRecipes.map((entry) => structuredClone(entry));
  }

  getActiveRefactorRecipeId(): string | null {
    return this.store.getState().activeRefactorRecipeId;
  }

  activateRefactorRecipe(recipeId: string | null): void {
    this.store.activateRefactorRecipe(recipeId);
  }

  async createSmartSetFromPrompt(query: string, tabId: string | null = this.getActiveTab()?.id ?? null): Promise<SmartSet> {
    const normalized = normalizeSmartSetPrompt(query);
    const now = Date.now();
    const liveResult = await this.runSmartSetQuery(normalized.query);
    const smartSet: SmartSet = {
      id: makeId("smart-set"),
      title: normalized.title,
      naturalQuery: query.trim(),
      normalizedQuery: normalized.normalizedQuery,
      savedNotePath: null,
      liveResult,
      lastSnapshot: null,
      lastDrift: null,
      lastRunAt: liveResult.generatedAt,
      createdAt: now,
      updatedAt: now,
    };

    const savedNotePath = await this.upsertSmartSetMirrorNote(smartSet);
    const next = {
      ...smartSet,
      savedNotePath,
      updatedAt: Date.now(),
    };
    this.store.upsertSmartSet(next);
    if (tabId) {
      const copy = this.getLocalizedCopy();
      this.store.addMessage(tabId, {
        id: makeId("smart-set"),
        kind: "system",
        text: copy.service.smartSetSaved(next.title, next.liveResult?.count ?? 0),
        createdAt: Date.now(),
      });
    }
    return next;
  }

  async runSmartSet(smartSetId: string, tabId: string | null = this.getActiveTab()?.id ?? null): Promise<SmartSet> {
    const smartSet = this.requireSmartSet(smartSetId);
    const liveResult = await this.runSmartSetQuery(parseSmartSetQuery(smartSet.normalizedQuery));
    const next: SmartSet = {
      ...smartSet,
      liveResult,
      lastRunAt: liveResult.generatedAt,
      updatedAt: Date.now(),
    };
    const savedNotePath = await this.upsertSmartSetMirrorNote(next);
    const finalized = {
      ...next,
      savedNotePath,
      updatedAt: Date.now(),
    };
    this.store.upsertSmartSet(finalized);
    if (tabId) {
      const copy = this.getLocalizedCopy();
      this.store.addMessage(tabId, {
        id: makeId("smart-set-run"),
        kind: "system",
        text: copy.service.smartSetRefreshed(finalized.title, finalized.liveResult?.count ?? 0),
        createdAt: Date.now(),
      });
    }
    return finalized;
  }

  async refreshSmartSetSnapshot(
    smartSetId: string,
    reason: SmartSetSnapshotReason,
    tabId: string | null = this.getActiveTab()?.id ?? null,
  ): Promise<SmartSet> {
    const smartSet = this.requireSmartSet(smartSetId);
    const liveResult = smartSet.liveResult ?? (await this.runSmartSetQuery(parseSmartSetQuery(smartSet.normalizedQuery)));
    const next: SmartSet = {
      ...smartSet,
      liveResult,
      lastRunAt: liveResult.generatedAt,
      lastSnapshot: {
        result: structuredClone(liveResult),
        createdAt: Date.now(),
        reason,
      },
      updatedAt: Date.now(),
    };
    const savedNotePath = await this.upsertSmartSetMirrorNote(next);
    const finalized = {
      ...next,
      savedNotePath,
      updatedAt: Date.now(),
    };
    this.store.upsertSmartSet(finalized);
    if (tabId && reason === "manual") {
      const copy = this.getLocalizedCopy();
      this.store.addMessage(tabId, {
        id: makeId("smart-set-snapshot"),
        kind: "system",
        text: copy.service.smartSetSnapshotRefreshed(finalized.title),
        createdAt: Date.now(),
      });
    }
    return finalized;
  }

  async computeSmartSetDrift(smartSetId: string, tabId: string | null = this.getActiveTab()?.id ?? null): Promise<SmartSetDrift | null> {
    const smartSet = await this.runSmartSet(smartSetId, null);
    if (!smartSet.lastSnapshot) {
      const baseline = await this.refreshSmartSetSnapshot(smartSetId, "drift", null);
      if (tabId) {
        const copy = this.getLocalizedCopy();
        this.store.addMessage(tabId, {
          id: makeId("smart-set-baseline"),
          kind: "system",
          text: copy.service.smartSetSnapshotBaseline(baseline.title),
          createdAt: Date.now(),
        });
      }
      return null;
    }

    const drift = computeSmartSetDrift(smartSet.liveResult ?? { items: [], count: 0, generatedAt: Date.now() }, smartSet.lastSnapshot);
    const next: SmartSet = {
      ...smartSet,
      lastDrift: drift,
      updatedAt: Date.now(),
    };
    const savedNotePath = await this.upsertSmartSetMirrorNote(next);
    const finalized = {
      ...next,
      savedNotePath,
      updatedAt: Date.now(),
    };
    this.store.upsertSmartSet(finalized);
    if (tabId && drift) {
      const copy = this.getLocalizedCopy();
      this.store.addMessage(tabId, {
        id: makeId("smart-set-drift"),
        kind: "system",
        text: copy.service.smartSetDrift(finalized.title, drift.added.length, drift.removed.length, drift.changed.length),
        createdAt: Date.now(),
      });
    }
    return drift;
  }

  async launchCampaignFromSmartSet(
    smartSetId: string,
    tabId: string | null = this.getActiveTab()?.id ?? null,
    file: TFile | null = this.getPreferredTargetFile(),
    editor: Editor | null = null,
  ): Promise<void> {
    const smartSet = this.requireSmartSet(smartSetId);
    const prepared =
      smartSet.lastSnapshot && smartSet.lastSnapshot.result.items.length > 0
        ? smartSet
        : await this.refreshSmartSetSnapshot(smartSetId, "campaign", null);
    const result = prepared.lastSnapshot?.result ?? prepared.liveResult;
    if (!result || result.items.length === 0) {
      throw new Error(`Smart Set is empty: ${prepared.title}`);
    }
    if (result.items.length > MAX_SMART_SET_CAMPAIGN_RESULTS) {
      throw new Error(
        `Smart Set has ${result.items.length} notes. Refine it to ${MAX_SMART_SET_CAMPAIGN_RESULTS} or fewer before launching a campaign.`,
      );
    }

    const activeTab = tabId ? this.findTab(tabId) : null;
    const resolvedTab = activeTab ?? this.createTab();
    if (!resolvedTab) {
      throw new Error("No Codex tab is available for the Smart Set campaign.");
    }
    if (file) {
      this.store.setTargetNotePath(resolvedTab.id, file.path);
    }
    this.store.setComposeMode(resolvedTab.id, "chat");
    await this.sendPrompt(resolvedTab.id, this.buildSmartSetCampaignPrompt(prepared, result), {
      file,
      editor,
      campaignSeed: {
        query: `Smart Set: ${prepared.title}`,
        targetPaths: result.items.map((item) => item.path),
      },
    });
  }

  async startCurrentNoteSurgery(
    tabId: string,
    file: TFile | null = this.getPreferredTargetFile(),
    editor: Editor | null = null,
  ): Promise<void> {
    const targetFile = file ?? this.getPreferredTargetFile();
    if (!targetFile) {
      throw new Error("No active note is available for Vault Surgeon.");
    }
    this.store.setTargetNotePath(tabId, targetFile.path);
    this.store.setComposeMode(tabId, "chat");
    await this.sendPrompt(
      tabId,
      this.buildScopeCampaignPrompt(`Current note: ${targetFile.path}`, [targetFile.path], [
        "Focus on backlink-safe rename or move options first. Use patches only when they materially improve the note.",
      ]),
      {
        file: targetFile,
        editor,
        campaignSeed: {
          query: `Current note: ${targetFile.path}`,
          targetPaths: [targetFile.path],
        },
      },
    );
  }

  saveRecipeFromCampaign(tabId: string, campaignId: string): RefactorRecipe {
    const tab = this.findTab(tabId);
    const campaign = tab?.campaigns.find((entry) => entry.id === campaignId) ?? null;
    if (!tab || !campaign) {
      throw new Error("Campaign not found.");
    }
    if (campaign.items.length === 0) {
      throw new Error("Cannot save an empty campaign as a recipe.");
    }
    if (!campaign.items.some((item) => item.enabled)) {
      throw new Error("Enable at least one campaign item before saving a recipe.");
    }

    const recipe = buildRefactorRecipeFromCampaign(campaign, makeId("recipe"));
    this.store.upsertRefactorRecipe(recipe);
    const copy = this.getLocalizedCopy();
    this.store.addMessage(tabId, {
      id: makeId("recipe-save"),
      kind: "system",
      text: copy.service.recipeSaved(recipe.title),
      createdAt: Date.now(),
    });
    return recipe;
  }

  removeRefactorRecipe(recipeId: string): void {
    this.store.removeRefactorRecipe(recipeId);
  }

  async runRecipeOnCurrentNote(
    recipeId: string,
    tabId: string,
    file: TFile | null = this.getPreferredTargetFile(),
    editor: Editor | null = null,
  ): Promise<void> {
    const recipe = this.requireRefactorRecipe(recipeId);
    const targetFile = file ?? this.getPreferredTargetFile();
    if (!targetFile) {
      throw new Error("No active note is available for this recipe.");
    }
    this.store.setTargetNotePath(tabId, targetFile.path);
    await this.runRecipeOnPaths(recipe, tabId, `Current note: ${targetFile.path}`, [targetFile.path], targetFile, editor);
  }

  async runRecipeOnActiveSmartSet(
    recipeId: string,
    tabId: string,
    file: TFile | null = this.getPreferredTargetFile(),
    editor: Editor | null = null,
  ): Promise<void> {
    const recipe = this.requireRefactorRecipe(recipeId);
    const activeSmartSetId = this.getActiveSmartSetId();
    if (!activeSmartSetId) {
      throw new Error("No active Smart Set.");
    }
    const prepared = await this.refreshSmartSetSnapshot(activeSmartSetId, "campaign", null);
    const result = prepared.lastSnapshot?.result ?? prepared.liveResult;
    if (!result || result.items.length === 0) {
      throw new Error(`Smart Set is empty: ${prepared.title}`);
    }
    if (result.items.length > MAX_SMART_SET_CAMPAIGN_RESULTS) {
      throw new Error(
        `Smart Set has ${result.items.length} notes. Refine it to ${MAX_SMART_SET_CAMPAIGN_RESULTS} or fewer before running a recipe.`,
      );
    }

    await this.runRecipeOnPaths(
      recipe,
      tabId,
      `Smart Set: ${prepared.title}`,
      result.items.map((item) => item.path),
      file,
      editor,
    );
  }

  async runRecipeFromQuery(
    recipeId: string,
    tabId: string,
    query: string,
    file: TFile | null = this.getPreferredTargetFile(),
    editor: Editor | null = null,
  ): Promise<void> {
    const normalizedInput = normalizeSmartSetPrompt(query.trim());
    const result = await this.runSmartSetQuery(normalizedInput.query);
    if (result.items.length > MAX_SMART_SET_CAMPAIGN_RESULTS) {
      throw new Error(
        `Search matched ${result.items.length} notes. Refine it to ${MAX_SMART_SET_CAMPAIGN_RESULTS} or fewer before running a recipe.`,
      );
    }
    await this.runRecipeOnPaths(
      this.requireRefactorRecipe(recipeId),
      tabId,
      `Search query: ${query.trim()}`,
      result.items.map((item) => item.path),
      file,
      editor,
    );
  }

  async openSmartSetNote(smartSetId: string): Promise<void> {
    const smartSet = this.requireSmartSet(smartSetId);
    if (!smartSet.savedNotePath) {
      throw new Error("This Smart Set does not have a saved note yet.");
    }
    const abstractFile = this.app.vault.getAbstractFileByPath(smartSet.savedNotePath);
    if (!(abstractFile instanceof TFile)) {
      throw new Error(`Smart Set note not found: ${smartSet.savedNotePath}`);
    }
    await this.app.workspace.getLeaf("tab").openFile(abstractFile);
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

  setTabComposeMode(tabId: string, composeMode: ComposeMode): ComposeMode | null {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }
    this.store.setComposeMode(tabId, composeMode);
    return composeMode;
  }

  toggleTabComposeMode(tabId: string): ComposeMode | null {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }
    const nextMode: ComposeMode = tab.composeMode === "plan" ? "chat" : "plan";
    this.store.setComposeMode(tabId, nextMode);
    return nextMode;
  }

  createTab() {
    if (this.store.getState().tabs.length >= MAX_OPEN_TABS) {
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
    return MAX_OPEN_TABS;
  }

  closeTab(tabId: string): void {
    const attachments = this.getTabSessionItems(tabId);
    this.abortTabRun(tabId, false);
    this.pendingCampaignSeeds.delete(tabId);
    this.store.clearApprovals(tabId);
    this.store.closeTab(tabId, this.resolveVaultRoot());
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
    this.store.resetTab(tabId, {
      title: copy.service.newChatTitle,
      draft: "",
      studyWorkflow: null,
      instructionChips: [],
      summary: null,
      lineage: {
        parentTabId: null,
        forkedFromThreadId: null,
        resumedFromThreadId: null,
        compactedAt: null,
      },
      targetNotePath: activeFile?.path ?? null,
      selectionContext: null,
      composeMode: "chat",
      contextPaths: [],
      lastResponseId: null,
      sessionItems: [],
      codexThreadId: null,
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort,
      usageSummary: createEmptyUsageSummary(),
      messages: [],
      diffText: "",
      status: this.hasCodexLogin() ? "ready" : "missing_login",
      runtimeMode: "normal",
      lastError: null,
      pendingApprovals: [],
      toolLog: [],
      patchBasket: [],
      campaigns: [],
      sessionApprovals: { write: false, shell: false },
      waitingState: null,
    });
    this.pendingCampaignSeeds.delete(tabId);
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

  getTabCampaigns(tabId: string): RefactorCampaign[] {
    return (this.findTab(tabId)?.campaigns ?? []).map((campaign) => structuredClone(campaign));
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

    if (hasAccountUsageSummaryData(this.store.getState().accountUsage)) {
      return;
    }

    const threadId = tab.codexThreadId;
    if (!threadId || this.usageSyncInFlight.has(threadId)) {
      return;
    }

    this.usageSyncInFlight.add(threadId);
    void this.syncUsageFromSession(threadId).finally(() => {
      this.usageSyncInFlight.delete(threadId);
    });
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

  startRefactorSession(tabId: string, file: TFile | null): void {
    const targetFile = file ?? this.getPreferredTargetFile();
    if (targetFile) {
      this.store.setTargetNotePath(tabId, targetFile.path);
    }
    this.store.setComposeMode(tabId, "chat");
    this.store.setDraft(tabId, DEFAULT_REFACTOR_SESSION_PROMPT);
  }

  async startRefactorCampaign(tabId: string, query: string, file: TFile | null, editor: Editor | null): Promise<void> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("Provide a search query for the refactor campaign.");
    }
    const targetFile = file ?? this.getPreferredTargetFile();
    if (targetFile) {
      this.store.setTargetNotePath(tabId, targetFile.path);
    }
    this.store.setComposeMode(tabId, "chat");
    await this.sendPrompt(tabId, `/campaign ${normalizedQuery}`, { file: targetFile, editor });
  }

  toggleCampaignItem(tabId: string, campaignId: string, itemId: string, enabled: boolean): void {
    this.store.updateCampaign(tabId, campaignId, (campaign) => ({
      ...campaign,
      items: campaign.items.map((item) => (item.id === itemId ? { ...item, enabled } : item)),
    }));
  }

  dismissCampaign(tabId: string, campaignId: string): void {
    this.store.removeCampaign(tabId, campaignId);
  }

  private async handleSmartSetLocalAction(
    tabId: string,
    action: { type: "create" | "run" | "drift" | "campaign"; query?: string; smartSetId?: string },
    context?: SendPromptContext,
  ): Promise<void> {
    if (action.type === "create") {
      await this.createSmartSetFromPrompt(action.query ?? "", tabId);
      return;
    }
    if (!action.smartSetId) {
      throw new Error("Smart Set reference is missing.");
    }
    if (action.type === "run") {
      await this.runSmartSet(action.smartSetId, tabId);
      return;
    }
    if (action.type === "drift") {
      await this.computeSmartSetDrift(action.smartSetId, tabId);
      return;
    }
    await this.launchCampaignFromSmartSet(action.smartSetId, tabId, context?.file ?? null, context?.editor ?? null);
  }

  private requireSmartSet(smartSetId: string): SmartSet {
    const smartSet = this.store.getState().smartSets.find((entry) => entry.id === smartSetId) ?? null;
    if (!smartSet) {
      throw new Error(`Smart Set not found: ${smartSetId}`);
    }
    return structuredClone(smartSet);
  }

  private async runSmartSetQuery(query: SmartSetQuery): Promise<SmartSetResult> {
    const candidates = await this.collectSmartSetCandidates();
    const result = executeSmartSetQuery(query, candidates, Date.now());
    if (result.count > MAX_SMART_SET_RESULTS) {
      throw new Error(`Smart Set matched ${result.count} notes. Refine it to ${MAX_SMART_SET_RESULTS} or fewer notes.`);
    }
    return result;
  }

  private async collectSmartSetCandidates(): Promise<SmartSetCandidate[]> {
    const candidates: SmartSetCandidate[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = [...new Set((cache?.tags ?? []).map((entry) => entry.tag.replace(/^#/, "").toLowerCase()))];
      const properties = Object.entries(cache?.frontmatter ?? {}).reduce<Record<string, string>>((accumulator, [key, value]) => {
        if (key === "position") {
          return accumulator;
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          accumulator[key.toLowerCase()] = String(value).trim().toLowerCase();
        }
        return accumulator;
      }, {});
      candidates.push({
        path: file.path,
        title: basename(file.basename || file.path, ".md"),
        text: content,
        tags,
        properties,
        mtime: file.stat?.mtime ?? null,
        size: file.stat?.size ?? null,
      });
    }
    return candidates;
  }

  private resolveSmartSetNoteFolderPath(): string {
    return SMART_SET_NOTE_FOLDER_SEGMENTS.join("/");
  }

  private noteRecentStudySource(source: RecentStudySource): void {
    this.store.addRecentStudySource(source, MAX_RECENT_STUDY_SOURCES);
  }

  private resolveSmartSetNotePath(smartSet: SmartSet): string {
    if (smartSet.savedNotePath?.trim()) {
      return smartSet.savedNotePath;
    }
    return `${this.resolveSmartSetNoteFolderPath()}/${slugifySmartSetTitle(smartSet.title)}-${smartSet.id.slice(-6)}.md`;
  }

  private async ensureVaultFolder(folderPath: string): Promise<void> {
    const normalized = folderPath.replace(/\\/g, "/").trim();
    if (!normalized) {
      return;
    }
    let currentPath = "";
    for (const segment of normalized.split("/").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(currentPath)) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  private async upsertSmartSetMirrorNote(smartSet: SmartSet): Promise<string> {
    const notePath = this.resolveSmartSetNotePath(smartSet);
    await this.ensureVaultFolder(dirname(notePath).replace(/\\/g, "/"));
    const nextText = buildSmartSetMirrorMarkdown({
      ...smartSet,
      savedNotePath: notePath,
    });
    const abstractFile = this.app.vault.getAbstractFileByPath(notePath);
    if (abstractFile instanceof TFile) {
      await this.app.vault.modify(abstractFile, nextText);
    } else {
      await this.app.vault.create(notePath, nextText);
    }
    return notePath;
  }

  private buildSmartSetCampaignPrompt(smartSet: SmartSet, result: SmartSetResult): string {
    return this.buildScopeCampaignPrompt(`Smart Set: ${smartSet.title}`, result.items.map((item) => item.path), [
      `Natural query: ${smartSet.naturalQuery}`,
    ]);
  }

  private buildScopeCampaignPrompt(scopeLabel: string, targetPaths: readonly string[], leadingLines: string[] = []): string {
    return [
      scopeLabel,
      ...leadingLines,
      `Target notes (${targetPaths.length})`,
      ...targetPaths.map((path) => `- ${path}`),
      "",
      "Prepare a coordinated refactor campaign for this exact note set.",
      "Prefer a small number of high-value changes.",
      "You may propose backlink-safe rename, move, property, and task changes with `obsidian-ops`.",
      "You may propose note-body updates with `obsidian-patch`.",
      "Explain the campaign briefly before the fenced blocks.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private requireRefactorRecipe(recipeId: string): RefactorRecipe {
    const recipe = this.store.getState().refactorRecipes.find((entry) => entry.id === recipeId) ?? null;
    if (!recipe) {
      throw new Error("Refactor recipe not found.");
    }
    return structuredClone(recipe);
  }

  private async runRecipeOnPaths(
    recipe: RefactorRecipe,
    tabId: string,
    query: string,
    targetPaths: string[],
    file: TFile | null,
    editor: Editor | null,
  ): Promise<void> {
    if (targetPaths.length === 0) {
      throw new Error("No notes are available for this recipe.");
    }
    if (targetPaths.length > MAX_SMART_SET_CAMPAIGN_RESULTS) {
      throw new Error(`This recipe scope has ${targetPaths.length} notes. Refine it to ${MAX_SMART_SET_CAMPAIGN_RESULTS} or fewer.`);
    }

    const targetFile = file ?? this.getPreferredTargetFile();
    if (targetFile) {
      this.store.setTargetNotePath(tabId, targetFile.path);
    }
    this.store.activateRefactorRecipe(recipe.id);
    this.store.setComposeMode(tabId, "chat");
    await this.sendPrompt(tabId, buildRecipeCampaignPrompt(recipe, query, targetPaths), {
      file: targetFile,
      editor,
      campaignSeed: {
        query: `${recipe.title} · ${query}`,
        targetPaths,
      },
    });
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
    this.store.setAuthState(this.hasCodexLogin());
    return Promise.resolve();
  }

  async ensureStarted(): Promise<void> {
    await this.refreshModelCatalog();
    await this.refreshCodexCatalogs();
    const hasLogin = this.hasCodexLogin();
    this.store.setAuthState(hasLogin);
    this.store.setRuntimeIssue(hasLogin ? null : this.getMissingLoginMessage());
    this.normalizeTabTargetNotes();
    this.seedInitialTargetNote();
    await this.syncKnownUsageFromSessions();
  }

  async sendPrompt(
    tabId: string,
    input: string,
    context?: SendPromptContext,
  ): Promise<void> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const selectionContext = tab.selectionContext ?? null;
    const attachments = this.getTabSessionItems(tabId);
    const normalizedInput =
      input.trim() ||
      (selectionContext && attachments.length > 0
        ? DEFAULT_SELECTION_AND_ATTACHMENT_PROMPT
        : selectionContext
          ? DEFAULT_SELECTION_PROMPT
          : attachments.length > 0
            ? DEFAULT_ATTACHMENT_PROMPT
            : "");
    if (!normalizedInput) {
      return;
    }
    if (tab.status === "busy" || tab.status === "waiting_approval") {
      throw new Error(this.getLocalizedCopy().service.tabAlreadyRunning);
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
      patchBasket: tab.patchBasket,
      smartSets: this.getSmartSets(),
      activeSmartSetId: this.getActiveSmartSetId(),
    });

    if (expanded.localAction) {
      await this.handleSmartSetLocalAction(tabId, expanded.localAction, context);
      this.store.setDraft(tabId, "");
      return;
    }

    if (!this.hasCodexLogin()) {
      const message = this.getMissingLoginMessage();
      this.store.setAuthState(false);
      this.store.setRuntimeIssue(message);
      throw new Error(message);
    }

    const campaignSeed = context?.campaignSeed ?? expanded.campaignSeed ?? null;
    if (campaignSeed) {
      this.pendingCampaignSeeds.set(tabId, {
        query: campaignSeed.query,
        targetPaths: [...campaignSeed.targetPaths],
      });
    } else {
      this.pendingCampaignSeeds.delete(tabId);
    }

    const promptMetadata = extractPromptMetadata(expanded.prompt.trim());
    const prompt = promptMetadata.cleanedPrompt.trim();
    if (!prompt) {
      throw new Error(this.getLocalizedCopy().service.promptEmptyAfterExpansion);
    }

    if (promptMetadata.instructionLabels.length > 0) {
      this.addInstructionChips(tabId, promptMetadata.instructionLabels);
    }

    const mentionResolution = await this.resolveMentionContext(promptMetadata.mentions);
    const workflowSkillRefs = tab.studyWorkflow
      ? getStudyWorkflowDefinition(tab.studyWorkflow, this.getLocale()).safeAutoSkillRefs.map((name) => `$${name}`)
      : [];
    const requestedSkillNames = await this.resolveRequestedSkills(
      [expanded.skillPrompt.trim(), ...mentionResolution.skillNames.map((name) => `$${name}`), ...workflowSkillRefs]
        .filter(Boolean)
        .join("\n"),
    );
    const skillNames = await this.resolveTurnSkillNames(tab.composeMode, requestedSkillNames);
    const executionPrompt = tab.composeMode === "plan" ? formatPlanModePrompt(prompt, skillNames) : prompt;
    const runtimeMode: RuntimeMode = skillNames.length > 0 ? "skill" : "normal";
    const composeMode = tab.composeMode;
    const contextSnapshot = await this.captureTurnContext(
      tabId,
      context?.file ?? null,
      context?.editor ?? null,
      expanded.command,
      attachments,
      mentionResolution.contextText,
    );
    const allowVaultWrite = composeMode === "plan" ? false : allowsVaultWrite(prompt);
    const imagePaths = [
      ...attachments.filter((attachment) => attachment.kind === "image").map((attachment) => attachment.stagedPath),
      ...(context?.images ?? []),
    ];

    this.store.setDraft(tabId, "");
    this.store.setRuntimeIssue(null);
    this.store.setRuntimeMode(tabId, runtimeMode);
    if (!tab.messages.length) {
      this.store.setTitle(tabId, sanitizeTitle(prompt, this.getLocalizedCopy().service.newChatTitle));
    }

    this.appendSelectionContextMessage(tabId, selectionContext);
    this.appendAttachmentSummaryMessage(tabId, attachments);
    this.store.addMessage(tabId, {
      id: makeId("user"),
      kind: "user",
      text: prompt,
      createdAt: Date.now(),
    });

    void this.runTurn(tabId, executionPrompt, runtimeMode, composeMode, skillNames, contextSnapshot, imagePaths, allowVaultWrite);
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
    this.abortTabRun(tabId, true);
  }

  async respondToApproval(approvalId: string, decision: ToolDecision): Promise<ApprovalResult> {
    const state = this.store.getState();
    const tab = state.tabs.find((entry) => entry.pendingApprovals.some((approval) => approval.id === approvalId)) ?? null;
    if (!tab) {
      return "ignored";
    }
    const approval = tab.pendingApprovals.find((entry) => entry.id === approvalId) ?? null;
    if (!approval) {
      return "ignored";
    }

    if (decision === "abort") {
      const copy = this.getLocalizedCopy();
      this.abortTabRun(tab.id, false);
      this.store.removeApproval(approvalId);
      this.updateCampaignItemStatusByRef(tab.id, approvalId, "failed");
      this.store.addMessage(tab.id, {
        id: makeId("approval-abort"),
        kind: "system",
        text: copy.service.approvalAborted(approval.title),
        createdAt: Date.now(),
      });
      this.reconcileApprovalStatus(tab.id);
      return "aborted";
    }

    if (decision === "deny") {
      const copy = this.getLocalizedCopy();
      this.store.removeApproval(approvalId);
      this.updateCampaignItemStatusByRef(tab.id, approvalId, "failed");
      this.store.addMessage(tab.id, {
        id: makeId("approval-deny"),
        kind: "system",
        text: copy.service.approvalDenied(approval.title),
        createdAt: Date.now(),
      });
      this.reconcileApprovalStatus(tab.id);
      return "denied";
    }

    if (approval.transport === "plugin_proposal" && approval.toolName === "vault_op" && approval.toolPayload) {
      if (decision === "approve_session" && approval.scope) {
        this.store.setSessionApproval(tab.id, approval.scope, true);
      }
      this.store.setStatus(tab.id, "waiting_approval");
      try {
        await this.executeVaultOpApproval(tab.id, approval);
        this.store.removeApproval(approvalId);
        this.updateCampaignItemStatusByRef(tab.id, approvalId, "applied");
        this.store.addMessage(tab.id, {
          id: makeId("approval-ok"),
          kind: "system",
          text: this.getLocalizedCopy().service.approvalApplied(approval.title),
          createdAt: Date.now(),
        });
        this.reconcileApprovalStatus(tab.id);
        return "applied";
      } catch (error) {
        const message = getErrorMessage(error);
        this.store.upsertToolLog(tab.id, `approval-${approval.id}`, (current) =>
          buildActivityRecord(
            current,
            `approval-${approval.id}`,
            approval.toolName === "vault_op" ? "file" : "tool",
            approval.toolName,
            approval.title,
            approval.description,
            safeJson(approval.toolPayload),
            "failed",
            message,
          ),
        );
        this.store.addMessage(tab.id, {
          id: makeId("approval-error"),
          kind: "system",
          text: `${approval.title} failed: ${message}`,
          createdAt: Date.now(),
        });
        this.store.removeApproval(approvalId);
        this.updateCampaignItemStatusByRef(tab.id, approvalId, "failed");
        this.reconcileApprovalStatus(tab.id);
        return "failed";
      }
    }

    this.store.removeApproval(approvalId);
    this.updateCampaignItemStatusByRef(tab.id, approvalId, "failed");
    this.reconcileApprovalStatus(tab.id);
    return "ignored";
  }

  async respondToAllApprovals(tabId: string, decision: "approve" | "approve_session" | "deny"): Promise<void> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const approvals = tab.pendingApprovals.filter((approval) => approval.toolName === "vault_op");
    if (approvals.length === 0) {
      return;
    }

    let applied = 0;
    let denied = 0;
    let failed = 0;
    if (decision === "approve_session") {
      this.store.setSessionApproval(tabId, "write", true);
    }
    this.store.setStatus(tabId, "waiting_approval");
    for (const approval of approvals) {
      const result = await this.respondToApproval(approval.id, decision);
      if (result === "applied") {
        applied += 1;
      } else if (result === "denied") {
        denied += 1;
      } else if (result === "failed") {
        failed += 1;
      }
    }

    this.store.addMessage(tabId, {
      id: makeId("approval-batch"),
      kind: "system",
      text: this.getLocalizedCopy().service.batchApprovalFinished(applied, denied, failed),
      createdAt: Date.now(),
    });
    this.reconcileApprovalStatus(tabId);
  }

  async applyCampaign(tabId: string, campaignId: string): Promise<void> {
    const tab = this.findTab(tabId);
    const campaign = tab?.campaigns.find((entry) => entry.id === campaignId) ?? null;
    if (!tab || !campaign) {
      return;
    }

    const enabledItems = campaign.items.filter((item) => item.enabled);
    if (enabledItems.length === 0) {
      throw new Error("Enable at least one campaign item before applying it.");
    }

    const snapshotCapsule = campaign.snapshotCapsule ?? (await this.createCampaignSnapshotCapsule(tabId, campaign));
    this.store.updateCampaign(tabId, campaignId, (current) => ({
      ...current,
      snapshotCapsule,
      status: "ready",
    }));

    const steps: CampaignExecutionStep[] = [];
    let completed = 0;
    let failed = 0;

    for (const item of enabledItems.filter((entry) => entry.kind === "vault_op")) {
      const result = await this.respondToApproval(item.refId, "approve");
      if (result === "applied") {
        completed += 1;
        steps.push({
          id: makeId("campaign-step"),
          itemId: item.id,
          action: "apply",
          status: "completed",
          message: `${item.title} applied.`,
          createdAt: Date.now(),
        });
        this.store.updateCampaign(tabId, campaignId, (current) => ({
          ...current,
          items: current.items.map((entry) => (entry.id === item.id ? { ...entry, status: "applied" } : entry)),
        }));
        continue;
      }

      failed += 1;
      steps.push({
        id: makeId("campaign-step"),
        itemId: item.id,
        action: "apply",
        status: "failed",
        message: `${item.title} failed.`,
        createdAt: Date.now(),
      });
      this.store.updateCampaign(tabId, campaignId, (current) => ({
        ...current,
        items: current.items.map((entry) => (entry.id === item.id ? { ...entry, status: "failed" } : entry)),
      }));
    }

    for (const item of enabledItems.filter((entry) => entry.kind === "patch")) {
      try {
        await this.applyPatchProposal(tabId, item.refId);
        completed += 1;
        steps.push({
          id: makeId("campaign-step"),
          itemId: item.id,
          action: "apply",
          status: "completed",
          message: `${item.title} applied.`,
          createdAt: Date.now(),
        });
        this.store.updateCampaign(tabId, campaignId, (current) => ({
          ...current,
          items: current.items.map((entry) => (entry.id === item.id ? { ...entry, status: "applied" } : entry)),
        }));
      } catch (error) {
        failed += 1;
        steps.push({
          id: makeId("campaign-step"),
          itemId: item.id,
          action: "apply",
          status: "failed",
          message: getErrorMessage(error),
          createdAt: Date.now(),
        });
        this.store.updateCampaign(tabId, campaignId, (current) => ({
          ...current,
          items: current.items.map((entry) => (entry.id === item.id ? { ...entry, status: "failed" } : entry)),
        }));
      }
    }

    this.store.updateCampaign(tabId, campaignId, (current) => ({
      ...current,
      snapshotCapsule,
      executionLog: [...current.executionLog, ...steps],
      status: failed > 0 ? "failed" : "applied",
    }));
    this.store.addMessage(tabId, {
      id: makeId("campaign-apply"),
      kind: "system",
      text: summarizeCampaignExecution("apply", completed, failed, this.getLocale()),
      createdAt: Date.now(),
    });
  }

  async rollbackCampaign(tabId: string, campaignId: string): Promise<void> {
    const tab = this.findTab(tabId);
    const campaign = tab?.campaigns.find((entry) => entry.id === campaignId) ?? null;
    if (!tab || !campaign?.snapshotCapsule) {
      throw new Error("No rollback capsule is available for this campaign.");
    }

    const steps: CampaignExecutionStep[] = [];
    let completed = 0;
    let failed = 0;

    const moveItems = [...campaign.items]
      .filter((item) => item.enabled && item.kind === "vault_op" && item.operationKind !== "property_set" && item.operationKind !== "property_remove" && item.operationKind !== "task_update")
      .reverse();
    for (const item of moveItems) {
      try {
        if (item.destinationPath) {
          const destination = this.app.vault.getAbstractFileByPath(item.destinationPath);
          if (destination instanceof TFile) {
            await this.ensureParentFolder(item.targetPath);
            await this.app.fileManager.renameFile(destination, item.targetPath);
            this.repointFilePathReferences(item.destinationPath, item.targetPath);
          }
        }
        completed += 1;
        steps.push({
          id: makeId("campaign-step"),
          itemId: item.id,
          action: "rollback",
          status: "completed",
          message: `${item.title} rolled back.`,
          createdAt: Date.now(),
        });
      } catch (error) {
        failed += 1;
        steps.push({
          id: makeId("campaign-step"),
          itemId: item.id,
          action: "rollback",
          status: "failed",
          message: getErrorMessage(error),
          createdAt: Date.now(),
        });
      }
    }

    for (const snapshot of campaign.snapshotCapsule.files) {
      try {
        const abstractFile = this.app.vault.getAbstractFileByPath(snapshot.path);
        const file = abstractFile instanceof TFile ? abstractFile : null;
        if (snapshot.existed) {
          if (file) {
            await this.app.vault.modify(file, snapshot.text ?? "");
          } else {
            await this.ensureParentFolder(snapshot.path);
            await this.app.vault.create(snapshot.path, snapshot.text ?? "");
          }
        } else if (file) {
          await this.app.vault.delete(file, true);
        }
        completed += 1;
      } catch (error) {
        failed += 1;
        steps.push({
          id: makeId("campaign-step"),
          itemId: snapshot.path,
          action: "rollback",
          status: "failed",
          message: getErrorMessage(error),
          createdAt: Date.now(),
        });
      }
    }

    this.store.updateCampaign(tabId, campaignId, (current) => ({
      ...current,
      executionLog: [...current.executionLog, ...steps],
      status: failed > 0 ? "failed" : "rolled_back",
      items: failed > 0 ? current.items : current.items.map((item) => (item.enabled ? { ...item, status: "rolled_back" } : item)),
    }));
    this.store.addMessage(tabId, {
      id: makeId("campaign-rollback"),
      kind: "system",
      text: summarizeCampaignExecution("rollback", completed, failed, this.getLocale()),
      createdAt: Date.now(),
    });
  }

  async applyPatchProposal(tabId: string, patchId: string): Promise<void> {
    const tab = this.findTab(tabId);
    const proposal = tab?.patchBasket.find((entry) => entry.id === patchId) ?? null;
    if (!tab || !proposal) {
      return;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(proposal.targetPath);
    const file = abstractFile instanceof TFile ? abstractFile : null;
    const currentContent = file ? await this.app.vault.cachedRead(file) : null;

    if (proposal.kind === "create") {
      if (file && currentContent !== proposal.proposedText) {
        this.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "conflicted" }));
        throw new Error(`${proposal.targetPath} already exists with different content.`);
      }
      if (!file) {
        await this.ensureParentFolder(proposal.targetPath);
        await this.app.vault.create(proposal.targetPath, proposal.proposedText);
      }
    } else {
      if (!file) {
        this.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "stale" }));
        throw new Error(`${proposal.targetPath} no longer exists.`);
      }
      if (currentContent !== proposal.baseSnapshot) {
        this.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "conflicted" }));
        throw new Error(`${proposal.targetPath} changed since Codex proposed this patch.`);
      }
      await this.app.vault.modify(file, proposal.proposedText);
    }

    this.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "applied" }));
    this.updateCampaignItemStatusByRef(tabId, patchId, "applied");
    this.store.upsertToolLog(tabId, `patch-${patchId}`, (current) =>
      buildActivityRecord(
        current,
        `patch-${patchId}`,
        "file",
        "write_note",
        proposal.kind === "create" ? "Create note" : "Apply note patch",
        proposal.summary,
        proposal.unifiedDiff,
        "completed",
        proposal.targetPath,
      ),
    );
    this.store.addMessage(tabId, {
      id: makeId("patch-applied"),
      kind: "system",
      text:
        proposal.kind === "create"
          ? this.getLocalizedCopy().service.patchCreated(proposal.targetPath)
          : this.getLocalizedCopy().service.patchApplied(proposal.targetPath),
      createdAt: Date.now(),
    });
  }

  rejectPatchProposal(tabId: string, patchId: string): void {
    const proposal = this.findTab(tabId)?.patchBasket.find((entry) => entry.id === patchId) ?? null;
    if (!proposal) {
      return;
    }
    this.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "rejected" }));
    this.updateCampaignItemStatusByRef(tabId, patchId, "failed");
    this.store.addMessage(tabId, {
      id: makeId("patch-rejected"),
      kind: "system",
      text: this.getLocalizedCopy().service.patchRejected(proposal.targetPath),
      createdAt: Date.now(),
    });
  }

  async openPatchTarget(tabId: string, patchId: string): Promise<void> {
    const proposal = this.findTab(tabId)?.patchBasket.find((entry) => entry.id === patchId) ?? null;
    if (!proposal) {
      return;
    }
    const abstractFile = this.app.vault.getAbstractFileByPath(proposal.targetPath);
    if (!(abstractFile instanceof TFile)) {
      throw new Error(this.getLocalizedCopy().service.patchTargetMissing(proposal.targetPath));
    }
    await this.app.workspace.getLeaf(false).openFile(abstractFile);
  }

  private async runTurn(
    tabId: string,
    prompt: string,
    mode: RuntimeMode,
    composeMode: ComposeMode,
    skillNames: string[],
    turnContext: TurnContextSnapshot,
    images: string[],
    allowVaultWrite: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    this.activeRuns.set(tabId, { controller, mode });
    this.store.setRuntimeMode(tabId, mode);
    this.store.setStatus(tabId, "busy");
    this.store.setWaitingState(tabId, this.createWaitingState("boot", mode));
    this.store.clearApprovals(tabId);

    let terminalError: string | null = null;
    const model = this.resolveSelectedModel(tabId);
    const reasoningEffort = this.resolveSelectedReasoningEffort(tabId, model);
    const permissionProfile =
      composeMode === "plan"
        ? {
            sandboxMode: "read-only" as const,
            approvalPolicy: "untrusted" as const,
          }
        : getPermissionModeProfile(this.settingsProvider().permissionMode);

    try {
      const { threadId } = await this.runCodexStream({
        prompt: buildTurnPrompt(prompt, turnContext, mode, skillNames, composeMode, allowVaultWrite),
        tabId,
        threadId: this.findTab(tabId)?.codexThreadId ?? null,
        workingDirectory: this.findTab(tabId)?.cwd || this.resolveVaultRoot(),
        sandboxMode: permissionProfile.sandboxMode,
        approvalPolicy: permissionProfile.approvalPolicy,
        images,
        model,
        reasoningEffort,
        signal: controller.signal,
        onEvent: (event) => {
          terminalError = this.handleThreadEvent(tabId, event) ?? terminalError;
        },
      });

      this.activeRuns.delete(tabId);
      this.finalizePendingMessages(tabId);
      this.store.setWaitingState(tabId, null);
      this.store.setLastResponseId(tabId, null);
      if (threadId) {
        this.store.setCodexThreadId(tabId, threadId);
        await this.syncUsageFromSession(threadId);
        await this.syncTranscriptFromSession(tabId, threadId);
      }
      if (terminalError) {
        this.pendingCampaignSeeds.delete(tabId);
        this.store.setRuntimeIssue(terminalError);
        this.store.setStatus(tabId, this.isLoginError(terminalError) ? "missing_login" : "error", terminalError);
        if (this.isLoginError(terminalError)) {
          this.store.setAuthState(false);
        }
        this.store.addMessage(tabId, {
          id: makeId("error"),
          kind: "system",
          text: terminalError,
          createdAt: Date.now(),
        });
        return;
      }

      await this.clearComposerArtifacts(tabId);
      this.pendingCampaignSeeds.delete(tabId);
      this.reconcileApprovalStatus(tabId);
    } catch (error) {
      this.activeRuns.delete(tabId);
      this.finalizePendingMessages(tabId);
      this.store.setWaitingState(tabId, null);
      if (isAbortError(error)) {
        this.store.addMessage(tabId, {
          id: makeId("aborted"),
          kind: "system",
          text: this.getLocalizedCopy().service.turnInterrupted,
          createdAt: Date.now(),
        });
        this.pendingCampaignSeeds.delete(tabId);
        this.reconcileApprovalStatus(tabId);
        return;
      }

      const message = getErrorMessage(error);
      const normalizedMessage = this.normalizeCodexError(message);
      const missingLogin = this.isLoginError(normalizedMessage);
      if (missingLogin) {
        this.store.setAuthState(false);
      }
      this.store.setRuntimeIssue(normalizedMessage);
      this.store.setStatus(tabId, missingLogin ? "missing_login" : "error", normalizedMessage);
      this.store.addMessage(tabId, {
        id: makeId("error"),
        kind: "system",
        text: normalizedMessage,
        createdAt: Date.now(),
      });
      this.pendingCampaignSeeds.delete(tabId);
    }
  }

  private async runCodexStream(request: CodexRunRequest): Promise<CodexRunResult> {
    const flags: JsonOutputFlag[] =
      this.jsonOutputFlag === "--experimental-json" ? ["--experimental-json"] : ["--json", "--experimental-json"];
    let lastError: unknown = null;

    for (const jsonOutputFlag of flags) {
      let currentEffort = request.reasoningEffort;
      const attemptedEfforts = new Set<string>([currentEffort ?? "__none__"]);

      while (true) {
        try {
          const threadId = await this.executeCodexStream(request, jsonOutputFlag, currentEffort);
          this.jsonOutputFlag = jsonOutputFlag;
          return {
            threadId,
          };
        } catch (error) {
          lastError = error;
          const message = getErrorMessage(error);
          if (jsonOutputFlag === "--json" && isUnsupportedJsonFlagError(message, jsonOutputFlag)) {
            break;
          }

          const fallbackEffort = this.getFallbackReasoningEffort(request.model, message, currentEffort);
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
    const spec = buildCodexSpawnSpec(this.resolveCodexCommand(), {
      jsonOutputFlag,
      model: request.model,
      threadId: request.threadId,
      workingDirectory: request.workingDirectory,
      sandboxMode: request.sandboxMode,
      approvalPolicy: request.approvalPolicy,
      images: request.images,
      reasoningEffort,
    });

    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stderrChunks: Buffer[] = [];
    let threadId = request.threadId;
    let spawnError: Error | null = null;
    let terminalEventError: string | null = null;

    child.once("error", (error) => {
      spawnError = error;
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
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
      throw createAbortError();
    }
    request.signal.addEventListener("abort", abortListener, { once: true });

    child.stdin.write(request.prompt);
    child.stdin.end();

    const reader = createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
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
        } else if (asString(event.type) === "turn.failed") {
          terminalEventError = getErrorMessage(asRecord(event.error));
        } else if (asString(event.type) === "error") {
          terminalEventError = unwrapApiErrorMessage(asString(event.message) ?? "");
        } else if (asString(asRecord(event.item)?.type) === "error") {
          terminalEventError = unwrapApiErrorMessage(
            asString(asRecord(event.item)?.message) ?? getErrorMessage(asRecord(asRecord(event.item)?.error)),
          );
        }
        request.onEvent(event);
      }

      const { code, signal } = await exitResult;
      if (request.signal.aborted) {
        throw createAbortError();
      }
      if (spawnError) {
        throw spawnError;
      }
      if (code !== 0 || signal) {
        throw new Error(this.buildCliExitMessage(stderrChunks, code, signal, spec, terminalEventError));
      }
      return threadId;
    } finally {
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

  private buildCliExitMessage(
    stderrChunks: Buffer[],
    code: number | null,
    signal: NodeJS.Signals | null,
    spec: ReturnType<typeof buildCodexSpawnSpec>,
    terminalEventError: string | null,
  ): string {
    if (terminalEventError) {
      return unwrapApiErrorMessage(terminalEventError);
    }
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    if (stderr) {
      return unwrapApiErrorMessage(stderr);
    }
    const exitDetail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    return this.getLocale() === "ja"
      ? `Codex CLI が ${exitDetail} で終了しました。\nResolved command: ${renderCodexSpawnSpec(spec)}`
      : `Codex CLI exited with ${exitDetail}.\nResolved command: ${renderCodexSpawnSpec(spec)}`;
  }

  private handleThreadEvent(tabId: string, event: JsonRecord): string | null {
    const usagePatch = extractUsageSummaryPatch(event);
    if (usagePatch) {
      const currentUsage = this.findTab(tabId)?.usageSummary ?? createEmptyUsageSummary();
      this.store.setUsageSummary(tabId, mergeUsageSummary(currentUsage, usagePatch));
      this.updateAccountUsageFromPatch(
        usagePatch.limits ?? null,
        extractCodexSessionId(event) ?? this.findTab(tabId)?.codexThreadId ?? null,
        "live",
        Date.now(),
      );
    }

    const eventType = asString(event.type);
    const payload = asRecord(event.payload);
    const mode = this.findTab(tabId)?.runtimeMode ?? "normal";
    const threadId = extractCodexSessionId(event);
    if (threadId) {
      if (threadId) {
        this.store.setCodexThreadId(tabId, threadId);
      }
      return null;
    }

    if (eventType === "turn.failed") {
      this.failRunningActivities(tabId, getErrorMessage(asRecord(event.error)));
      return getErrorMessage(asRecord(event.error));
    }

    if (eventType === "error") {
      this.failRunningActivities(tabId, unwrapApiErrorMessage(asString(event.message) ?? "Unknown Codex error."));
      return unwrapApiErrorMessage(asString(event.message) ?? "Unknown Codex error.");
    }

    if (eventType === "event_msg" && payload) {
      const payloadType = asString(payload.type);
      if (payloadType === "task_started") {
        this.setWaitingPhase(tabId, "boot", mode);
        return null;
      }

      if (payloadType === "task_complete") {
        const text = extractTaskCompleteMessageText(payload);
        if (text) {
          this.appendAssistantFallbackMessage(tabId, text, buildEventBackedMessageId(event, "final_answer", "codex-message"));
        }
        return null;
      }

      if (payloadType === "agent_message") {
        const text = asString(payload.message);
        if (!text) {
          return null;
        }
        const phase = asString(payload.phase) ?? "final_answer";
        const messageId = buildEventBackedMessageId(event, phase, "codex-message");
        this.setWaitingPhase(tabId, "finalizing", mode);
        this.store.upsertMessage(tabId, messageId, (current) => ({
          id: current?.id ?? messageId,
          kind: "assistant",
          text,
          createdAt: current?.createdAt ?? Date.now(),
          pending: false,
        }));
        this.queueAssistantArtifactSync(tabId, messageId, text);
        return null;
      }
    }

    if (eventType === "response_item" && payload) {
      const payloadType = asString(payload.type);
      if (payloadType === "message") {
        if (asString(payload.role) !== "assistant") {
          return null;
        }
        const text = extractResponseMessageText(payload);
        if (!text) {
          return null;
        }
        const phase = asString(payload.phase) ?? "final_answer";
        const messageId = buildEventBackedMessageId(event, phase, "codex-message");
        this.setWaitingPhase(tabId, "finalizing", mode);
        this.store.upsertMessage(tabId, messageId, (current) => ({
          id: current?.id ?? messageId,
          kind: "assistant",
          text,
          createdAt: current?.createdAt ?? Date.now(),
          pending: false,
        }));
        this.queueAssistantArtifactSync(tabId, messageId, text);
        return null;
      }

      if (payloadType === "reasoning") {
        this.setWaitingPhase(tabId, "reasoning", mode);
        if (!this.settingsProvider().showReasoning) {
          return null;
        }
        const text = extractReasoningText(payload);
        if (!text) {
          return null;
        }
        this.store.upsertMessage(tabId, buildEventBackedMessageId(event, "reasoning", "codex-reasoning"), (current) => ({
          id: current?.id ?? buildEventBackedMessageId(event, "reasoning", "codex-reasoning"),
          kind: "reasoning",
          text,
          createdAt: current?.createdAt ?? Date.now(),
          pending: false,
        }));
        return null;
      }

      if (payloadType === "function_call" || payloadType === "function_call_output") {
        this.setWaitingPhase(tabId, "tools", mode);
        this.recordResponseItemActivity(tabId, payload, payloadType === "function_call");
        return null;
      }
    }

    const item = asRecord(event.item);
    if (!item) {
      return null;
    }

    if (asString(item.type) === "error") {
      this.failRunningActivities(tabId, unwrapApiErrorMessage(asString(item.message) ?? getErrorMessage(asRecord(item.error))));
      return unwrapApiErrorMessage(asString(item.message) ?? getErrorMessage(asRecord(item.error)));
    }

    this.handleThreadItem(tabId, item, eventType !== "item.completed");
    return null;
  }

  private handleThreadItem(tabId: string, item: JsonRecord, pending: boolean): void {
    const itemType = asString(item.type);
    const itemId = asString(item.id) ?? makeId("codex-item");
    const mode = this.findTab(tabId)?.runtimeMode ?? "normal";

    if (itemType === "agent_message") {
      this.setWaitingPhase(tabId, "finalizing", mode);
      this.store.upsertMessage(tabId, `codex-assistant-${itemId}`, (current) => ({
        id: `codex-assistant-${itemId}`,
        kind: "assistant",
        text: asString(item.text) ?? "",
        createdAt: current?.createdAt ?? Date.now(),
        pending,
      }));
      if (!pending) {
        this.queueAssistantArtifactSync(tabId, `codex-assistant-${itemId}`, asString(item.text) ?? "");
      }
      return;
    }

    if (itemType === "reasoning") {
      this.setWaitingPhase(tabId, "reasoning", mode);
      if (!this.settingsProvider().showReasoning) {
        return;
      }
      this.store.upsertMessage(tabId, `codex-reasoning-${itemId}`, (current) => ({
        id: `codex-reasoning-${itemId}`,
        kind: "reasoning",
        text: asString(item.text) ?? "",
        createdAt: current?.createdAt ?? Date.now(),
        pending,
      }));
      return;
    }

    if (itemType === "command_execution") {
      this.setWaitingPhase(tabId, "tools", mode);
      this.recordCommandExecution(tabId, item, pending);
      return;
    }

    if (itemType === "mcp_tool_call") {
      this.setWaitingPhase(tabId, "tools", mode);
      this.recordMcpToolCall(tabId, item, pending);
      return;
    }

    if (itemType === "file_change") {
      this.setWaitingPhase(tabId, "tools", mode);
      this.recordFileChange(tabId, item, pending);
      return;
    }

    if (itemType === "web_search") {
      this.setWaitingPhase(tabId, "tools", mode);
      this.recordWebSearch(tabId, item, pending);
      return;
    }

    if (itemType === "todo_list") {
      this.setWaitingPhase(tabId, "tools", mode);
      this.recordTodoList(tabId, item, pending);
      return;
    }

  }

  private recordCommandExecution(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("shell");
    const summary = summarizeCommand(item);
    const resultText = summarizeResultText(item) ?? undefined;
    this.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "shell",
        "command_execution",
        "Run shell command",
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        resultText,
      ),
    );
  }

  private recordMcpToolCall(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("mcp");
    const { title, summary, name } = summarizeMcpTool(item);
    const resultText = summarizeResultText(item) ?? undefined;
    this.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "mcp",
        name,
        title,
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        resultText,
      ),
    );
  }

  private recordFileChange(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("file-change");
    const { summary, resultText } = summarizeFileChange(item);
    this.store.setDiff(tabId, resultText);
    this.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "file",
        "file_change",
        "File changes",
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        resultText,
      ),
    );
  }

  private recordWebSearch(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("web");
    const summary = summarizeWebSearch(item);
    const resultText = summarizeResultText(item) ?? undefined;
    this.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "web",
        "web_search",
        "Web search",
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        resultText,
      ),
    );
  }

  private recordTodoList(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("todo");
    const summary = summarizeTodoList(item);
    this.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "todo",
        "todo_list",
        "Todo list",
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        summarizeResultText(item) ?? undefined,
      ),
    );
  }

  private recordResponseItemActivity(tabId: string, payload: JsonRecord, isStart: boolean): void {
    const callId = extractCallId(payload) ?? makeId("tool");
    const name = asString(payload.name) ?? asString(payload.tool_name) ?? "tool";
    const summary =
      asString(payload.arguments) ??
      asString(payload.input) ??
      summarizeResultText(payload) ??
      name;
    const resultText = isStart ? undefined : summarizeResultText(payload) ?? asString(payload.output) ?? undefined;
    this.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "tool",
        name,
        name,
        summary,
        safeJson(payload),
        deriveActivityStatus(isStart, false),
        resultText,
      ),
    );
  }

  private failRunningActivities(tabId: string, resultText: string): void {
    this.store.updateRunningToolLogs(tabId, (current) => ({
      ...current,
      status: "failed",
      updatedAt: Date.now(),
      resultText: current.resultText ?? resultText,
    }));
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

  private async resolveTurnSkillNames(composeMode: ComposeMode, requestedSkills: string[]): Promise<string[]> {
    const skillNames = new Set(requestedSkills);
    if (composeMode !== "plan" || skillNames.has("grill-me")) {
      return [...skillNames];
    }

    try {
      const installed = await this.listInstalledSkills();
      if (installed.has("grill-me")) {
        skillNames.add("grill-me");
      }
    } catch {
      // Fall back to prompt-only planmode guidance if the skill catalog is unavailable.
    }
    return [...skillNames];
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

  private appendAssistantFallbackMessage(tabId: string, text: string, messageId: string): void {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }

    const lastPromptIndex = [...tab.messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.kind === "user" && message.meta?.selectionContext !== true)?.index;

    if (typeof lastPromptIndex === "number") {
      const hasAssistantReply = tab.messages
        .slice(lastPromptIndex + 1)
        .some((message) => message.kind === "assistant" && !message.pending && message.text.trim().length > 0);
      if (hasAssistantReply) {
        return;
      }
    }

    this.store.upsertMessage(tabId, messageId, (current) => ({
      id: current?.id ?? messageId,
      kind: "assistant",
      text: normalizedText,
      createdAt: current?.createdAt ?? Date.now(),
      pending: false,
    }));
    this.queueAssistantArtifactSync(tabId, messageId, normalizedText);
  }

  private async syncAssistantArtifacts(tabId: string, messageId: string, text: string): Promise<void> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    const campaignSeed = this.pendingCampaignSeeds.get(tabId) ?? null;

    const parsed = extractAssistantProposals(text);
    const patchBasket = (
      await Promise.all(
        parsed.patches.map((patch, index) => this.buildPatchProposalFromParsed(tabId, messageId, patch, index)),
      )
    ).filter((proposal): proposal is PatchProposal => Boolean(proposal));
    this.store.replacePatchProposals(tabId, messageId, patchBasket);

    const approvals = await this.buildVaultOpApprovals(tabId, messageId, parsed.ops, !campaignSeed);
    this.store.replaceProposalApprovals(tabId, messageId, approvals);
    if (campaignSeed) {
      const campaign = this.buildRefactorCampaign(messageId, campaignSeed, patchBasket, approvals);
      this.store.replaceCampaign(tabId, messageId, campaign);
      this.pendingCampaignSeeds.delete(tabId);
      this.store.addMessage(tabId, {
        id: makeId("campaign-ready"),
        kind: "system",
        text:
          campaign.items.length > 0
            ? this.getLocalizedCopy().service.campaignReady(campaign.items.length, campaign.targetPaths.length)
            : this.getLocalizedCopy().service.campaignReadyNoChanges(campaign.targetPaths.length),
        createdAt: Date.now(),
      });
    }
    if (!this.activeRuns.has(tabId)) {
      this.reconcileApprovalStatus(tabId);
    }
  }

  private queueAssistantArtifactSync(tabId: string, messageId: string, text: string): void {
    void this.syncAssistantArtifacts(tabId, messageId, text).catch((error) => {
      this.store.addMessage(tabId, {
        id: makeId("proposal-error"),
        kind: "system",
        text: this.getLocalizedCopy().service.proposalProcessingFailed(getErrorMessage(error)),
        createdAt: Date.now(),
      });
    });
  }

  private async buildPatchProposalFromParsed(
    tabId: string,
    messageId: string,
    patch: ParsedAssistantPatch,
    index: number,
  ): Promise<PatchProposal | null> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return null;
    }

    const targetPath = patch.targetPath.trim();
    if (!targetPath) {
      return null;
    }

    const id = buildPatchProposalId(messageId, patch.sourceIndex, index);
    const existing = tab.patchBasket.find((entry) => entry.id === id) ?? null;
    const abstractFile = this.app.vault.getAbstractFileByPath(targetPath);
    const file = abstractFile instanceof TFile ? abstractFile : null;
    const baseSnapshot = file ? await this.app.vault.cachedRead(file) : null;
    const kind = patch.kind === "create" || !file ? "create" : "update";
    const proposedText = normalizeProposalText(patch.proposedText);
    return {
      id,
      threadId: tab.codexThreadId ?? null,
      sourceMessageId: messageId,
      targetPath: file?.path ?? targetPath,
      kind,
      baseSnapshot,
      proposedText,
      unifiedDiff: buildUnifiedDiff(file?.path ?? targetPath, baseSnapshot, proposedText),
      summary: patch.summary || `${kind === "create" ? "Create" : "Update"} ${basename(targetPath)}`,
      status: existing?.status ?? "pending",
      createdAt: existing?.createdAt ?? Date.now(),
    };
  }

  private buildRefactorCampaign(
    messageId: string,
    seed: PendingCampaignSeed,
    patchBasket: readonly PatchProposal[],
    approvals: readonly PendingApproval[],
  ): RefactorCampaign {
    const items: CampaignItem[] = [
      ...approvals.map((approval) => ({
        id: `campaign-item-${approval.id}`,
        refId: approval.id,
        kind: "vault_op" as const,
        title: approval.title,
        summary: approval.description || approval.details,
        targetPath: approval.toolPayload?.targetPath ?? approval.decisionTarget ?? approval.title,
        destinationPath: approval.toolPayload?.destinationPath ?? null,
        operationKind: approval.toolPayload?.kind ?? "task_update",
        enabled: true,
        status: "pending" as const,
        sourceMessageId: messageId,
      })),
      ...patchBasket.map((proposal) => ({
        id: `campaign-item-${proposal.id}`,
        refId: proposal.id,
        kind: "patch" as const,
        title: proposal.kind === "create" ? "Create note patch" : "Apply note patch",
        summary: proposal.summary,
        targetPath: proposal.targetPath,
        destinationPath: null,
        operationKind: proposal.kind,
        enabled: true,
        status: "pending" as const,
        sourceMessageId: messageId,
      })),
    ];

    return {
      id: makeId("campaign"),
      sourceMessageId: messageId,
      title: "Refactor Campaign",
      query: seed.query,
      targetPaths: [...seed.targetPaths],
      items,
      heatmap: this.buildCampaignHeatmap(approvals, patchBasket),
      snapshotCapsule: null,
      executionLog: [],
      status: "ready",
      createdAt: Date.now(),
    };
  }

  private buildCampaignHeatmap(
    approvals: readonly PendingApproval[],
    patchBasket: readonly PatchProposal[],
  ): CampaignHeatmapNode[] {
    const nodes = new Map<string, { score: number; backlinks: number; reasons: Set<string> }>();
    const bump = (path: string, backlinks: number, score: number, reason: string) => {
      const current = nodes.get(path) ?? { score: 0, backlinks: 0, reasons: new Set<string>() };
      current.score += score;
      current.backlinks += backlinks;
      current.reasons.add(reason);
      nodes.set(path, current);
    };

    for (const approval of approvals) {
      const targetPath = approval.toolPayload?.targetPath ?? approval.decisionTarget ?? "";
      if (!targetPath) {
        continue;
      }
      const directBacklinks = this.collectBacklinkSources(targetPath).reduce((total, entry) => total + entry.count, 0);
      bump(targetPath, directBacklinks, Math.max(1, directBacklinks), approval.toolPayload?.kind ?? "vault op");
      for (const entry of approval.toolPayload?.impact?.backlinkSources ?? []) {
        const parsed = parseBacklinkSourceLabel(entry);
        if (parsed) {
          bump(parsed.path, parsed.count, parsed.count * 2, `links into ${basename(targetPath)}`);
        }
      }
    }

    for (const proposal of patchBasket) {
      const backlinks = this.collectBacklinkSources(proposal.targetPath).reduce((total, entry) => total + entry.count, 0);
      bump(proposal.targetPath, backlinks, Math.max(1, backlinks), proposal.kind === "create" ? "new note patch" : "body patch");
    }

    return [...nodes.entries()]
      .map(([path, value]) => ({
        path,
        score: value.score,
        backlinks: value.backlinks,
        reasons: [...value.reasons],
      }))
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, 8);
  }

  private async createCampaignSnapshotCapsule(tabId: string, campaign: RefactorCampaign): Promise<CampaignSnapshotCapsule> {
    const trackedPaths = [...new Set(campaign.items.filter((item) => item.enabled).map((item) => item.targetPath))];
    const files: CampaignSnapshotFile[] = [];
    for (const path of trackedPaths) {
      const abstractFile = this.app.vault.getAbstractFileByPath(path);
      const file = abstractFile instanceof TFile ? abstractFile : null;
      const text = file ? await this.app.vault.cachedRead(file) : null;
      const stat = file ? await this.app.vault.adapter.stat(path) : null;
      files.push({
        path,
        existed: Boolean(file),
        text,
        mtime: stat?.mtime ?? null,
      });
    }

    const manifestPath = await this.writeCampaignSnapshotCapsule(tabId, campaign.id, files);
    return {
      createdAt: Date.now(),
      manifestPath,
      files,
    };
  }

  private async writeCampaignSnapshotCapsule(
    tabId: string,
    campaignId: string,
    files: readonly CampaignSnapshotFile[],
  ): Promise<string | null> {
    try {
      const directory = this.resolveCampaignStageDirectory(tabId, campaignId);
      await fs.mkdir(directory, { recursive: true });
      const manifestPath = join(directory, "snapshot.json");
      await fs.writeFile(
        manifestPath,
        JSON.stringify(
          {
            createdAt: Date.now(),
            files,
          },
          null,
          2,
        ),
        "utf8",
      );
      return manifestPath;
    } catch {
      return null;
    }
  }

  private async buildVaultOpApprovals(
    tabId: string,
    messageId: string,
    ops: readonly ParsedAssistantOp[],
    allowSessionAutoApproval = true,
  ): Promise<PendingApproval[]> {
    const tab = this.findTab(tabId);
    if (!tab) {
      return [];
    }

    const approvals: PendingApproval[] = [];
    for (const [index, op] of ops.entries()) {
      const payload = await this.buildVaultOpPayload(op);
      if (!payload) {
        continue;
      }

      const approval: PendingApproval = {
        id: buildApprovalId(messageId, op.sourceIndex, index),
        tabId,
        callId: `vault-op-${messageId}-${op.sourceIndex}-${index}`,
        toolName: "vault_op",
        title: buildApprovalTitle(payload),
        description: buildApprovalDescription(payload),
        details: payload.preflightSummary ?? op.summary,
        createdAt: Date.now(),
        sourceMessageId: messageId,
        transport: "plugin_proposal",
        decisionTarget: payload.targetPath,
        scopeEligible: true,
        scope: "write",
        toolPayload: payload,
      };

      if (allowSessionAutoApproval && tab.sessionApprovals.write && !this.hasCompletedApprovalAction(tabId, approval.id)) {
        await this.executeVaultOpApproval(tabId, approval);
        this.store.addMessage(tabId, {
          id: makeId("approval-session"),
          kind: "system",
          text: `${approval.title} auto-applied for this session.`,
          createdAt: Date.now(),
        });
        continue;
      }

      approvals.push(approval);
    }
    return approvals;
  }

  private async buildVaultOpPayload(op: ParsedAssistantOp): Promise<VaultOpProposal | null> {
    const targetPath = op.targetPath.trim();
    if (!targetPath) {
      return null;
    }
    const destinationPath = op.destinationPath?.trim() ? op.destinationPath.trim() : undefined;
    const payload: VaultOpProposal = {
      kind: op.kind,
      targetPath,
      destinationPath,
      propertyKey: op.propertyKey?.trim() ? op.propertyKey.trim() : undefined,
      propertyValue: op.propertyValue ?? null,
      taskLine: typeof op.taskLine === "number" ? op.taskLine : null,
      taskText: op.taskText?.trim() ? op.taskText.trim() : null,
      checked: typeof op.checked === "boolean" ? op.checked : null,
      preflightSummary: await this.buildVaultOpPreflightSummary(op.kind, targetPath, destinationPath, op),
      impact: await this.buildVaultOpImpact(op.kind, targetPath, destinationPath),
    };
    return payload;
  }

  private async buildVaultOpImpact(
    kind: VaultOpProposal["kind"],
    targetPath: string,
    destinationPath: string | undefined,
  ): Promise<VaultOpProposal["impact"]> {
    const abstractFile = this.app.vault.getAbstractFileByPath(targetPath);
    const file = abstractFile instanceof TFile ? abstractFile : null;
    if (!file || (kind !== "rename" && kind !== "move")) {
      return null;
    }

    const backlinkSources = this.collectBacklinkSources(file.path);
    const destinationState = destinationPath
      ? this.app.vault.getAbstractFileByPath(destinationPath) instanceof TFile
        ? `Destination already exists: ${destinationPath}`
        : `Destination clear: ${destinationPath}`
      : "Destination path missing.";
    const unresolved = kind === "rename" && destinationPath ? this.collectUnresolvedStemSources(getPathStem(file.path)) : { total: 0, sources: [] };
    return {
      backlinksCount: backlinkSources.reduce((total, entry) => total + entry.count, 0),
      backlinkSources: backlinkSources.slice(0, 5).map((entry) => `${entry.path} (${entry.count})`),
      unresolvedWarning:
        unresolved.total > 0
          ? `Unresolved references to ${getPathStem(file.path)} will remain unresolved after the rename.`
          : null,
      unresolvedSources: unresolved.sources.slice(0, 5),
      destinationState,
      recoveryNote: "Use Obsidian File Recovery if you need to roll this back.",
    };
  }

  private async buildVaultOpPreflightSummary(
    kind: VaultOpProposal["kind"],
    targetPath: string,
    destinationPath: string | undefined,
    op: ParsedAssistantOp,
  ): Promise<string> {
    const details: string[] = [];
    const abstractFile = this.app.vault.getAbstractFileByPath(targetPath);
    const file = abstractFile instanceof TFile ? abstractFile : null;

    if (!file) {
      details.push(`Target note not found: ${targetPath}`);
      return details.join("\n");
    }

    if (kind === "rename" || kind === "move") {
      const impact = await this.buildVaultOpImpact(kind, file.path, destinationPath);
      details.push(`Backlinks detected: ${impact?.backlinksCount ?? 0}`);
      if (impact?.destinationState) {
        details.push(impact.destinationState);
      }
      if (impact?.unresolvedWarning) {
        details.push(impact.unresolvedWarning);
      }
      details.push("Obsidian FileManager will rewrite wikilinks when the rename or move succeeds.");
      details.push("Use Obsidian File Recovery if you need to roll this back.");
      return details.join("\n");
    }

    if (kind === "property_set" || kind === "property_remove") {
      details.push(`Frontmatter target: ${file.path}`);
      if (op.propertyKey?.trim()) {
        details.push(`Property key: ${op.propertyKey.trim()}`);
      }
      details.push("Frontmatter will be updated in-place.");
      return details.join("\n");
    }

    const content = await this.app.vault.cachedRead(file);
    const taskMatch = this.findTaskMatch(content, op.taskLine ?? null, op.taskText ?? null);
    details.push(taskMatch ? `Matched task: ${taskMatch.lineText.trim()}` : "No matching task found.");
    if (typeof op.checked === "boolean") {
      details.push(`Requested state: ${op.checked ? "checked" : "unchecked"}`);
    }
    return details.join("\n");
  }

  private hasCompletedApprovalAction(tabId: string, approvalId: string): boolean {
    const tab = this.findTab(tabId);
    return Boolean(tab?.toolLog.some((entry) => entry.callId === `approval-${approvalId}` && entry.status === "completed"));
  }

  private async executeVaultOpApproval(tabId: string, approval: PendingApproval): Promise<void> {
    const op = approval.toolPayload;
    if (!op) {
      throw new Error("Approval payload is missing.");
    }

    if (op.kind === "rename" || op.kind === "move") {
      await this.executeRenameOrMove(op);
    } else if (op.kind === "property_set") {
      await this.executePropertySet(op);
    } else if (op.kind === "property_remove") {
      await this.executePropertyRemove(op);
    } else {
      await this.executeTaskUpdate(op);
    }

    this.store.upsertToolLog(tabId, `approval-${approval.id}`, (current) =>
      buildActivityRecord(
        current,
        `approval-${approval.id}`,
        op.kind === "rename" || op.kind === "move" ? "file" : "tool",
        approval.toolName,
        approval.title,
        approval.description,
        safeJson(op),
        "completed",
        op.preflightSummary ?? approval.details,
      ),
    );
  }

  private async executeRenameOrMove(op: VaultOpProposal): Promise<void> {
    if (!op.destinationPath) {
      throw new Error("Destination path is required.");
    }
    const abstractFile = this.app.vault.getAbstractFileByPath(op.targetPath);
    if (!(abstractFile instanceof TFile)) {
      throw new Error(`${op.targetPath} does not exist.`);
    }
    if (this.app.vault.getAbstractFileByPath(op.destinationPath) instanceof TFile) {
      throw new Error(`${op.destinationPath} already exists.`);
    }
    await this.ensureParentFolder(op.destinationPath);
    await this.app.fileManager.renameFile(abstractFile, op.destinationPath);
    this.repointFilePathReferences(op.targetPath, op.destinationPath);
  }

  private async executePropertySet(op: VaultOpProposal): Promise<void> {
    if (!op.propertyKey) {
      throw new Error("Property key is required.");
    }
    const abstractFile = this.app.vault.getAbstractFileByPath(op.targetPath);
    if (!(abstractFile instanceof TFile)) {
      throw new Error(`${op.targetPath} does not exist.`);
    }
    await this.app.fileManager.processFrontMatter(abstractFile, (frontmatter) => {
      frontmatter[op.propertyKey as string] = op.propertyValue ?? "";
    });
  }

  private async executePropertyRemove(op: VaultOpProposal): Promise<void> {
    if (!op.propertyKey) {
      throw new Error("Property key is required.");
    }
    const abstractFile = this.app.vault.getAbstractFileByPath(op.targetPath);
    if (!(abstractFile instanceof TFile)) {
      throw new Error(`${op.targetPath} does not exist.`);
    }
    await this.app.fileManager.processFrontMatter(abstractFile, (frontmatter) => {
      delete frontmatter[op.propertyKey as string];
    });
  }

  private async executeTaskUpdate(op: VaultOpProposal): Promise<void> {
    if (typeof op.checked !== "boolean") {
      throw new Error("Task update requires a checked boolean.");
    }
    const abstractFile = this.app.vault.getAbstractFileByPath(op.targetPath);
    if (!(abstractFile instanceof TFile)) {
      throw new Error(`${op.targetPath} does not exist.`);
    }
    const content = await this.app.vault.cachedRead(abstractFile);
    const match = this.findTaskMatch(content, op.taskLine ?? null, op.taskText ?? null);
    if (!match) {
      throw new Error("No matching task line was found.");
    }
    const lines = normalizeProposalText(content).split("\n");
    const currentLine = lines[match.lineIndex] ?? "";
    lines[match.lineIndex] = currentLine.replace(/^(\s*[-*]\s+\[)( |x|X)(\]\s.*)$/, `$1${op.checked ? "x" : " "}$3`);
    await this.app.vault.modify(abstractFile, lines.join("\n"));
  }

  private findTaskMatch(content: string, requestedLine: number | null, taskText: string | null): VaultTaskMatchResult | null {
    const lines = normalizeProposalText(content).split("\n");
    const checkboxPattern = /^\s*[-*]\s+\[(?: |x|X)\]\s.+$/;
    if (typeof requestedLine === "number" && requestedLine > 0) {
      const lineIndex = requestedLine - 1;
      const lineText = lines[lineIndex] ?? "";
      if (checkboxPattern.test(lineText)) {
        return { lineIndex, lineText };
      }
    }
    if (taskText?.trim()) {
      const lineIndex = lines.findIndex((line) => checkboxPattern.test(line) && line.includes(taskText));
      if (lineIndex >= 0) {
        return {
          lineIndex,
          lineText: lines[lineIndex] ?? "",
        };
      }
    }
    return null;
  }

  private collectBacklinkSources(targetPath: string): Array<{ path: string; count: number }> {
    const resolvedLinks = this.app.metadataCache.resolvedLinks ?? {};
    const sources: Array<{ path: string; count: number }> = [];
    for (const sourcePath of Object.keys(resolvedLinks)) {
      const count = resolvedLinks[sourcePath]?.[targetPath] ?? 0;
      if (count > 0) {
        sources.push({ path: sourcePath, count });
      }
    }
    return sources.sort((left, right) => right.count - left.count);
  }

  private collectUnresolvedStemSources(stem: string): { total: number; sources: string[] } {
    const unresolvedLinks = this.app.metadataCache.unresolvedLinks ?? {};
    const sources: string[] = [];
    for (const [sourcePath, targets] of Object.entries(unresolvedLinks)) {
      const matches = Object.keys(targets ?? {}).some((target) => target === stem || target === `${stem}.md`);
      if (matches) {
        sources.push(sourcePath);
      }
    }
    return {
      total: sources.length,
      sources,
    };
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const folderPath = dirname(filePath).replace(/\\/g, "/");
    if (!folderPath || folderPath === ".") {
      return;
    }
    let currentPath = "";
    for (const segment of folderPath.split("/").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(currentPath)) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  private repointFilePathReferences(oldPath: string, nextPath: string): void {
    for (const tab of this.store.getState().tabs) {
      if (tab.targetNotePath === oldPath) {
        this.store.setTargetNotePath(tab.id, nextPath);
      }
      if (tab.selectionContext?.sourcePath === oldPath) {
        this.store.setSelectionContext(tab.id, {
          ...tab.selectionContext,
          sourcePath: nextPath,
        });
      }
      if (tab.contextPaths.includes(oldPath)) {
        this.store.setContextPaths(
          tab.id,
          tab.contextPaths.map((path) => (path === oldPath ? nextPath : path)),
        );
      }
      const patchBasket = tab.patchBasket.map((proposal) =>
        proposal.targetPath === oldPath ? { ...proposal, targetPath: nextPath } : proposal,
      );
      if (patchBasket.some((proposal, index) => proposal.targetPath !== (tab.patchBasket[index]?.targetPath ?? null))) {
        this.store.setPatchBasket(tab.id, patchBasket);
      }

      const approvals = tab.pendingApprovals.map((approval) => {
        if (!approval.toolPayload || approval.toolPayload.kind === "rename" || approval.toolPayload.kind === "move") {
          return approval;
        }
        if (approval.toolPayload.targetPath !== oldPath) {
          return approval;
        }
        return {
          ...approval,
          decisionTarget: nextPath,
          description: approval.description.replace(oldPath, nextPath),
          details: approval.details.replace(oldPath, nextPath),
          toolPayload: {
            ...approval.toolPayload,
            targetPath: nextPath,
          },
        };
      });
      if (approvals.some((approval, index) => approval.toolPayload?.targetPath !== tab.pendingApprovals[index]?.toolPayload?.targetPath)) {
        this.store.setApprovals(tab.id, approvals);
      }

      const campaigns = tab.campaigns.map((campaign) => ({
        ...campaign,
        targetPaths: campaign.targetPaths.map((path) => (path === oldPath ? nextPath : path)),
        heatmap: campaign.heatmap.map((node) => (node.path === oldPath ? { ...node, path: nextPath } : node)),
        items: campaign.items.map((item) => {
          if (item.kind === "patch" && item.targetPath === oldPath) {
            return {
              ...item,
              targetPath: nextPath,
            };
          }
          if (item.kind === "vault_op" && item.operationKind !== "rename" && item.operationKind !== "move" && item.targetPath === oldPath) {
            return {
              ...item,
              targetPath: nextPath,
            };
          }
          return item;
        }),
      }));
      if (campaigns.some((campaign, index) => safeJson(campaign) !== safeJson(tab.campaigns[index]))) {
        this.store.setCampaigns(tab.id, campaigns);
      }
    }
  }

  private reconcileApprovalStatus(tabId: string): void {
    const tab = this.findTab(tabId);
    if (!tab) {
      return;
    }
    if (this.activeRuns.has(tabId)) {
      return;
    }
    if (tab.pendingApprovals.length > 0) {
      this.store.setStatus(tabId, "waiting_approval");
      return;
    }
    if (!this.hasCodexLogin()) {
      this.store.setStatus(tabId, "missing_login", this.getMissingLoginMessage());
      return;
    }
    if (tab.status !== "error") {
      this.store.setStatus(tabId, "ready");
    }
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
  ): void {
    if (!limits || Object.keys(limits).length === 0) {
      return;
    }

    const current = this.store.getState().accountUsage ?? createEmptyAccountUsageSummary();
    if (current.updatedAt && current.updatedAt > updatedAt) {
      return;
    }

    this.store.setAccountUsage(
      mergeAccountUsageSummary(current, {
        limits,
        source,
        updatedAt,
        threadId,
      }),
    );
  }

  private updateAccountUsageFromSummary(
    summary: ReturnType<typeof createEmptyUsageSummary>,
    threadId: string | null,
    source: AccountUsageSummary["source"],
    updatedAt: number,
  ): void {
    this.updateAccountUsageFromPatch(summary.limits, threadId, source, updatedAt);
  }

  private resolveSelectedModel(tabId: string): string {
    const selected = this.findTab(tabId)?.model?.trim();
    if (selected) {
      return coerceModelForPicker(this.getAvailableModels(), selected);
    }
    const settings = this.settingsProvider();
    return coerceModelForPicker(this.getAvailableModels(), settings.codex.model.trim() || settings.defaultModel.trim() || DEFAULT_MODEL);
  }

  private resolveSelectedReasoningEffort(tabId: string, model: string): ReasoningEffort {
    const tab = this.findTab(tabId);
    const desired = tab?.reasoningEffort ?? this.settingsProvider().defaultReasoningEffort;
    return resolveReasoningEffortForModel(this.getAvailableModels(), model, desired);
  }

  private async refreshModelCatalog(): Promise<void> {
    try {
      const raw = await fs.readFile(join(CODEX_HOME, "models_cache.json"), "utf8");
      this.store.setAvailableModels(parseModelCatalog(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.store.setAvailableModels(getFallbackModelCatalog());
      } else {
        throw error;
      }
    }
    this.normalizeTabModels();
  }

  private async refreshCodexCatalogs(): Promise<void> {
    const vaultRoot = this.resolveVaultRoot();
    this.customPromptCatalog = await loadCodexPromptCatalog([
      join(vaultRoot, ".codex", "prompts"),
      join(CODEX_HOME, "prompts"),
    ]);
    this.installedSkillCatalog = await loadInstalledSkillCatalog(this.resolveSkillRoots(vaultRoot));
  }

  private resolveSkillRoots(vaultRoot: string): string[] {
    return normalizeConfiguredSkillRoots([
      join(vaultRoot, ".codex", "skills"),
      DEFAULT_SKILL_ROOT,
      DEFAULT_AGENT_SKILL_ROOT,
      ...this.settingsProvider().extraSkillRoots,
    ]);
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

  private resolveCodexCommand(): string {
    const configured = this.settingsProvider().codex.command.trim();
    if (configured && configured !== DEFAULT_CODEX_COMMAND) {
      return configured;
    }

    for (const candidate of this.getCodexCommandCandidates()) {
      if (candidate === DEFAULT_CODEX_COMMAND || existsSync(candidate)) {
        return candidate;
      }
    }

    return configured || DEFAULT_CODEX_COMMAND;
  }

  private getCodexCommandCandidates(): string[] {
    const binary = process.platform === "win32" ? "codex.exe" : "codex";
    const wrapper = process.platform === "win32" ? "codex.cmd" : "codex";
    const candidates = [
      join(CODEX_HOME, ".sandbox-bin", binary),
      join(homedir(), "AppData", "Roaming", "npm", wrapper),
      DEFAULT_CODEX_COMMAND,
    ];
    return [...new Set(candidates)];
  }

  private normalizeCodexError(message: string): string {
    const apiError = extractApiErrorDetails(message);
    if (apiError?.param === "reasoning.effort") {
      return apiError.message;
    }
    if (isUnsupportedJsonFlagError(message, "--json")) {
      return this.getLocale() === "ja"
        ? "この Codex install は plugin が必要とする JSON event stream をサポートしていません。"
        : "This Codex installation does not support the JSON event stream required by the plugin.";
    }
    if (/ENOENT|spawn .*codex/i.test(message)) {
      const resolvedCommand = this.resolveCodexCommand();
      return this.getLocale() === "ja"
        ? [
            "Codex 実行ファイルが見つかりません。",
            `Resolved command: ${resolvedCommand}`,
            "Obsidian から Codex install が見えない場合は、plugin 設定で Codex command を指定してください。",
          ].join("\n")
        : [
            "Codex executable not found.",
            `Resolved command: ${resolvedCommand}`,
            'Set "Codex command" in plugin settings if Obsidian cannot see your Codex install.',
          ].join("\n");
    }
    return message.trim() || (this.getLocale() === "ja" ? "不明な Codex エラーです。" : "Unknown Codex error.");
  }

  private hasCodexLogin(): boolean {
    if (existsSync(CODEX_AUTH_PATH)) {
      return true;
    }
    return usesWsl(splitCommandString(this.resolveCodexCommand()));
  }

  private isLoginError(message: string): boolean {
    return !this.hasCodexLogin() || /log in|login|authenticate|authentication|not logged in/i.test(message);
  }

  private async captureTurnContext(
    tabId: string,
    file: TFile | null,
    _editor: Editor | null,
    slashCommand: string | null,
    attachments: readonly ComposerAttachment[],
    mentionContextText: string | null,
  ): Promise<TurnContextSnapshot> {
    const dailyNoteFile = await this.findDailyNoteFile();
    const dailyNotePath = dailyNoteFile?.path ?? null;
    const tab = this.findTab(tabId);
    const selectionContext = slashCommand === "/selection" ? null : tab?.selectionContext ?? null;
    const selection = selectionContext?.text ?? null;
    const targetNotePath = this.resolveTargetNotePath(tabId);
    const studyWorkflow = tab?.studyWorkflow ?? null;
    const activeSmartSetId = this.getActiveSmartSetId();
    const activeSmartSet =
      activeSmartSetId ? this.getSmartSets().find((entry) => entry.id === activeSmartSetId) ?? null : null;
    const workflowContext = this.buildWorkflowPromptContext(tabId, studyWorkflow, file?.path ?? null, activeSmartSet?.title ?? null);
    const instructionText = this.buildInstructionContextText(tabId);
    const excludedContextPaths = [
      slashCommand === "/note" ? file?.path ?? null : null,
      slashCommand === "/daily" ? dailyNotePath : null,
    ].filter((entry): entry is string => Boolean(entry));
    const contextPackText = await this.captureContextPackText(tabId, excludedContextPaths);
    const attachmentManifestText = buildAttachmentPromptManifest(attachments);
    return {
      activeFilePath: file?.path ?? null,
      targetNotePath,
      studyWorkflow,
      workflowText: studyWorkflow ? buildStudyWorkflowRuntimeBrief(studyWorkflow, workflowContext, this.getLocale()) : null,
      instructionText,
      mentionContextText,
      selection: selection || null,
      selectionSourcePath: selectionContext?.sourcePath ?? file?.path ?? null,
      vaultRoot: this.resolveVaultRoot(),
      dailyNotePath,
      contextPackText,
      attachmentManifestText,
    };
  }

  private buildWorkflowPromptContext(
    tabId: string,
    workflow: StudyWorkflowKind | null,
    currentFilePath: string | null,
    activeSmartSetTitle: string | null,
  ): StudyWorkflowPromptContext {
    const tab = this.findTab(tabId);
    if (!tab || !workflow) {
      return {
        currentFilePath,
        targetNotePath: this.resolveTargetNotePath(tabId),
        activeSmartSetTitle,
      };
    }

    return {
      currentFilePath,
      targetNotePath: this.resolveTargetNotePath(tabId),
      activeSmartSetTitle,
      hasAttachments: this.getTabSessionItems(tabId).length > 0,
      hasSelection: Boolean(tab.selectionContext),
      pinnedContextCount: tab.contextPaths.length,
    };
  }

  private buildInstructionContextText(tabId: string): string | null {
    const chips = this.findTab(tabId)?.instructionChips ?? [];
    if (chips.length === 0) {
      return null;
    }
    return [
      "Instruction chips",
      chips.map((chip) => `- #${chip.label}`).join("\n"),
      "Treat these chips as active style and execution constraints for this turn.",
    ].join("\n\n");
  }

  private async resolveMentionContext(
    mentions: readonly ParsedMention[],
  ): Promise<{ contextText: string | null; skillNames: string[] }> {
    if (mentions.length === 0) {
      return { contextText: null, skillNames: [] };
    }

    const contextBlocks: string[] = [];
    const skillNames = new Set<string>();

    for (const mention of mentions) {
      if (mention.kind === "note") {
        const abstractFile = this.app.vault.getAbstractFileByPath(mention.value);
        if (abstractFile instanceof TFile) {
          const content = await this.app.vault.cachedRead(abstractFile);
          contextBlocks.push(`Mentioned note: ${abstractFile.path}\n\n\`\`\`md\n${content}\n\`\`\``);
        }
        continue;
      }

      if (mention.kind === "smart_set") {
        const smartSet =
          this.getSmartSets().find((entry) => entry.title === mention.value || entry.id === mention.value) ?? null;
        if (smartSet) {
          const items = (smartSet.lastSnapshot?.result.items ?? smartSet.liveResult?.items ?? []).slice(0, 20).map((item) => `- ${item.path}`);
          contextBlocks.push(
            [
              `Mentioned Smart Set: ${smartSet.title}`,
              `Natural query: ${smartSet.naturalQuery}`,
              `Notes (${smartSet.lastSnapshot?.result.count ?? smartSet.liveResult?.count ?? 0})`,
              ...items,
            ].join("\n"),
          );
        }
        continue;
      }

      if (mention.kind === "skill") {
        skillNames.add(mention.value);
        continue;
      }

      if (mention.kind === "external_dir") {
        contextBlocks.push(`Mentioned external directory: ${mention.value}\nUse this directory as relevant read-only context if needed.`);
        continue;
      }

      contextBlocks.push(`Mentioned MCP server: ${mention.value}\nPrefer this MCP server when it is relevant.`);
    }

    return {
      contextText: contextBlocks.length > 0 ? contextBlocks.join("\n\n") : null,
      skillNames: [...skillNames],
    };
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
    return normalizeComposerAttachments(this.findTab(tabId)?.sessionItems ?? []);
  }

  private resolveAttachmentStageDirectory(tabId: string): string {
    return join(this.resolveVaultRoot(), ...ATTACHMENT_STAGE_ROOT_SEGMENTS, tabId);
  }

  private resolveCampaignStageDirectory(tabId: string, campaignId: string): string {
    return join(this.resolveVaultRoot(), ...CAMPAIGN_STAGE_ROOT_SEGMENTS, tabId, campaignId);
  }

  private updateCampaignItemStatusByRef(tabId: string, refId: string, status: CampaignItem["status"]): void {
    const tab = this.findTab(tabId);
    if (!tab?.campaigns.some((campaign) => campaign.items.some((item) => item.refId === refId))) {
      return;
    }
    this.store.setCampaigns(
      tabId,
      tab.campaigns.map((campaign) => ({
        ...campaign,
        items: campaign.items.map((item) => (item.refId === refId ? { ...item, status } : item)),
      })),
    );
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

  private abortTabRun(tabId: string, addMessage: boolean): boolean {
    const run = this.activeRuns.get(tabId);
    if (!run?.controller) {
      return false;
    }

    run.controller.abort();
    this.activeRuns.delete(tabId);
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

    const excluded = new Set(excludedPaths);
    const retainedPaths: string[] = [];
    const sources: Array<{ path: string; content: string }> = [];

    for (const contextPath of normalizeContextPaths(tab.contextPaths)) {
      if (excluded.has(contextPath)) {
        retainedPaths.push(contextPath);
        continue;
      }

      const abstractFile = this.app.vault.getAbstractFileByPath(contextPath);
      if (!(abstractFile instanceof TFile)) {
        continue;
      }

      retainedPaths.push(abstractFile.path);
      const content = await this.app.vault.cachedRead(abstractFile);
      sources.push({
        path: abstractFile.path,
        content,
      });
    }

    if (!this.stringArraysEqual(retainedPaths, tab.contextPaths)) {
      this.store.setContextPaths(tabId, retainedPaths);
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

  private resolveTabDefaults(modelOverride?: string | null, effortOverride?: ReasoningEffort | null) {
    const settings = this.settingsProvider();
    const model = coerceModelForPicker(
      this.getAvailableModels(),
      modelOverride?.trim() || settings.codex.model.trim() || settings.defaultModel.trim() || DEFAULT_MODEL,
    );
    return {
      model,
      reasoningEffort: resolveReasoningEffortForModel(
        this.getAvailableModels(),
        model,
        effortOverride ?? settings.defaultReasoningEffort,
      ),
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
    const tabs = this.store.getState().tabs;
    for (const tab of tabs) {
      if (!tab.codexThreadId) {
        continue;
      }
      await this.syncUsageFromSession(tab.codexThreadId);
    }
  }

  private async syncUsageFromSession(threadId: string): Promise<void> {
    try {
      const sessionFile = await this.resolveSessionFile(threadId);
      if (!sessionFile) {
        return;
      }
      const stat = await fs.stat(sessionFile);
      const summary = await readUsageSummaryFromSessionFile(sessionFile);
      if (!summary) {
        return;
      }
      for (const tab of this.store.getState().tabs) {
        if (tab.codexThreadId === threadId) {
          this.store.setUsageSummary(tab.id, summary);
        }
      }
      this.updateAccountUsageFromSummary(summary, threadId, "session_backfill", stat.mtimeMs);
    } catch {
      // Keep the live stream result if session reconciliation fails.
    }
  }

  private async syncTranscriptFromSession(tabId: string, threadId: string): Promise<void> {
    try {
      const sessionFile = await this.resolveSessionFile(threadId);
      if (!sessionFile) {
        return;
      }
      const lastAssistantMessage = await readLastAssistantMessageFromSessionFile(sessionFile);
      if (!lastAssistantMessage) {
        return;
      }
      this.appendAssistantFallbackMessage(tabId, lastAssistantMessage, `codex-session-final-${threadId}`);
    } catch {
      // Keep the streamed transcript if session reconciliation fails.
    }
  }

  private async resolveSessionFile(threadId: string): Promise<string | null> {
    const cached = this.sessionFileCache.get(threadId);
    if (cached && existsSync(cached)) {
      return cached;
    }

    const resolved = await findSessionFileForThread(CODEX_SESSION_ROOT, threadId);
    if (resolved) {
      this.sessionFileCache.set(threadId, resolved);
    }
    return resolved;
  }

  private stringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
  }
}
