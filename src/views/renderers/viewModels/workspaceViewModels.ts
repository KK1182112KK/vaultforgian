import {
  DEFAULT_PRIMARY_MODEL,
  type AccountUsageSummary,
  type ChatSuggestion,
  type ModelCatalogEntry,
  type PendingApproval,
  type WorkspaceState,
} from "../../../model/types";
import { getStudyWorkflowComposerPlaceholder, getStudyWorkflowDefinition } from "../../../util/studyWorkflows";
import { getLocalizedCopy, type LocalizedCopy, type SupportedLocale } from "../../../util/i18n";
import { resolveEffectiveExecutionState } from "../../../util/planExecution";
import { TRANSCRIPT_SOFT_COLLAPSE_WINDOW } from "../../../util/conversationCompaction";
import { compactModelLabel, displayEffortLabel, isTabStreaming } from "../workspaceViewShared";

export interface HeaderActionState {
  newTabDisabled: boolean;
  newSessionDisabled: boolean;
  forkDisabled: boolean;
  resumeDisabled: boolean;
  compactDisabled: boolean;
}

export interface TranscriptRenderState {
  hasConversationContext: boolean;
  showWelcome: boolean;
  showApprovalBatchBar: boolean;
  showSummaryWindow: boolean;
}

export interface ComposerDisplayState {
  placeholder: string;
  panelLabel: string | null;
  activeSkillLabels: string[];
  canClearPanelContext: boolean;
  planModeActive: boolean;
}

export interface StatusBarDisplayState {
  modelLabel: string;
  reasoningLabel: string;
  streaming: boolean;
  learningModeActive: boolean;
  fastModeActive: boolean;
  yoloActive: boolean;
  yoloConfigured: boolean;
  yoloToggleDisabled: boolean;
  effectivePermissionState: string;
  planImplementationArmed: boolean;
  showPlanYoloWarning: boolean;
  canImplementReadyPlan: boolean;
  usageSourceLabel: string | null;
  usageFreshnessState: "live" | "polled" | "restored" | "stale" | null;
  usageFreshnessLabel: "LIVE" | "POLLED" | "RESTORED" | "STALE" | null;
  usageUpdatedAt: number | null;
}

const USAGE_STALE_AFTER_MS = 120_000;

function hasVisibleUsageLimits(accountUsage: AccountUsageSummary | null): boolean {
  if (!accountUsage) {
    return false;
  }
  return (
    typeof accountUsage.limits.fiveHourPercent === "number" ||
    typeof accountUsage.limits.weekPercent === "number" ||
    Boolean(accountUsage.limits.planType)
  );
}

function resolveUsageFreshness(
  accountUsage: AccountUsageSummary | null,
): Pick<StatusBarDisplayState, "usageFreshnessState" | "usageFreshnessLabel" | "usageUpdatedAt"> {
  const updatedAt = accountUsage?.updatedAt ?? null;
  const hasSource = Boolean(accountUsage?.source);
  const hasVisibleUsage = hasVisibleUsageLimits(accountUsage);

  if (!hasSource && !hasVisibleUsage) {
    return {
      usageFreshnessState: null,
      usageFreshnessLabel: null,
      usageUpdatedAt: updatedAt,
    };
  }

  const isStale = updatedAt === null || Date.now() - updatedAt > USAGE_STALE_AFTER_MS;
  if (isStale) {
    return {
      usageFreshnessState: "stale",
      usageFreshnessLabel: "STALE",
      usageUpdatedAt: updatedAt,
    };
  }

  switch (accountUsage?.source) {
    case "live":
      return {
        usageFreshnessState: "live",
        usageFreshnessLabel: "LIVE",
        usageUpdatedAt: updatedAt,
      };
    case "active_poll":
    case "idle_poll":
    case "session_backfill":
      return {
        usageFreshnessState: "polled",
        usageFreshnessLabel: "POLLED",
        usageUpdatedAt: updatedAt,
      };
    case "restored":
      return {
        usageFreshnessState: "restored",
        usageFreshnessLabel: "RESTORED",
        usageUpdatedAt: updatedAt,
      };
    default:
      return {
        usageFreshnessState: "stale",
        usageFreshnessLabel: "STALE",
        usageUpdatedAt: updatedAt,
      };
  }
}

export function buildHeaderActionState(
  state: WorkspaceState,
  activeTab: WorkspaceState["tabs"][number] | null,
  maxOpenTabs: number,
): HeaderActionState {
  const busy = isTabStreaming(activeTab?.status);
  return {
    newTabDisabled: state.tabs.length >= maxOpenTabs,
    newSessionDisabled: busy,
    forkDisabled: !activeTab || busy,
    resumeDisabled: !activeTab?.codexThreadId || busy,
    compactDisabled: !activeTab || busy || activeTab.messages.length === 0,
  };
}

export function buildTranscriptRenderState(
  activeTab: WorkspaceState["tabs"][number] | null,
  transcriptLength: number,
): TranscriptRenderState {
  const hasConversationContext =
    Boolean(activeTab?.summary) ||
    Boolean(activeTab?.lineage.forkedFromThreadId) ||
    Boolean(activeTab?.lineage.resumedFromThreadId) ||
    Boolean(activeTab?.lineage.compactedAt);
  return {
    hasConversationContext,
    showWelcome: transcriptLength === 0 && activeTab?.status !== "busy" && !hasConversationContext,
    showApprovalBatchBar:
      (activeTab?.pendingApprovals.filter((approval: PendingApproval) => approval.toolName === "vault_op").length ?? 0) > 1,
    showSummaryWindow: Boolean(activeTab?.summary) && transcriptLength > TRANSCRIPT_SOFT_COLLAPSE_WINDOW,
  };
}

export function buildComposerDisplayState(
  activeTab: WorkspaceState["tabs"][number] | null,
  panels: Array<{ id: string; title: string; workflow?: string | null }>,
  locale: SupportedLocale,
): ComposerDisplayState {
  const copy = getLocalizedCopy(locale).workspace;
  const activePanel =
    activeTab?.activeStudyRecipeId
      ? panels.find((entry) => entry.id === activeTab.activeStudyRecipeId) ?? null
      : null;
  const workflowLabel = activeTab?.studyWorkflow ? getStudyWorkflowDefinition(activeTab.studyWorkflow, locale).label : null;
  const isBlankCustomPanel = activePanel?.workflow === "custom" && !activePanel.title.trim();
  const panelLabel = activePanel ? (isBlankCustomPanel ? null : activePanel.title.trim() || copy.untitledPanel) : workflowLabel;
  const hasVisiblePanelContext = Boolean(panelLabel) || (activeTab?.activeStudySkillNames?.length ?? 0) > 0 || Boolean(activeTab?.studyWorkflow);
  return {
    placeholder: getStudyWorkflowComposerPlaceholder(activeTab?.studyWorkflow ?? null, locale),
    panelLabel,
    activeSkillLabels: (activeTab?.activeStudySkillNames ?? []).map((skillName) => `/${skillName}`),
    canClearPanelContext: Boolean(activeTab && hasVisiblePanelContext),
    planModeActive: activeTab?.composeMode === "plan",
  };
}

export function buildStatusBarDisplayState(
  activeTab: WorkspaceState["tabs"][number] | null,
  catalog: ModelCatalogEntry[],
  accountUsage: AccountUsageSummary | null,
  permissionMode: "suggest" | "auto-edit" | "full-auto",
  locale: SupportedLocale,
  copy: LocalizedCopy["workspace"],
): StatusBarDisplayState {
  const activeModel = activeTab?.model ?? DEFAULT_PRIMARY_MODEL;
  const selectedModel =
    catalog.find((entry) => entry.slug === activeModel) ??
    catalog[0] ?? {
      slug: activeModel,
      displayName: activeModel,
      defaultReasoningLevel: "medium" as const,
      supportedReasoningLevels: ["low", "medium", "high", "xhigh"] as const,
    };
  let usageSourceLabel: string | null = null;
  if (accountUsage?.source === "live") {
    usageSourceLabel = copy.usageSource.live;
  } else if (accountUsage?.source === "active_poll" || accountUsage?.source === "idle_poll") {
    usageSourceLabel = copy.usageSource.recovered;
  } else if (accountUsage?.source === "session_backfill") {
    usageSourceLabel = copy.usageSource.recovered;
  } else if (accountUsage?.source === "restored") {
    usageSourceLabel = copy.usageSource.restored;
  }
  const usageFreshness = resolveUsageFreshness(accountUsage);
  const executionState = resolveEffectiveExecutionState({
    composeMode: activeTab?.composeMode ?? "chat",
    permissionMode,
    status: activeTab?.status ?? null,
    chatSuggestion: (activeTab?.chatSuggestion ?? null) as ChatSuggestion | null,
  });
  const effectivePermissionState =
    executionState.effectivePermissionState === "planning"
      ? copy.executionPlanning
      : executionState.effectivePermissionState === "armed"
        ? copy.executionArmed
        : executionState.effectivePermissionState === "editing"
          ? copy.executionEditing
          : executionState.effectivePermissionState === "assisted"
            ? copy.executionAssisted
            : copy.executionReadOnly;
  return {
    modelLabel: compactModelLabel(selectedModel.slug, selectedModel.displayName),
    reasoningLabel: displayEffortLabel(activeTab?.reasoningEffort ?? selectedModel.defaultReasoningLevel, locale),
    streaming: isTabStreaming(activeTab?.status),
    learningModeActive: Boolean(activeTab?.learningMode),
    fastModeActive: Boolean(activeTab?.fastMode),
    yoloActive: permissionMode === "full-auto",
    yoloConfigured: executionState.yoloConfigured,
    yoloToggleDisabled: false,
    effectivePermissionState,
    planImplementationArmed: executionState.planImplementationArmed,
    showPlanYoloWarning: executionState.showPlanYoloWarning,
    canImplementReadyPlan: executionState.canImplementReadyPlan,
    usageSourceLabel,
    usageFreshnessState: usageFreshness.usageFreshnessState,
    usageFreshnessLabel: usageFreshness.usageFreshnessLabel,
    usageUpdatedAt: usageFreshness.usageUpdatedAt,
  };
}
