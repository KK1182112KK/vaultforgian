import type { ComposeMode, RuntimeMode, TurnContextSnapshot } from "../../model/types";
import { allowsVaultWrite as promptAllowsVaultWrite } from "../../util/vaultEdit";

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

export function buildStudyLayerPromptOverlay(input: StudyLayerPromptOverlayInput): StudyLayerPromptOverlay {
  const statusLines: string[] = [];
  const instructions: string[] = [];
  const blocks: Array<string | null> = [];
  const context = input.context;
  const active = isStudyLayerActiveForTurn(context);
  const learningModeActive = shouldUseLearningMode(input);

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
        "Learning mode is active for this tab. Use a study-coach response structure for study and explanation turns. Because the user explicitly asked for the direct answer in this turn, Give the direct answer first.",
      );
      instructions.push(
        "After the direct answer, still include one short understanding-check question, name one likely point of confusion, suggest the next study step, and append a fenced `obsidian-study-checkpoint` JSON block after the visible answer. Use this literal fence label: ```obsidian-study-checkpoint",
      );
    } else {
      instructions.push(
        "Learning mode is active for this tab. Use a study-coach response structure for study and explanation turns: lead with the key explanation, include one short understanding-check question, name a likely point of confusion, and end with the next study step.",
      );
      instructions.push(
        "After the visible answer, append a fenced `obsidian-study-checkpoint` JSON block with keys `workflow`, `mastered`, `unclear`, `next_step`, and `confidence_note`. Keep the checkpoint factual and concise so the plugin can carry it forward into the next turn. Use this literal fence label: ```obsidian-study-checkpoint",
      );
      instructions.push(
        "Do not force this study-coach contract onto note-editing, patch-generation, implementation, or operational tasks.",
      );
    }
  }

  if (context.paperStudyRuntimeOverlayText) {
    instructions.push(
      "A paper-study runtime overlay is attached for this turn. It overrides attached skill guides and any source-bundle/path hints in the user request.",
    );
    instructions.push("Do not perform a second local PDF ingestion pass when the attached source text is already present.");
    instructions.push("Do not call shell or file-reading tools for source acquisition in this turn.");
  }

  if (learningModeActive && context.studyCoachText) {
    instructions.push("A study coach carry-forward summary is attached for this turn.");
    instructions.push("Use it to continue from the learner's latest recap, unresolved weak point, and next study step.");
  }

  if (context.paperStudyGuideText) {
    instructions.push("A paper-study guide is attached for this turn. Follow it before falling back to generic paper-reading instructions.");
    instructions.push(
      "When attached paper text is present, do not fall back to generic 'paste the abstract' or 'local read failed' instructions.",
    );
  }

  blocks.push(context.workflowText, learningModeActive ? context.studyCoachText ?? null : null, context.paperStudyRuntimeOverlayText, context.paperStudyGuideText);

  return { statusLines, instructions, blocks, learningModeActive };
}
