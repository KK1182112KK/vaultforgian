import { basename } from "node:path";
import type { SupportedLocale } from "./i18n";

export type TurnSourceAcquisitionMode = "workspace_generic" | "attachment_source" | "note_source";

export interface NoteSourcePackEntry {
  label: string;
  path: string;
  content: string;
}

export interface NoteSourcePackDecisionParams {
  prompt: string;
  slashCommand: string | null;
  activeFilePath: string | null;
  targetNotePath: string | null;
  selectionSourcePath: string | null;
}

const NOTE_SOURCE_KEYWORDS = [
  /\bnote\b/iu,
  /\breader\b/iu,
  /\bstudy guide\b/iu,
  /\bproof sheet\b/iu,
  /\bimprove\b/iu,
  /\brewrite\b/iu,
  /\bedit\b/iu,
  /\bexpand\b/iu,
  /このノート/iu,
  /ノート/iu,
  /スタディガイド/iu,
  /study guide/iu,
  /reader/iu,
  /proof/iu,
  /導線/iu,
  /説明/iu,
  /内容/iu,
  /整え/iu,
  /改善/iu,
  /充実/iu,
  /追記/iu,
  /書き換え/iu,
];

const MAX_NOTE_SOURCE_CHARS_PER_NOTE = 12_000;
const MAX_NOTE_SOURCE_HEADINGS = 12;

function truncateNoteContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_NOTE_SOURCE_CHARS_PER_NOTE) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_NOTE_SOURCE_CHARS_PER_NOTE).trimEnd()}\n\n...[truncated for note source pack]`;
}

function extractMarkdownHeadings(content: string): string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => /^(#{1,6})\s+(.+)$/u.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .slice(0, MAX_NOTE_SOURCE_HEADINGS)
    .map((match) => `${match[1]} ${match[2]}`);
}

export function shouldAttachNoteSourcePack(params: NoteSourcePackDecisionParams): boolean {
  if (params.slashCommand === "/note") {
    return true;
  }
  if (!params.activeFilePath && !params.targetNotePath && !params.selectionSourcePath) {
    return false;
  }
  return NOTE_SOURCE_KEYWORDS.some((pattern) => pattern.test(params.prompt));
}

export function buildNoteSourcePackText(entries: readonly NoteSourcePackEntry[]): string | null {
  const usable = entries
    .map((entry) => ({
      ...entry,
      path: entry.path.trim(),
      content: truncateNoteContent(entry.content),
    }))
    .filter((entry) => entry.path.length > 0 && entry.content.length > 0);

  if (usable.length === 0) {
    return null;
  }

  return [
    "Note source pack:",
    ...usable.map((entry, index) => {
      const headings = extractMarkdownHeadings(entry.content);
      return [
        `${entry.label} ${index + 1}: ${entry.path}`,
        `Basename: ${basename(entry.path)}`,
        headings.length > 0 ? ["Headings:", ...headings.map((heading) => `- ${heading}`)].join("\n") : null,
        `\`\`\`md\n${entry.content}\n\`\`\``,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n\n");
    }),
  ].join("\n\n");
}

export interface SourceRuntimeOverlayParams {
  locale: SupportedLocale;
  sourceAcquisitionMode: TurnSourceAcquisitionMode;
  hasAttachmentContent: boolean;
  hasNoteSourcePack: boolean;
}

export function buildSourceRuntimeOverlayText(params: SourceRuntimeOverlayParams): string | null {
  if (params.sourceAcquisitionMode === "workspace_generic") {
    return null;
  }

  if (params.locale === "ja") {
    return [
      "Source runtime overlay:",
      params.hasAttachmentContent
        ? "- この turn では添付 source package がすでに揃っています。"
        : "- この turn では current/reference note の source pack がすでに揃っています。",
      "- source acquisition はこの turn では closed です。",
      "- shell や file-reading ツールで source を再取得しないでください。",
      "- ローカル読取の再試行、最小コマンド確認、sandbox 起動確認の実況は出さないでください。",
      "- 添付 source pack / note source pack を正本として、その内容に anchored に分析・改善提案・ノート修正案を返してください。",
    ].join("\n");
  }

  return [
    "Source runtime overlay:",
    params.hasAttachmentContent
      ? "- The attachment source package is already present for this turn."
      : "- The current/reference note source pack is already present for this turn.",
    "- Source acquisition is closed for this turn.",
    "- Do not re-acquire source files through shell or file-reading tools.",
    "- Do not emit local-read retry, minimal-command, or sandbox-bootstrap troubleshooting chatter.",
    "- Treat the attached source pack as canonical and stay anchored to it for analysis, revision suggestions, and note edits.",
  ].join("\n");
}
