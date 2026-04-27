import type {
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

export type { StudyTurnPlan, StudySourceStrategy, StudyTeachingMode } from "../../model/types";

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

function buildVisibleReplyGuidance(mode: StudyTeachingMode): string {
  if (mode === "ask_for_source") {
    return "Keep the reply short and natural; ask one short source question before solving or explaining.";
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
  const nextAction =
    teachingMode === "ask_for_source"
      ? firstNonEmpty([input.preflight?.advisories[0], "Ask for the problem statement or source excerpt."]) ?? "Ask for the missing source."
      : firstNonEmpty([nextProblem, input.studyCoachState?.latestContract?.nextAction, input.studyCoachState?.latestRecap?.nextStep]) ??
        "Continue with one concise check question.";
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
    likelyStuckPoint: firstNonEmpty([topWeak?.lastStuckPoint, activeCoachWeak?.explanationSummary, memory?.recentStuckPoints[0]?.detail]),
    sourceStrategy,
    checkQuestion: firstNonEmpty([topWeak?.nextQuestion, activeCoachWeak?.nextQuestion, input.studyCoachState?.latestContract?.checkQuestion]),
    nextAction,
    recommendedSkills: rankedSkills
      .filter((skill) => !selected.has(skill.name))
      .slice(0, 3)
      .map((skill) => ({
        name: skill.name,
        reason: buildSkillReason(input),
      })),
    panelSignals: buildPanelSignals(input),
    visibleReplyGuidance: buildVisibleReplyGuidance(teachingMode),
  };
}

function formatPanelSignal(signal: StudyTurnPlanSignal): string {
  const kind: PanelImprovementSignalKind = signal.kind;
  return `${kind}:${signal.label} (${signal.reason})`;
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
    plan.recommendedSkills.length > 0 ? `- Recommended skills: ${plan.recommendedSkills.map((entry) => entry.name).join(" / ")}` : null,
    plan.panelSignals.length > 0 ? `- Panel signals: ${plan.panelSignals.map(formatPanelSignal).join(" / ")}` : null,
    `- Visible reply guidance: ${plan.visibleReplyGuidance}`,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
}
