import type { StudyRecipeWorkflowKind, StudyWorkflowKind } from "../model/types";
import type { SupportedLocale } from "./i18n";

export interface StudyWorkflowDefinition {
  kind: StudyWorkflowKind;
  label: string;
  shortLabel: string;
  description: string;
  helperText: string;
  attachRecommended: boolean;
  responseContract: readonly string[];
  sourcePriority: readonly string[];
  guidance: readonly string[];
  missingContextHint: string;
  composerPlaceholder: string;
  quickAction: string;
  promptLead: string;
  safeAutoSkillRefs: readonly string[];
}

export interface StudyWorkflowPromptContext {
  currentFilePath?: string | null;
  targetNotePath?: string | null;
  hasAttachments?: boolean;
  hasSelection?: boolean;
  pinnedContextCount?: number;
}

export function isStudyWorkflowKind(value: unknown): value is StudyWorkflowKind {
  return value === "lecture" || value === "review" || value === "paper" || value === "homework";
}

const DEFAULT_COMPOSER_PLACEHOLDER: Record<SupportedLocale, string> = {
  en: "Ask about your lecture, paper, homework, or notes...",
  ja: "講義、論文、宿題、ノートについて質問してください...",
};

const STUDY_WORKFLOW_TEXT: Record<SupportedLocale, Record<StudyWorkflowKind, Omit<StudyWorkflowDefinition, "kind" | "attachRecommended" | "safeAutoSkillRefs">>> = {
  en: {
    lecture: {
      label: "Lecture",
      shortLabel: "Lecture",
      description: "Turn lecture slides, notes, or handouts into a clear study-oriented breakdown.",
      helperText: "Keep the answer study-first: main topics, formulas, confusing points, and follow-up review tasks.",
      responseContract: ["Main topics", "Key concepts and formulas", "Confusing points or gaps", "Suggested follow-up notes or review tasks"],
      sourcePriority: ["attached lecture files and images", "current or reference note", "pinned context notes"],
      guidance: [
        "Teach from the material instead of giving a generic summary.",
        "Surface formulas, definitions, and prerequisite concepts when they materially affect understanding.",
        "If the available source is partial, say what is directly grounded in the source versus inferred.",
      ],
      missingContextHint: "Attach the lecture slides, handout, or source PDF for more reliable topic and formula extraction.",
      composerPlaceholder: "Ask about this lecture material...",
      quickAction: "Create a lecture study guide from the current material",
      promptLead: "Help me study this lecture material.",
    },
    review: {
      label: "Review",
      shortLabel: "Review",
      description: "Build a focused review session from the current note or pinned context.",
      helperText: "Prioritize what to review, identify weak spots, propose a short drill list, and point to the next source to reopen.",
      responseContract: [
        "What I should review first",
        "Weak spots or likely forgotten areas",
        "A short review checklist or drill list",
        "Next note set or source to reopen",
      ],
      sourcePriority: ["pinned context notes", "current or reference note"],
      guidance: [
        "Optimize for review sequencing and weak-spot detection, not broad explanation.",
        "Prefer concrete review drills and reopen targets over abstract advice.",
      ],
      missingContextHint: "Pin the note set you want reviewed to make the review order and weak-spot scan more reliable.",
      composerPlaceholder: "Plan a focused review from these notes...",
      quickAction: "Plan a focused review session from this note set",
      promptLead: "Help me run a review session over the current study context.",
    },
    paper: {
      label: "Paper",
      shortLabel: "Paper",
      description: "Read a paper deeply and extract claims, methods, results, and open questions.",
      helperText: "Separate direct paper claims from your inferences, and emphasize method, results, assumptions, and next questions.",
      responseContract: [
        "Research question and contribution",
        "Method overview",
        "Key results",
        "Important assumptions or limitations",
        "Questions worth investigating next",
      ],
      sourcePriority: ["attached paper PDF or figures", "current or reference note", "pinned context notes"],
      guidance: [
        "Keep direct source claims and your interpretation clearly separated.",
        "Call out assumptions, limitations, and open questions even when the user asks for a summary.",
        "When possible, anchor major points to the provided source material instead of paraphrasing loosely.",
      ],
      missingContextHint: "Attach the paper PDF or figures for source-grounded method and results extraction.",
      composerPlaceholder: "Ask about this paper's claims, method, or limitations...",
      quickAction: "Read the attached paper deeply",
      promptLead: "Help me read this paper deeply.",
    },
    homework: {
      label: "Homework",
      shortLabel: "Homework",
      description: "Work through an attached assignment or selected problem with explanation-first support.",
      helperText: "Restate the problem, list givens and unknowns, explain strategy before calculation, then walk through the reasoning.",
      responseContract: [
        "What the problem is asking",
        "A solution strategy before calculations",
        "Step-by-step reasoning",
        "Common mistakes to avoid",
      ],
      sourcePriority: ["selected problem statement", "attached homework sheet or images", "current or reference note", "pinned context notes"],
      guidance: [
        "State givens and unknowns before solving when the source provides them.",
        "Explain the plan before the calculation steps.",
        "Do not skip intermediate reasoning that changes the result or the method choice.",
      ],
      missingContextHint: "Attach the homework sheet or capture the exact problem statement first for reliable step-by-step help.",
      composerPlaceholder: "Work through this homework problem step by step...",
      quickAction: "Help me unpack this homework step by step",
      promptLead: "Help me work through this homework or problem set.",
    },
  },
  ja: {
    lecture: {
      label: "Lecture",
      shortLabel: "Lecture",
      description: "講義スライド、ノート、配布資料を学習向けに整理して読み解きます。",
      helperText: "主要トピック、公式、分かりにくい点、次の復習タスクを学習向けにまとめます。",
      responseContract: ["主要トピック", "重要な概念と公式", "分かりにくい点や抜け", "次に取るべきノート化や復習タスク"],
      sourcePriority: ["添付された講義ファイルや画像", "現在または参照ノート", "固定した context ノート"],
      guidance: [
        "単なる要約ではなく、資料から学べる形で教えること。",
        "理解に効く公式、定義、前提概念は明示すること。",
        "資料が部分的なときは、資料に直接根拠がある内容と推論を分けること。",
      ],
      missingContextHint: "トピックや公式をより確実に抽出したいなら、講義スライドや handout、元 PDF を添付してください。",
      composerPlaceholder: "この講義資料について聞く...",
      quickAction: "現在の資料から講義の study guide を作って",
      promptLead: "この講義資料を勉強できるように手伝ってください。",
    },
    review: {
      label: "Review",
      shortLabel: "Review",
      description: "現在のノートや固定 context から集中した復習セッションを組み立てます。",
      helperText: "何を先に復習すべきか、弱点、短い drill list、次に開くべき資料を優先して返します。",
      responseContract: ["最初に復習すべきこと", "弱点や忘れていそうな箇所", "短い復習チェックリストや drill list", "次に開くべきノートや資料"],
      sourcePriority: ["固定した context ノート", "現在または参照ノート"],
      guidance: [
        "広い説明より、復習順と弱点検出を優先すること。",
        "抽象的な助言ではなく、具体的な drill と reopen target を優先すること。",
      ],
      missingContextHint: "復習順と弱点検出の精度を上げるには、復習したいノート群を pin してください。",
      composerPlaceholder: "このノート群から復習を計画する...",
      quickAction: "このノート集合から復習セッションを計画して",
      promptLead: "現在の学習 context をもとに復習セッションを組み立ててください。",
    },
    paper: {
      label: "Paper",
      shortLabel: "Paper",
      description: "論文を深く読み、claim、method、result、open question を抽出します。",
      helperText: "論文の直接 claim と推論を分け、method、result、assumption、next question を重視します。",
      responseContract: ["研究課題と貢献", "手法の概要", "主要結果", "重要な仮定や limitation", "次に掘るべき質問"],
      sourcePriority: ["添付した論文 PDF や figure", "現在または参照ノート", "固定した context ノート"],
      guidance: [
        "論文の直接 claim とあなたの解釈を明確に分けること。",
        "要約依頼でも assumption、limitation、open question を必ず拾うこと。",
        "可能な限り、主要点は添付された source に anchor して述べること。",
      ],
      missingContextHint: "method と result を source に根ざして読みたいなら、論文 PDF や figure を添付してください。",
      composerPlaceholder: "この論文の claim、method、limitation について聞く...",
      quickAction: "添付した論文を深く読んで",
      promptLead: "この論文を深く読むのを手伝ってください。",
    },
    homework: {
      label: "Homework",
      shortLabel: "Homework",
      description: "添付した課題や選択した問題を explanation-first で解き進めます。",
      helperText: "問題の言い換え、既知と未知、計算前の方針、段階的な reasoning を返します。",
      responseContract: ["問題が何を求めているか", "計算前の解法方針", "段階的な reasoning", "避けるべき典型ミス"],
      sourcePriority: ["選択した問題文", "添付した課題シートや画像", "現在または参照ノート", "固定した context ノート"],
      guidance: [
        "source にある既知量と未知量は解く前に整理すること。",
        "計算手順の前に解法の方針を説明すること。",
        "結果や手法選択に関わる中間 reasoning は省略しないこと。",
      ],
      missingContextHint: "step-by-step の精度を上げるには、課題シートを添付するか、正確な問題文を先に取り込んでください。",
      composerPlaceholder: "この宿題を順を追って解く...",
      quickAction: "この宿題を順を追って解きほぐして",
      promptLead: "この宿題や問題セットを一緒に解いてください。",
    },
  },
};

const STUDY_WORKFLOW_BASE = {
  lecture: { attachRecommended: true, safeAutoSkillRefs: [] },
  review: { attachRecommended: false, safeAutoSkillRefs: [] },
  paper: { attachRecommended: true, safeAutoSkillRefs: [] },
  homework: { attachRecommended: true, safeAutoSkillRefs: [] },
} as const;

function buildContextLines(context: StudyWorkflowPromptContext, locale: SupportedLocale): string[] {
  return [
    context.currentFilePath ? (locale === "ja" ? `現在のノート: ${context.currentFilePath}` : `Current note: ${context.currentFilePath}`) : null,
    context.targetNotePath && context.targetNotePath !== context.currentFilePath
      ? locale === "ja"
        ? `参照ノート: ${context.targetNotePath}`
        : `Reference note: ${context.targetNotePath}`
      : null,
    context.hasSelection ? (locale === "ja" ? "この conversation には選択範囲がすでに添付されています。" : "A selection is already attached in this conversation.") : null,
    context.hasAttachments ? (locale === "ja" ? "この conversation には添付ファイルがあります。" : "Attached files are available in this conversation.") : null,
    typeof context.pinnedContextCount === "number" && context.pinnedContextCount > 0
      ? locale === "ja"
        ? `固定した context ノート: ${context.pinnedContextCount}`
        : `Pinned context notes: ${context.pinnedContextCount}`
      : null,
  ].filter((line): line is string => Boolean(line));
}

export function getStudyWorkflowCatalog(locale: SupportedLocale = "en"): readonly StudyWorkflowDefinition[] {
  return (["lecture", "review", "paper", "homework"] as const).map((kind) => ({
    kind,
    ...STUDY_WORKFLOW_BASE[kind],
    ...STUDY_WORKFLOW_TEXT[locale][kind],
  }));
}

export function getStudyWorkflowDefinition(kind: StudyWorkflowKind, locale: SupportedLocale = "en"): StudyWorkflowDefinition {
  const workflow = getStudyWorkflowCatalog(locale).find((entry) => entry.kind === kind);
  if (!workflow) {
    throw new Error(`Unknown study workflow: ${kind}`);
  }
  return workflow;
}

export function getStudyRecipeWorkflowLabel(workflow: StudyRecipeWorkflowKind, locale: SupportedLocale = "en"): string {
  return workflow === "custom" ? (locale === "ja" ? "カスタム" : "Custom") : getStudyWorkflowDefinition(workflow, locale).label;
}

export function getStudyWorkflowComposerPlaceholder(kind: StudyWorkflowKind | null | undefined, locale: SupportedLocale = "en"): string {
  return kind ? getStudyWorkflowDefinition(kind, locale).composerPlaceholder : DEFAULT_COMPOSER_PLACEHOLDER[locale];
}

export function getStudyWorkflowQuickAction(kind: StudyWorkflowKind, locale: SupportedLocale = "en"): string {
  return getStudyWorkflowDefinition(kind, locale).quickAction;
}

export function getStudyWorkflowMissingContextHint(
  kind: StudyWorkflowKind,
  context: StudyWorkflowPromptContext = {},
  locale: SupportedLocale = "en",
): string | null {
  const hasCurrentContext = Boolean(context.currentFilePath || context.targetNotePath);
  const hasPinnedContext = (context.pinnedContextCount ?? 0) > 0;
  const definition = getStudyWorkflowDefinition(kind, locale);

  if (kind === "lecture") {
    return context.hasAttachments ? null : definition.missingContextHint;
  }

  if (kind === "review") {
    return hasPinnedContext || hasCurrentContext ? null : definition.missingContextHint;
  }

  if (kind === "paper") {
    return context.hasAttachments ? null : definition.missingContextHint;
  }

  if (context.hasSelection || context.hasAttachments) {
    return null;
  }
  return hasCurrentContext
    ? locale === "ja"
      ? "解法を問題文に密着させたいなら、正確な問題文を取り込むか課題シートを添付してください。"
      : "Capture the exact problem statement or attach the assignment sheet if you want the solution steps to stay tightly grounded."
    : definition.missingContextHint;
}

export function buildStudyWorkflowDraft(
  kind: StudyWorkflowKind,
  context: StudyWorkflowPromptContext = {},
  locale: SupportedLocale = "en",
): string {
  const definition = getStudyWorkflowDefinition(kind, locale);
  const contextLines = buildContextLines(context, locale);
  const header = contextLines.length > 0 ? `${contextLines.join("\n")}\n\n` : "";
  const produceLabel = locale === "ja" ? "出力:" : "Produce:";
  return `${header}${definition.promptLead}\n\n${produceLabel}\n${definition.responseContract.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
}

export function buildStudyWorkflowRuntimeBrief(
  kind: StudyWorkflowKind,
  context: StudyWorkflowPromptContext = {},
  locale: SupportedLocale = "en",
): string {
  const definition = getStudyWorkflowDefinition(kind, locale);
  const missingHint = getStudyWorkflowMissingContextHint(kind, context, locale);
  const contextLines = buildContextLines(context, locale);

  return [
    locale === "ja" ? `現在の study workflow: ${definition.label}` : `Active study workflow: ${definition.label}`,
    locale === "ja" ? `Workflow の目的: ${definition.helperText}` : `Workflow objective: ${definition.helperText}`,
    contextLines.length > 0
      ? locale === "ja"
        ? `Workflow context:\n${contextLines.map((line) => `- ${line}`).join("\n")}`
        : `Workflow context:\n${contextLines.map((line) => `- ${line}`).join("\n")}`
      : null,
    locale === "ja" ? `優先する source 順: ${definition.sourcePriority.join(" -> ")}` : `Preferred source order: ${definition.sourcePriority.join(" -> ")}`,
    locale === "ja"
      ? "推奨 source が一部なくても、現在利用できる context で回答してください。"
      : "Use the currently available context to answer even if some recommended source material is missing.",
    missingHint ? (locale === "ja" ? `不足していて価値が高い context: ${missingHint}` : `Highest-value missing context: ${missingHint}`) : null,
    locale === "ja" ? "期待する出力:" : "Response contract:",
    ...definition.responseContract.map((item) => `- ${item}`),
    locale === "ja" ? "Workflow 固有ガイダンス:" : "Workflow-specific guidance:",
    ...definition.guidance.map((item) => `- ${item}`),
  ]
    .filter(Boolean)
    .join("\n");
}
