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

async function extractPdfText(bytes: Uint8Array): Promise<string | null> {
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
      const pageTexts: string[] = [];
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
            pageTexts.push(pageText);
          }
        } finally {
          page.cleanup?.();
        }
      }

      const normalized = pageTexts.join("\n\n").replace(/\u0000/g, "").trim();
      return normalized || null;
    } finally {
      await document.destroy?.();
      await loadingTask.destroy?.();
    }
  } catch (error) {
    console.warn("[obsidian-codex-study] PDF text extraction failed; falling back to raw PDF attachment.", error);
    return null;
  }
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
  let promptPath = vaultPath;

  if (kind === "pdf") {
    const extractedText = await extractPdfText(input.bytes);
    if (extractedText) {
      const textPath = join(stageDir, `${stageName}.txt`);
      await fs.writeFile(textPath, extractedText, "utf8");
      promptPath = toVaultRelativePath(vaultRoot, textPath);
    }
  }

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
    paths.add(attachment.stagedPath);
    paths.add(resolveVaultPath(vaultRoot, attachment.promptPath));
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

export function buildAttachmentPromptManifest(attachments: readonly ComposerAttachment[]): string | null {
  if (attachments.length === 0) {
    return null;
  }

  const lines = attachments.map((attachment) => {
    if (attachment.kind === "image") {
      return `- Image: ${attachment.displayName} (${attachment.vaultPath})`;
    }
    if (attachment.kind === "pdf") {
      if (attachment.promptPath !== attachment.vaultPath) {
        return `- PDF: ${attachment.displayName} (original: ${attachment.vaultPath}, extracted text: ${attachment.promptPath})`;
      }
      return `- PDF: ${attachment.displayName} (${attachment.vaultPath})`;
    }
    return `- File: ${attachment.displayName} (${attachment.promptPath})`;
  });

  return ["Attached files and images:", ...lines].join("\n");
}

export function buildAttachmentSummaryText(attachments: readonly ComposerAttachment[]): string {
  return attachments.map((attachment) => attachment.displayName).join("\n");
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isComposerAttachmentSource(value: unknown): value is ComposerAttachmentSource {
  return value === "clipboard" || value === "picker";
}

export function normalizeComposerAttachments(input: unknown): ComposerAttachment[] {
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
