import type { ReasoningEffort } from "../util/reasoning";
import type { PermissionMode } from "../util/permissionMode";

export const DEFAULT_PRIMARY_MODEL = "gpt-5.4";
export const DEFAULT_MINI_MODEL = "gpt-5.4-mini";
export type UiLanguageSetting = "app" | "en" | "ja";

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
  extraSkillRoots: string[];
  codex: {
    model: string;
    command: string;
  };
  showReasoning: boolean;
  autoRestoreTabs: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultModel: DEFAULT_PRIMARY_MODEL,
  defaultReasoningEffort: "xhigh",
  permissionMode: "suggest",
  uiLanguage: "app",
  extraSkillRoots: [],
  codex: {
    model: DEFAULT_PRIMARY_MODEL,
    command: "codex",
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

export type AccountUsageSource = "live" | "session_backfill" | "restored";

export interface AccountUsageSummary {
  limits: UsageSummary["limits"];
  source: AccountUsageSource | null;
  updatedAt: number | null;
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
export type CampaignItemKind = "vault_op" | "patch";
export type CampaignItemStatus = "pending" | "applied" | "failed" | "rolled_back";
export type RefactorCampaignStatus = "draft" | "ready" | "applied" | "rolled_back" | "failed";
export type SmartSetSnapshotReason = "manual" | "drift" | "campaign";
export type SurgeryScopeKind = "current_note" | "search_query" | "smart_set";
export type StudyWorkflowKind = "lecture" | "review" | "paper" | "homework";
export type RecentStudySourceKind = "note" | "attachment" | "smart_set" | "selection";

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

export interface PatchProposal {
  id: string;
  threadId: string | null;
  sourceMessageId: string;
  targetPath: string;
  kind: PatchProposalKind;
  baseSnapshot: string | null;
  proposedText: string;
  unifiedDiff: string;
  summary: string;
  status: PatchProposalStatus;
  createdAt: number;
}

export interface CampaignHeatmapNode {
  path: string;
  score: number;
  backlinks: number;
  reasons: string[];
}

export interface CampaignSnapshotFile {
  path: string;
  existed: boolean;
  text: string | null;
  mtime: number | null;
}

export interface CampaignSnapshotCapsule {
  createdAt: number;
  manifestPath: string | null;
  files: CampaignSnapshotFile[];
}

export interface CampaignExecutionStep {
  id: string;
  itemId: string;
  action: "apply" | "rollback";
  status: "completed" | "failed";
  message: string;
  createdAt: number;
}

export interface CampaignItem {
  id: string;
  refId: string;
  kind: CampaignItemKind;
  title: string;
  summary: string;
  targetPath: string;
  destinationPath: string | null;
  operationKind: VaultOpKind | PatchProposalKind;
  enabled: boolean;
  status: CampaignItemStatus;
  sourceMessageId: string;
}

export interface RefactorCampaign {
  id: string;
  sourceMessageId: string;
  title: string;
  query: string;
  targetPaths: string[];
  items: CampaignItem[];
  heatmap: CampaignHeatmapNode[];
  snapshotCapsule: CampaignSnapshotCapsule | null;
  executionLog: CampaignExecutionStep[];
  status: RefactorCampaignStatus;
  createdAt: number;
}

export interface RefactorRecipeExample {
  kind: CampaignItemKind;
  operationKind: VaultOpKind | PatchProposalKind;
  title: string;
  summary: string;
  targetPath: string;
  destinationPath: string | null;
}

export interface RefactorRecipe {
  id: string;
  title: string;
  description: string;
  sourceCampaignId: string;
  sourceCampaignTitle: string;
  sourceQuery: string;
  preferredScopeKind: SurgeryScopeKind;
  operationKinds: Array<VaultOpKind | PatchProposalKind>;
  examples: RefactorRecipeExample[];
  createdAt: number;
  updatedAt: number;
}

export interface SmartSetQueryProperty {
  key: string;
  value: string | null;
}

export interface SmartSetQuery {
  includeText: string[];
  excludeText: string[];
  pathIncludes: string[];
  pathExcludes: string[];
  tags: string[];
  properties: SmartSetQueryProperty[];
}

export interface SmartSetResultItem {
  path: string;
  title: string;
  excerpt: string;
  mtime: number | null;
  size: number | null;
  score: number;
}

export interface SmartSetResult {
  items: SmartSetResultItem[];
  count: number;
  generatedAt: number;
}

export interface SmartSetSnapshot {
  result: SmartSetResult;
  createdAt: number;
  reason: SmartSetSnapshotReason;
}

export interface SmartSetDrift {
  added: SmartSetResultItem[];
  removed: SmartSetResultItem[];
  changed: SmartSetResultItem[];
  comparedAt: number;
}

export interface SmartSet {
  id: string;
  title: string;
  naturalQuery: string;
  normalizedQuery: string;
  savedNotePath: string | null;
  liveResult: SmartSetResult | null;
  lastSnapshot: SmartSetSnapshot | null;
  lastDrift: SmartSetDrift | null;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
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
  cwd: string;
  studyWorkflow: StudyWorkflowKind | null;
  instructionChips: InstructionChip[];
  summary: ConversationSummary | null;
  lineage: TabLineage;
  targetNotePath: string | null;
  selectionContext: SelectionContext | null;
  composeMode: ComposeMode;
  contextPaths: string[];
  lastResponseId: string | null;
  sessionItems: ComposerAttachment[];
  codexThreadId: string | null;
  model: string;
  reasoningEffort: ReasoningEffort;
  usageSummary: UsageSummary;
  messages: PersistedChatMessage[];
  diffText: string;
  toolLog: ToolCallRecord[];
  patchBasket: PatchProposal[];
  campaigns: RefactorCampaign[];
}

export interface PersistedWorkspaceState {
  tabs: PersistedTabState[];
  activeTabId: string | null;
  accountUsage: AccountUsageSummary;
  activeStudyWorkflow: StudyWorkflowKind | null;
  recentStudySources: RecentStudySource[];
  studyHubState: StudyHubState;
  smartSets: SmartSet[];
  activeSmartSetId: string | null;
  refactorRecipes: RefactorRecipe[];
  activeRefactorRecipeId: string | null;
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
  transport?: ApprovalTransport;
  decisionTarget?: string | null;
  scopeEligible?: boolean;
  scope?: ApprovalSessionScope;
  toolPayload?: VaultOpProposal | null;
}

export interface ConversationTabState extends PersistedTabState {
  messages: ChatMessage[];
  status: AgentStatus;
  runtimeMode: RuntimeMode;
  lastError: string | null;
  pendingApprovals: PendingApproval[];
  toolLog: ToolCallRecord[];
  patchBasket: PatchProposal[];
  campaigns: RefactorCampaign[];
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
  smartSets: SmartSet[];
  activeSmartSetId: string | null;
  refactorRecipes: RefactorRecipe[];
  activeRefactorRecipeId: string | null;
  runtimeIssue: string | null;
  authState: "ready" | "missing_login";
  availableModels: ModelCatalogEntry[];
}

export interface TurnContextSnapshot {
  activeFilePath: string | null;
  targetNotePath: string | null;
  studyWorkflow: StudyWorkflowKind | null;
  workflowText: string | null;
  instructionText: string | null;
  mentionContextText: string | null;
  selection: string | null;
  selectionSourcePath: string | null;
  vaultRoot: string;
  dailyNotePath: string | null;
  contextPackText: string | null;
  attachmentManifestText: string | null;
}
