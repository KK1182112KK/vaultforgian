import type {
  LearningCoachHintLevel,
  LearningCoachMode,
  LearningCoachPlan,
  PanelImprovementSignalKind,
  PanelStudyMemory,
  StudyCoachState,
  StudyRecipe,
  StudySourceStrategy,
  StudyTeachingMode,
  StudyTurnPlan,
  StudyTurnPlanSignal,
  UserStudyMemory,
} from "../../model/types";
import type { AgentTurnIntent } from "../../util/turnIntent";
import { rankPanelSkillsForRecipe, type StudyRecipePreflight } from "../../util/studyRecipes";

export type { LearningCoachPlan, StudyTurnPlan, StudySourceStrategy, StudyTeachingMode } from "../../model/types";

export interface StudyTurnPlannerSkill {
  name: string;
  description: string;
  path?: string;
}

export interface StudyTurnPlannerInput {
  prompt: string;
  activePanel: StudyRecipe | null;
  panelMemory: PanelStudyMemory | null;
  globalStudyMemory: UserStudyMemory | null;
  studyCoachState: StudyCoachState | null;
  turnIntent: AgentTurnIntent;
  preflight: StudyRecipePreflight | null;
  selectedSkillNames: readonly string[];
  explicitSkillNames?: readonly string[];
  availableSkills: readonly StudyTurnPlannerSkill[];
  sourceState: {
    hasAttachmentContent: boolean;
    hasNoteSourcePack: boolean;
    hasSelection: boolean;
  };
  learningMode: boolean;
}

function firstNonEmpty(values: readonly (string | null | undefined)[]): string | null {
  return values.map((entry) => entry?.trim() ?? "").find(Boolean) ?? null;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}

const DIRECT_ANSWER_PATTERNS: readonly RegExp[] = [
  /\bjust give me the answer\b/i,
  /\bjust tell me\b/i,
  /\bdirect answer\b/i,
  /\banswer first\b/i,
  /\bskip the questions\b/i,
  /\bno hints\b/i,
  /\bshow me the solution\b/i,
  /答えだけ/,
  /先に答え/,
  /そのまま答え/,
  /質問しないで/,
  /ヒントはいらない/,
  /解答だけ/,
  /結論から/,
];

const UNKNOWN_RESPONSE_PATTERNS: readonly RegExp[] = [
  /\bi\s+don'?t\s+know\b/i,
  /\bidk\b/i,
  /\bnot\s+sure\b/i,
  /\bno\s+idea\b/i,
  /わからない/,
  /分からない/,
  /知らない/,
  /不明/,
];

function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function inferSourceStrategy(input: StudyTurnPlannerInput): StudySourceStrategy {
  const preflightStrategy = input.preflight?.sourceStrategy;
  if (
    preflightStrategy === "use_note" ||
    preflightStrategy === "use_attachment" ||
    preflightStrategy === "continue_from_memory" ||
    preflightStrategy === "ask_for_source"
  ) {
    return preflightStrategy;
  }
  if (input.sourceState.hasAttachmentContent) {
    return "use_attachment";
  }
  if (input.sourceState.hasNoteSourcePack || input.sourceState.hasSelection) {
    return "use_note";
  }
  const memory = input.panelMemory ?? input.globalStudyMemory;
  if (memory && (memory.weakConcepts.length > 0 || memory.nextProblems.length > 0)) {
    return "continue_from_memory";
  }
  return "ask_for_source";
}

function inferTeachingMode(input: StudyTurnPlannerInput, sourceStrategy: StudySourceStrategy): StudyTeachingMode {
  if (sourceStrategy === "ask_for_source") {
    return "ask_for_source";
  }
  if (input.studyCoachState?.quizSession?.status === "active") {
    return "quiz";
  }
  if (input.activePanel?.workflow === "paper" && sourceStrategy === "use_attachment") {
    return "source_check";
  }
  if ((input.panelMemory ?? input.globalStudyMemory)?.weakConcepts.length || input.studyCoachState?.weakPointLedger.some((entry) => !entry.resolved)) {
    return "coach";
  }
  if (/\b(?:quiz|test|drill|practice)\b|確認問題|小テスト|練習/u.test(input.prompt)) {
    return "quiz";
  }
  return input.learningMode ? "coach" : "explain";
}

function buildObjective(input: StudyTurnPlannerInput, sourceStrategy: StudySourceStrategy): string {
  if (input.activePanel) {
    const workflow = input.activePanel.workflow === "custom" ? "study" : input.activePanel.workflow;
    if (sourceStrategy === "ask_for_source") {
      return `Clarify the missing source before continuing the ${workflow} panel.`;
    }
    return `Continue the ${workflow} panel with the learner's current memory and source context.`;
  }
  if (sourceStrategy === "ask_for_source") {
    return "Clarify the missing source before giving a study answer.";
  }
  return "Continue the study turn from the learner's memory.";
}

function buildSkillReason(input: StudyTurnPlannerInput): string {
  const focusText = (input.panelMemory ?? input.globalStudyMemory)?.weakConcepts[0]?.conceptLabel;
  if (focusText) {
    return `Matches the current focus concept: ${focusText}.`;
  }
  if (input.activePanel) {
    return `Matches the active ${input.activePanel.workflow} panel.`;
  }
  return `Useful for this study turn.`;
}

function buildPanelSignals(input: StudyTurnPlannerInput): StudyTurnPlanSignal[] {
  const signals: StudyTurnPlanSignal[] = [];
  const memory = input.panelMemory;
  if (!input.activePanel || !memory) {
    return signals;
  }
  for (const skillName of input.selectedSkillNames) {
    signals.push({
      kind: "skill",
      label: skillName,
      reason: "Selected during an active panel turn.",
    });
  }
  const sourcePreference = memory.sourcePreferences[0];
  if (sourcePreference) {
    signals.push({
      kind: "source",
      label: sourcePreference.label,
      reason: "Repeatedly useful source for this panel.",
    });
  }
  const weakConcept = memory.weakConcepts[0];
  if (weakConcept) {
    signals.push({
      kind: "weak_concept",
      label: weakConcept.conceptLabel,
      reason: "Current unresolved panel weak concept.",
    });
  }
  return signals.filter((signal, index, all) => {
    const key = `${signal.kind}:${signal.label.toLowerCase()}`;
    return all.findIndex((entry) => `${entry.kind}:${entry.label.toLowerCase()}` === key) === index;
  });
}

function resolveLearningCoachMode(input: StudyTurnPlannerInput, teachingMode: StudyTeachingMode): LearningCoachMode {
  if (matchesAnyPattern(input.prompt, DIRECT_ANSWER_PATTERNS)) {
    return "direct_answer";
  }
  if (input.studyCoachState?.quizSession?.status === "active" || teachingMode === "quiz") {
    return "quiz";
  }
  if (matchesAnyPattern(input.prompt, UNKNOWN_RESPONSE_PATTERNS)) {
    return "scaffold";
  }
  if (teachingMode === "source_check" || teachingMode === "ask_for_source") {
    return "source_check";
  }
  return input.learningMode ? "hint_first" : "explain";
}

function resolveLearningHintLevel(input: StudyTurnPlannerInput, coachMode: LearningCoachMode): LearningCoachHintLevel {
  if (coachMode === "direct_answer") {
    return "worked_step";
  }
  const unknownResponse = matchesAnyPattern(input.prompt, UNKNOWN_RESPONSE_PATTERNS);
  if (unknownResponse) {
    return (input.studyCoachState?.consecutiveStuckCount ?? 0) > 0 || input.studyCoachState?.lastHintLevel === "guided"
      ? "worked_step"
      : "guided";
  }
  if (coachMode === "quiz" && input.studyCoachState?.quizSession?.lastUserResponseKind === "unknown") {
    return "guided";
  }
  return "nudge";
}

function buildScaffoldStep(coachMode: LearningCoachMode, hintLevel: LearningCoachHintLevel, focusConcept: string | null): string {
  const focus = focusConcept ? ` for ${focusConcept}` : "";
  if (coachMode === "direct_answer") {
    return `Give the answer first, then add one quick check${focus}.`;
  }
  if (hintLevel === "worked_step") {
    return `Show one worked step${focus}, then pause for the learner to continue.`;
  }
  if (hintLevel === "guided") {
    return `Give one concrete cue${focus}, then ask the learner to try the next step.`;
  }
  return `Give one short hint${focus} before any full explanation.`;
}

function buildLearningCoachPlan(params: {
  input: StudyTurnPlannerInput;
  teachingMode: StudyTeachingMode;
  focusConcepts: readonly string[];
  likelyStuckPoint: string | null;
  checkQuestion: string | null;
  nextAction: string;
}): LearningCoachPlan | null {
  const activeQuiz = params.input.studyCoachState?.quizSession?.status === "active";
  if (!params.input.learningMode && !activeQuiz) {
    return null;
  }
  const mode = resolveLearningCoachMode(params.input, params.teachingMode);
  const hintLevel = resolveLearningHintLevel(params.input, mode);
  const focusConcept = firstNonEmpty([
    params.focusConcepts[0],
    params.input.studyCoachState?.lastStuckPoint?.conceptLabel,
    params.input.studyCoachState?.latestContract?.concepts[0]?.label,
  ]);
  return {
    mode,
    hintLevel,
    answerPolicy: mode === "direct_answer" ? "answer_first" : "hint_first",
    focusConcept,
    stuckPoint: params.likelyStuckPoint,
    scaffoldSteps: [buildScaffoldStep(mode, hintLevel, focusConcept)],
    checkQuestion: params.checkQuestion,
    nextAction: params.nextAction,
  };
}

function buildVisibleReplyGuidance(mode: StudyTeachingMode, learningCoachPlan: LearningCoachPlan | null): string {
  if (mode === "ask_for_source") {
    return "Keep the reply short and natural; ask one short source question before solving or explaining.";
  }
  if (learningCoachPlan?.answerPolicy === "answer_first") {
    return "Give the direct answer first, then include at most one short check question or next action.";
  }
  if (learningCoachPlan) {
    return "Use hint-first coaching: one short hint, at most one scaffold step, at most one check question, and at most one next action.";
  }
  return "Keep the answer short and natural; include at most one understanding-check question and at most one next action.";
}

function buildRankingPrompt(input: StudyTurnPlannerInput): string {
  const memory = input.panelMemory ?? input.globalStudyMemory;
  return [
    input.prompt,
    ...(memory?.weakConcepts ?? []).flatMap((entry) => [entry.conceptLabel, entry.evidence, entry.lastStuckPoint, entry.nextQuestion]),
    ...(memory?.nextProblems ?? []).map((entry) => entry.prompt),
  ].join("\n");
}

export function buildStudyTurnPlan(input: StudyTurnPlannerInput): StudyTurnPlan {
  const memory = input.panelMemory ?? input.globalStudyMemory;
  const topWeak = memory?.weakConcepts[0] ?? null;
  const activeCoachWeak = input.studyCoachState?.weakPointLedger.find((entry) => !entry.resolved) ?? null;
  const focusConcepts = dedupe([
    ...(memory?.weakConcepts.slice(0, 3).map((entry) => entry.conceptLabel) ?? []),
    ...(activeCoachWeak ? [activeCoachWeak.conceptLabel] : []),
  ]);
  const sourceStrategy = inferSourceStrategy(input);
  const teachingMode = inferTeachingMode(input, sourceStrategy);
  const nextProblem = memory?.nextProblems[0]?.prompt ?? input.studyCoachState?.nextProblems?.[0]?.prompt ?? null;
  const likelyStuckPoint = firstNonEmpty([
    topWeak?.lastStuckPoint,
    activeCoachWeak?.explanationSummary,
    memory?.recentStuckPoints[0]?.detail,
    input.studyCoachState?.lastStuckPoint?.detail,
  ]);
  const checkQuestion = firstNonEmpty([topWeak?.nextQuestion, activeCoachWeak?.nextQuestion, input.studyCoachState?.latestContract?.checkQuestion]);
  const nextAction =
    teachingMode === "ask_for_source"
      ? firstNonEmpty([input.preflight?.advisories[0], "Ask for the problem statement or source excerpt."]) ?? "Ask for the missing source."
      : firstNonEmpty([nextProblem, input.studyCoachState?.latestContract?.nextAction, input.studyCoachState?.latestRecap?.nextStep]) ??
        "Continue with one concise check question.";
  const learningCoachPlan = buildLearningCoachPlan({
    input,
    teachingMode,
    focusConcepts,
    likelyStuckPoint,
    checkQuestion,
    nextAction,
  });
  const rankedSkills = input.activePanel
    ? rankPanelSkillsForRecipe({
        panel: input.activePanel,
        panelMemory: input.panelMemory,
        skills: input.availableSkills,
        selectedSkillNames: input.selectedSkillNames,
        explicitSkillNames: input.explicitSkillNames ?? [],
        preferredSkillNames: [],
        prompt: buildRankingPrompt(input),
      })
    : [...input.availableSkills];
  const selected = new Set(input.selectedSkillNames);

  return {
    objective: buildObjective(input, sourceStrategy),
    teachingMode,
    focusConcepts,
    likelyStuckPoint,
    sourceStrategy,
    checkQuestion,
    nextAction,
    selectedSkillNames: dedupe(input.selectedSkillNames),
    recommendedSkills: rankedSkills
      .filter((skill) => !selected.has(skill.name))
      .slice(0, 3)
      .map((skill) => ({
        name: skill.name,
        reason: buildSkillReason(input),
      })),
    panelSignals: buildPanelSignals(input),
    visibleReplyGuidance: buildVisibleReplyGuidance(teachingMode, learningCoachPlan),
    learningCoachPlan,
  };
}

function formatPanelSignal(signal: StudyTurnPlanSignal): string {
  const kind: PanelImprovementSignalKind = signal.kind;
  return `${kind}:${signal.label} (${signal.reason})`;
}

function formatLearningCoachPlanForPrompt(plan: LearningCoachPlan | null | undefined): string | null {
  if (!plan) {
    return null;
  }
  return [
    "LearningCoachPlan",
    `- Mode: ${plan.mode}`,
    `- Hint level: ${plan.hintLevel}`,
    `- Answer policy: ${plan.answerPolicy}`,
    plan.focusConcept ? `- Focus concept: ${plan.focusConcept}` : null,
    plan.stuckPoint ? `- Stuck point: ${plan.stuckPoint}` : null,
    plan.scaffoldSteps.length > 0 ? `- Scaffold steps: ${plan.scaffoldSteps.join(" / ")}` : null,
    plan.checkQuestion ? `- Check question: ${plan.checkQuestion}` : null,
    `- Next action: ${plan.nextAction}`,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
}

export function formatStudyTurnPlanForPrompt(plan: StudyTurnPlan): string {
  return [
    "StudyTurnPlan",
    `- Objective: ${plan.objective}`,
    `- Teaching mode: ${plan.teachingMode}`,
    `- Source strategy: ${plan.sourceStrategy}`,
    plan.focusConcepts.length > 0 ? `- Focus concepts: ${plan.focusConcepts.join(" / ")}` : null,
    plan.likelyStuckPoint ? `- Likely stuck point: ${plan.likelyStuckPoint}` : null,
    plan.checkQuestion ? `- Check question: ${plan.checkQuestion}` : null,
    `- Next action: ${plan.nextAction}`,
    plan.selectedSkillNames?.length ? `- Selected required skills: ${plan.selectedSkillNames.map((entry) => `$${entry}`).join(" / ")}` : null,
    plan.recommendedSkills.length > 0 ? `- Recommended skills: ${plan.recommendedSkills.map((entry) => entry.name).join(" / ")}` : null,
    plan.panelSignals.length > 0 ? `- Panel signals: ${plan.panelSignals.map(formatPanelSignal).join(" / ")}` : null,
    `- Visible reply guidance: ${plan.visibleReplyGuidance}`,
    formatLearningCoachPlanForPrompt(plan.learningCoachPlan),
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
}
