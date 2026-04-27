import type {
  PanelAdaptationOverlay,
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

export function buildStudyMemoryCarryForwardText(memory: UserAdaptationMemory | null | undefined): string | null {
  const normalized = normalizeUserAdaptationMemory(memory);
  const studyMemory = normalized?.studyMemory ?? null;
  if (!studyMemory) {
    return null;
  }
  const lines: string[] = ["Study memory carry-forward:"];
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
  if (studyMemory.recentStuckPoints.length > 0 && studyMemory.weakConcepts.length === 0) {
    lines.push(`- Recent stuck point: ${studyMemory.recentStuckPoints[0]?.detail}`);
  }
  return lines.length > 1 ? lines.join("\n") : null;
}
