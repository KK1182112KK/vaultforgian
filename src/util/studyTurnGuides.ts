import type { ComposerAttachmentKind, StudyWorkflowKind } from "../model/types";
import type { SupportedLocale } from "./i18n";

const PAPER_STUDY_SKILLS = new Set(["deep-read", "study-material-builder", "deep-research"]);

export interface PaperStudyGuideParams {
  locale: SupportedLocale;
  studyWorkflow: StudyWorkflowKind | null;
  skillNames: readonly string[];
  attachmentKinds: readonly ComposerAttachmentKind[];
}

export function isPaperStudySkillName(skillName: string): boolean {
  return PAPER_STUDY_SKILLS.has(skillName.trim());
}

export function shouldAttachPaperStudyGuide(params: Omit<PaperStudyGuideParams, "locale"> & { locale?: SupportedLocale }): boolean {
  if (params.studyWorkflow === "paper") {
    return true;
  }
  return params.skillNames.some((skillName) => isPaperStudySkillName(skillName));
}

export function buildPaperStudyGuideText(params: PaperStudyGuideParams): string | null {
  if (!shouldAttachPaperStudyGuide(params)) {
    return null;
  }

  const hasPdfAttachment = params.attachmentKinds.includes("pdf");
  if (params.locale === "ja") {
    return [
      "Paper study guide:",
      hasPdfAttachment
        ? "- 添付された PDF / 抽出テキストを最優先のソースとして扱ってください。"
        : "- この turn で与えられたソース本文を最優先で扱ってください。",
      "- 出力は最低でも `著者の主張` / `方法` / `主要結果` / `仮定と限界` / `こちらの解釈` / `まだ言えないこと` に分けてください。",
      "- 著者が直接述べていることと、こちらがそこから推論したことを必ず分けてください。",
      "- 添付本文がある場合、generic な『Abstract を貼ってください』や『ローカル読取に失敗しました』には逃げないでください。",
      "- ソースが部分的なら、その範囲に anchored な内容だけを述べ、推測部分は明示してください。",
    ].join("\n");
  }

  return [
    "Paper study guide:",
    hasPdfAttachment
      ? "- Treat the attached PDF or extracted text as the primary source for this turn."
      : "- Treat the provided source text for this turn as the primary source.",
    "- Structure the answer at minimum as `authors' claims` / `methods` / `main results` / `assumptions and limitations` / `our interpretation` / `what does not follow yet`.",
    "- Keep direct author claims separate from our inference.",
    "- When attached source text is already present, do not fall back to generic 'paste the abstract' or 'local read failed' instructions.",
    "- If the source is partial, stay anchored to the available text and mark inference explicitly.",
  ].join("\n");
}
