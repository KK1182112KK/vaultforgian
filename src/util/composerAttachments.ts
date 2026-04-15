import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type {
  ComposerAttachment,
  ComposerAttachmentInput,
  ComposerAttachmentKind,
  ComposerAttachmentSource,
} from "../model/types";

const TEXT_LIKE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".m",
  ".markdown",
  ".md",
  ".mdx",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const TEXT_LIKE_MIME_PREFIXES = ["text/"];
const TEXT_LIKE_MIME_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/sql",
  "application/xml",
]);

export const DEFAULT_ATTACHMENT_PROMPT = "Analyze the attached image(s) and file(s) and answer based on them.";
export const DEFAULT_SELECTION_AND_ATTACHMENT_PROMPT = "Analyze the selected text together with the attached image(s) and file(s).";
const DEFAULT_ATTACHMENT_CONTENT_MAX_CHARS = 160_000;
const DEFAULT_ATTACHMENT_CONTENT_MAX_CHARS_PER_FILE = 120_000;
const MAX_ATTACHMENT_CONTENT_CHARS = 160_000;
const MAX_ATTACHMENT_CONTENT_CHARS_PER_FILE = 120_000;
export const PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS = 240_000;
export const PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS_PER_FILE = 200_000;
const PDF_TOTAL_PAGES_PATTERN = /- Total pages:\s*(\d+)/i;
const PDF_PAGE_MARKER_PATTERN = /\[Page\s+(\d+)\s+of\s+(\d+)\]/gi;
const PDF_EXTRACTION_CACHE_VERSION = 1;
const ATTACHMENT_STAGE_ROOT_SEGMENTS = [".obsidian", "plugins", "obsidian-codex-study", ".staging"] as const;

interface PdfExtractionCacheEntry {
  version: number;
  sourceSize: number;
  sourceMtimeMs: number;
  sourceHash: string;
  displayName: string;
  totalPages: number;
  text: string;
  extractedAt: number;
}

function sanitizeFileName(name: string): string {
  const base = basename(name).trim() || "attachment";
  const sanitized = base.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_");
  return sanitized.slice(0, 120) || "attachment";
}

function toVaultRelativePath(vaultRoot: string, absolutePath: string): string {
  return relative(vaultRoot, absolutePath).replace(/\\/g, "/");
}

function resolveVaultPath(vaultRoot: string, relativePath: string): string {
  return join(vaultRoot, ...relativePath.split("/"));
}

export function resolveComposerAttachmentStageRoot(vaultRoot: string): string {
  return join(vaultRoot, ...ATTACHMENT_STAGE_ROOT_SEGMENTS);
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && relativePath !== "..");
}

function isManagedAttachmentPathCandidate(vaultRoot: string, candidate: string): boolean {
  const normalizedCandidate = candidate.trim();
  if (!normalizedCandidate) {
    return false;
  }
  return isPathWithinRoot(resolveComposerAttachmentStageRoot(vaultRoot), normalizedCandidate);
}

async function resolveManagedAttachmentPath(vaultRoot: string, candidate: string): Promise<string | null> {
  if (!isManagedAttachmentPathCandidate(vaultRoot, candidate)) {
    return null;
  }

  const stageRoot = resolveComposerAttachmentStageRoot(vaultRoot);
  try {
    const [resolvedRoot, resolvedCandidate] = await Promise.all([fs.realpath(stageRoot), fs.realpath(candidate)]);
    if (!isPathWithinRoot(resolvedRoot, resolvedCandidate)) {
      return null;
    }
  } catch {
    // Fall back to the lexical boundary check when the path does not exist yet.
  }

  return candidate;
}

function isPdfAttachment(name: string, mimeType: string | null): boolean {
  return mimeType === "application/pdf" || extname(name).toLowerCase() === ".pdf";
}

export function isImageAttachment(name: string, mimeType: string | null): boolean {
  return mimeType?.startsWith("image/") === true || [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"].includes(extname(name).toLowerCase());
}

export function inferComposerAttachmentKind(name: string, mimeType: string | null): ComposerAttachmentKind {
  if (isImageAttachment(name, mimeType)) {
    return "image";
  }
  if (isPdfAttachment(name, mimeType)) {
    return "pdf";
  }
  return "file";
}

export function isTextLikeAttachment(name: string, mimeType: string | null): boolean {
  const normalizedMime = mimeType?.toLowerCase() ?? null;
  if (normalizedMime && (TEXT_LIKE_MIME_TYPES.has(normalizedMime) || TEXT_LIKE_MIME_PREFIXES.some((prefix) => normalizedMime.startsWith(prefix)))) {
    return true;
  }
  return TEXT_LIKE_EXTENSIONS.has(extname(name).toLowerCase());
}

export function formatExtractedPdfText(
  pageTexts: readonly { pageNumber: number; text: string }[],
  totalPages: number,
  displayName?: string,
): string | null {
  const normalizedPages = pageTexts
    .map(({ pageNumber, text }) => {
      const normalizedText = text.replace(/\u0000/g, "").trim();
      if (!normalizedText) {
        return null;
      }
      return [`[Page ${pageNumber} of ${totalPages}]`, normalizedText].join("\n");
    })
    .filter((entry): entry is string => Boolean(entry));

  if (!normalizedPages.length) {
    return null;
  }

  const metadata = [
    "PDF extraction metadata:",
    displayName ? `- File: ${displayName}` : null,
    `- Total pages: ${totalPages}`,
    `- Extracted text pages: ${normalizedPages.length}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return [metadata, ...normalizedPages].join("\n\n");
}

function summarizePdfChunkCoverage(text: string): string | null {
  const totalPagesMatch = text.match(PDF_TOTAL_PAGES_PATTERN);
  const totalPages = totalPagesMatch ? Number(totalPagesMatch[1]) : null;
  const pageNumbers = [...new Set(
    [...text.matchAll(PDF_PAGE_MARKER_PATTERN)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value)),
  )].sort((left, right) => left - right);

  const formatPageRanges = (pages: readonly number[]): string => {
    const ranges: string[] = [];
    let rangeStart = pages[0] ?? null;
    let previous = pages[0] ?? null;
    for (let index = 1; index <= pages.length; index += 1) {
      const current = pages[index] ?? null;
      if (current !== null && previous !== null && current === previous + 1) {
        previous = current;
        continue;
      }
      if (rangeStart !== null && previous !== null) {
        ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
      }
      rangeStart = current;
      previous = current;
    }
    return ranges.join(", ");
  };

  if (pageNumbers.length > 0 && totalPages) {
    return pageNumbers.length === 1
      ? `[Attached excerpt includes page ${pageNumbers[0]} of ${totalPages}.]`
      : `[Attached excerpt includes pages ${formatPageRanges(pageNumbers)} of ${totalPages}.]`;
  }

  if (totalPages) {
    return `[This PDF has ${totalPages} pages in total.]`;
  }

  return null;
}

async function extractPdfText(bytes: Uint8Array, displayName?: string): Promise<string | null> {
  try {
    type PdfLoadingTask = { promise: Promise<any>; destroy?: () => Promise<void> | void };
    type PdfJsLike = { getDocument?: (options: unknown) => PdfLoadingTask };
    const runtimeRequire = typeof require === "function" ? require : null;
    const obsidianModule = runtimeRequire ? ((runtimeRequire("obsidian") as { loadPdfJs?: () => Promise<unknown> }) ?? null) : null;
    const pdfjsLib: PdfJsLike | null =
      ((obsidianModule?.loadPdfJs ? await obsidianModule.loadPdfJs() : null) as PdfJsLike | null) ??
      (globalThis as { pdfjsLib?: PdfJsLike }).pdfjsLib ??
      null;
    if (!pdfjsLib?.getDocument) {
      return null;
    }

    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    const document = await loadingTask.promise;

    try {
      const pageTexts: Array<{ pageNumber: number; text: string }> = [];
      for (let pageNumber = 1; pageNumber <= (document.numPages ?? 0); pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const pageText = (Array.isArray(content?.items) ? content.items : [])
            .map((item: unknown) => {
              const value = typeof item === "object" && item !== null && "str" in item ? (item as { str?: unknown }).str : "";
              return typeof value === "string" ? value : "";
            })
            .filter((value: string) => value.trim().length > 0)
            .join(" ");
          if (pageText) {
            pageTexts.push({
              pageNumber,
              text: pageText,
            });
          }
        } finally {
          page.cleanup?.();
        }
      }

      return formatExtractedPdfText(pageTexts, document.numPages ?? pageTexts.length, displayName);
    } finally {
      await document.destroy?.();
      await loadingTask.destroy?.();
    }
  } catch (error) {
    console.warn("[obsidian-codex-study] PDF text extraction failed; falling back to raw PDF attachment.", error);
    return null;
  }
}

export function buildPdfExtractionCachePath(stagedPath: string): string {
  return `${stagedPath}.pdf-cache.json`;
}

async function readPdfExtractionText(vaultRoot: string, stagedPath: string, displayName: string): Promise<{ text: string | null; missingSource: boolean }> {
  const managedSourcePath = await resolveManagedAttachmentPath(vaultRoot, stagedPath);
  if (!managedSourcePath) {
    return { text: null, missingSource: true };
  }
  const cachePath = buildPdfExtractionCachePath(managedSourcePath);
  const managedCachePath = await resolveManagedAttachmentPath(vaultRoot, cachePath);
  let sourceStat;
  try {
    sourceStat = await fs.stat(managedSourcePath);
  } catch {
    return { text: null, missingSource: true };
  }

  try {
    const bytes = await fs.readFile(managedSourcePath);
    const sourceHash = createHash("sha1").update(bytes).digest("hex");
    if (managedCachePath) {
      try {
        const cachedRaw = await fs.readFile(managedCachePath, "utf8");
        const cached = JSON.parse(cachedRaw) as Partial<PdfExtractionCacheEntry>;
        if (
          cached.version === PDF_EXTRACTION_CACHE_VERSION &&
          typeof cached.text === "string" &&
          cached.text.trim() &&
          typeof cached.sourceSize === "number" &&
          typeof cached.sourceMtimeMs === "number" &&
          typeof cached.sourceHash === "string" &&
          cached.sourceSize === sourceStat.size &&
          cached.sourceMtimeMs === sourceStat.mtimeMs &&
          cached.sourceHash === sourceHash
        ) {
          return { text: cached.text, missingSource: false };
        }
      } catch {
        // ignore stale or missing cache and rebuild from the raw PDF
      }
    }

    const text = await extractPdfText(bytes, displayName);
    if (!text) {
      return { text: null, missingSource: false };
    }
    const totalPagesMatch = text.match(PDF_TOTAL_PAGES_PATTERN);
    const totalPages = totalPagesMatch ? Number(totalPagesMatch[1]) : 0;
    const cacheEntry: PdfExtractionCacheEntry = {
      version: PDF_EXTRACTION_CACHE_VERSION,
      sourceSize: sourceStat.size,
      sourceMtimeMs: sourceStat.mtimeMs,
      sourceHash,
      displayName,
      totalPages,
      text,
      extractedAt: Date.now(),
    };
    if (managedCachePath) {
      await fs.writeFile(managedCachePath, JSON.stringify(cacheEntry), "utf8");
    }
    return { text, missingSource: false };
  } catch {
    return { text: null, missingSource: false };
  }
}

async function readAttachmentSourceText(
  vaultRoot: string,
  attachment: ComposerAttachment,
): Promise<{ text: string | null; missingSource: boolean }> {
  if (attachment.kind === "pdf") {
    return readPdfExtractionText(vaultRoot, attachment.stagedPath, attachment.displayName);
  }

  const candidatePaths = [attachment.stagedPath];
  const promptAbsolutePath = resolveVaultPath(vaultRoot, attachment.promptPath);
  if (promptAbsolutePath !== attachment.stagedPath) {
    candidatePaths.push(promptAbsolutePath);
  }

  for (const path of candidatePaths) {
    const managedPath = await resolveManagedAttachmentPath(vaultRoot, path);
    if (!managedPath) {
      continue;
    }
    try {
      const content = await fs.readFile(managedPath, "utf8");
      return {
        text: content.replace(/\u0000/g, "").trim() || null,
        missingSource: false,
      };
    } catch {
      // try the next candidate
    }
  }

  return { text: null, missingSource: true };
}

export async function stageComposerAttachment(
  vaultRoot: string,
  stageDir: string,
  input: ComposerAttachmentInput & {
    id: string;
    createdAt?: number;
  },
): Promise<ComposerAttachment> {
  const displayName = sanitizeFileName(input.name);
  const stageName = `${input.id}-${displayName}`;
  const stagedPath = join(stageDir, stageName);
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(stagedPath, input.bytes);

  const kind = inferComposerAttachmentKind(displayName, input.mimeType);
  const vaultPath = toVaultRelativePath(vaultRoot, stagedPath);
  const promptPath = vaultPath;

  return {
    id: input.id,
    kind,
    displayName,
    mimeType: input.mimeType,
    stagedPath,
    vaultPath,
    promptPath,
    originalPath: input.originalPath,
    source: input.source,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export async function cleanupComposerAttachments(vaultRoot: string, attachments: readonly ComposerAttachment[]): Promise<void> {
  const paths = new Set<string>();
  for (const attachment of attachments) {
    const managedStagedPath = await resolveManagedAttachmentPath(vaultRoot, attachment.stagedPath);
    if (managedStagedPath) {
      paths.add(managedStagedPath);
      if (attachment.kind === "pdf") {
        const managedCachePath = await resolveManagedAttachmentPath(vaultRoot, buildPdfExtractionCachePath(managedStagedPath));
        if (managedCachePath) {
          paths.add(managedCachePath);
        }
      }
    }
    const managedPromptPath = await resolveManagedAttachmentPath(vaultRoot, resolveVaultPath(vaultRoot, attachment.promptPath));
    if (managedPromptPath) {
      paths.add(managedPromptPath);
    }
  }

  await Promise.all(
    [...paths].map(async (path) => {
      try {
        await fs.unlink(path);
      } catch {
        // ignore best-effort cleanup failures
      }
    }),
  );
}

export interface AttachmentContentPackResult {
  text: string | null;
  missingPdfTextAttachmentNames: string[];
  missingSourceAttachmentNames: string[];
}

export interface AttachmentContentPackOptions {
  maxChars?: number;
  maxCharsPerFile?: number;
}

function truncateAttachmentText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, limit).trimEnd()}\n\n[Attachment excerpt truncated]`,
    truncated: true,
  };
}

export function listPdfAttachmentsMissingText(attachments: readonly ComposerAttachment[]): string[] {
  return attachments.filter((attachment) => attachment.kind === "pdf" && attachment.promptPath.endsWith(".txt")).map((attachment) => attachment.displayName);
}

export async function buildInlineAttachmentContentPack(
  vaultRoot: string,
  attachments: readonly ComposerAttachment[],
  options: AttachmentContentPackOptions = {},
): Promise<AttachmentContentPackResult> {
  const maxChars = options.maxChars ?? DEFAULT_ATTACHMENT_CONTENT_MAX_CHARS;
  const maxCharsPerFile = options.maxCharsPerFile ?? DEFAULT_ATTACHMENT_CONTENT_MAX_CHARS_PER_FILE;
  const missingPdfTextAttachmentNames: string[] = [];
  const missingSourceAttachmentNames: string[] = [];
  const blocks: string[] = [];
  let remainingChars = maxChars;

  for (const attachment of attachments) {
    if (remainingChars <= 0 || attachment.kind === "image") {
      break;
    }

    const source = await readAttachmentSourceText(vaultRoot, attachment);
    if (source.missingSource) {
      missingSourceAttachmentNames.push(attachment.displayName);
      continue;
    }
    const normalized = source.text?.trim() ?? "";
    if (!normalized) {
      if (attachment.kind === "pdf") {
        missingPdfTextAttachmentNames.push(attachment.displayName);
      }
      continue;
    }

    const clipped = truncateAttachmentText(normalized, Math.min(maxCharsPerFile, remainingChars));
    const label =
      attachment.kind === "pdf"
        ? `PDF text excerpt: ${attachment.displayName}`
        : `Attachment text excerpt: ${attachment.displayName}`;
    const block = `${label}\n\n\`\`\`text\n${clipped.text}\n\`\`\``;
    blocks.push(block);
    remainingChars -= clipped.text.length;
  }

  if (blocks.length === 0) {
    return {
      text: null,
      missingPdfTextAttachmentNames,
      missingSourceAttachmentNames,
    };
  }

  return {
    text: ["Attachment content pack:", ...blocks].join("\n\n"),
    missingPdfTextAttachmentNames,
    missingSourceAttachmentNames,
  };
}

export function buildAttachmentPromptManifest(attachments: readonly ComposerAttachment[]): string | null {
  if (attachments.length === 0) {
    return null;
  }

  const lines = attachments.map((attachment) => {
    if (attachment.kind === "image") {
      return `- Image: ${attachment.displayName} (${attachment.vaultPath})`;
    }
    if (attachment.kind === "pdf") {
      return `- PDF: ${attachment.displayName} (${attachment.vaultPath})`;
    }
    return `- File: ${attachment.displayName} (${attachment.promptPath})`;
  });

  return ["Attached files and images:", ...lines].join("\n");
}

export function buildAttachmentSummaryText(attachments: readonly ComposerAttachment[]): string {
  return attachments.map((attachment) => attachment.displayName).join("\n");
}

export function hasPdfAttachmentsWithoutExtractedText(attachments: readonly ComposerAttachment[]): boolean {
  return listPdfAttachmentsMissingText(attachments).length > 0;
}

export async function buildAttachmentContentPackResult(
  vaultRoot: string,
  attachments: readonly ComposerAttachment[],
  options: AttachmentContentPackOptions = {},
): Promise<AttachmentContentPackResult> {
  if (attachments.length === 0) {
    return {
      text: null,
      missingPdfTextAttachmentNames: [],
      missingSourceAttachmentNames: [],
    };
  }
  const maxChars = options.maxChars ?? MAX_ATTACHMENT_CONTENT_CHARS;
  const maxCharsPerFile = options.maxCharsPerFile ?? MAX_ATTACHMENT_CONTENT_CHARS_PER_FILE;
  let remaining = maxChars;
  const sections: string[] = [];
  const missingPdfTextAttachmentNames: string[] = [];
  const missingSourceAttachmentNames: string[] = [];

  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      continue;
    }

    const sourceLabel = attachment.kind === "pdf" ? `extracted text from ${attachment.displayName}` : attachment.displayName;
    const source = await readAttachmentSourceText(vaultRoot, attachment);
    if (source.missingSource) {
      missingSourceAttachmentNames.push(attachment.displayName);
      sections.push(`Attachment source unavailable: ${sourceLabel}`);
      continue;
    }
    const normalized = source.text?.trim() ?? "";
    if (!normalized) {
      if (attachment.kind === "pdf") {
        missingPdfTextAttachmentNames.push(attachment.displayName);
      }
      sections.push(`Attachment content unavailable: ${sourceLabel}`);
      continue;
    }

    const nextChunk = normalized.slice(0, Math.min(maxCharsPerFile, remaining));
    if (!nextChunk) {
      break;
    }
    const truncated = normalized.length > nextChunk.length;
    sections.push(
      [
        `Attachment content: ${sourceLabel}`,
        "```text",
        nextChunk,
        "```",
        attachment.kind === "pdf" ? summarizePdfChunkCoverage(nextChunk) : null,
        truncated ? "[Attachment content truncated for turn context.]" : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    remaining -= nextChunk.length;
    if (remaining <= 0) {
      sections.push("[Additional attachment content omitted because the turn context budget was exhausted.]");
      break;
    }
  }

  return {
    text: sections.length > 0 ? sections.join("\n\n") : null,
    missingPdfTextAttachmentNames,
    missingSourceAttachmentNames,
  };
}

export async function buildAttachmentContentPack(
  vaultRoot: string,
  attachments: readonly ComposerAttachment[],
  options: AttachmentContentPackOptions = {},
): Promise<string | null> {
  const result = await buildAttachmentContentPackResult(vaultRoot, attachments, options);
  return result.text;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isComposerAttachmentSource(value: unknown): value is ComposerAttachmentSource {
  return value === "clipboard" || value === "picker";
}

export function normalizeComposerAttachments(input: unknown, vaultRoot?: string): ComposerAttachment[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .flatMap((entry) => {
      const id = asString(entry.id);
      const kind = asString(entry.kind);
      const displayName = asString(entry.displayName);
      const stagedPath = asString(entry.stagedPath);
      const vaultPath = asString(entry.vaultPath);
      const promptPath = asString(entry.promptPath);
      const source = entry.source;
      if (
        !id ||
        !displayName ||
        !stagedPath ||
        !vaultPath ||
        !promptPath ||
        !isComposerAttachmentSource(source) ||
        (kind !== "image" && kind !== "file" && kind !== "pdf")
      ) {
        return [];
      }

      if (vaultRoot) {
        if (
          !isManagedAttachmentPathCandidate(vaultRoot, stagedPath) ||
          !isManagedAttachmentPathCandidate(vaultRoot, resolveVaultPath(vaultRoot, vaultPath)) ||
          !isManagedAttachmentPathCandidate(vaultRoot, resolveVaultPath(vaultRoot, promptPath))
        ) {
          return [];
        }
      }

      return [
        {
          id,
          kind,
          displayName,
          mimeType: asString(entry.mimeType),
          stagedPath,
          vaultPath,
          promptPath,
          originalPath: asString(entry.originalPath),
          source,
          createdAt: typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
        } satisfies ComposerAttachment,
      ];
    });
}
