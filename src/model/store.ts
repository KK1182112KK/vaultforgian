import { makeId } from "../util/id";
import { getFallbackModelCatalog } from "../util/models";
import { EMPTY_COMPOSER_HISTORY_STATE } from "../util/composerHistory";
import {
  createEmptyAccountUsageSummary,
  createEmptyUsageSummary,
  normalizeAccountUsageSummary,
  shouldPreferAccountUsageSummary,
} from "../util/usage";
import { DEFAULT_PRIMARY_MODEL } from "./types";
import type {
  AccountUsageSummary,
  ChatMessage,
  ComposerHistorySnapshot,
  GeneratedDiagramRecord,
  RestartDropNotice,
  RecentStudySource,
  StudyCoachState,
  StudyContractConcept,
  StudyContractConceptStatus,
  StudyContractWorkflowKind,
  StudyHubState,
  StudyMemoryUnderstoodConcept,
  StudyMemoryWeakConcept,
  StudyNextProblem,
  StudyWeakPoint,
  StudyWorkflowKind,
  StudyStuckPoint,
  StudyTurnContract,
  ConversationTabState,
  ModelCatalogEntry,
  PatchProposal,
  PendingApproval,
  PanelImprovementSignal,
  PanelSourcePreference,
  PanelStudyMemory,
  PersistedWorkspaceState,
  StudyRecipe,
  ToolCallRecord,
  UserAdaptationMemory,
  UserAdaptationProfile,
  UserStudyMemory,
  UsageSummary,
  WaitingState,
  WorkspaceState,
} from "./types";

type Listener = (state: WorkspaceState) => void;
type SessionModeDefaults = {
  fastMode: boolean;
  learningMode: boolean;
};

const MAX_PERSISTED_COMPOSER_HISTORY_ENTRIES = 50;
const LEGACY_TRANSIENT_RUNTIME_SYSTEM_MESSAGE_PATTERNS = [
  /^Codex stopped emitting events for 120 seconds, so this turn was aborted\.$/i,
  /^The reply came back empty, so this conversation was compacted and retried on a fresh thread\.$/i,
  /^The session file was not found\.$/i,
  /^Codex が 120 秒以上 event を返さなかったため、この turn を中断しました。$/i,
  /^返信が空だったため、この会話を compact して fresh thread で再試行しました。$/i,
  /^session file が見つかりませんでした。$/i,
] as const;

const RESTART_DROP_NOTICE_META_KEY = "restartDropNotice";
const MAX_STUDY_MEMORY_WEAK_CONCEPTS = 20;
const MAX_STUDY_MEMORY_UNDERSTOOD_CONCEPTS = 30;
const MAX_STUDY_MEMORY_NEXT_PROBLEMS = 10;
const MAX_STUDY_MEMORY_STUCK_POINTS = 10;
const MAX_PANEL_SOURCE_PREFERENCES = 12;
const MAX_PANEL_IMPROVEMENT_SIGNALS = 20;

function normalizeLineage(lineage: ConversationTabState["lineage"] | null | undefined): ConversationTabState["lineage"] {
  return {
    parentTabId: null,
    forkedFromThreadId: null,
    resumedFromThreadId: null,
    compactedAt: null,
    pendingThreadReset: false,
    compactedFromThreadId: null,
    ...lineage,
  };
}

function normalizeStudyWeakPoint(point: StudyWeakPoint | null | undefined): StudyWeakPoint | null {
  if (!point) {
    return null;
  }
  const conceptLabel = typeof point.conceptLabel === "string" ? point.conceptLabel.trim() : "";
  const workflow = point.workflow;
  const explanationSummary = typeof point.explanationSummary === "string" ? point.explanationSummary.trim() : "";
  const nextQuestion = typeof point.nextQuestion === "string" ? point.nextQuestion.trim() : "";
  const updatedAt = typeof point.updatedAt === "number" && Number.isFinite(point.updatedAt) ? point.updatedAt : Date.now();
  if (!conceptLabel || !workflow || !explanationSummary || !nextQuestion) {
    return null;
  }
  return {
    conceptLabel,
    workflow,
    updatedAt,
    explanationSummary,
    nextQuestion,
    resolved: Boolean(point.resolved),
  };
}

function normalizeStudyContractWorkflow(value: unknown): StudyContractWorkflowKind {
  return value === "lecture" || value === "review" || value === "paper" || value === "homework" || value === "general"
    ? value
    : "general";
}

function normalizeStudyContractConceptStatus(value: unknown): StudyContractConceptStatus {
  return value === "introduced" || value === "weak" || value === "understood" || value === "review" ? value : "review";
}

function normalizeStudyContractConcept(concept: StudyContractConcept | null | undefined): StudyContractConcept | null {
  if (!concept) {
    return null;
  }
  const label = typeof concept.label === "string" ? concept.label.trim() : "";
  if (!label) {
    return null;
  }
  return {
    label,
    status: normalizeStudyContractConceptStatus(concept.status),
    evidence: typeof concept.evidence === "string" && concept.evidence.trim() ? concept.evidence.trim() : null,
  };
}

function normalizeStudyTurnContract(contract: StudyTurnContract | null | undefined): StudyTurnContract | null {
  if (!contract) {
    return null;
  }
  const objective = typeof contract.objective === "string" ? contract.objective.trim() : "";
  const sources = Array.isArray(contract.sources) ? contract.sources.map((entry) => entry.trim()).filter(Boolean) : [];
  const concepts = Array.isArray(contract.concepts)
    ? contract.concepts
        .map((entry) => normalizeStudyContractConcept(entry))
        .filter((entry): entry is StudyContractConcept => Boolean(entry))
    : [];
  const checkQuestion = typeof contract.checkQuestion === "string" ? contract.checkQuestion.trim() : "";
  const nextAction = typeof contract.nextAction === "string" ? contract.nextAction.trim() : "";
  const confidenceNote = typeof contract.confidenceNote === "string" ? contract.confidenceNote.trim() : "";
  if (!objective || sources.length === 0 || concepts.length === 0 || !checkQuestion || !nextAction || !confidenceNote) {
    return null;
  }
  return {
    objective,
    sources,
    concepts,
    likelyStuckPoints: Array.isArray(contract.likelyStuckPoints)
      ? contract.likelyStuckPoints.map((entry) => entry.trim()).filter(Boolean)
      : [],
    checkQuestion,
    nextAction,
    nextProblems: Array.isArray(contract.nextProblems)
      ? contract.nextProblems.map((entry) => entry.trim()).filter(Boolean)
      : [],
    confidenceNote,
    workflow: normalizeStudyContractWorkflow(contract.workflow),
  };
}

function normalizeStudyStuckPoint(point: StudyStuckPoint | null | undefined): StudyStuckPoint | null {
  if (!point) {
    return null;
  }
  const conceptLabel = typeof point.conceptLabel === "string" ? point.conceptLabel.trim() : "";
  const detail = typeof point.detail === "string" ? point.detail.trim() : "";
  const createdAt = typeof point.createdAt === "number" && Number.isFinite(point.createdAt) ? point.createdAt : Date.now();
  if (!conceptLabel || !detail) {
    return null;
  }
  return {
    conceptLabel,
    detail,
    workflow: normalizeStudyContractWorkflow(point.workflow),
    createdAt,
  };
}

function normalizeStudyNextProblem(problem: StudyNextProblem | null | undefined): StudyNextProblem | null {
  if (!problem) {
    return null;
  }
  const prompt = typeof problem.prompt === "string" ? problem.prompt.trim() : "";
  const createdAt = typeof problem.createdAt === "number" && Number.isFinite(problem.createdAt) ? problem.createdAt : Date.now();
  if (!prompt) {
    return null;
  }
  return {
    prompt,
    workflow: normalizeStudyContractWorkflow(problem.workflow),
    source: typeof problem.source === "string" && problem.source.trim() ? problem.source.trim() : null,
    createdAt,
  };
}

function normalizeStudyWeakMemoryConcept(concept: StudyMemoryWeakConcept | null | undefined): StudyMemoryWeakConcept | null {
  if (!concept) {
    return null;
  }
  const conceptLabel = typeof concept.conceptLabel === "string" ? concept.conceptLabel.trim() : "";
  const evidence = typeof concept.evidence === "string" ? concept.evidence.trim() : "";
  const lastStuckPoint = typeof concept.lastStuckPoint === "string" ? concept.lastStuckPoint.trim() : "";
  const nextQuestion = typeof concept.nextQuestion === "string" ? concept.nextQuestion.trim() : "";
  const updatedAt = typeof concept.updatedAt === "number" && Number.isFinite(concept.updatedAt) ? concept.updatedAt : Date.now();
  if (!conceptLabel || !evidence || !nextQuestion) {
    return null;
  }
  return {
    conceptLabel,
    evidence,
    lastStuckPoint,
    nextQuestion,
    workflow: normalizeStudyContractWorkflow(concept.workflow),
    updatedAt,
  };
}

function normalizeStudyUnderstoodMemoryConcept(
  concept: StudyMemoryUnderstoodConcept | null | undefined,
): StudyMemoryUnderstoodConcept | null {
  if (!concept) {
    return null;
  }
  const conceptLabel = typeof concept.conceptLabel === "string" ? concept.conceptLabel.trim() : "";
  const evidence = typeof concept.evidence === "string" ? concept.evidence.trim() : "";
  const updatedAt = typeof concept.updatedAt === "number" && Number.isFinite(concept.updatedAt) ? concept.updatedAt : Date.now();
  if (!conceptLabel || !evidence) {
    return null;
  }
  return {
    conceptLabel,
    evidence,
    workflow: normalizeStudyContractWorkflow(concept.workflow),
    updatedAt,
  };
}

function normalizeUserStudyMemory(memory: UserStudyMemory | null | undefined): UserStudyMemory | null {
  if (!memory) {
    return null;
  }
  const weakConcepts = Array.isArray(memory.weakConcepts)
    ? memory.weakConcepts
        .map((entry) => normalizeStudyWeakMemoryConcept(entry))
        .filter((entry): entry is StudyMemoryWeakConcept => Boolean(entry))
        .slice(0, MAX_STUDY_MEMORY_WEAK_CONCEPTS)
    : [];
  const understoodConcepts = Array.isArray(memory.understoodConcepts)
    ? memory.understoodConcepts
        .map((entry) => normalizeStudyUnderstoodMemoryConcept(entry))
        .filter((entry): entry is StudyMemoryUnderstoodConcept => Boolean(entry))
        .slice(0, MAX_STUDY_MEMORY_UNDERSTOOD_CONCEPTS)
    : [];
  const nextProblems = Array.isArray(memory.nextProblems)
    ? memory.nextProblems
        .map((entry) => normalizeStudyNextProblem(entry))
        .filter((entry): entry is StudyNextProblem => Boolean(entry))
        .slice(0, MAX_STUDY_MEMORY_NEXT_PROBLEMS)
    : [];
  const recentStuckPoints = Array.isArray(memory.recentStuckPoints)
    ? memory.recentStuckPoints
        .map((entry) => normalizeStudyStuckPoint(entry))
        .filter((entry): entry is StudyStuckPoint => Boolean(entry))
        .slice(0, MAX_STUDY_MEMORY_STUCK_POINTS)
    : [];
  if (weakConcepts.length === 0 && understoodConcepts.length === 0 && nextProblems.length === 0 && recentStuckPoints.length === 0) {
    return null;
  }
  return {
    weakConcepts,
    understoodConcepts,
    nextProblems,
    recentStuckPoints,
  };
}

function normalizePanelSourcePreference(preference: PanelSourcePreference | null | undefined): PanelSourcePreference | null {
  if (!preference) {
    return null;
  }
  const label = typeof preference.label === "string" ? preference.label.trim() : "";
  const count = typeof preference.count === "number" && Number.isFinite(preference.count) ? Math.max(1, Math.floor(preference.count)) : 1;
  const updatedAt =
    typeof preference.updatedAt === "number" && Number.isFinite(preference.updatedAt) ? preference.updatedAt : Date.now();
  if (!label) {
    return null;
  }
  return {
    label,
    count,
    workflow: normalizeStudyContractWorkflow(preference.workflow),
    updatedAt,
  };
}

function normalizePanelImprovementSignal(signal: PanelImprovementSignal | null | undefined): PanelImprovementSignal | null {
  if (!signal) {
    return null;
  }
  const kind =
    signal.kind === "source" || signal.kind === "skill" || signal.kind === "workflow" || signal.kind === "weak_concept"
      ? signal.kind
      : null;
  const key = typeof signal.key === "string" ? signal.key.trim().toLowerCase().replace(/\s+/g, " ") : "";
  const label = typeof signal.label === "string" ? signal.label.trim() : "";
  const count = typeof signal.count === "number" && Number.isFinite(signal.count) ? Math.max(1, Math.floor(signal.count)) : 1;
  const updatedAt = typeof signal.updatedAt === "number" && Number.isFinite(signal.updatedAt) ? signal.updatedAt : Date.now();
  if (!kind || !key || !label) {
    return null;
  }
  return {
    kind,
    key,
    label,
    count,
    updatedAt,
  };
}

function normalizePanelStudyMemory(memory: PanelStudyMemory | null | undefined): PanelStudyMemory | null {
  if (!memory) {
    return null;
  }
  const base = normalizeUserStudyMemory(memory);
  const sourcePreferences = Array.isArray(memory.sourcePreferences)
    ? memory.sourcePreferences
        .map((entry) => normalizePanelSourcePreference(entry))
        .filter((entry): entry is PanelSourcePreference => Boolean(entry))
        .slice(0, MAX_PANEL_SOURCE_PREFERENCES)
    : [];
  const improvementSignals = Array.isArray(memory.improvementSignals)
    ? memory.improvementSignals
        .map((entry) => normalizePanelImprovementSignal(entry))
        .filter((entry): entry is PanelImprovementSignal => Boolean(entry))
        .slice(0, MAX_PANEL_IMPROVEMENT_SIGNALS)
    : [];
  const lastContract = normalizeStudyTurnContract(memory.lastContract ?? null);
  if (!base && sourcePreferences.length === 0 && improvementSignals.length === 0 && !lastContract) {
    return null;
  }
  return {
    weakConcepts: base?.weakConcepts ?? [],
    understoodConcepts: base?.understoodConcepts ?? [],
    nextProblems: base?.nextProblems ?? [],
    recentStuckPoints: base?.recentStuckPoints ?? [],
    sourcePreferences,
    lastContract,
    improvementSignals,
  };
}

function normalizeStudyCoachState(studyCoachState: StudyCoachState | null | undefined): StudyCoachState | null {
  if (!studyCoachState) {
    return null;
  }
  const latestRecap = studyCoachState.latestRecap
    ? {
        workflow: studyCoachState.latestRecap.workflow,
        mastered: Array.isArray(studyCoachState.latestRecap.mastered)
          ? studyCoachState.latestRecap.mastered.map((entry) => entry.trim()).filter(Boolean)
          : [],
        unclear: Array.isArray(studyCoachState.latestRecap.unclear)
          ? studyCoachState.latestRecap.unclear.map((entry) => entry.trim()).filter(Boolean)
          : [],
        nextStep: typeof studyCoachState.latestRecap.nextStep === "string" ? studyCoachState.latestRecap.nextStep.trim() : "",
        confidenceNote:
          typeof studyCoachState.latestRecap.confidenceNote === "string" ? studyCoachState.latestRecap.confidenceNote.trim() : "",
      }
    : null;
  const weakPointLedger = Array.isArray(studyCoachState.weakPointLedger)
    ? studyCoachState.weakPointLedger
        .map((entry) => normalizeStudyWeakPoint(entry))
        .filter((entry): entry is StudyWeakPoint => Boolean(entry))
    : [];
  const lastCheckpointAt =
    typeof studyCoachState.lastCheckpointAt === "number" && Number.isFinite(studyCoachState.lastCheckpointAt)
      ? studyCoachState.lastCheckpointAt
      : latestRecap
        ? Date.now()
        : null;
  const latestContract = normalizeStudyTurnContract(studyCoachState.latestContract ?? null);
  const lastStuckPoint = normalizeStudyStuckPoint(studyCoachState.lastStuckPoint ?? null);
  const nextProblems = Array.isArray(studyCoachState.nextProblems)
    ? studyCoachState.nextProblems
        .map((entry) => normalizeStudyNextProblem(entry))
        .filter((entry): entry is StudyNextProblem => Boolean(entry))
        .slice(0, MAX_STUDY_MEMORY_NEXT_PROBLEMS)
    : [];
  if (!latestRecap && weakPointLedger.length === 0 && lastCheckpointAt === null && !latestContract && !lastStuckPoint && nextProblems.length === 0) {
    return null;
  }
  return {
    latestRecap:
      latestRecap && latestRecap.nextStep && latestRecap.confidenceNote
        ? latestRecap
        : null,
    weakPointLedger,
    lastCheckpointAt,
    ...(latestContract ? { latestContract } : {}),
    ...(lastStuckPoint ? { lastStuckPoint } : {}),
    ...(nextProblems.length > 0 ? { nextProblems } : {}),
  };
}

function cloneStudyCoachState(studyCoachState: StudyCoachState | null | undefined): StudyCoachState | null {
  const normalized = normalizeStudyCoachState(studyCoachState);
  if (!normalized) {
    return null;
  }
  return {
    latestRecap: normalized.latestRecap
      ? {
          workflow: normalized.latestRecap.workflow,
          mastered: [...normalized.latestRecap.mastered],
          unclear: [...normalized.latestRecap.unclear],
          nextStep: normalized.latestRecap.nextStep,
          confidenceNote: normalized.latestRecap.confidenceNote,
        }
      : null,
    weakPointLedger: normalized.weakPointLedger.map((entry) => ({ ...entry })),
    lastCheckpointAt: normalized.lastCheckpointAt,
    ...(normalized.latestContract
      ? {
          latestContract: {
            ...normalized.latestContract,
            sources: [...normalized.latestContract.sources],
            concepts: normalized.latestContract.concepts.map((entry) => ({ ...entry })),
            likelyStuckPoints: [...normalized.latestContract.likelyStuckPoints],
            nextProblems: [...normalized.latestContract.nextProblems],
          },
        }
      : {}),
    ...(normalized.lastStuckPoint ? { lastStuckPoint: { ...normalized.lastStuckPoint } } : {}),
    ...(normalized.nextProblems ? { nextProblems: normalized.nextProblems.map((entry) => ({ ...entry })) } : {}),
  };
}

function normalizeUserAdaptationMemory(memory: UserAdaptationMemory | null | undefined): UserAdaptationMemory | null {
  if (!memory) {
    return null;
  }
  const globalProfile: UserAdaptationProfile | null = memory.globalProfile
    ? {
        explanationDepth:
          memory.globalProfile.explanationDepth === "concise" || memory.globalProfile.explanationDepth === "step_by_step"
            ? memory.globalProfile.explanationDepth
            : "balanced",
        preferredFocusTags: Array.isArray(memory.globalProfile.preferredFocusTags)
          ? [...new Set(memory.globalProfile.preferredFocusTags.map((entry) => entry.trim()).filter(Boolean))]
          : [],
        preferredNoteStyleHints: Array.isArray(memory.globalProfile.preferredNoteStyleHints)
          ? [...new Set(memory.globalProfile.preferredNoteStyleHints.map((entry) => entry.trim()).filter(Boolean))]
          : [],
        avoidResponsePatterns: Array.isArray(memory.globalProfile.avoidResponsePatterns)
          ? [...new Set(memory.globalProfile.avoidResponsePatterns.map((entry) => entry.trim()).filter(Boolean))]
          : [],
        updatedAt:
          typeof memory.globalProfile.updatedAt === "number" && Number.isFinite(memory.globalProfile.updatedAt)
            ? memory.globalProfile.updatedAt
            : Date.now(),
      }
    : null;
  const panelEntries = Object.entries(memory.panelOverlays ?? {}).flatMap(([panelId, overlay]) => {
    const normalizedPanelId = panelId.trim();
    if (!normalizedPanelId || !overlay) {
      return [];
    }
    return [
      [
        normalizedPanelId,
        {
          panelId: typeof overlay.panelId === "string" && overlay.panelId.trim() ? overlay.panelId.trim() : normalizedPanelId,
          preferredFocusTags: Array.isArray(overlay.preferredFocusTags)
            ? [...new Set(overlay.preferredFocusTags.map((entry) => entry.trim()).filter(Boolean))]
            : [],
          preferredNoteStyleHints: Array.isArray(overlay.preferredNoteStyleHints)
            ? [...new Set(overlay.preferredNoteStyleHints.map((entry) => entry.trim()).filter(Boolean))]
            : [],
          preferredSkillNames: Array.isArray(overlay.preferredSkillNames)
            ? [...new Set(overlay.preferredSkillNames.map((entry) => entry.trim()).filter(Boolean))]
            : [],
          lastAppliedTargetPath:
            typeof overlay.lastAppliedTargetPath === "string" && overlay.lastAppliedTargetPath.trim()
              ? overlay.lastAppliedTargetPath.trim()
              : null,
          updatedAt:
            typeof overlay.updatedAt === "number" && Number.isFinite(overlay.updatedAt) ? overlay.updatedAt : Date.now(),
          ...(normalizePanelStudyMemory(overlay.studyMemory ?? null)
            ? { studyMemory: normalizePanelStudyMemory(overlay.studyMemory ?? null) }
            : {}),
        },
      ] as const,
    ];
  });
  const studyMemory = normalizeUserStudyMemory(memory.studyMemory ?? null);
  if (!globalProfile && panelEntries.length === 0 && !studyMemory) {
    return null;
  }
  return {
    globalProfile,
    panelOverlays: Object.fromEntries(panelEntries),
    ...(studyMemory ? { studyMemory } : {}),
  };
}

function cloneUserAdaptationMemory(memory: UserAdaptationMemory | null | undefined): UserAdaptationMemory | null {
  const normalized = normalizeUserAdaptationMemory(memory);
  if (!normalized) {
    return null;
  }
  return {
    globalProfile: normalized.globalProfile
      ? {
          explanationDepth: normalized.globalProfile.explanationDepth,
          preferredFocusTags: [...normalized.globalProfile.preferredFocusTags],
          preferredNoteStyleHints: [...normalized.globalProfile.preferredNoteStyleHints],
          avoidResponsePatterns: [...normalized.globalProfile.avoidResponsePatterns],
          updatedAt: normalized.globalProfile.updatedAt,
        }
      : null,
    panelOverlays: Object.fromEntries(
      Object.entries(normalized.panelOverlays).map(([panelId, overlay]) => [
        panelId,
        {
          panelId: overlay.panelId,
          preferredFocusTags: [...overlay.preferredFocusTags],
          preferredNoteStyleHints: [...overlay.preferredNoteStyleHints],
          preferredSkillNames: [...overlay.preferredSkillNames],
          lastAppliedTargetPath: overlay.lastAppliedTargetPath,
          updatedAt: overlay.updatedAt,
          ...(overlay.studyMemory
            ? {
                studyMemory: {
                  weakConcepts: overlay.studyMemory.weakConcepts.map((entry) => ({ ...entry })),
                  understoodConcepts: overlay.studyMemory.understoodConcepts.map((entry) => ({ ...entry })),
                  nextProblems: overlay.studyMemory.nextProblems.map((entry) => ({ ...entry })),
                  recentStuckPoints: overlay.studyMemory.recentStuckPoints.map((entry) => ({ ...entry })),
                  sourcePreferences: overlay.studyMemory.sourcePreferences.map((entry) => ({ ...entry })),
                  lastContract: overlay.studyMemory.lastContract
                    ? {
                        ...overlay.studyMemory.lastContract,
                        sources: [...overlay.studyMemory.lastContract.sources],
                        concepts: overlay.studyMemory.lastContract.concepts.map((entry) => ({ ...entry })),
                        likelyStuckPoints: [...overlay.studyMemory.lastContract.likelyStuckPoints],
                        nextProblems: [...overlay.studyMemory.lastContract.nextProblems],
                      }
                    : null,
                  improvementSignals: overlay.studyMemory.improvementSignals.map((entry) => ({ ...entry })),
                },
              }
            : {}),
        },
      ]),
    ),
    ...(normalized.studyMemory
      ? {
          studyMemory: {
            weakConcepts: normalized.studyMemory.weakConcepts.map((entry) => ({ ...entry })),
            understoodConcepts: normalized.studyMemory.understoodConcepts.map((entry) => ({ ...entry })),
            nextProblems: normalized.studyMemory.nextProblems.map((entry) => ({ ...entry })),
            recentStuckPoints: normalized.studyMemory.recentStuckPoints.map((entry) => ({ ...entry })),
          },
        }
      : {}),
  };
}

function normalizeRestartDropNotice(notice: RestartDropNotice | null | undefined): RestartDropNotice | null {
  if (!notice) {
    return null;
  }
  const approvalCount =
    typeof notice.approvalCount === "number" && Number.isFinite(notice.approvalCount) ? Math.max(0, notice.approvalCount) : 0;
  const patchCount =
    typeof notice.patchCount === "number" && Number.isFinite(notice.patchCount) ? Math.max(0, notice.patchCount) : 0;
  const createdAt = typeof notice.createdAt === "number" && Number.isFinite(notice.createdAt) ? notice.createdAt : Date.now();
  if (approvalCount === 0 && patchCount === 0) {
    return null;
  }
  return {
    approvalCount,
    patchCount,
    createdAt,
  };
}

function formatRestartDropCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildRestartDropNoticeId(notice: RestartDropNotice): string {
  return `restart-drop-${notice.createdAt}-${notice.approvalCount}-${notice.patchCount}`;
}

function buildRestartDropMessage(notice: RestartDropNotice): ChatMessage {
  const dropped: string[] = [];
  if (notice.approvalCount > 0) {
    dropped.push(formatRestartDropCount(notice.approvalCount, "approval", "approvals"));
  }
  if (notice.patchCount > 0) {
    dropped.push(formatRestartDropCount(notice.patchCount, "patch proposal", "patch proposals"));
  }
  const verb = dropped.length === 1 ? "was" : "were";
  return {
    id: buildRestartDropNoticeId(notice),
    kind: "system",
    text: `${dropped.join(" and ")} ${verb} cleared when this tab was restored after restart. Review state from the previous session could not be recovered automatically.`,
    createdAt: notice.createdAt,
    meta: {
      [RESTART_DROP_NOTICE_META_KEY]: true,
      restartDropApprovalCount: notice.approvalCount,
      restartDropPatchCount: notice.patchCount,
      restartDropCreatedAt: notice.createdAt,
    },
  };
}

function hasRestartDropMessage(messages: ChatMessage[], notice: RestartDropNotice): boolean {
  return messages.some((message) => {
    if (message.kind !== "system") {
      return false;
    }
    return (
      message.meta?.[RESTART_DROP_NOTICE_META_KEY] === true &&
      message.meta?.restartDropCreatedAt === notice.createdAt &&
      message.meta?.restartDropApprovalCount === notice.approvalCount &&
      message.meta?.restartDropPatchCount === notice.patchCount
    );
  });
}

function appendRestartDropMessage(
  messages: ChatMessage[] | null | undefined,
  notice: RestartDropNotice | null,
): ChatMessage[] {
  const normalizedMessages = normalizeRestoredMessages(messages);
  if (!notice || hasRestartDropMessage(normalizedMessages, notice)) {
    return normalizedMessages;
  }
  return [...normalizedMessages, buildRestartDropMessage(notice)];
}

function buildPersistedRestartDropNotice(tab: ConversationTabState): RestartDropNotice | null {
  const approvalCount = tab.pendingApprovals.length;
  const patchCount = tab.patchBasket.length;
  if (approvalCount === 0 && patchCount === 0) {
    return null;
  }
  return {
    approvalCount,
    patchCount,
    createdAt: Date.now(),
  };
}

function deriveActiveStudyWorkflow(tabs: ConversationTabState[], activeTabId: string | null): StudyWorkflowKind | null {
  return tabs.find((tab) => tab.id === activeTabId)?.studyWorkflow ?? null;
}

function deriveActiveStudyRecipeId(tabs: ConversationTabState[], activeTabId: string | null): string | null {
  return tabs.find((tab) => tab.id === activeTabId)?.activeStudyRecipeId ?? null;
}

function findStudyRecipe(recipeId: string | null, recipes: StudyRecipe[]): StudyRecipe | null {
  return recipeId ? recipes.find((recipe) => recipe.id === recipeId) ?? null : null;
}

function normalizeLinkedSkillNames(skillNames: string[], linkedSkillNames: string[]): string[] {
  const allowed = new Set(linkedSkillNames.map((entry) => entry.trim()).filter(Boolean));
  if (allowed.size === 0) {
    return [];
  }
  return [...new Set(skillNames.map((skillName) => skillName.trim()).filter((skillName) => allowed.has(skillName)))];
}

function normalizePanelSelection(
  recipeId: string | null,
  skillNames: string[],
  recipes: StudyRecipe[],
): { recipeId: string | null; skillNames: string[] } {
  const recipe = findStudyRecipe(recipeId, recipes);
  if (!recipe) {
    return {
      recipeId: null,
      skillNames: [],
    };
  }
  return {
    recipeId: recipe.id,
    skillNames: normalizeLinkedSkillNames(skillNames, recipe.linkedSkillNames),
  };
}

function clearPanelSelection(tab: ConversationTabState): void {
  tab.activeStudyRecipeId = null;
  tab.activeStudySkillNames = [];
}

function cloneComposerHistory(history: ComposerHistorySnapshot | null | undefined): ComposerHistorySnapshot {
  return {
    entries: [...(history?.entries ?? EMPTY_COMPOSER_HISTORY_STATE.entries)],
    index: history?.index ?? EMPTY_COMPOSER_HISTORY_STATE.index,
    draft: history?.draft ?? EMPTY_COMPOSER_HISTORY_STATE.draft,
  };
}

function normalizeComposerHistory(history: ComposerHistorySnapshot | null | undefined): ComposerHistorySnapshot {
  const entries = Array.isArray(history?.entries)
    ? history.entries
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .slice(-MAX_PERSISTED_COMPOSER_HISTORY_ENTRIES)
    : [];
  const index =
    typeof history?.index === "number" && history.index >= 0 && history.index < entries.length ? history.index : null;
  return {
    entries,
    index,
    draft: typeof history?.draft === "string" ? history.draft : null,
  };
}

function isTransientRuntimeSystemMessage(message: Pick<ChatMessage, "kind" | "text">): boolean {
  if (message.kind !== "system") {
    return false;
  }
  const text = message.text.trim();
  if (!text) {
    return false;
  }
  return LEGACY_TRANSIENT_RUNTIME_SYSTEM_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeRestoredMessages(messages: ChatMessage[] | null | undefined): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .filter((message): message is ChatMessage => Boolean(message))
    .filter((message) => !isTransientRuntimeSystemMessage(message))
    .map((message) => ({ ...message }));
}

function normalizePanelSessionOrigin(
  panelSessionOrigin: ConversationTabState["panelSessionOrigin"],
  recipes: StudyRecipe[],
): ConversationTabState["panelSessionOrigin"] {
  if (!panelSessionOrigin) {
    return null;
  }
  const recipe = findStudyRecipe(panelSessionOrigin.panelId, recipes);
  if (!recipe) {
    return null;
  }
  return {
    ...panelSessionOrigin,
    panelId: recipe.id,
    selectedSkillNames: normalizeLinkedSkillNames(panelSessionOrigin.selectedSkillNames, recipe.linkedSkillNames),
  };
}

function normalizeChatSuggestion(
  chatSuggestion: ConversationTabState["chatSuggestion"],
  recipes: StudyRecipe[],
): ConversationTabState["chatSuggestion"] {
  if (!chatSuggestion) {
    return null;
  }
  const recipe = findStudyRecipe(chatSuggestion.panelId, recipes);
  if (chatSuggestion.panelId && !recipe) {
    return null;
  }
  const matchedSkillName =
    typeof chatSuggestion.matchedSkillName === "string" && chatSuggestion.matchedSkillName.trim()
      ? chatSuggestion.matchedSkillName.trim()
      : null;
  const linkedMatchedSkillName =
    recipe && matchedSkillName ? normalizeLinkedSkillNames([matchedSkillName], recipe.linkedSkillNames)[0] ?? null : matchedSkillName;
  const keepPanelMemorySkill = chatSuggestion.matchedSkillSource === "panel_memory";
  return {
    ...chatSuggestion,
    panelId: recipe?.id ?? chatSuggestion.panelId,
    panelTitle: recipe?.title?.trim() || chatSuggestion.panelTitle,
    matchedSkillName: linkedMatchedSkillName ?? (keepPanelMemorySkill ? matchedSkillName : null),
    matchedSkillSource: linkedMatchedSkillName ? "linked" : keepPanelMemorySkill && matchedSkillName ? "panel_memory" : null,
  };
}

function normalizeTabStudyState(tab: ConversationTabState, recipes: StudyRecipe[]): void {
  const normalized = normalizePanelSelection(tab.activeStudyRecipeId, tab.activeStudySkillNames, recipes);
  tab.activeStudyRecipeId = normalized.recipeId;
  tab.activeStudySkillNames = normalized.skillNames;
  tab.panelSessionOrigin = normalizePanelSessionOrigin(tab.panelSessionOrigin, recipes);
  tab.chatSuggestion = normalizeChatSuggestion(tab.chatSuggestion, recipes);
}

function reconcileStudyRecipeState(state: WorkspaceState): void {
  for (const tab of state.tabs) {
    normalizeTabStudyState(tab, state.studyRecipes);
  }
  state.activeStudyRecipeId = deriveActiveStudyRecipeId(state.tabs, state.activeTabId);
}

function ensureUniqueTabIds(
  tabs: ConversationTabState[],
): { tabs: ConversationTabState[]; remappedIds: Map<string, string> } {
  const seen = new Set<string>();
  const remappedIds = new Map<string, string>();
  const normalizedTabs = tabs.map((tab) => {
    if (!seen.has(tab.id)) {
      seen.add(tab.id);
      return tab;
    }
    let nextId = makeId("tab");
    while (seen.has(nextId)) {
      nextId = makeId("tab");
    }
    seen.add(nextId);
    remappedIds.set(tab.id, nextId);
    return {
      ...tab,
      id: nextId,
    };
  });
  return {
    tabs: normalizedTabs,
    remappedIds,
  };
}

function cloneUsageSummary(usageSummary: ConversationTabState["usageSummary"]) {
  return {
    lastTurn: usageSummary.lastTurn ? { ...usageSummary.lastTurn } : null,
    total: usageSummary.total ? { ...usageSummary.total } : null,
    limits: { ...usageSummary.limits },
  };
}

function cloneChatMessage(message: ChatMessage): ChatMessage {
  return structuredClone(message);
}

function clonePendingApproval(approval: PendingApproval): PendingApproval {
  return structuredClone(approval);
}

function clonePatchProposal(proposal: PatchProposal): PatchProposal {
  return structuredClone(proposal);
}

function cloneGeneratedDiagram(record: GeneratedDiagramRecord): GeneratedDiagramRecord {
  return { ...record };
}

function cloneAccountUsage(accountUsage: AccountUsageSummary): AccountUsageSummary {
  const normalized = normalizeAccountUsageSummary(accountUsage);
  return {
    limits: { ...normalized.limits },
    source: normalized.source,
    updatedAt: normalized.updatedAt,
    lastObservedAt: normalized.lastObservedAt,
    lastCheckedAt: normalized.lastCheckedAt,
    threadId: normalized.threadId,
  };
}

function deriveRestoredAccountUsage(
  tabs: ConversationTabState[],
  activeTabId: string | null,
  restoredAccountUsage?: AccountUsageSummary | null,
): AccountUsageSummary {
  const normalizedRestored = restoredAccountUsage ? normalizeAccountUsageSummary(restoredAccountUsage) : null;
  const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId) ?? null : null;
  const firstWithLimits =
    (activeTab &&
    (activeTab.usageSummary.limits.fiveHourPercent !== null ||
      activeTab.usageSummary.limits.weekPercent !== null ||
      activeTab.usageSummary.limits.planType !== null)
      ? activeTab
      : null) ??
    tabs.find(
      (tab) =>
        tab.usageSummary.limits.fiveHourPercent !== null ||
        tab.usageSummary.limits.weekPercent !== null ||
        tab.usageSummary.limits.planType !== null,
    );
  const derived = !firstWithLimits
    ? createEmptyAccountUsageSummary()
    : {
        limits: { ...firstWithLimits.usageSummary.limits },
        source: "restored" as const,
        updatedAt: null,
        lastObservedAt: null,
        lastCheckedAt: null,
        threadId: firstWithLimits.codexThreadId ?? null,
      };
  if (!normalizedRestored) {
    return derived;
  }
  return shouldPreferAccountUsageSummary(derived, normalizedRestored) ? normalizedRestored : derived;
}

function cloneState(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    accountUsage: cloneAccountUsage(state.accountUsage),
    activeStudyWorkflow: deriveActiveStudyWorkflow(state.tabs, state.activeTabId),
    recentStudySources: state.recentStudySources.map((source) => ({ ...source })),
    studyHubState: { ...state.studyHubState },
    studyRecipes: state.studyRecipes.map((recipe) => structuredClone(recipe)),
    activeStudyRecipeId: state.activeStudyRecipeId,
    userAdaptationMemory: cloneUserAdaptationMemory(state.userAdaptationMemory),
    availableModels: state.availableModels.map((model) => ({
      ...model,
      supportedReasoningLevels: [...model.supportedReasoningLevels],
    })),
    tabs: state.tabs.map((tab) => ({
      ...tab,
      activeStudyRecipeId: tab.activeStudyRecipeId,
      activeStudySkillNames: [...tab.activeStudySkillNames],
      summary: tab.summary ? { ...tab.summary } : null,
      studyCoachState: cloneStudyCoachState(tab.studyCoachState),
      lineage: normalizeLineage(tab.lineage),
      targetNotePath: tab.targetNotePath,
      selectionContext: tab.selectionContext ? { ...tab.selectionContext } : null,
      panelSessionOrigin: tab.panelSessionOrigin ? structuredClone(tab.panelSessionOrigin) : null,
      chatSuggestion: tab.chatSuggestion ? structuredClone(tab.chatSuggestion) : null,
      composerHistory: cloneComposerHistory(tab.composerHistory),
      contextPaths: [...tab.contextPaths],
      sessionItems: tab.sessionItems.map((item) => structuredClone(item)),
      messages: tab.messages.map((message) => cloneChatMessage(message)),
      pendingApprovals: tab.pendingApprovals.map((approval) => clonePendingApproval(approval)),
      toolLog: tab.toolLog.map((entry) => ({ ...entry })),
      patchBasket: tab.patchBasket.map((proposal) => clonePatchProposal(proposal)),
      generatedDiagrams: (tab.generatedDiagrams ?? []).map((record) => cloneGeneratedDiagram(record)),
      sessionApprovals: { ...tab.sessionApprovals },
      usageSummary: cloneUsageSummary(tab.usageSummary),
      waitingState: tab.waitingState ? { ...tab.waitingState } : null,
    })),
  };
}

function createTab(cwd: string, partial?: Partial<ConversationTabState>): ConversationTabState {
  return {
    id: partial?.id ?? makeId("tab"),
    title: partial?.title ?? "New chat",
    draft: partial?.draft ?? "",
    cwd,
    studyWorkflow: partial?.studyWorkflow ?? null,
    activeStudyRecipeId: partial?.activeStudyRecipeId ?? null,
    activeStudySkillNames: partial?.activeStudySkillNames ? [...partial.activeStudySkillNames] : [],
    summary: partial?.summary ?? null,
    studyCoachState: cloneStudyCoachState(partial?.studyCoachState),
    lineage: normalizeLineage(partial?.lineage),
    targetNotePath: partial?.targetNotePath ?? null,
    selectionContext: partial?.selectionContext ? { ...partial.selectionContext } : null,
    panelSessionOrigin: partial?.panelSessionOrigin ? structuredClone(partial.panelSessionOrigin) : null,
    chatSuggestion: partial?.chatSuggestion ? structuredClone(partial.chatSuggestion) : null,
    composerHistory: normalizeComposerHistory(partial?.composerHistory),
    composeMode: partial?.composeMode ?? "chat",
    learningMode: partial?.learningMode ?? false,
    contextPaths: partial?.contextPaths ?? [],
    lastResponseId: partial?.lastResponseId ?? null,
    sessionItems: partial?.sessionItems?.map((item) => structuredClone(item)) ?? [],
    codexThreadId: partial?.codexThreadId ?? null,
    model: partial?.model ?? DEFAULT_PRIMARY_MODEL,
    reasoningEffort: partial?.reasoningEffort ?? "xhigh",
    fastMode: partial?.fastMode ?? false,
    usageSummary: partial?.usageSummary ?? createEmptyUsageSummary(),
    messages: normalizeRestoredMessages(partial?.messages),
    diffText: partial?.diffText ?? "",
    toolLog: partial?.toolLog?.map((entry) => ({ ...entry })) ?? [],
    patchBasket: partial?.patchBasket?.map((proposal) => clonePatchProposal(proposal)) ?? [],
    generatedDiagrams: partial?.generatedDiagrams?.map((record) => cloneGeneratedDiagram(record)) ?? [],
    status: partial?.status ?? "ready",
    runtimeMode: partial?.runtimeMode ?? "normal",
    lastError: partial?.lastError ?? null,
    pendingApprovals: partial?.pendingApprovals?.map((approval) => clonePendingApproval(approval)) ?? [],
    sessionApprovals: partial?.sessionApprovals ?? { write: false, shell: false },
    waitingState: partial?.waitingState ?? null,
  };
}

function normalizeSessionModeDefaults(defaults?: Partial<SessionModeDefaults> | null): SessionModeDefaults {
  return {
    fastMode: defaults?.fastMode === true,
    learningMode: defaults?.learningMode === true,
  };
}

function deriveWorkspaceSessionModeDefaults(initial: PersistedWorkspaceState | null): SessionModeDefaults {
  const activeTab =
    initial?.activeTabId && initial.tabs.some((tab) => tab.id === initial.activeTabId)
      ? initial.tabs.find((tab) => tab.id === initial.activeTabId) ?? null
      : initial?.tabs[0] ?? null;
  return normalizeSessionModeDefaults(activeTab ?? null);
}

export class AgentStore {
  private state: WorkspaceState;
  private listeners = new Set<Listener>();
  private sessionModeDefaults: SessionModeDefaults;

  constructor(initial: PersistedWorkspaceState | null, fallbackCwd: string, hasLogin: boolean, defaults?: Partial<SessionModeDefaults> | null) {
    this.sessionModeDefaults =
      defaults === undefined
        ? deriveWorkspaceSessionModeDefaults(initial)
        : normalizeSessionModeDefaults(defaults);
    const tabs =
      initial?.tabs.length && initial.tabs.length > 0
        ? initial.tabs.map((tab) => {
            const restartDropNotice = normalizeRestartDropNotice(tab.restartDropNotice);
            return createTab(tab.cwd || fallbackCwd, {
              ...tab,
              learningMode: this.sessionModeDefaults.learningMode,
              fastMode: this.sessionModeDefaults.fastMode,
              messages: appendRestartDropMessage(tab.messages, restartDropNotice),
              status: hasLogin ? "ready" : "missing_login",
              pendingApprovals: [],
              sessionApprovals: { write: false, shell: false },
            });
          })
        : [
            createTab(fallbackCwd, {
              title: "Study chat",
              status: hasLogin ? "ready" : "missing_login",
              ...this.sessionModeDefaults,
            }),
          ];
    const { tabs: normalizedTabs, remappedIds } = ensureUniqueTabIds(tabs);
    const requestedActiveTabId = initial?.activeTabId ?? null;
    const remappedActiveTabId =
      requestedActiveTabId && normalizedTabs.some((tab) => tab.id === requestedActiveTabId)
        ? requestedActiveTabId
        : requestedActiveTabId
          ? remappedIds.get(requestedActiveTabId) ?? requestedActiveTabId
          : null;
    const activeTabId =
      remappedActiveTabId && normalizedTabs.some((tab) => tab.id === remappedActiveTabId)
        ? remappedActiveTabId
        : normalizedTabs[0]?.id ?? null;
    const accountUsage = deriveRestoredAccountUsage(
      normalizedTabs,
      activeTabId,
      initial?.accountUsage ? cloneAccountUsage(initial.accountUsage) : null,
    );
    const recentStudySources = initial?.recentStudySources?.map((source) => ({ ...source })) ?? [];
    const studyHubState: StudyHubState = {
      lastOpenedAt: initial?.studyHubState?.lastOpenedAt ?? null,
      isCollapsed: initial?.studyHubState?.isCollapsed ?? false,
    };
    const studyRecipes = initial?.studyRecipes?.map((recipe) => structuredClone(recipe)) ?? [];
    const userAdaptationMemory = normalizeUserAdaptationMemory(initial?.userAdaptationMemory);

    const tabsWithPanelSelection = normalizedTabs.map((tab) => {
      const nextTab: ConversationTabState = {
        ...tab,
        lineage: {
          ...normalizeLineage(tab.lineage),
          parentTabId:
            tab.lineage.parentTabId && normalizedTabs.some((entry) => entry.id === tab.lineage.parentTabId)
              ? tab.lineage.parentTabId
              : tab.lineage.parentTabId
                ? remappedIds.get(tab.lineage.parentTabId) ?? tab.lineage.parentTabId
                : null,
        },
      };
      normalizeTabStudyState(nextTab, studyRecipes);
      return nextTab;
    });

    this.state = {
      tabs: tabsWithPanelSelection,
      activeTabId,
      accountUsage,
      activeStudyWorkflow: deriveActiveStudyWorkflow(tabsWithPanelSelection, activeTabId),
      recentStudySources,
      studyHubState,
      studyRecipes,
      activeStudyRecipeId: deriveActiveStudyRecipeId(tabsWithPanelSelection, activeTabId),
      userAdaptationMemory,
      runtimeIssue: null,
      authState: hasLogin ? "ready" : "missing_login",
      availableModels: getFallbackModelCatalog(),
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): WorkspaceState {
    return cloneState(this.state);
  }

  getActiveTab(): ConversationTabState | null {
    return this.state.tabs.find((tab) => tab.id === this.state.activeTabId) ?? null;
  }

  getSessionModeDefaults(): { fastMode: boolean; learningMode: boolean } {
    return { ...this.sessionModeDefaults };
  }

  serialize(): PersistedWorkspaceState {
    return {
      tabs: this.state.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        draft: tab.draft,
        cwd: tab.cwd,
        studyWorkflow: tab.studyWorkflow,
        activeStudyRecipeId: tab.activeStudyRecipeId,
        activeStudySkillNames: [...tab.activeStudySkillNames],
        summary: tab.summary ? { ...tab.summary } : null,
        studyCoachState: cloneStudyCoachState(tab.studyCoachState),
        lineage: normalizeLineage(tab.lineage),
        targetNotePath: tab.targetNotePath,
        selectionContext: tab.selectionContext ? { ...tab.selectionContext } : null,
        panelSessionOrigin: tab.panelSessionOrigin ? structuredClone(tab.panelSessionOrigin) : null,
        chatSuggestion: tab.chatSuggestion ? structuredClone(tab.chatSuggestion) : null,
        composerHistory: {
          entries: [...tab.composerHistory.entries],
          index: tab.composerHistory.index,
          draft: tab.composerHistory.draft,
        },
        composeMode: tab.composeMode,
        learningMode: tab.learningMode,
        contextPaths: [...tab.contextPaths],
        lastResponseId: tab.lastResponseId,
        sessionItems: [],
        codexThreadId: tab.codexThreadId,
        model: tab.model,
        reasoningEffort: tab.reasoningEffort,
        fastMode: tab.fastMode,
        usageSummary: cloneUsageSummary(tab.usageSummary),
        messages: tab.messages.map((message) => ({
          id: message.id,
          kind: message.kind,
          text: message.text,
          createdAt: message.createdAt,
          meta: message.meta,
        })),
        diffText: tab.diffText,
        toolLog: tab.toolLog.map((entry) => ({ ...entry })),
        patchBasket: [],
        generatedDiagrams: (tab.generatedDiagrams ?? []).map((record) => cloneGeneratedDiagram(record)),
        restartDropNotice: buildPersistedRestartDropNotice(tab),
      })),
      activeTabId: this.state.activeTabId,
      accountUsage: cloneAccountUsage(this.state.accountUsage),
      activeStudyWorkflow: deriveActiveStudyWorkflow(this.state.tabs, this.state.activeTabId),
      recentStudySources: this.state.recentStudySources.map((source) => ({ ...source })),
      studyHubState: { ...this.state.studyHubState },
      studyRecipes: this.state.studyRecipes.map((recipe) => structuredClone(recipe)),
      activeStudyRecipeId: this.state.activeStudyRecipeId,
      userAdaptationMemory: cloneUserAdaptationMemory(this.state.userAdaptationMemory),
    };
  }

  createTab(cwd: string, title = "New study chat", partial?: Partial<ConversationTabState>): ConversationTabState {
    const status = this.state.authState === "ready" ? "ready" : "missing_login";
    const tab = createTab(cwd, {
      learningMode: this.sessionModeDefaults.learningMode,
      fastMode: this.sessionModeDefaults.fastMode,
      ...partial,
      title,
      status,
    });
    this.mutate((state) => {
      state.tabs.push(tab);
      state.activeTabId = tab.id;
    });
    return tab;
  }

  closeTab(tabId: string, fallbackCwd: string, defaults?: Partial<SessionModeDefaults> | null): void {
    const fallbackModes = normalizeSessionModeDefaults(defaults ?? this.sessionModeDefaults);
    this.mutate((state) => {
      state.tabs = state.tabs.filter((tab) => tab.id !== tabId);
      if (state.tabs.length === 0) {
        state.tabs = [
          createTab(fallbackCwd, {
            title: "Study chat",
            status: state.authState === "ready" ? "ready" : "missing_login",
            ...fallbackModes,
          }),
        ];
      }
      if (state.activeTabId === tabId) {
        state.activeTabId = state.tabs[0]?.id ?? null;
      }
      state.activeStudyRecipeId = deriveActiveStudyRecipeId(state.tabs, state.activeTabId);
    });
  }

  activateTab(tabId: string): void {
    this.mutate((state) => {
      state.activeTabId = tabId;
      state.activeStudyWorkflow = deriveActiveStudyWorkflow(state.tabs, state.activeTabId);
      state.activeStudyRecipeId = deriveActiveStudyRecipeId(state.tabs, state.activeTabId);
    });
  }

  setActiveStudyWorkflow(workflow: StudyWorkflowKind | null): void {
    const activeTabId = this.state.activeTabId;
    if (!activeTabId) {
      return;
    }
    this.setTabStudyWorkflow(activeTabId, workflow);
  }

  setTabStudyWorkflow(tabId: string, workflow: StudyWorkflowKind | null): void {
    this.mutate((state) => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      if (!tab) {
        return;
      }
      tab.studyWorkflow = workflow;
      state.activeStudyWorkflow = deriveActiveStudyWorkflow(state.tabs, state.activeTabId);
    });
  }

  setRecentStudySources(sources: RecentStudySource[]): void {
    this.mutate((state) => {
      state.recentStudySources = sources.map((source) => ({ ...source }));
    });
  }

  addRecentStudySource(source: RecentStudySource, maxItems = 8): void {
    this.mutate((state) => {
      const deduped = state.recentStudySources.filter(
        (entry) => !(entry.kind === source.kind && entry.path === source.path && entry.label === source.label),
      );
      state.recentStudySources = [{ ...source }, ...deduped].slice(0, maxItems);
    });
  }

  setStudyHubState(studyHubState: StudyHubState): void {
    this.mutate((state) => {
      state.studyHubState = { ...studyHubState };
    });
  }

  setStudyRecipes(studyRecipes: StudyRecipe[]): void {
    this.mutate((state) => {
      state.studyRecipes = studyRecipes.map((recipe) => structuredClone(recipe));
      reconcileStudyRecipeState(state);
    });
  }

  setUserAdaptationMemory(userAdaptationMemory: UserAdaptationMemory | null): void {
    this.mutate((state) => {
      state.userAdaptationMemory = cloneUserAdaptationMemory(userAdaptationMemory);
    });
  }

  activateStudyRecipe(recipeId: string | null): void {
    this.mutate((state) => {
      const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
      if (activeTab) {
        const normalized = normalizePanelSelection(recipeId, activeTab.activeStudySkillNames, state.studyRecipes);
        activeTab.activeStudyRecipeId = normalized.recipeId;
        activeTab.activeStudySkillNames = normalized.skillNames;
      }
    });
  }

  upsertStudyRecipe(recipe: StudyRecipe): void {
    this.mutate((state) => {
      const index = state.studyRecipes.findIndex((entry) => entry.id === recipe.id);
      if (index >= 0) {
        state.studyRecipes[index] = structuredClone(recipe);
      } else {
        state.studyRecipes.push(structuredClone(recipe));
      }
      reconcileStudyRecipeState(state);
    });
  }

  removeStudyRecipe(recipeId: string): void {
    this.mutate((state) => {
      state.studyRecipes = state.studyRecipes.filter((recipe) => recipe.id !== recipeId);
      for (const tab of state.tabs) {
        if (tab.activeStudyRecipeId === recipeId) {
          clearPanelSelection(tab);
        }
        if (tab.panelSessionOrigin?.panelId === recipeId) {
          tab.panelSessionOrigin = null;
        }
        if (tab.chatSuggestion?.panelId === recipeId) {
          tab.chatSuggestion = null;
        }
      }
      state.activeStudyRecipeId = deriveActiveStudyRecipeId(state.tabs, state.activeTabId);
    });
  }

  setAuthState(hasLogin: boolean): void {
    this.mutate((state) => {
      state.authState = hasLogin ? "ready" : "missing_login";
      if (!hasLogin) {
        state.runtimeIssue = "Codex login is not configured.";
      } else if (state.runtimeIssue === "Codex login is not configured.") {
        state.runtimeIssue = null;
      }
      for (const tab of state.tabs) {
        if (tab.status === "missing_login" || (!hasLogin && tab.status === "ready")) {
          tab.status = hasLogin ? "ready" : "missing_login";
        }
      }
    });
  }

  setRuntimeIssue(message: string | null): void {
    this.mutate((state) => {
      state.runtimeIssue = message;
    });
  }

  setAvailableModels(models: ModelCatalogEntry[]): void {
    this.mutate((state) => {
      state.availableModels = models.map((model) => ({
        ...model,
        supportedReasoningLevels: [...model.supportedReasoningLevels],
      }));
    });
  }

  setDraft(tabId: string, draft: string): void {
    this.updateTab(tabId, (tab) => {
      tab.draft = draft;
    });
  }

  setComposeMode(tabId: string, composeMode: ConversationTabState["composeMode"]): void {
    this.updateTab(tabId, (tab) => {
      tab.composeMode = composeMode;
    });
  }

  setLearningMode(tabId: string, learningMode: boolean): void {
    this.updateTab(tabId, (tab) => {
      tab.learningMode = learningMode;
    });
  }

  setAllTabsLearningMode(learningMode: boolean): void {
    this.sessionModeDefaults = {
      ...this.sessionModeDefaults,
      learningMode,
    };
    this.mutate((state) => {
      for (const tab of state.tabs) {
        tab.learningMode = learningMode;
      }
    });
  }

  setActiveStudyPanel(tabId: string, recipeId: string | null, skillNames: string[] = []): void {
    this.mutate((state) => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      if (!tab) {
        return;
      }
      const normalized = normalizePanelSelection(recipeId, skillNames, state.studyRecipes);
      tab.activeStudyRecipeId = normalized.recipeId;
      tab.activeStudySkillNames = normalized.skillNames;
      tab.panelSessionOrigin = normalizePanelSessionOrigin(tab.panelSessionOrigin, state.studyRecipes);
      tab.chatSuggestion = normalizeChatSuggestion(tab.chatSuggestion, state.studyRecipes);
      if (state.activeTabId === tabId) {
        state.activeStudyRecipeId = normalized.recipeId;
      }
    });
  }

  setPanelSessionOrigin(tabId: string, panelSessionOrigin: ConversationTabState["panelSessionOrigin"]): void {
    this.updateTab(tabId, (tab) => {
      tab.panelSessionOrigin = panelSessionOrigin ? structuredClone(panelSessionOrigin) : null;
    });
  }

  setChatSuggestion(tabId: string, chatSuggestion: ConversationTabState["chatSuggestion"]): void {
    this.updateTab(tabId, (tab) => {
      tab.chatSuggestion = chatSuggestion ? structuredClone(chatSuggestion) : null;
    });
  }

  setActiveTabStudyWorkflow(workflow: StudyWorkflowKind | null): void {
    if (!this.state.activeTabId) {
      return;
    }
    this.setTabStudyWorkflow(this.state.activeTabId, workflow);
  }

  setTargetNotePath(tabId: string, targetNotePath: string | null): void {
    this.updateTab(tabId, (tab) => {
      tab.targetNotePath = targetNotePath;
    });
  }

  setSummary(tabId: string, summary: ConversationTabState["summary"]): void {
    this.updateTab(tabId, (tab) => {
      tab.summary = summary ? { ...summary } : null;
    });
  }

  setStudyCoachState(tabId: string, studyCoachState: ConversationTabState["studyCoachState"]): void {
    this.updateTab(tabId, (tab) => {
      tab.studyCoachState = cloneStudyCoachState(studyCoachState);
    });
  }

  setLineage(tabId: string, lineage: ConversationTabState["lineage"]): void {
    this.updateTab(tabId, (tab) => {
      tab.lineage = normalizeLineage(lineage);
    });
  }

  setSelectionContext(tabId: string, selectionContext: ConversationTabState["selectionContext"]): void {
    this.updateTab(tabId, (tab) => {
      tab.selectionContext = selectionContext ? { ...selectionContext } : null;
    });
  }

  setContextPaths(tabId: string, contextPaths: string[]): void {
    this.updateTab(tabId, (tab) => {
      tab.contextPaths = [...contextPaths];
    });
  }

  setStatus(tabId: string, status: ConversationTabState["status"], error: string | null = null): void {
    this.updateTab(tabId, (tab) => {
      tab.status = status;
      tab.lastError = error;
    });
  }

  setRuntimeMode(tabId: string, runtimeMode: ConversationTabState["runtimeMode"]): void {
    this.updateTab(tabId, (tab) => {
      tab.runtimeMode = runtimeMode;
    });
  }

  setTitle(tabId: string, title: string): void {
    this.updateTab(tabId, (tab) => {
      tab.title = title;
    });
  }

  setLastResponseId(tabId: string, responseId: string | null): void {
    this.updateTab(tabId, (tab) => {
      tab.lastResponseId = responseId;
    });
  }

  setSessionItems(tabId: string, sessionItems: ConversationTabState["sessionItems"]): void {
    this.updateTab(tabId, (tab) => {
      tab.sessionItems = sessionItems.map((item) => structuredClone(item));
    });
  }

  setCodexThreadId(tabId: string, codexThreadId: string | null): void {
    this.updateTab(tabId, (tab) => {
      tab.codexThreadId = codexThreadId;
    });
  }

  setTabModel(tabId: string, model: string): void {
    this.updateTab(tabId, (tab) => {
      tab.model = model;
    });
  }

  setTabReasoningEffort(tabId: string, reasoningEffort: ConversationTabState["reasoningEffort"]): void {
    this.updateTab(tabId, (tab) => {
      tab.reasoningEffort = reasoningEffort;
    });
  }

  setTabFastMode(tabId: string, fastMode: boolean): void {
    this.updateTab(tabId, (tab) => {
      tab.fastMode = fastMode;
    });
  }

  setAllTabsFastMode(fastMode: boolean): void {
    this.sessionModeDefaults = {
      ...this.sessionModeDefaults,
      fastMode,
    };
    this.mutate((state) => {
      for (const tab of state.tabs) {
        tab.fastMode = fastMode;
      }
    });
  }

  setSessionModeDefaults(defaults: Partial<SessionModeDefaults> | null | undefined): void {
    this.sessionModeDefaults = normalizeSessionModeDefaults({
      ...this.sessionModeDefaults,
      ...(defaults ?? {}),
    });
  }

  setUsageSummary(tabId: string, usageSummary: UsageSummary): void {
    this.updateTab(tabId, (tab) => {
      tab.usageSummary = cloneUsageSummary(usageSummary);
    });
  }

  setComposerHistory(tabId: string, composerHistory: ConversationTabState["composerHistory"]): void {
    this.updateTab(tabId, (tab) => {
      tab.composerHistory = normalizeComposerHistory(composerHistory);
    });
  }

  setAccountUsage(accountUsage: AccountUsageSummary): void {
    this.mutate((state) => {
      state.accountUsage = cloneAccountUsage(accountUsage);
    });
  }

  setWaitingState(tabId: string, waitingState: WaitingState | null): void {
    this.updateTab(tabId, (tab) => {
      tab.waitingState = waitingState ? { ...waitingState } : null;
    });
  }

  resetTab(tabId: string, partial: Partial<ConversationTabState>): void {
    this.mutate((state) => {
      const index = state.tabs.findIndex((entry) => entry.id === tabId);
      if (index < 0) {
        return;
      }
      const current = state.tabs[index];
      if (!current) {
        return;
      }
      state.tabs[index] = createTab(current.cwd, {
        ...current,
        ...partial,
        id: current.id,
        cwd: partial.cwd ?? current.cwd,
        composerHistory: partial.composerHistory ?? EMPTY_COMPOSER_HISTORY_STATE,
      });
      if (state.activeTabId === tabId) {
        state.activeStudyRecipeId = deriveActiveStudyRecipeId(state.tabs, state.activeTabId);
      }
    });
  }

  setDiff(tabId: string, diffText: string): void {
    this.updateTab(tabId, (tab) => {
      tab.diffText = diffText;
    });
  }

  setPatchBasket(tabId: string, patchBasket: PatchProposal[]): void {
    this.updateTab(tabId, (tab) => {
      tab.patchBasket = patchBasket.map((proposal) => clonePatchProposal(proposal));
    });
  }

  addGeneratedDiagram(tabId: string, record: GeneratedDiagramRecord): void {
    this.updateTab(tabId, (tab) => {
      tab.generatedDiagrams = [...(tab.generatedDiagrams ?? []), cloneGeneratedDiagram(record)];
    });
  }

  addMessage(tabId: string, message: ChatMessage): void {
    this.updateTab(tabId, (tab) => {
      tab.messages.push(cloneChatMessage(message));
    });
  }

  upsertMessage(tabId: string, messageId: string, updater: (current: ChatMessage | null) => ChatMessage): void {
    this.updateTab(tabId, (tab) => {
      const index = tab.messages.findIndex((message) => message.id === messageId);
      const current = index >= 0 ? tab.messages[index] ?? null : null;
      const next = updater(current);
      if (index >= 0) {
        tab.messages[index] = next;
      } else {
        tab.messages.push(next);
      }
    });
  }

  addApproval(tabId: string, approval: PendingApproval): void {
    this.updateTab(tabId, (tab) => {
      tab.pendingApprovals.push(clonePendingApproval(approval));
    });
  }

  setApprovals(tabId: string, approvals: PendingApproval[]): void {
    this.updateTab(tabId, (tab) => {
      tab.pendingApprovals = approvals.map((approval) => clonePendingApproval(approval));
    });
  }

  removeApproval(approvalId: string): void {
    this.mutate((state) => {
      for (const tab of state.tabs) {
        tab.pendingApprovals = tab.pendingApprovals.filter((approval) => approval.id !== approvalId);
      }
    });
  }

  clearApprovals(tabId: string): void {
    this.updateTab(tabId, (tab) => {
      tab.pendingApprovals = [];
    });
  }

  replaceProposalApprovals(tabId: string, sourceMessageId: string, approvals: PendingApproval[]): void {
    this.updateTab(tabId, (tab) => {
      const retained = tab.pendingApprovals.filter(
        (approval) => !(approval.transport === "plugin_proposal" && approval.sourceMessageId === sourceMessageId),
      );
      tab.pendingApprovals = [
        ...retained,
        ...approvals.map((approval) => clonePendingApproval(approval)),
      ];
    });
  }

  addToolLog(tabId: string, entry: ToolCallRecord): void {
    this.updateTab(tabId, (tab) => {
      tab.toolLog.push({ ...entry });
    });
  }

  upsertToolLog(tabId: string, callId: string, updater: (current: ToolCallRecord | null) => ToolCallRecord): void {
    this.updateTab(tabId, (tab) => {
      const index = tab.toolLog.findIndex((entry) => entry.callId === callId);
      const current = index >= 0 ? (tab.toolLog[index] ?? null) : null;
      const next = updater(current);
      if (index >= 0) {
        tab.toolLog[index] = { ...next };
      } else {
        tab.toolLog.push({ ...next });
      }
    });
  }

  updateRunningToolLogs(tabId: string, updater: (current: ToolCallRecord) => ToolCallRecord): void {
    this.updateTab(tabId, (tab) => {
      tab.toolLog = tab.toolLog.map((entry) => (entry.status === "running" ? { ...updater(entry) } : entry));
    });
  }

  setSessionApproval(tabId: string, kind: "write" | "shell", allowed: boolean): void {
    this.updateTab(tabId, (tab) => {
      tab.sessionApprovals[kind] = allowed;
    });
  }

  resetSessionApprovals(tabId: string): void {
    this.updateTab(tabId, (tab) => {
      tab.sessionApprovals = { write: false, shell: false };
    });
  }

  replacePatchProposals(tabId: string, sourceMessageId: string, proposals: PatchProposal[]): void {
    this.updateTab(tabId, (tab) => {
      const retained = tab.patchBasket.filter((proposal) => proposal.sourceMessageId !== sourceMessageId);
      tab.patchBasket = [...retained, ...proposals.map((proposal) => clonePatchProposal(proposal))].sort(
        (left, right) => left.createdAt - right.createdAt,
      );
    });
  }

  updatePatchProposal(tabId: string, patchId: string, updater: (proposal: PatchProposal) => PatchProposal): void {
    this.updateTab(tabId, (tab) => {
      tab.patchBasket = tab.patchBasket.map((proposal) => (proposal.id === patchId ? { ...updater(proposal) } : proposal));
    });
  }

  private updateTab(tabId: string, updater: (tab: ConversationTabState) => void): void {
    this.mutate((state) => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      if (!tab) {
        return;
      }
      updater(tab);
    });
  }

  private mutate(mutator: (state: WorkspaceState) => void): void {
    const next = cloneState(this.state);
    mutator(next);
    next.tabs.forEach((tab) => {
      normalizeTabStudyState(tab, next.studyRecipes);
      tab.composerHistory = normalizeComposerHistory(tab.composerHistory);
    });
    next.activeStudyWorkflow = deriveActiveStudyWorkflow(next.tabs, next.activeTabId);
    next.activeStudyRecipeId = deriveActiveStudyRecipeId(next.tabs, next.activeTabId);
    this.state = next;
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
