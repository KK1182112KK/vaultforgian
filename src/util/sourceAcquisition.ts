import type { TFile } from "obsidian";
import type { SupportedLocale } from "./i18n";

export type SourceAcquisitionMode = "workspace_generic" | "paper_attachment" | "vault_note" | "external_bundle";

export interface VaultNoteSourceEntry {
  path: string;
  role: string;
  content: string;
}

export interface BuildVaultNoteSourcePackOptions {
  locale: SupportedLocale;
  maxCharsPerNote?: number;
  priorityTerms?: string[];
}

const DEFAULT_SINGLE_NOTE_MAX_CHARS = 160_000;
const DEFAULT_MULTI_NOTE_MAX_CHARS = 80_000;

function extractFrontmatterLines(content: string): string[] {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(content.trimStart());
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !line.startsWith("#"))
    .slice(0, 10);
}

interface NoteSection {
  heading: string;
  text: string;
}

function truncateNoteContentWithHeadAndTail(content: string, maxChars: number): string {
  const omissionMarker = "\n\n...[omitted middle of note]...\n\n";
  const headChars = Math.max(1, Math.floor((maxChars - omissionMarker.length) * 0.7));
  const tailChars = Math.max(1, maxChars - omissionMarker.length - headChars);
  const head = content.slice(0, headChars).trimEnd();
  const tail = content.slice(Math.max(0, content.length - tailChars)).trimStart();
  return `${head}${omissionMarker}${tail}`.trim();
}

function buildHeadingSections(lines: string[], headings: Array<{ line: string; index: number }>): NoteSection[] {
  const sections: NoteSection[] = [];
  for (const [index, heading] of headings.entries()) {
    const nextHeadingIndex = headings[index + 1]?.index ?? lines.length;
    sections.push({
      heading: heading.line.trim(),
      text: lines.slice(heading.index, nextHeadingIndex).join("\n").trim(),
    });
  }
  return sections;
}

function renderSelectedSections(sections: NoteSection[], selected: ReadonlySet<number>): string {
  const blocks: string[] = [];
  let previousIndex: number | null = null;
  for (const [index, section] of sections.entries()) {
    if (!selected.has(index)) {
      continue;
    }
    if (previousIndex !== null && index - previousIndex > 1) {
      blocks.push("...[omitted sections]...");
    }
    blocks.push(section.text);
    previousIndex = index;
  }
  return blocks.join("\n\n").trim();
}

function scoreSection(
  section: NoteSection,
  index: number,
  totalSections: number,
  priorityTerms: readonly string[],
): number {
  let score = 0;
  if (index === 0) {
    score += 100;
  }
  if (index === totalSections - 1) {
    score += 90;
  }
  if (/^#\s/u.test(section.heading)) {
    score += 30;
  } else if (/^##\s/u.test(section.heading)) {
    score += 20;
  }
  const haystack = `${section.heading}\n${section.text}`.toLowerCase();
  score += priorityTerms.filter((term) => haystack.includes(term)).length * 50;
  return score;
}

function truncateNoteContent(content: string, maxChars: number, priorityTerms: readonly string[] = []): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  const lines = trimmed.split(/\r?\n/u);
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^(#{1,6})\s+\S/u.test(line.trim()));
  const normalizedPriorityTerms = [...new Set(priorityTerms.map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 3))];

  if (headings.length === 0) {
    return truncateNoteContentWithHeadAndTail(trimmed, maxChars);
  }

  const sections = buildHeadingSections(lines, headings);
  const selected = new Set<number>([0, sections.length - 1]);
  for (const [index, section] of sections.entries()) {
    const haystack = `${section.heading}\n${section.text}`.toLowerCase();
    if (normalizedPriorityTerms.some((term) => haystack.includes(term))) {
      selected.add(index);
    }
  }

  let excerpt = renderSelectedSections(sections, selected);
  const scoredSections = sections
    .map((section, index) => ({
      index,
      score: scoreSection(section, index, sections.length, normalizedPriorityTerms),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  for (const candidate of scoredSections) {
    if (selected.has(candidate.index)) {
      continue;
    }
    const nextSelected = new Set(selected);
    nextSelected.add(candidate.index);
    const nextExcerpt = renderSelectedSections(sections, nextSelected);
    if (nextExcerpt.length > maxChars) {
      continue;
    }
    selected.add(candidate.index);
    excerpt = nextExcerpt;
  }

  if (excerpt.length > maxChars) {
    return truncateNoteContentWithHeadAndTail(trimmed, maxChars);
  }
  return `${excerpt}\n\n...[truncated for note source pack]`;
}

function buildCoverageLine(content: string, maxChars: number): string {
  const trimmedLength = content.trim().length;
  if (trimmedLength <= maxChars) {
    return `Coverage: full note body (${trimmedLength} chars)`;
  }
  return `Coverage: excerpted note sections within ${maxChars} chars of ${trimmedLength}`;
}

function extractHeadings(content: string): string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^(#{1,6})\s+\S/u.test(line))
    .slice(0, 12);
}

export function extractSourcePackPriorityTerms(prompt: string, maxTerms = 8): string[] {
  return [
    ...new Set(
      prompt
        .toLowerCase()
        .split(/[^\p{L}\p{N}_/-]+/u)
        .map((term) => term.trim())
        .filter((term) => (hasCompactScriptTerm(term) ? term.length > 0 : term.length >= 3)),
    ),
  ].slice(0, maxTerms);
}

function hasCompactScriptTerm(term: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(term);
}

export function buildVaultNoteSourcePackText(
  entries: readonly VaultNoteSourceEntry[],
  options: BuildVaultNoteSourcePackOptions,
): string | null {
  const maxCharsPerNote =
    options.maxCharsPerNote ??
    (entries.length <= 1 ? DEFAULT_SINGLE_NOTE_MAX_CHARS : DEFAULT_MULTI_NOTE_MAX_CHARS);
  const usable = entries
    .map((entry) => ({
      path: entry.path.trim(),
      role: entry.role.trim(),
      content: truncateNoteContent(entry.content, maxCharsPerNote, options.priorityTerms ?? []),
      coverage: buildCoverageLine(entry.content, maxCharsPerNote),
      headings: extractHeadings(entry.content),
      frontmatterLines: extractFrontmatterLines(entry.content),
    }))
    .filter((entry) => entry.path.length > 0 && entry.content.length > 0);

  if (usable.length === 0) {
    return null;
  }

  const title = options.locale === "ja" ? "Vault note source pack:" : "Vault note source pack:";
  return [
    title,
    ...usable.map((entry) =>
      [
        `${entry.role}: ${entry.path}`,
        entry.coverage,
        entry.frontmatterLines.length > 0
          ? `Frontmatter summary:\n${entry.frontmatterLines.map((line) => `- ${line}`).join("\n")}`
          : null,
        entry.headings.length > 0 ? `Outline:\n${entry.headings.map((heading) => `- ${heading}`).join("\n")}` : null,
        `\`\`\`md\n${entry.content}\n\`\`\``,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n\n"),
    ),
  ].join("\n\n");
}

export interface SourceAcquisitionContractParams {
  locale: SupportedLocale;
  mode: SourceAcquisitionMode;
  hasSourcePackage: boolean;
}

export function buildSourceAcquisitionContractText(params: SourceAcquisitionContractParams): string | null {
  if (params.mode === "workspace_generic") {
    return null;
  }

  if (params.mode === "paper_attachment" && params.hasSourcePackage) {
    return params.locale === "ja"
      ? [
          "Source acquisition contract:",
          "- この turn では添付 source package を正本として使ってください。",
          "- source の再取得、最小コマンド再試行、shell bootstrap 調査を会話に出さないでください。",
        ].join("\n")
      : [
          "Source acquisition contract:",
          "- Use the attached source package as the canonical source for this turn.",
          "- Do not narrate source reacquisition, minimal-command retries, or shell bootstrap troubleshooting.",
        ].join("\n");
  }

  if (params.mode === "vault_note" && params.hasSourcePackage) {
    return params.locale === "ja"
      ? [
          "Source acquisition contract:",
          "- この turn には vault note source pack が添付されています。これを一次資料として使ってください。",
          "- ノート本文の再読込や shell/file-read の再試行を会話に出さないでください。",
          "- この turn では shell や file-reading ツールでノート本文を再取得しないでください。",
          "- ノート改善依頼では、再読込ログではなく改善内容か `obsidian-patch` を返してください。",
          "- user request にローカル path や source bundle の文字列が含まれていても、note source pack が既に揃っている限りそれを優先してください。",
          "- source pack が部分的でも、その範囲を明示して改善案か編集案を返してください。",
        ].join("\n")
      : [
          "Source acquisition contract:",
          "- A vault note source pack is attached for this turn. Use it as the primary source.",
          "- Do not narrate note re-reads or shell/file-read retries.",
          "- Do not call shell or file-reading tools to reacquire the note body in this turn.",
          "- For note-improvement requests, return the improvement itself or an `obsidian-patch`, not a note-reopen plan.",
          "- Even if the user request mentions local paths or a source bundle, prefer the attached note source pack when it already covers the note.",
          "- If the source pack is partial, state the boundary and continue with the requested edit/improvement.",
        ].join("\n");
  }

  if (params.mode === "external_bundle") {
    return params.locale === "ja"
      ? [
          "Source acquisition contract:",
          "- source bundle path は provenance として添付されています。",
          "- runtime が読める場合だけ一度アクセスし、読めない場合は短い失敗メッセージで止めてください。",
          "- 『最小コマンドで確認します』『sandbox 初期化エラーです』のような troubleshooting chatter は出さないでください。",
        ].join("\n")
      : [
          "Source acquisition contract:",
          "- A source bundle path is attached as provenance for this turn.",
          "- Access it once only if the runtime can read it. If not, stop with a concise failure message.",
          "- Do not emit troubleshooting chatter such as 'I will try a minimal command' or 'sandbox initialization failed'.",
        ].join("\n");
  }

  return null;
}

export function sanitizeExecutionPrompt(prompt: string, externalSourcePaths: readonly string[]): string {
  let sanitized = prompt;
  for (const sourcePath of externalSourcePaths) {
    if (!sourcePath.trim()) {
      continue;
    }
    sanitized = sanitized.split(sourcePath).join("[external source path attached separately]");
  }
  return sanitized.replace(/\s+/gu, " ").trim();
}

export function dedupeNoteFiles(entries: readonly { file: TFile; role: string }[]): Array<{ file: TFile; role: string }> {
  const byPath = new Map<string, { file: TFile; role: string }>();
  for (const entry of entries) {
    const existing = byPath.get(entry.file.path);
    if (existing) {
      existing.role = `${existing.role}, ${entry.role}`;
      continue;
    }
    byPath.set(entry.file.path, { ...entry });
  }
  return [...byPath.values()];
}
