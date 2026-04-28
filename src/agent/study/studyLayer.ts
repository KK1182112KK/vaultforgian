import type { ComposeMode, RuntimeMode, TurnContextSnapshot } from "../../model/types";
import type { AgentTurnIntentKind } from "../../util/turnIntent";
import { allowsVaultWrite as promptAllowsVaultWrite } from "../../util/vaultEdit";
import { formatStudyTurnPlanForPrompt, type StudyTurnPlan } from "./studyTurnPlanner";

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

const EXPLANATION_PATTERNS: readonly RegExp[] = [
  /\bexplain\b/i,
  /\bteach me\b/i,
  /\bhelp me understand\b/i,
  /\bwalk me through\b/i,
  /\bstudy\b/i,
  /\blearn\b/i,
  /\breview\b/i,
  /\bwhat is\b/i,
  /\bhow does\b/i,
  /\bwhy\b/i,
  /説明/,
  /教えて/,
  /理解/,
  /勉強/,
  /復習/,
  /なぜ/,
  /どうして/,
  /とは/,
  /解説/,
];

export interface StudyLayerPromptOverlayInput {
  prompt: string;
  context: TurnContextSnapshot;
  mode: RuntimeMode;
  skillNames: readonly string[];
  composeMode: ComposeMode;
  allowVaultWrite: boolean;
  learningMode: boolean;
  studyTurnPlan?: StudyTurnPlan | null;
  turnIntentKind?: AgentTurnIntentKind | null;
}

export interface StudyLayerPromptOverlay {
  statusLines: string[];
  instructions: string[];
  blocks: Array<string | null>;
  learningModeActive: boolean;
}

function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function isStudyLayerActiveForTurn(context: TurnContextSnapshot): boolean {
  return Boolean(
    context.studyWorkflow ||
      context.workflowText ||
      context.studyCoachText ||
      context.paperStudyRuntimeOverlayText ||
      context.paperStudyGuideText,
  );
}

function shouldUseLearningMode(input: StudyLayerPromptOverlayInput): boolean {
  if (!input.learningMode || !isStudyLayerActiveForTurn(input.context)) {
    return false;
  }
  if (input.composeMode !== "chat" || input.allowVaultWrite) {
    return false;
  }
  if (promptAllowsVaultWrite(input.prompt)) {
    return false;
  }
  return Boolean(input.context.studyWorkflow) || matchesAnyPattern(input.prompt, EXPLANATION_PATTERNS);
}

function shouldUseStudyContract(input: StudyLayerPromptOverlayInput, learningModeActive: boolean): boolean {
  if (input.composeMode !== "chat" || input.allowVaultWrite || promptAllowsVaultWrite(input.prompt)) {
    return false;
  }
  if (learningModeActive) {
    return true;
  }
  return Boolean(
    input.context.studyWorkflow ||
      input.context.workflowText ||
      input.context.paperStudyRuntimeOverlayText ||
      input.context.paperStudyGuideText,
  );
}

function shouldAttachStudyTurnPlan(input: StudyLayerPromptOverlayInput): boolean {
  if (!input.studyTurnPlan || input.composeMode !== "chat" || input.allowVaultWrite || promptAllowsVaultWrite(input.prompt)) {
    return false;
  }
  return input.turnIntentKind !== "smalltalk" && input.turnIntentKind !== "note_edit" && input.turnIntentKind !== "plan";
}

export function buildStudyLayerPromptOverlay(input: StudyLayerPromptOverlayInput): StudyLayerPromptOverlay {
  const statusLines: string[] = [];
  const instructions: string[] = [];
  const blocks: Array<string | null> = [];
  const context = input.context;
  const active = isStudyLayerActiveForTurn(context);
  const learningModeActive = shouldUseLearningMode(input);
  const studyContractActive = shouldUseStudyContract(input, learningModeActive);
  const studyTurnPlanActive = shouldAttachStudyTurnPlan(input);

  if (!active) {
    return { statusLines, instructions, blocks, learningModeActive };
  }

  statusLines.push(`Active study workflow: ${context.studyWorkflow ?? "none"}`);
  statusLines.push(`Study coach carry-forward: ${context.studyCoachText ? "attached" : "none"}`);
  statusLines.push(`Paper-study runtime overlay: ${context.paperStudyRuntimeOverlayText ? "attached" : "none"}`);
  statusLines.push(`Paper-study guidance: ${context.paperStudyGuideText ? "attached" : "none"}`);

  if (learningModeActive) {
    const directAnswerRequested = matchesAnyPattern(input.prompt, DIRECT_ANSWER_PATTERNS);
    if (directAnswerRequested) {
      instructions.push(
        "Learning mode is active for this tab. Use the attached LearningCoachPlan when present. Because the user explicitly asked for the direct answer in this turn, Give the direct answer first.",
      );
      instructions.push(
        "After the direct answer, still include one short understanding-check question or next action. Do not expose planner JSON, memory, or contract details.",
      );
    } else {
      instructions.push(
        "Learning mode is active for this tab. Use the attached LearningCoachPlan when present. Default to hint-first support: give one short hint, at most one scaffold step, one short understanding-check question, and one next action.",
      );
      instructions.push(
        "Do not dump the full answer unless the LearningCoachPlan says direct_answer or the learner is stuck enough for a worked step. Do not force this study-coach contract onto note-editing, patch-generation, implementation, or operational tasks.",
      );
    }
  }

  if (studyContractActive) {
    instructions.push(
      "For this study turn, append a hidden fenced `obsidian-study-contract` JSON block after the visible answer. Use this literal fence label: ```obsidian-study-contract",
    );
    instructions.push(
      "The study contract JSON schema is {\"objective\":\"...\",\"sources\":[\"...\"],\"concepts\":[{\"label\":\"...\",\"status\":\"introduced|weak|understood|review\",\"evidence\":\"...\"}],\"likely_stuck_points\":[\"...\"],\"check_question\":\"...\",\"next_action\":\"...\",\"next_problems\":[\"...\"],\"confidence_note\":\"...\",\"workflow\":\"lecture|review|paper|homework|general\"}.",
    );
    instructions.push(
      "Do not show the contract JSON or internal analysis in the visible reply. Surface only the useful explanation, one concise check question when helpful, and the next action.",
    );
  }

  if (studyTurnPlanActive && input.studyTurnPlan) {
    instructions.push(
      "A hidden StudyTurnPlan and LearningCoachPlan are attached for this study turn. Use them to choose the teaching mode, focus concept, source strategy, hint level, scaffold, check question, and next action.",
    );
    instructions.push(
      "Do not show the StudyTurnPlan, LearningCoachPlan, planner fields, or internal memory analysis in the visible reply.",
    );
    instructions.push(
      "Keep the visible reply short and natural: give one short hint, include at most one scaffold step, include at most one understanding-check question, and include at most one next action.",
    );
  }

  if (context.paperStudyRuntimeOverlayText) {
    instructions.push(
      "A paper-study runtime overlay is attached for this turn. It overrides attached skill guides and any source-bundle/path hints in the user request.",
    );
    instructions.push("Do not perform a second local PDF ingestion pass when the attached source text is already present.");
    instructions.push("Do not call shell or file-reading tools for source acquisition in this turn.");
  }

  if (studyContractActive && context.studyCoachText) {
    instructions.push("A study coach carry-forward summary is attached for this turn.");
    instructions.push("Use it to continue from the learner's latest recap, unresolved weak point, and next study step.");
  }

  if (context.paperStudyGuideText) {
    instructions.push("A paper-study guide is attached for this turn. Follow it before falling back to generic paper-reading instructions.");
    instructions.push(
      "When attached paper text is present, do not fall back to generic 'paste the abstract' or 'local read failed' instructions.",
    );
  }

  blocks.push(
    context.workflowText,
    studyTurnPlanActive && input.studyTurnPlan ? formatStudyTurnPlanForPrompt(input.studyTurnPlan) : null,
    studyContractActive ? context.studyCoachText ?? null : null,
    context.paperStudyRuntimeOverlayText,
    context.paperStudyGuideText,
  );

  return { statusLines, instructions, blocks, learningModeActive };
}
