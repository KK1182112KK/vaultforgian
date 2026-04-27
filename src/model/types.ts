import type { ReasoningEffort } from "../util/reasoning";
import type { PermissionMode } from "../util/permissionMode";
import type { SourceAcquisitionMode } from "../util/sourceAcquisition";

export const DEFAULT_PRIMARY_MODEL = "gpt-5.5";
export const DEFAULT_MINI_MODEL = "gpt-5.4-mini";
export type UiLanguageSetting = "app" | "en" | "ja";
export type CodexRuntime = "native" | "wsl";
export type TabBarPosition = "header" | "composer";

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

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: string[];
  enabled: boolean;
}

export interface EnvironmentSnippet {
  id: string;
  name: string;
  entries: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PluginCatalogOverride {
  key: string;
  enabled: boolean;
}

export interface SecurityPolicySettings {
  inheritGlobalCodexHomeAssets: boolean;
  commandBlacklistEnabled: boolean;
  blockedCommandsWindows: string[];
  blockedCommandsUnix: string[];
  allowedExportPaths: string[];
  browserIntegrationEnabled: boolean;
  preferLongContextModel: boolean;
}

export interface VaultSettings {
  defaultModel: string;
  defaultReasoningEffort: ReasoningEffort;
  defaultFastMode: boolean;
  defaultLearningMode: boolean;
  permissionMode: PermissionMode;
  uiLanguage: UiLanguageSetting;
  onboardingVersionSeen: number | null;
  autoApplyConsentVersionSeen: number | null;
  preferredName: string;
  excludedTags: string[];
  mediaFolder: string;
  customSystemPrompt: string;
  autoScrollStreaming: boolean;
  autoGenerateTitle: boolean;
  titleGenerationModel: string;
  vimMappings: string[];
  tabBarPosition: TabBarPosition;
  openInMainEditor: boolean;
  maxChatTabs: number;
  showReasoning: boolean;
  autoRestoreTabs: boolean;
}

export interface LocalSettings {
  extraSkillRoots: string[];
  codex: {
    model: string;
    runtime: CodexRuntime;
    executablePath: string;
  };
  mcpServers: McpServerConfig[];
  pluginOverrides: PluginCatalogOverride[];
  securityPolicy: SecurityPolicySettings;
  customEnv: string[];
  envSnippets: EnvironmentSnippet[];
}

export interface PluginSettings extends VaultSettings, LocalSettings {}

export const DEFAULT_VAULT_SETTINGS: VaultSettings = {
  defaultModel: DEFAULT_PRIMARY_MODEL,
  defaultReasoningEffort: "xhigh",
  defaultFastMode: false,
  defaultLearningMode: false,
  permissionMode: "suggest",
  uiLanguage: "app",
  onboardingVersionSeen: null,
  autoApplyConsentVersionSeen: null,
  preferredName: "",
  excludedTags: [],
  mediaFolder: "",
  customSystemPrompt: "",
  autoScrollStreaming: true,
  autoGenerateTitle: true,
  titleGenerationModel: DEFAULT_PRIMARY_MODEL,
  vimMappings: [],
  tabBarPosition: "header",
  openInMainEditor: false,
  maxChatTabs: 6,
  showReasoning: true,
  autoRestoreTabs: true,
};

export const DEFAULT_SECURITY_POLICY_SETTINGS: SecurityPolicySettings = {
  inheritGlobalCodexHomeAssets: true,
  commandBlacklistEnabled: false,
  blockedCommandsWindows: [
    "del /s /q",
    "rd /s /q",
    "rmdir /s /q",
    "format",
    "diskpart",
    "Remove-Item -Recurse -Force",
  ],
  blockedCommandsUnix: [
    "rm -rf",
    "chmod 777",
    "chmod -R 777",
  ],
  allowedExportPaths: [],
  browserIntegrationEnabled: true,
  preferLongContextModel: false,
};

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  extraSkillRoots: [],
  codex: {
    model: DEFAULT_PRIMARY_MODEL,
    runtime: "native",
    executablePath: "codex",
  },
  mcpServers: [],
  pluginOverrides: [],
  securityPolicy: {
    ...DEFAULT_SECURITY_POLICY_SETTINGS,
  },
  customEnv: [],
  envSnippets: [],
};

export const DEFAULT_SETTINGS: PluginSettings = {
  ...DEFAULT_VAULT_SETTINGS,
  ...DEFAULT_LOCAL_SETTINGS,
  codex: {
    ...DEFAULT_LOCAL_SETTINGS.codex,
  },
  securityPolicy: {
    ...DEFAULT_SECURITY_POLICY_SETTINGS,
  },
};

export interface ChatMessage {
  id: string;
  kind: MessageKind;
  text: string;
  createdAt: number;
  pending?: boolean;
  meta?: Record<string, string | number | boolean | null | undefined>;
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
export type ApprovalToolName = "write_note" | "run_shell" | "vault_op" | "skill_update";
export type ApprovalSessionScope = "write" | "shell";
export type ApprovalTransport = "plugin_proposal";
export type VaultOpKind = "rename" | "move" | "property_set" | "property_remove" | "task_update";
export type PatchProposalKind = "update" | "create";
export type PatchProposalStatus = "pending" | "applied" | "rejected" | "stale" | "conflicted" | "blocked";
export type PatchIntent = "augment" | "replace" | "delete" | "full_replace" | "create";
export type PatchEvidenceSourceKind = "vault_note" | "attachment" | "web";
export type PatchQualityState = "clean" | "auto_healed" | "review_required";
export type PatchQualityIssueCode =
  | "display_math_single_dollar"
  | "math_delimiter_marker_collision"
  | "unmatched_display_math"
  | "adjacent_block_spacing"
  | "mixed_display_math_context"
  | "display_math_same_line_delimiter"
  | "unquoted_callout_header";
export type PatchSafetyIssueCode =
  | "unsafe_full_update"
  | "full_replace_requires_review"
  | "delete_requires_review"
  | "large_deletion";
export type StudyWorkflowKind = "lecture" | "review" | "paper" | "homework";
export type StudyRecipeWorkflowKind = StudyWorkflowKind | "custom";
export type RecentStudySourceKind = "note" | "attachment" | "selection";
export type StudyRecipePromotionState = "captured" | "promoted";
export type ChatSuggestionKind = "panel_completion" | "plan_execute" | "rewrite_followup";
export type ChatSuggestionStatus = "pending" | "applied" | "dismissed";
export type EditOutcome = "applied" | "review_required" | "proposal_only" | "explanation_only" | "failed";
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

export interface StudyCheckpoint {
  workflow: StudyWorkflowKind;
  mastered: string[];
  unclear: string[];
  nextStep: string;
  confidenceNote: string;
}

export type StudyContractWorkflowKind = StudyWorkflowKind | "general";
export type StudyContractConceptStatus = "introduced" | "weak" | "understood" | "review";

export interface StudyContractConcept {
  label: string;
  status: StudyContractConceptStatus;
  evidence: string | null;
}

export interface StudyTurnContract {
  objective: string;
  sources: string[];
  concepts: StudyContractConcept[];
  likelyStuckPoints: string[];
  checkQuestion: string;
  nextAction: string;
  nextProblems: string[];
  confidenceNote: string;
  workflow: StudyContractWorkflowKind;
}

export interface StudyMemoryWeakConcept {
  conceptLabel: string;
  evidence: string;
  lastStuckPoint: string;
  nextQuestion: string;
  workflow: StudyContractWorkflowKind;
  updatedAt: number;
}

export interface StudyMemoryUnderstoodConcept {
  conceptLabel: string;
  evidence: string;
  workflow: StudyContractWorkflowKind;
  updatedAt: number;
}

export interface StudyNextProblem {
  prompt: string;
  workflow: StudyContractWorkflowKind;
  source: string | null;
  createdAt: number;
}

export interface StudyStuckPoint {
  conceptLabel: string;
  detail: string;
  workflow: StudyContractWorkflowKind;
  createdAt: number;
}

export interface UserStudyMemory {
  weakConcepts: StudyMemoryWeakConcept[];
  understoodConcepts: StudyMemoryUnderstoodConcept[];
  nextProblems: StudyNextProblem[];
  recentStuckPoints: StudyStuckPoint[];
}

export interface StudyWeakPoint {
  conceptLabel: string;
  workflow: StudyWorkflowKind;
  updatedAt: number;
  explanationSummary: string;
  nextQuestion: string;
  resolved: boolean;
}

export interface StudyCoachState {
  latestRecap: StudyCheckpoint | null;
  weakPointLedger: StudyWeakPoint[];
  lastCheckpointAt: number | null;
  latestContract?: StudyTurnContract | null;
  lastStuckPoint?: StudyStuckPoint | null;
  nextProblems?: StudyNextProblem[];
}

export interface UserAdaptationProfile {
  explanationDepth: "balanced" | "concise" | "step_by_step";
  preferredFocusTags: string[];
  preferredNoteStyleHints: string[];
  avoidResponsePatterns: string[];
  updatedAt: number;
}

export interface PanelAdaptationOverlay {
  panelId: string;
  preferredFocusTags: string[];
  preferredNoteStyleHints: string[];
  preferredSkillNames: string[];
  lastAppliedTargetPath: string | null;
  updatedAt: number;
}

export interface UserAdaptationMemory {
  globalProfile: UserAdaptationProfile | null;
  panelOverlays: Record<string, PanelAdaptationOverlay>;
  studyMemory?: UserStudyMemory | null;
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

export interface PatchQualityIssue {
  code: PatchQualityIssueCode;
  line?: number | null;
  detail?: string | null;
}

export interface PatchSafetyIssue {
  code: PatchSafetyIssueCode;
  detail?: string | null;
  deletedChars?: number | null;
  deletedPercent?: number | null;
}

export interface PatchProposal {
  id: string;
  threadId: string | null;
  sourceMessageId: string;
  originTurnId: string | null;
  targetPath: string;
  kind: PatchProposalKind;
  intent?: PatchIntent;
  baseSnapshot: string | null;
  proposedText: string;
  unifiedDiff: string;
  summary: string;
  status: PatchProposalStatus;
  createdAt: number;
  qualityState?: PatchQualityState;
  qualityIssues?: PatchQualityIssue[];
  healedByPlugin?: boolean;
  safetyIssues?: PatchSafetyIssue[];
  anchors?: PatchProposalAnchor[];
  evidence?: PatchEvidence[];
}

export interface GeneratedDiagramRecord {
  id: string;
  assetPath: string;
  targetNotePath: string | null;
  sourceMessageId: string;
  createdAt: number;
  status: "saved" | "inserted" | "failed";
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

export interface SkillFeedbackRecord {
  prompt: string;
  summary: string;
  targetNotePath: string | null;
  panelId: string | null;
  selectedSkillNames?: string[];
  conversationSummary?: string | null;
  appliedChangeSummary?: string | null;
  attributionReason?: string | null;
}

export interface SkillImprovementProposal {
  skillName: string;
  skillPath: string;
  baseContent: string;
  baseContentHash: string;
  nextContent: string;
  feedbackSummary: string;
  attribution: SkillFeedbackRecord;
}

export type ApprovalToolPayload = VaultOpProposal | SkillImprovementProposal;

export interface PersistedTabState {
  id: string;
  title: string;
  draft: string;
  composerHistory?: ComposerHistorySnapshot;
  cwd: string;
  studyWorkflow: StudyWorkflowKind | null;
  activeStudyRecipeId: string | null;
  activeStudySkillNames: string[];
  summary: ConversationSummary | null;
  studyCoachState?: StudyCoachState | null;
  lineage: TabLineage;
  targetNotePath: string | null;
  selectionContext: SelectionContext | null;
  panelSessionOrigin: PanelSessionOrigin | null;
  chatSuggestion: ChatSuggestion | null;
  composeMode: ComposeMode;
  learningMode: boolean;
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
  generatedDiagrams?: GeneratedDiagramRecord[];
  restartDropNotice?: RestartDropNotice | null;
}

export interface RuntimeTabState {
  sessionItems: ComposerAttachment[];
  patchBasket: PatchProposal[];
  generatedDiagrams?: GeneratedDiagramRecord[];
  pendingApprovals: PendingApproval[];
  status: AgentStatus;
  runtimeMode: RuntimeMode;
  lastError: string | null;
  sessionApprovals: {
    write: boolean;
    shell: boolean;
  };
  waitingState: WaitingState | null;
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
  userAdaptationMemory?: UserAdaptationMemory | null;
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
  toolPayload?: ApprovalToolPayload | null;
}

export interface ConversationTabState extends PersistedTabState, RuntimeTabState {
  studyCoachState?: StudyCoachState | null;
  composerHistory: ComposerHistorySnapshot;
  messages: ChatMessage[];
  toolLog: ToolCallRecord[];
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
  userAdaptationMemory?: UserAdaptationMemory | null;
  runtimeIssue: string | null;
  authState: "ready" | "missing_login";
  availableModels: ModelCatalogEntry[];
}

export interface TurnContextSnapshot {
  activeFilePath: string | null;
  targetNotePath: string | null;
  studyWorkflow: StudyWorkflowKind | null;
  studyCoachText?: string | null;
  userAdaptationText?: string | null;
  conversationSummaryText: string | null;
  sourceAcquisitionMode: SourceAcquisitionMode;
  sourceAcquisitionContractText: string | null;
  workflowText: string | null;
  pluginFeatureText: string | null;
  paperStudyRuntimeOverlayText: string | null;
  skillGuideText: string | null;
  paperStudyGuideText: string | null;
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
