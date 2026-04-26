import type { ComposeMode } from "../model/types";

export type AgentTurnIntentKind = "smalltalk" | "answer_only" | "note_answer" | "note_edit" | "diagram_generation" | "plan";
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

const DIAGRAM_GENERATION_PATTERNS = [
  /\b(?:diagram|flowchart|concept\s+map|visualization|visualise|visualize)\b.{0,48}\b(?:make|create|generate|draw|build|insert|add)\b/iu,
  /\b(?:make|create|generate|draw|build|insert|add)\b.{0,48}\b(?:diagram|flowchart|concept\s+map|visualization|visualise|visualize|visual)\b/iu,
  /(?:図|図解|学習図|概念図|ダイアグラム|可視化).{0,24}(?:作|生成|描|追加|挿入|して|ほしい)/u,
  /(?:作|生成|描|追加|挿入).{0,24}(?:図|図解|学習図|概念図|ダイアグラム|可視化)/u,
];

const IMAGE_ATTACHMENT_ANALYSIS_PATTERNS = [
  /(?:画像|イメージ|写真).{0,16}(?:添付|貼|アップロード).{0,24}(?:解析|分析|説明|読|見)/u,
  /\b(?:attached|uploaded)\s+(?:image|picture|photo)\b.{0,32}\b(?:analy[sz]e|explain|read|inspect|look)\b/iu,
  /\b(?:analy[sz]e|explain|read|inspect|look)\b.{0,32}\b(?:attached|uploaded)\s+(?:image|picture|photo)\b/iu,
];

export function isSmalltalkPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return Boolean(text && SMALLTALK_ONLY_PATTERNS.some((pattern) => pattern.test(text)));
}

function isNoteAnswerPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return Boolean(text && NOTE_ANSWER_PATTERNS.some((pattern) => pattern.test(text)));
}

export function isDiagramGenerationPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || IMAGE_ATTACHMENT_ANALYSIS_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return DIAGRAM_GENERATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyTurnIntent(input: ClassifyTurnIntentInput): AgentTurnIntent {
  if (input.composeMode === "plan") {
    return { kind: "plan" };
  }
  if (isSmalltalkPrompt(input.prompt)) {
    return { kind: "smalltalk" };
  }
  if (isDiagramGenerationPrompt(input.prompt)) {
    return { kind: "diagram_generation" };
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
