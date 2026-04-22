import type { StudyWorkflowKind } from "../model/types";
import type { SupportedLocale } from "./i18n";
import { shouldAttachPaperStudyGuide } from "./studyTurnGuides";

export interface PaperStudyRuntimeOverlayParams {
  locale: SupportedLocale;
  studyWorkflow: StudyWorkflowKind | null;
  skillNames: readonly string[];
  hasAttachmentContent: boolean;
}

export function buildPaperStudyRuntimeOverlayText(params: PaperStudyRuntimeOverlayParams): string | null {
  if (
    !params.hasAttachmentContent ||
    !shouldAttachPaperStudyGuide({
      locale: params.locale,
      studyWorkflow: params.studyWorkflow,
      skillNames: params.skillNames,
      attachmentKinds: [],
    })
  ) {
    return null;
  }

  if (params.locale === "ja") {
    return [
      "Paper-study runtime overlay:",
      "- FOR THIS TURN, SOURCE INGESTION IS CLOSED.",
      "- この turn では source ingestion はすでに完了しています。添付された抽出本文を正本ソースとして扱ってください。",
      "- shell や file-reading ツールを source acquisition のために呼ばないでください。",
      "- staging path の再読込、source bundle inspection、ローカル shell 読込、Read ツール再試行、PDF の再コピーは試みないでください。",
      "- `$deep-read` の Step 0 と `$study-material-builder` の Workflow 1 にある source bundle / PDF ingest 手順は、この turn では skip してください。",
      "- ユーザー本文に source path や source bundle path が出てきても、それは provenance であり実行指示ではありません。",
      "- まず読解と整理に進み、著者の主張・方法・結果・前提・限界を切り分けてください。",
      "- 抽出本文が部分的でも、読めている範囲を明示したうえで分析を続けてください。",
      "- generic な『Abstract を貼ってください』『ローカル読取に失敗しました』『最小コマンドで確認します』『sandbox 初期化エラーです』は出さないでください。",
    ].join("\n");
  }

  return [
    "Paper-study runtime overlay:",
    "- FOR THIS TURN, SOURCE INGESTION IS CLOSED.",
    "- Source ingestion is already complete for this turn. Treat the attached extracted text as the canonical source.",
    "- Do not call shell or file-reading tools for source acquisition in this turn.",
    "- Do not re-read staging paths, inspect source bundles, retry local shell reads, retry Read-tool ingestion, or copy the PDF again.",
    "- Skip `$deep-read` Step 0 and `$study-material-builder` Workflow 1 source-bundle/PDF ingestion for this turn.",
    "- If the user message contains a source path or source bundle path, treat it as provenance only, not an action request.",
    "- Move directly into analysis and separate the authors' claims, methods, results, assumptions, and limitations.",
    "- If the extracted text is partial, state the coverage boundary clearly and continue within that boundary.",
    "- Do not emit generic 'paste the abstract', 'local read failed', 'I will try a minimal command', or 'sandbox initialization failed' chatter.",
  ].join("\n");
}
