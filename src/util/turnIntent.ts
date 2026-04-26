import type { ComposeMode } from "../model/types";

export type AgentTurnIntentKind = "smalltalk" | "answer_only" | "note_answer" | "note_edit" | "plan";
export type NoteSuggestionPolicy = "never" | "eligible";

export interface AgentTurnIntent {
  kind: AgentTurnIntentKind;
}

export interface ClassifyTurnIntentInput {
  prompt: string;
  composeMode: ComposeMode;
  allowVaultWrite: boolean;
  hasNoteTarget: boolean;
  hasSelection: boolean;
  hasNoteSourcePack: boolean;
  hasAttachmentContent: boolean;
}

const SMALLTALK_ONLY_PATTERNS = [
  /^(?:hi|hello|hey|yo|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you|ok(?:ay)?|cool|nice)[.!?\s]*$/iu,
  /^(?:こんにちは|こんにちわ|こんばんは|おはよう|おはようございます|ありがとう|ありがとうございます|どうも|よろしく|よろしくお願いします|了解|OK|はい)[。！!？?\s]*$/u,
];

const NOTE_ANSWER_PATTERNS = [
  /\b(?:this|the|current|target|active)\s+note\b/iu,
  /\bnote\b.{0,32}\b(?:summar|explain|review|check|clarif|analy[sz]e)\w*/iu,
  /\b(?:summar|explain|review|check|clarif|analy[sz]e)\w*.{0,32}\bnote\b/iu,
  /(?:この|今の|対象|選択中の)?(?:ノート|メモ|資料|添付|選択範囲).{0,32}(?:要約|説明|確認|レビュー|解説|分析)/u,
  /(?:要約|説明|確認|レビュー|解説|分析).{0,32}(?:ノート|メモ|資料|添付|選択範囲)/u,
];

export function isSmalltalkPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return Boolean(text && SMALLTALK_ONLY_PATTERNS.some((pattern) => pattern.test(text)));
}

function isNoteAnswerPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return Boolean(text && NOTE_ANSWER_PATTERNS.some((pattern) => pattern.test(text)));
}

export function classifyTurnIntent(input: ClassifyTurnIntentInput): AgentTurnIntent {
  if (input.composeMode === "plan") {
    return { kind: "plan" };
  }
  if (isSmalltalkPrompt(input.prompt)) {
    return { kind: "smalltalk" };
  }
  if (input.allowVaultWrite) {
    return { kind: "note_edit" };
  }
  if (
    input.hasNoteTarget &&
    (input.hasSelection || input.hasNoteSourcePack || input.hasAttachmentContent || isNoteAnswerPrompt(input.prompt))
  ) {
    return { kind: "note_answer" };
  }
  return { kind: "answer_only" };
}

export function resolveNoteSuggestionPolicy(intent: AgentTurnIntent): NoteSuggestionPolicy {
  return intent.kind === "note_answer" || intent.kind === "note_edit" ? "eligible" : "never";
}
