import type {
  PanelAdaptationOverlay,
  PanelImprovementSignal,
  PanelSourcePreference,
  PanelStudyMemory,
  StudyContractWorkflowKind,
  StudyMemoryUnderstoodConcept,
  StudyMemoryWeakConcept,
  StudyNextProblem,
  StudyStuckPoint,
  StudyTurnContract,
  UserAdaptationMemory,
  UserAdaptationProfile,
  UserStudyMemory,
} from "../model/types";

export interface UserAdaptationUpdateInput {
  prompt: string;
  assistantSummary: string;
  appliedChangeSummary: string;
  appliedContent: string;
  panelId: string | null;
  targetNotePath: string | null;
  selectedSkillNames: readonly string[];
  occurredAt?: number;
}

const EXPLANATION_DEPTH_PATTERNS = {
  step_by_step: /\b(step[- ]by[- ]step|walk me through|break it down|詳しく|丁寧に|順番に)\b/i,
  concise: /\b(concise|brief|short|quick summary|簡潔|短く)\b/i,
} as const;

const FOCUS_TAG_PATTERNS: Array<[string, RegExp]> = [
  ["examples", /\b(example|examples|for instance|例)\b/i],
  ["pitfalls", /\b(pitfall|pitfalls|common mistake|mistake|confus(?:e|ion)|誤解|落とし穴)\b/i],
  ["definitions", /\b(definition|define|term|terms|定義)\b/i],
  ["intuition", /\b(intuition|why|reasoning|直感|なぜ)\b/i],
  ["formulas", /\b(formula|equation|latex)\b|\$\$/i],
  ["claims_vs_interpretation", /\b(claim|claims|interpretation|authors?|paper)\b/i],
  ["step_by_step", /\b(step[- ]by[- ]step|順番|手順)\b/i],
];

const NOTE_STYLE_PATTERNS: Array<[string, RegExp]> = [
  ["bullet_lists", /(^|\n)-\s/m],
  ["numbered_steps", /(^|\n)\d+\.\s/m],
  ["preserve_headings", /(^|\n)##?\s/m],
  ["math_blocks", /\$\$/],
  ["pitfall_callouts", /\bpitfall\b|(^|\n)##\s*Pitfall\b/i],
];

const AVOID_PATTERNS: Array<[string, RegExp]> = [
  ["filler", /\b(no fluff|avoid filler|冗長|だらだら)\b/i],
  ["overexplaining", /\b(don't overexplain|too long|長すぎ)\b/i],
];

const AGENTIC_NOTE_STYLE_HINTS = [
  "prefer_augmenting_existing_notes",
  "preserve_existing_note_content",
  "canonical_callout_math",
];

const AGENTIC_AVOID_PATTERNS = [
  "unrequested_deletion",
  "unrequested_full_note_replacement",
];

const MAX_STUDY_MEMORY_WEAK_CONCEPTS = 20;
const MAX_STUDY_MEMORY_UNDERSTOOD_CONCEPTS = 30;
const MAX_STUDY_MEMORY_NEXT_PROBLEMS = 10;
const MAX_STUDY_MEMORY_STUCK_POINTS = 10;
const MAX_PANEL_SOURCE_PREFERENCES = 12;
const MAX_PANEL_IMPROVEMENT_SIGNALS = 20;
const PANEL_IMPROVEMENT_SIGNAL_THRESHOLD = 3;

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((entry) => entry.trim()).filter(Boolean))];
}

function detectExplanationDepth(prompt: string, summary: string): UserAdaptationProfile["explanationDepth"] {
  const haystack = `${prompt}\n${summary}`;
  if (EXPLANATION_DEPTH_PATTERNS.step_by_step.test(haystack)) {
    return "step_by_step";
  }
  if (EXPLANATION_DEPTH_PATTERNS.concise.test(haystack)) {
    return "concise";
  }
  return "balanced";
}

function detectTags(haystack: string, patterns: Array<[string, RegExp]>): string[] {
  return patterns.flatMap(([tag, pattern]) => (pattern.test(haystack) ? [tag] : []));
}

function normalizeStudyWorkflow(value: unknown): StudyContractWorkflowKind {
  return value === "lecture" || value === "review" || value === "paper" || value === "homework" || value === "general"
    ? value
    : "general";
}

function normalizeConceptKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeStudyWeakConcept(concept: StudyMemoryWeakConcept | null | undefined): StudyMemoryWeakConcept | null {
  if (!concept) {
    return null;
  }
  const conceptLabel = concept.conceptLabel?.trim() ?? "";
  const evidence = concept.evidence?.trim() ?? "";
  const nextQuestion = concept.nextQuestion?.trim() ?? "";
  if (!conceptLabel || !evidence || !nextQuestion) {
    return null;
  }
  return {
    conceptLabel,
    evidence,
    lastStuckPoint: concept.lastStuckPoint?.trim() ?? "",
    nextQuestion,
    workflow: normalizeStudyWorkflow(concept.workflow),
    updatedAt: typeof concept.updatedAt === "number" && Number.isFinite(concept.updatedAt) ? concept.updatedAt : Date.now(),
  };
}

function normalizeStudyUnderstoodConcept(
  concept: StudyMemoryUnderstoodConcept | null | undefined,
): StudyMemoryUnderstoodConcept | null {
  if (!concept) {
    return null;
  }
  const conceptLabel = concept.conceptLabel?.trim() ?? "";
  const evidence = concept.evidence?.trim() ?? "";
  if (!conceptLabel || !evidence) {
    return null;
  }
  return {
    conceptLabel,
    evidence,
    workflow: normalizeStudyWorkflow(concept.workflow),
    updatedAt: typeof concept.updatedAt === "number" && Number.isFinite(concept.updatedAt) ? concept.updatedAt : Date.now(),
  };
}

function normalizeStudyNextProblem(problem: StudyNextProblem | null | undefined): StudyNextProblem | null {
  if (!problem) {
    return null;
  }
  const prompt = problem.prompt?.trim() ?? "";
  if (!prompt) {
    return null;
  }
  return {
    prompt,
    workflow: normalizeStudyWorkflow(problem.workflow),
    source: problem.source?.trim() || null,
    createdAt: typeof problem.createdAt === "number" && Number.isFinite(problem.createdAt) ? problem.createdAt : Date.now(),
  };
}

function normalizeStudyStuckPoint(point: StudyStuckPoint | null | undefined): StudyStuckPoint | null {
  if (!point) {
    return null;
  }
  const conceptLabel = point.conceptLabel?.trim() ?? "";
  const detail = point.detail?.trim() ?? "";
  if (!conceptLabel || !detail) {
    return null;
  }
  return {
    conceptLabel,
    detail,
    workflow: normalizeStudyWorkflow(point.workflow),
    createdAt: typeof point.createdAt === "number" && Number.isFinite(point.createdAt) ? point.createdAt : Date.now(),
  };
}

function dedupeByConcept<T extends { conceptLabel: string; updatedAt?: number; createdAt?: number }>(
  entries: readonly T[],
  limit: number,
): T[] {
  const seen = new Map<string, T>();
  for (const entry of entries) {
    const key = normalizeConceptKey(entry.conceptLabel);
    const previous = seen.get(key);
    const entryTime = entry.updatedAt ?? entry.createdAt ?? 0;
    const previousTime = previous ? previous.updatedAt ?? previous.createdAt ?? 0 : -1;
    if (!previous || entryTime >= previousTime) {
      seen.set(key, entry);
    }
  }
  return [...seen.values()].sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0)).slice(0, limit);
}

function normalizeUserStudyMemory(memory: UserStudyMemory | null | undefined): UserStudyMemory | null {
  if (!memory) {
    return null;
  }
  const weakConcepts = dedupeByConcept(
    (memory.weakConcepts ?? []).flatMap((entry) => {
      const normalized = normalizeStudyWeakConcept(entry);
      return normalized ? [normalized] : [];
    }),
    MAX_STUDY_MEMORY_WEAK_CONCEPTS,
  );
  const understoodConcepts = dedupeByConcept(
    (memory.understoodConcepts ?? []).flatMap((entry) => {
      const normalized = normalizeStudyUnderstoodConcept(entry);
      return normalized ? [normalized] : [];
    }),
    MAX_STUDY_MEMORY_UNDERSTOOD_CONCEPTS,
  );
  const nextProblems = (memory.nextProblems ?? [])
    .flatMap((entry) => {
      const normalized = normalizeStudyNextProblem(entry);
      return normalized ? [normalized] : [];
    })
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_STUDY_MEMORY_NEXT_PROBLEMS);
  const recentStuckPoints = dedupeByConcept(
    (memory.recentStuckPoints ?? []).flatMap((entry) => {
      const normalized = normalizeStudyStuckPoint(entry);
      return normalized ? [normalized] : [];
    }),
    MAX_STUDY_MEMORY_STUCK_POINTS,
  );
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

function normalizeStudyContract(contract: StudyTurnContract | null | undefined): StudyTurnContract | null {
  if (!contract) {
    return null;
  }
  const objective = contract.objective?.trim() ?? "";
  const sources = unique(contract.sources ?? []);
  const concepts = (contract.concepts ?? [])
    .map((concept) => ({
      label: concept.label?.trim() ?? "",
      status:
        concept.status === "introduced" || concept.status === "weak" || concept.status === "understood" || concept.status === "review"
          ? concept.status
          : "review",
      evidence: concept.evidence?.trim() || null,
    }))
    .filter((concept) => concept.label);
  const checkQuestion = contract.checkQuestion?.trim() ?? "";
  const nextAction = contract.nextAction?.trim() ?? "";
  const confidenceNote = contract.confidenceNote?.trim() ?? "";
  if (!objective || sources.length === 0 || concepts.length === 0 || !checkQuestion || !nextAction || !confidenceNote) {
    return null;
  }
  return {
    objective,
    sources,
    concepts,
    likelyStuckPoints: unique(contract.likelyStuckPoints ?? []),
    checkQuestion,
    nextAction,
    nextProblems: unique(contract.nextProblems ?? []),
    confidenceNote,
    workflow: normalizeStudyWorkflow(contract.workflow),
  };
}

function normalizePanelSourcePreference(preference: PanelSourcePreference | null | undefined): PanelSourcePreference | null {
  if (!preference) {
    return null;
  }
  const label = preference.label?.trim() ?? "";
  if (!label) {
    return null;
  }
  return {
    label,
    count: typeof preference.count === "number" && Number.isFinite(preference.count) ? Math.max(1, Math.floor(preference.count)) : 1,
    workflow: normalizeStudyWorkflow(preference.workflow),
    updatedAt: typeof preference.updatedAt === "number" && Number.isFinite(preference.updatedAt) ? preference.updatedAt : Date.now(),
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
  const key = signal.key?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  const label = signal.label?.trim() ?? "";
  if (!kind || !key || !label) {
    return null;
  }
  return {
    kind,
    key,
    label,
    count: typeof signal.count === "number" && Number.isFinite(signal.count) ? Math.max(1, Math.floor(signal.count)) : 1,
    updatedAt: typeof signal.updatedAt === "number" && Number.isFinite(signal.updatedAt) ? signal.updatedAt : Date.now(),
  };
}

export function normalizePanelStudyMemory(memory: PanelStudyMemory | null | undefined): PanelStudyMemory | null {
  if (!memory) {
    return null;
  }
  const base = normalizeUserStudyMemory(memory);
  const sourcePreferences = (memory.sourcePreferences ?? [])
    .flatMap((entry) => {
      const normalized = normalizePanelSourcePreference(entry);
      return normalized ? [normalized] : [];
    })
    .sort((left, right) => right.count - left.count || right.updatedAt - left.updatedAt)
    .slice(0, MAX_PANEL_SOURCE_PREFERENCES);
  const improvementSignals = (memory.improvementSignals ?? [])
    .flatMap((entry) => {
      const normalized = normalizePanelImprovementSignal(entry);
      return normalized ? [normalized] : [];
    })
    .sort((left, right) => right.count - left.count || right.updatedAt - left.updatedAt)
    .slice(0, MAX_PANEL_IMPROVEMENT_SIGNALS);
  const lastContract = normalizeStudyContract(memory.lastContract ?? null);
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

export function normalizeUserAdaptationMemory(memory: UserAdaptationMemory | null | undefined): UserAdaptationMemory | null {
  if (!memory) {
    return null;
  }
  const globalProfile: UserAdaptationProfile | null = memory.globalProfile
    ? {
        explanationDepth:
          memory.globalProfile.explanationDepth === "step_by_step" || memory.globalProfile.explanationDepth === "concise"
            ? memory.globalProfile.explanationDepth
            : "balanced",
        preferredFocusTags: unique(memory.globalProfile.preferredFocusTags ?? []),
        preferredNoteStyleHints: unique(memory.globalProfile.preferredNoteStyleHints ?? []),
        avoidResponsePatterns: unique(memory.globalProfile.avoidResponsePatterns ?? []),
        updatedAt:
          typeof memory.globalProfile.updatedAt === "number" && Number.isFinite(memory.globalProfile.updatedAt)
            ? memory.globalProfile.updatedAt
            : Date.now(),
      }
    : null;
  const panelOverlays = Object.fromEntries(
    Object.entries(memory.panelOverlays ?? {}).flatMap(([panelId, overlay]) => {
      const normalizedPanelId = panelId.trim();
      if (!normalizedPanelId || !overlay) {
        return [];
      }
      const normalized: PanelAdaptationOverlay = {
        panelId: overlay.panelId?.trim() || normalizedPanelId,
        preferredFocusTags: unique(overlay.preferredFocusTags ?? []),
        preferredNoteStyleHints: unique(overlay.preferredNoteStyleHints ?? []),
        preferredSkillNames: unique(overlay.preferredSkillNames ?? []),
        lastAppliedTargetPath: overlay.lastAppliedTargetPath?.trim() || null,
        updatedAt: typeof overlay.updatedAt === "number" && Number.isFinite(overlay.updatedAt) ? overlay.updatedAt : Date.now(),
        ...(normalizePanelStudyMemory(overlay.studyMemory ?? null)
          ? { studyMemory: normalizePanelStudyMemory(overlay.studyMemory ?? null) }
          : {}),
      };
      return [[normalizedPanelId, normalized] as const];
    }),
  );
  const studyMemory = normalizeUserStudyMemory(memory.studyMemory ?? null);
  if (!globalProfile && Object.keys(panelOverlays).length === 0 && !studyMemory) {
    return null;
  }
  return {
    globalProfile,
    panelOverlays,
    ...(studyMemory ? { studyMemory } : {}),
  };
}

export function cloneUserAdaptationMemory(memory: UserAdaptationMemory | null | undefined): UserAdaptationMemory | null {
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

export function updateUserAdaptationMemory(
  current: UserAdaptationMemory | null | undefined,
  input: UserAdaptationUpdateInput,
): UserAdaptationMemory | null {
  const normalized = normalizeUserAdaptationMemory(current);
  const occurredAt = typeof input.occurredAt === "number" && Number.isFinite(input.occurredAt) ? input.occurredAt : Date.now();
  const summaryHaystack = [input.prompt, input.assistantSummary, input.appliedChangeSummary, input.appliedContent].join("\n");
  const globalProfile: UserAdaptationProfile = {
    explanationDepth: detectExplanationDepth(input.prompt, summaryHaystack),
    preferredFocusTags: unique([
      ...(normalized?.globalProfile?.preferredFocusTags ?? []),
      ...detectTags(summaryHaystack, FOCUS_TAG_PATTERNS),
    ]),
    preferredNoteStyleHints: unique([
      ...(normalized?.globalProfile?.preferredNoteStyleHints ?? []),
      ...detectTags(summaryHaystack, NOTE_STYLE_PATTERNS),
      ...AGENTIC_NOTE_STYLE_HINTS,
    ]),
    avoidResponsePatterns: unique([
      ...(normalized?.globalProfile?.avoidResponsePatterns ?? []),
      ...detectTags(input.prompt, AVOID_PATTERNS),
      ...AGENTIC_AVOID_PATTERNS,
    ]),
    updatedAt: occurredAt,
  };
  const panelOverlays = { ...(normalized?.panelOverlays ?? {}) };
  if (input.panelId?.trim()) {
    const panelId = input.panelId.trim();
    const prior = panelOverlays[panelId];
    panelOverlays[panelId] = {
      panelId,
      preferredFocusTags: unique([...(prior?.preferredFocusTags ?? []), ...detectTags(summaryHaystack, FOCUS_TAG_PATTERNS)]),
      preferredNoteStyleHints: unique([
        ...(prior?.preferredNoteStyleHints ?? []),
        ...detectTags(summaryHaystack, NOTE_STYLE_PATTERNS),
      ]),
      preferredSkillNames: unique([...(prior?.preferredSkillNames ?? []), ...input.selectedSkillNames]),
      lastAppliedTargetPath: input.targetNotePath?.trim() || prior?.lastAppliedTargetPath || null,
      updatedAt: occurredAt,
      studyMemory: prior?.studyMemory ?? null,
    };
  }
  return normalizeUserAdaptationMemory({
    globalProfile,
    panelOverlays,
    studyMemory: normalized?.studyMemory ?? null,
  });
}

export function mergeStudyContractIntoUserAdaptationMemory(
  current: UserAdaptationMemory | null | undefined,
  contract: StudyTurnContract,
  occurredAt: number = Date.now(),
): UserAdaptationMemory | null {
  const normalized = normalizeUserAdaptationMemory(current);
  const workflow = normalizeStudyWorkflow(contract.workflow);
  const priorStudyMemory = normalized?.studyMemory ?? {
    weakConcepts: [],
    understoodConcepts: [],
    nextProblems: [],
    recentStuckPoints: [],
  };
  const nextWeakConcepts = [...priorStudyMemory.weakConcepts];
  const nextUnderstoodConcepts = [...priorStudyMemory.understoodConcepts];

  for (const concept of contract.concepts) {
    const conceptLabel = concept.label.trim();
    if (!conceptLabel) {
      continue;
    }
    const evidence = concept.evidence?.trim() || contract.confidenceNote;
    if (concept.status === "understood") {
      nextUnderstoodConcepts.unshift({
        conceptLabel,
        evidence,
        workflow,
        updatedAt: occurredAt,
      });
      const resolvedKey = normalizeConceptKey(conceptLabel);
      for (let index = nextWeakConcepts.length - 1; index >= 0; index -= 1) {
        if (normalizeConceptKey(nextWeakConcepts[index]?.conceptLabel ?? "") === resolvedKey) {
          nextWeakConcepts.splice(index, 1);
        }
      }
    } else if (concept.status === "weak") {
      nextWeakConcepts.unshift({
        conceptLabel,
        evidence,
        lastStuckPoint: contract.likelyStuckPoints[0] ?? evidence,
        nextQuestion: contract.checkQuestion,
        workflow,
        updatedAt: occurredAt,
      });
    }
  }

  const stuckConceptLabel =
    contract.concepts.find((concept) => concept.status === "weak")?.label.trim() ||
    contract.likelyStuckPoints[0]?.trim() ||
    contract.objective;
  const stuckPoints = contract.likelyStuckPoints.map((detail) => ({
    conceptLabel: stuckConceptLabel,
    detail,
    workflow,
    createdAt: occurredAt,
  }));
  const nextProblems = contract.nextProblems.map((prompt) => ({
    prompt,
    workflow,
    source: contract.sources[0] ?? null,
    createdAt: occurredAt,
  }));

  return normalizeUserAdaptationMemory({
    globalProfile: normalized?.globalProfile ?? null,
    panelOverlays: normalized?.panelOverlays ?? {},
    studyMemory: {
      weakConcepts: nextWeakConcepts,
      understoodConcepts: nextUnderstoodConcepts,
      nextProblems: [...nextProblems, ...priorStudyMemory.nextProblems],
      recentStuckPoints: [...stuckPoints, ...priorStudyMemory.recentStuckPoints],
    },
  });
}

function upsertPanelSourcePreferences(
  current: readonly PanelSourcePreference[],
  labels: readonly string[],
  workflow: StudyContractWorkflowKind,
  occurredAt: number,
): PanelSourcePreference[] {
  const byKey = new Map(current.map((entry) => [normalizeConceptKey(entry.label), { ...entry }]));
  for (const label of labels) {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) {
      continue;
    }
    const key = normalizeConceptKey(normalizedLabel);
    const previous = byKey.get(key);
    byKey.set(key, {
      label: previous?.label ?? normalizedLabel,
      count: (previous?.count ?? 0) + 1,
      workflow,
      updatedAt: occurredAt,
    });
  }
  return [...byKey.values()].sort((left, right) => right.count - left.count || right.updatedAt - left.updatedAt).slice(0, MAX_PANEL_SOURCE_PREFERENCES);
}

function upsertPanelImprovementSignals(
  current: readonly PanelImprovementSignal[],
  additions: Array<Pick<PanelImprovementSignal, "kind" | "label">>,
  occurredAt: number,
): PanelImprovementSignal[] {
  const byKey = new Map(current.map((entry) => [`${entry.kind}:${entry.key}`, { ...entry }]));
  for (const addition of additions) {
    const label = addition.label.trim();
    if (!label) {
      continue;
    }
    const key = normalizeConceptKey(label);
    const mapKey = `${addition.kind}:${key}`;
    const previous = byKey.get(mapKey);
    byKey.set(mapKey, {
      kind: addition.kind,
      key,
      label: previous?.label ?? label,
      count: (previous?.count ?? 0) + 1,
      updatedAt: occurredAt,
    });
  }
  return [...byKey.values()].sort((left, right) => right.count - left.count || right.updatedAt - left.updatedAt).slice(0, MAX_PANEL_IMPROVEMENT_SIGNALS);
}

export function mergeStudyContractIntoPanelMemory(
  current: UserAdaptationMemory | null | undefined,
  panelId: string,
  contract: StudyTurnContract,
  options: {
    panelWorkflow?: StudyContractWorkflowKind | "custom" | null;
    occurredAt?: number;
    preferredSkillNames?: readonly string[];
  } = {},
): UserAdaptationMemory | null {
  const normalized = normalizeUserAdaptationMemory(current);
  const normalizedPanelId = panelId.trim();
  const normalizedContract = normalizeStudyContract(contract);
  if (!normalizedPanelId || !normalizedContract) {
    return normalized;
  }
  const occurredAt = typeof options.occurredAt === "number" && Number.isFinite(options.occurredAt) ? options.occurredAt : Date.now();
  const panelOverlays = { ...(normalized?.panelOverlays ?? {}) };
  const priorOverlay = panelOverlays[normalizedPanelId];
  const priorMemory = normalizePanelStudyMemory(priorOverlay?.studyMemory ?? null) ?? {
    weakConcepts: [],
    understoodConcepts: [],
    nextProblems: [],
    recentStuckPoints: [],
    sourcePreferences: [],
    lastContract: null,
    improvementSignals: [],
  };
  const workflow = normalizeStudyWorkflow(normalizedContract.workflow);
  const nextWeakConcepts = [...priorMemory.weakConcepts];
  const nextUnderstoodConcepts = [...priorMemory.understoodConcepts];

  for (const concept of normalizedContract.concepts) {
    const evidence = concept.evidence?.trim() || normalizedContract.confidenceNote;
    if (concept.status === "understood") {
      nextUnderstoodConcepts.unshift({
        conceptLabel: concept.label,
        evidence,
        workflow,
        updatedAt: occurredAt,
      });
      const key = normalizeConceptKey(concept.label);
      for (let index = nextWeakConcepts.length - 1; index >= 0; index -= 1) {
        if (normalizeConceptKey(nextWeakConcepts[index]?.conceptLabel ?? "") === key) {
          nextWeakConcepts.splice(index, 1);
        }
      }
    } else if (concept.status === "weak") {
      nextWeakConcepts.unshift({
        conceptLabel: concept.label,
        evidence,
        lastStuckPoint: normalizedContract.likelyStuckPoints[0] ?? evidence,
        nextQuestion: normalizedContract.checkQuestion,
        workflow,
        updatedAt: occurredAt,
      });
    }
  }

  const weakConcept = normalizedContract.concepts.find((concept) => concept.status === "weak") ?? null;
  const stuckPoints = normalizedContract.likelyStuckPoints.map((detail) => ({
    conceptLabel: weakConcept?.label ?? normalizedContract.objective,
    detail,
    workflow,
    createdAt: occurredAt,
  }));
  const nextProblems = normalizedContract.nextProblems.map((prompt) => ({
    prompt,
    workflow,
    source: normalizedContract.sources[0] ?? null,
    createdAt: occurredAt,
  }));
  const signalAdditions: Array<Pick<PanelImprovementSignal, "kind" | "label">> = [
    ...normalizedContract.sources.map((label) => ({ kind: "source" as const, label })),
    ...normalizedContract.concepts
      .filter((concept) => concept.status === "weak")
      .map((concept) => ({ kind: "weak_concept" as const, label: concept.label })),
    ...unique(options.preferredSkillNames ?? []).map((label) => ({ kind: "skill" as const, label })),
  ];
  const panelWorkflow = options.panelWorkflow === "custom" ? null : options.panelWorkflow;
  if (panelWorkflow && panelWorkflow !== normalizedContract.workflow) {
    signalAdditions.push({ kind: "workflow", label: normalizedContract.workflow });
  }

  const nextPanelStudyMemory = normalizePanelStudyMemory({
    weakConcepts: nextWeakConcepts,
    understoodConcepts: nextUnderstoodConcepts,
    nextProblems: [...nextProblems, ...priorMemory.nextProblems],
    recentStuckPoints: [...stuckPoints, ...priorMemory.recentStuckPoints],
    sourcePreferences: upsertPanelSourcePreferences(priorMemory.sourcePreferences, normalizedContract.sources, workflow, occurredAt),
    lastContract: normalizedContract,
    improvementSignals: upsertPanelImprovementSignals(priorMemory.improvementSignals, signalAdditions, occurredAt),
  });

  panelOverlays[normalizedPanelId] = {
    panelId: normalizedPanelId,
    preferredFocusTags: priorOverlay?.preferredFocusTags ?? [],
    preferredNoteStyleHints: priorOverlay?.preferredNoteStyleHints ?? [],
    preferredSkillNames: unique([...(priorOverlay?.preferredSkillNames ?? []), ...(options.preferredSkillNames ?? [])]),
    lastAppliedTargetPath: priorOverlay?.lastAppliedTargetPath ?? null,
    updatedAt: occurredAt,
    studyMemory: nextPanelStudyMemory,
  };

  return normalizeUserAdaptationMemory({
    globalProfile: normalized?.globalProfile ?? null,
    panelOverlays,
    studyMemory: normalized?.studyMemory ?? null,
  });
}

export function getStablePanelImprovementSignals(
  memory: PanelStudyMemory | null | undefined,
  threshold = PANEL_IMPROVEMENT_SIGNAL_THRESHOLD,
): PanelImprovementSignal[] {
  const normalized = normalizePanelStudyMemory(memory);
  if (!normalized) {
    return [];
  }
  return normalized.improvementSignals.filter((signal) => signal.count >= threshold);
}

function formatLabelList(label: string, values: readonly string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  return [`- ${label}: ${values.join(", ")}`];
}

function formatExplanationDepth(depth: UserAdaptationProfile["explanationDepth"]): string {
  if (depth === "step_by_step") {
    return "step-by-step";
  }
  if (depth === "concise") {
    return "concise";
  }
  return "balanced";
}

export function buildUserAdaptationMemoryText(
  memory: UserAdaptationMemory | null | undefined,
  panelId: string | null,
): string | null {
  const normalized = normalizeUserAdaptationMemory(memory);
  if (!normalized) {
    return null;
  }
  const lines: string[] = ["User adaptation memory"];
  if (normalized.globalProfile) {
    lines.push("Global profile");
    lines.push(`- Preferred explanation depth: ${formatExplanationDepth(normalized.globalProfile.explanationDepth)}`);
    lines.push(...formatLabelList("Preferred focus tags", normalized.globalProfile.preferredFocusTags.slice(0, 5)));
    lines.push(...formatLabelList("Preferred note style hints", normalized.globalProfile.preferredNoteStyleHints.slice(0, 5)));
    lines.push(...formatLabelList("Avoid response patterns", normalized.globalProfile.avoidResponsePatterns.slice(0, 3)));
  }
  if (panelId?.trim()) {
    const overlay = normalized.panelOverlays[panelId.trim()];
    if (overlay) {
      lines.push(`Panel overlay (${overlay.panelId})`);
      lines.push(...formatLabelList("Focus tags", overlay.preferredFocusTags.slice(0, 5)));
      lines.push(...formatLabelList("Note style hints", overlay.preferredNoteStyleHints.slice(0, 5)));
      lines.push(...formatLabelList("Frequently used skills", overlay.preferredSkillNames.slice(0, 5)));
      if (overlay.lastAppliedTargetPath) {
        lines.push(`- Last applied target note: ${overlay.lastAppliedTargetPath}`);
      }
    }
  }
  return lines.length > 1 ? lines.join("\n") : null;
}

export function buildStudyMemoryCarryForwardText(memory: UserAdaptationMemory | null | undefined, panelId: string | null = null): string | null {
  const normalized = normalizeUserAdaptationMemory(memory);
  const panelMemory = panelId?.trim() ? normalized?.panelOverlays[panelId.trim()]?.studyMemory ?? null : null;
  const studyMemory = panelMemory ?? normalized?.studyMemory ?? null;
  if (!studyMemory) {
    return null;
  }
  const lines: string[] = [panelMemory ? "Panel memory carry-forward:" : "Study memory carry-forward:"];
  if (studyMemory.weakConcepts.length > 0) {
    lines.push(`- Weak concepts: ${studyMemory.weakConcepts.slice(0, 3).map((entry) => entry.conceptLabel).join(" / ")}`);
    const topWeak = studyMemory.weakConcepts[0];
    if (topWeak) {
      lines.push(`- Prior stuck point: ${topWeak.lastStuckPoint || topWeak.evidence}`);
      lines.push(`- Next check: ${topWeak.nextQuestion}`);
    }
  }
  if (studyMemory.understoodConcepts.length > 0) {
    lines.push(`- Understood concepts: ${studyMemory.understoodConcepts.slice(0, 4).map((entry) => entry.conceptLabel).join(" / ")}`);
  }
  if (studyMemory.nextProblems.length > 0) {
    lines.push(`- Next problems: ${studyMemory.nextProblems.slice(0, 3).map((entry) => entry.prompt).join(" / ")}`);
  }
  const sourcePreferences =
    "sourcePreferences" in studyMemory && Array.isArray((studyMemory as Partial<PanelStudyMemory>).sourcePreferences)
      ? ((studyMemory as PanelStudyMemory).sourcePreferences ?? [])
      : [];
  if (sourcePreferences.length > 0) {
    lines.push(`- Source preferences: ${sourcePreferences.slice(0, 3).map((entry) => entry.label).join(" / ")}`);
  }
  if (studyMemory.recentStuckPoints.length > 0 && studyMemory.weakConcepts.length === 0) {
    lines.push(`- Recent stuck point: ${studyMemory.recentStuckPoints[0]?.detail}`);
  }
  return lines.length > 1 ? lines.join("\n") : null;
}
