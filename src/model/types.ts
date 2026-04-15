import type { ReasoningEffort } from "../util/reasoning";
import type { PermissionMode } from "../util/permissionMode";
import type { SourceAcquisitionMode } from "../util/sourceAcquisition";

export const DEFAULT_PRIMARY_MODEL = "gpt-5.4";
export const DEFAULT_MINI_MODEL = "gpt-5.4-mini";
export type UiLanguageSetting = "app" | "en" | "ja";
export type CodexRuntime = "native" | "wsl";

export type AgentStatus = "ready" | "busy" | "waiting_approval" | "error" | "missing_login";
export type RuntimeMode = "normal" | "skill";
export type ComposeMode = "chat" | "plan";
export type WaitingPhase = "boot" | "reasoning" | "tools" | "finalizing";
export type MessageKind =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool"
  | "shell"
  | "diff"
  | "system";

export interface PluginSettings {
  defaultModel: string;
  defaultReasoningEffort: ReasoningEffort;
  permissionMode: PermissionMode;
  uiLanguage: UiLanguageSetting;
  onboardingVersionSeen: number | null;
  autoApplyConsentVersionSeen: number | null;
  extraSkillRoots: string[];
  codex: {
    model: string;
    runtime: CodexRuntime;
    executablePath: string;
  };
  showReasoning: boolean;
  autoRestoreTabs: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultModel: DEFAULT_PRIMARY_MODEL,
  defaultReasoningEffort: "xhigh",
  permissionMode: "suggest",
  uiLanguage: "app",
  onboardingVersionSeen: null,
  autoApplyConsentVersionSeen: null,
  extraSkillRoots: [],
  codex: {
    model: DEFAULT_PRIMARY_MODEL,
    runtime: "native",
    executablePath: "codex",
  },
  showReasoning: true,
  autoRestoreTabs: true,
};

export interface ChatMessage {
  id: string;
  kind: MessageKind;
  text: string;
  createdAt: number;
  pending?: boolean;
  meta?: Record<string, string | number | boolean | null | undefined>;
}

export interface InstructionChip {
  id: string;
  label: string;
  createdAt: number;
}

export interface ConversationSummary {
  id: string;
  text: string;
  createdAt: number;
}

export interface TabLineage {
  parentTabId: string | null;
  forkedFromThreadId: string | null;
  resumedFromThreadId: string | null;
  compactedAt: number | null;
  pendingThreadReset?: boolean;
  compactedFromThreadId?: string | null;
}

export interface SelectionContext {
  text: string;
  sourcePath: string | null;
  createdAt: number;
}

export type ComposerAttachmentKind = "image" | "file" | "pdf";
export type ComposerAttachmentSource = "clipboard" | "picker";

export interface ComposerAttachmentInput {
  name: string;
  mimeType: string | null;
  bytes: Uint8Array;
  source: ComposerAttachmentSource;
  originalPath: string | null;
}

export interface ComposerAttachment {
  id: string;
  kind: ComposerAttachmentKind;
  displayName: string;
  mimeType: string | null;
  stagedPath: string;
  vaultPath: string;
  promptPath: string;
  originalPath: string | null;
  source: ComposerAttachmentSource;
  createdAt: number;
}

export interface PersistedChatMessage {
  id: string;
  kind: MessageKind;
  text: string;
  createdAt: number;
  meta?: Record<string, string | number | boolean | null | undefined>;
}

export interface UsageMetric {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface UsageSummary {
  lastTurn: UsageMetric | null;
  total: UsageMetric | null;
  limits: {
    fiveHourPercent: number | null;
    weekPercent: number | null;
    planType: string | null;
  };
}

export type AccountUsageSource = "live" | "active_poll" | "idle_poll" | "session_backfill" | "restored";

export interface AccountUsageSummary {
  limits: UsageSummary["limits"];
  source: AccountUsageSource | null;
  updatedAt: number | null;
  lastObservedAt: number | null;
  lastCheckedAt: number | null;
  threadId: string | null;
}

export interface WaitingState {
  phase: WaitingPhase;
  text: string;
}

export interface ModelCatalogEntry {
  slug: string;
  displayName: string;
  defaultReasoningLevel: ReasoningEffort;
  supportedReasoningLevels: ReasoningEffort[];
}

export type ToolActivityKind = "tool" | "shell" | "mcp" | "web" | "file" | "todo";
export type ToolActivityStatus = "running" | "completed" | "failed";
export type ApprovalToolName = "write_note" | "run_shell" | "vault_op";
export type ApprovalSessionScope = "write" | "shell";
export type ApprovalTransport = "plugin_proposal";
export type VaultOpKind = "rename" | "move" | "property_set" | "property_remove" | "task_update";
export type PatchProposalKind = "update" | "create";
export type PatchProposalStatus = "pending" | "applied" | "rejected" | "stale" | "conflicted";
export type PatchEvidenceSourceKind = "vault_note" | "attachment" | "web";
export type StudyWorkflowKind = "lecture" | "review" | "paper" | "homework";
export type StudyRecipeWorkflowKind = StudyWorkflowKind | "custom";
export type RecentStudySourceKind = "note" | "attachment" | "selection";
export type StudyRecipePromotionState = "captured" | "promoted";
export type ChatSuggestionKind = "panel_completion" | "plan_execute" | "rewrite_followup";
export type ChatSuggestionStatus = "pending" | "applied" | "dismissed";
export type ChatSuggestionAction =
  | "update_panel"
  | "save_panel_copy"
  | "update_skill"
  | "dismiss"
  | "implement_now"
  | "rewrite_note";

export interface RecentStudySource {
  id: string;
  label: string;
  path: string | null;
  kind: RecentStudySourceKind;
  createdAt: number;
}

export interface StudyHubState {
  lastOpenedAt: number | null;
  isCollapsed: boolean;
}

export interface StudyRecipeContextContract {
  summary: string;
  requireTargetNote: boolean;
  recommendAttachments: boolean;
  requireSelection: boolean;
  minimumPinnedContextCount: number;
}

export interface StudyRecipeExampleSession {
  sourceTabTitle: string;
  targetNotePath: string | null;
  prompt: string;
  outcomePreview: string | null;
  createdAt: number;
}

export interface StudyRecipe {
  id: string;
  title: string;
  description: string;
  commandAlias: string;
  workflow: StudyRecipeWorkflowKind;
  promptTemplate: string;
  linkedSkillNames: string[];
  contextContract: StudyRecipeContextContract;
  outputContract: string[];
  instructionChipHints: string[];
  sourceHints: string[];
  exampleSession: StudyRecipeExampleSession;
  promotionState: StudyRecipePromotionState;
  promotedSkillName: string | null;
  useCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PanelSessionOrigin {
  panelId: string;
  selectedSkillNames: string[];
  promptSnapshot: string;
  awaitingCompletionSignal: boolean;
  lastAssistantMessageId: string | null;
  startedAt: number;
}

export interface ChatSuggestion {
  id: string;
  kind: ChatSuggestionKind;
  status: ChatSuggestionStatus;
  messageId: string;
  panelId: string | null;
  panelTitle: string | null;
  promptSnapshot: string;
  matchedSkillName: string | null;
  canUpdatePanel: boolean;
  canSaveCopy: boolean;
  planSummary: string | null;
  planStatus: "ready_to_implement" | null;
  rewriteSummary?: string | null;
  rewriteQuestion?: string | null;
  createdAt: number;
}

export interface ComposerHistorySnapshot {
  entries: string[];
  index: number | null;
  draft: string | null;
}

export interface VaultOpImpact {
  backlinksCount: number;
  backlinkSources: string[];
  unresolvedWarning: string | null;
  unresolvedSources: string[];
  destinationState: string | null;
  recoveryNote: string | null;
}

export interface ToolCallRecord {
  id: string;
  callId: string;
  kind: ToolActivityKind;
  name: string;
  title: string;
  summary: string;
  argsJson: string;
  createdAt: number;
  updatedAt: number;
  status: ToolActivityStatus;
  resultText?: string;
}

export interface PatchProposalAnchor {
  anchorBefore: string;
  anchorAfter: string;
  replacement: string;
}

export interface PatchEvidence {
  kind: PatchEvidenceSourceKind;
  label: string;
  sourceRef: string | null;
  snippet: string | null;
}

export interface PatchProposal {
  id: string;
  threadId: string | null;
  sourceMessageId: string;
  originTurnId: string | null;
  targetPath: string;
  kind: PatchProposalKind;
  baseSnapshot: string | null;
  proposedText: string;
  unifiedDiff: string;
  summary: string;
  status: PatchProposalStatus;
  createdAt: number;
  anchors?: PatchProposalAnchor[];
  evidence?: PatchEvidence[];
}

export interface RestartDropNotice {
  approvalCount: number;
  patchCount: number;
  createdAt: number;
}

export interface VaultOpProposal {
  kind: VaultOpKind;
  targetPath: string;
  destinationPath?: string;
  propertyKey?: string;
  propertyValue?: string | null;
  taskLine?: number | null;
  taskText?: string | null;
  checked?: boolean | null;
  preflightSummary?: string | null;
  impact?: VaultOpImpact | null;
}

export interface PersistedTabState {
  id: string;
  title: string;
  draft: string;
  composerHistory?: ComposerHistorySnapshot;
  cwd: string;
  studyWorkflow: StudyWorkflowKind | null;
  activeStudyRecipeId: string | null;
  activeStudySkillNames: string[];
  instructionChips: InstructionChip[];
  summary: ConversationSummary | null;
  lineage: TabLineage;
  targetNotePath: string | null;
  selectionContext: SelectionContext | null;
  panelSessionOrigin: PanelSessionOrigin | null;
  chatSuggestion: ChatSuggestion | null;
  composeMode: ComposeMode;
  contextPaths: string[];
  lastResponseId: string | null;
  sessionItems: ComposerAttachment[];
  codexThreadId: string | null;
  model: string;
  reasoningEffort: ReasoningEffort;
  fastMode?: boolean;
  usageSummary: UsageSummary;
  messages: PersistedChatMessage[];
  diffText: string;
  toolLog: ToolCallRecord[];
  patchBasket: PatchProposal[];
  restartDropNotice?: RestartDropNotice | null;
}

export interface PersistedWorkspaceState {
  tabs: PersistedTabState[];
  activeTabId: string | null;
  accountUsage: AccountUsageSummary;
  activeStudyWorkflow: StudyWorkflowKind | null;
  recentStudySources: RecentStudySource[];
  studyHubState: StudyHubState;
  studyRecipes: StudyRecipe[];
  activeStudyRecipeId: string | null;
}

export interface PendingApproval {
  id: string;
  tabId: string;
  callId: string;
  toolName: ApprovalToolName;
  title: string;
  description: string;
  details: string;
  diffText?: string;
  createdAt: number;
  sourceMessageId?: string;
  originTurnId?: string | null;
  transport?: ApprovalTransport;
  decisionTarget?: string | null;
  scopeEligible?: boolean;
  scope?: ApprovalSessionScope;
  toolPayload?: VaultOpProposal | null;
}

export interface ConversationTabState extends PersistedTabState {
  composerHistory: ComposerHistorySnapshot;
  messages: ChatMessage[];
  status: AgentStatus;
  runtimeMode: RuntimeMode;
  lastError: string | null;
  pendingApprovals: PendingApproval[];
  toolLog: ToolCallRecord[];
  patchBasket: PatchProposal[];
  sessionApprovals: {
    write: boolean;
    shell: boolean;
  };
  waitingState: WaitingState | null;
}

export interface WorkspaceState {
  tabs: ConversationTabState[];
  activeTabId: string | null;
  accountUsage: AccountUsageSummary;
  activeStudyWorkflow: StudyWorkflowKind | null;
  recentStudySources: RecentStudySource[];
  studyHubState: StudyHubState;
  studyRecipes: StudyRecipe[];
  activeStudyRecipeId: string | null;
  runtimeIssue: string | null;
  authState: "ready" | "missing_login";
  availableModels: ModelCatalogEntry[];
}

export interface TurnContextSnapshot {
  activeFilePath: string | null;
  targetNotePath: string | null;
  studyWorkflow: StudyWorkflowKind | null;
  conversationSummaryText: string | null;
  sourceAcquisitionMode: SourceAcquisitionMode;
  sourceAcquisitionContractText: string | null;
  workflowText: string | null;
  pluginFeatureText: string | null;
  paperStudyRuntimeOverlayText: string | null;
  skillGuideText: string | null;
  paperStudyGuideText: string | null;
  instructionText: string | null;
  mentionContextText: string | null;
  selection: string | null;
  selectionSourcePath: string | null;
  vaultRoot: string;
  dailyNotePath: string | null;
  contextPackText: string | null;
  attachmentManifestText: string | null;
  attachmentContentText: string | null;
  noteSourcePackText: string | null;
  attachmentMissingPdfTextNames: string[];
  attachmentMissingSourceNames: string[];
}
