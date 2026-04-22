import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ComposerAttachment } from "../model/types";
import {
  buildAttachmentContentPack,
  buildAttachmentContentPackResult,
  buildInlineAttachmentContentPack,
  buildAttachmentPromptManifest,
  buildPdfExtractionCachePath,
  cleanupComposerAttachments,
  formatExtractedPdfText,
  listPdfAttachmentsMissingText,
  normalizeComposerAttachments,
  PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS,
  PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS_PER_FILE,
  stageComposerAttachment,
} from "../util/composerAttachments";

async function seedPdfExtractionCache(
  stagedPath: string,
  displayName: string,
  extractedText: string,
): Promise<void> {
  await fs.writeFile(stagedPath, new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  const stat = await fs.stat(stagedPath);
  await fs.writeFile(
    buildPdfExtractionCachePath(stagedPath),
    JSON.stringify({
      version: 1,
      sourceSize: stat.size,
      sourceMtimeMs: stat.mtimeMs,
      sourceHash: createHash("sha1").update(await fs.readFile(stagedPath)).digest("hex"),
      displayName,
      totalPages: 14,
      text: extractedText,
      extractedAt: Date.now(),
    }),
    "utf8",
  );
}

describe("composer attachment helpers", () => {
  it("builds a prompt manifest for mixed attachment types", () => {
    expect(
      buildAttachmentPromptManifest([
        {
          id: "img-1",
          kind: "image",
          displayName: "diagram.png",
          mimeType: "image/png",
          stagedPath: "/vault/.obsidian/plugins/obsidian-codex/.staging/tab/diagram.png",
          vaultPath: ".obsidian/plugins/obsidian-codex/.staging/tab/diagram.png",
          promptPath: ".obsidian/plugins/obsidian-codex/.staging/tab/diagram.png",
          originalPath: null,
          source: "clipboard",
          createdAt: 1,
        },
        {
          id: "pdf-1",
          kind: "pdf",
          displayName: "notes.pdf",
          mimeType: "application/pdf",
          stagedPath: "/vault/.obsidian/plugins/obsidian-codex/.staging/tab/notes.pdf",
          vaultPath: ".obsidian/plugins/obsidian-codex/.staging/tab/notes.pdf",
          promptPath: ".obsidian/plugins/obsidian-codex/.staging/tab/notes.pdf.txt",
          originalPath: "/tmp/notes.pdf",
          source: "picker",
          createdAt: 2,
        },
      ]),
    ).toContain("notes.pdf");
  });

  it("drops malformed persisted attachments", () => {
    expect(
      normalizeComposerAttachments([
        {
          id: "valid",
          kind: "file",
          displayName: "todo.txt",
          mimeType: "text/plain",
          stagedPath: "/vault/todo.txt",
          vaultPath: "todo.txt",
          promptPath: "todo.txt",
          originalPath: null,
          source: "picker",
          createdAt: 10,
        },
        {
          id: "broken",
          kind: "nope",
        },
      ]),
    ).toHaveLength(1);
  });

  it("drops live attachment metadata that escapes the managed staging root", () => {
    expect(
      normalizeComposerAttachments(
        [
          {
            id: "unsafe",
            kind: "file",
            displayName: "notes.txt",
            mimeType: "text/plain",
            stagedPath: "/vault/notes.txt",
            vaultPath: "notes.txt",
            promptPath: "notes.txt",
            originalPath: null,
            source: "picker",
            createdAt: 10,
          },
        ],
        "/vault",
      ),
    ).toEqual([]);
  });

  it("falls back to the raw pdf attachment when text extraction is unavailable", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const stageDir = join(vaultRoot, ".obsidian", "plugins", "obsidian-codex-study", ".staging", "tab-1");

    try {
      const attachment = await stageComposerAttachment(vaultRoot, stageDir, {
        id: "pdf-fallback",
        name: "lecture.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        source: "picker",
        originalPath: "/tmp/lecture.pdf",
      });

      expect(attachment.kind).toBe("pdf");
      expect(attachment.promptPath).toBe(attachment.vaultPath);
      await expect(fs.stat(attachment.stagedPath)).resolves.toBeTruthy();
      await expect(fs.stat(join(vaultRoot, attachment.promptPath))).resolves.toBeTruthy();
      await expect(fs.stat(`${attachment.stagedPath}.txt`)).rejects.toBeTruthy();
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("builds an inline attachment content pack from extracted PDF text", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const stageDir = join(vaultRoot, ".obsidian", "plugins", "obsidian-codex-study", ".staging", "tab-1");
    await fs.mkdir(stageDir, { recursive: true });
    const stagedPath = join(stageDir, "paper.pdf");
    await seedPdfExtractionCache(stagedPath, "paper.pdf", "Abstract\n\nThis is the extracted paper text.");

    try {
      const pack = await buildInlineAttachmentContentPack(vaultRoot, [
        {
          id: "pdf-1",
          kind: "pdf",
          displayName: "paper.pdf",
          mimeType: "application/pdf",
          stagedPath,
          vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/paper.pdf",
          promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/paper.pdf",
          originalPath: "/tmp/paper.pdf",
          source: "picker",
          createdAt: 1,
        },
      ]);

      expect(pack.text).toContain("Attachment content pack:");
      expect(pack.text).toContain("PDF text excerpt: paper.pdf");
      expect(pack.text).toContain("This is the extracted paper text.");
      expect(pack.missingPdfTextAttachmentNames).toEqual([]);
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("preserves the legacy attachment content pack behavior", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const stageDir = join(vaultRoot, ".obsidian", "plugins", "obsidian-codex-study", ".staging", "tab-1");
    await fs.mkdir(stageDir, { recursive: true });
    const stagedPath = join(stageDir, "paper.pdf");
    await seedPdfExtractionCache(stagedPath, "paper.pdf", "Abstract\n\nThis is the extracted paper text.");

    try {
      const pack = await buildAttachmentContentPack(vaultRoot, [
        {
          id: "pdf-1",
          kind: "pdf",
          displayName: "paper.pdf",
          mimeType: "application/pdf",
          stagedPath,
          vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/paper.pdf",
          promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/paper.pdf.txt",
          originalPath: "/tmp/paper.pdf",
          source: "picker",
          createdAt: 1,
        },
      ]);

      expect(pack).toContain("Attachment content: extracted text from paper.pdf");
      expect(pack).toContain("This is the extracted paper text.");
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("embeds total page metadata into extracted PDF text", () => {
    const text = formatExtractedPdfText(
      [
        { pageNumber: 1, text: "Abstract and introduction." },
        { pageNumber: 2, text: "Methods and results." },
      ],
      14,
      "technical_note.pdf",
    );

    expect(text).toContain("PDF extraction metadata:");
    expect(text).toContain("- File: technical_note.pdf");
    expect(text).toContain("- Total pages: 14");
    expect(text).toContain("[Page 1 of 14]");
    expect(text).toContain("[Page 2 of 14]");
  });

  it("preserves PDF page-count metadata when the attachment content pack is truncated", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const stageDir = join(vaultRoot, ".obsidian", "plugins", "obsidian-codex-study", ".staging", "tab-1");
    await fs.mkdir(stageDir, { recursive: true });
    const stagedPath = join(stageDir, "technical_note.pdf");
    const extractedText = formatExtractedPdfText(
      Array.from({ length: 14 }, (_, index) => ({
        pageNumber: index + 1,
        text: `Page ${index + 1} body `.repeat(1200),
      })),
      14,
      "technical_note.pdf",
    );
    await seedPdfExtractionCache(stagedPath, "technical_note.pdf", extractedText ?? "");

    try {
      const pack = await buildAttachmentContentPack(vaultRoot, [
        {
          id: "pdf-1",
          kind: "pdf",
          displayName: "technical_note.pdf",
          mimeType: "application/pdf",
          stagedPath,
          vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/technical_note.pdf",
          promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/technical_note.pdf.txt",
          originalPath: "/tmp/technical_note.pdf",
          source: "picker",
          createdAt: 1,
        },
      ]);

      expect(pack).toContain("- Total pages: 14");
      expect(pack).toContain("[Attached excerpt includes pages 1-");
      expect(pack).toContain("[Attachment content truncated for turn context.]");
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("allows paper-study turns to include later PDF pages beyond the default 24k/file cap", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const stageDir = join(vaultRoot, ".obsidian", "plugins", "obsidian-codex-study", ".staging", "tab-1");
    await fs.mkdir(stageDir, { recursive: true });
    const stagedPath = join(stageDir, "technical_note.pdf");
    const extractedText = formatExtractedPdfText(
      Array.from({ length: 25 }, (_, index) => ({
        pageNumber: index + 1,
        text: `Page ${index + 1} theorem statement `.repeat(220),
      })),
      25,
      "technical_note.pdf",
    );
    await seedPdfExtractionCache(stagedPath, "technical_note.pdf", extractedText ?? "");

    try {
      const pack = await buildAttachmentContentPackResult(
        vaultRoot,
        [
          {
            id: "pdf-1",
            kind: "pdf",
            displayName: "technical_note.pdf",
            mimeType: "application/pdf",
            stagedPath,
            vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/technical_note.pdf",
            promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/technical_note.pdf",
            originalPath: "/tmp/technical_note.pdf",
            source: "picker",
            createdAt: 1,
          },
        ],
        {
          maxChars: PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS,
          maxCharsPerFile: PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS_PER_FILE,
        },
      );

      expect(pack.text).toContain("- Total pages: 25");
      expect(pack.text).toContain("[Page 25 of 25]");
      expect(pack.text).not.toContain("[Attachment content truncated for turn context.]");
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("rescues legacy pdf attachments from the raw staged file instead of stale promptPath text", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const stageDir = join(vaultRoot, ".obsidian", "plugins", "obsidian-codex-study", ".staging", "tab-1");
    await fs.mkdir(stageDir, { recursive: true });
    const stagedPath = join(stageDir, "legacy.pdf");
    await seedPdfExtractionCache(stagedPath, "legacy.pdf", "PDF extraction metadata:\n- File: legacy.pdf\n- Total pages: 12\n- Extracted text pages: 12\n\n[Page 1 of 12]\nFresh raw-based text.");
    const legacyPromptPath = join(stageDir, "legacy.pdf.txt");
    await fs.writeFile(legacyPromptPath, "Stale legacy prompt text.", "utf8");

    try {
      const pack = await buildAttachmentContentPack(vaultRoot, [
        {
          id: "pdf-1",
          kind: "pdf",
          displayName: "legacy.pdf",
          mimeType: "application/pdf",
          stagedPath,
          vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/legacy.pdf",
          promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/legacy.pdf.txt",
          originalPath: "/tmp/legacy.pdf",
          source: "picker",
          createdAt: 1,
        },
      ]);

      expect(pack).toContain("Fresh raw-based text.");
      expect(pack).not.toContain("Stale legacy prompt text.");
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("invalidates a stale PDF cache when the source hash no longer matches", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const stageDir = join(vaultRoot, ".obsidian", "plugins", "obsidian-codex-study", ".staging", "tab-1");
    await fs.mkdir(stageDir, { recursive: true });
    const stagedPath = join(stageDir, "hash-mismatch.pdf");
    await seedPdfExtractionCache(
      stagedPath,
      "hash-mismatch.pdf",
      "PDF extraction metadata:\n- File: hash-mismatch.pdf\n- Total pages: 2\n- Extracted text pages: 1\n\n[Page 1 of 2]\nStale cached text.",
    );

    const cachePath = buildPdfExtractionCachePath(stagedPath);
    const rawCache = JSON.parse(await fs.readFile(cachePath, "utf8")) as Record<string, unknown>;
    rawCache.sourceHash = "definitely-not-the-current-hash";
    rawCache.text = "PDF extraction metadata:\n- File: hash-mismatch.pdf\n- Total pages: 2\n- Extracted text pages: 1\n\n[Page 1 of 2]\nStale cached text.";
    await fs.writeFile(cachePath, JSON.stringify(rawCache), "utf8");

    try {
      const pack = await buildInlineAttachmentContentPack(vaultRoot, [
        {
          id: "pdf-mismatch",
          kind: "pdf",
          displayName: "hash-mismatch.pdf",
          mimeType: "application/pdf",
          stagedPath,
          vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/hash-mismatch.pdf",
          promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/hash-mismatch.pdf",
          originalPath: "/tmp/hash-mismatch.pdf",
          source: "picker",
          createdAt: 1,
        },
      ]);

      expect(pack.text).toBeNull();
      expect(pack.missingPdfTextAttachmentNames).toEqual(["hash-mismatch.pdf"]);
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("only reports legacy pdf attachments that still point at promptPath text", async () => {
    const attachments: ComposerAttachment[] = [
      {
        id: "pdf-1",
        kind: "pdf",
        displayName: "scanned.pdf",
        mimeType: "application/pdf",
        stagedPath: "/vault/.obsidian/plugins/obsidian-codex-study/.staging/tab-1/scanned.pdf",
        vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/scanned.pdf",
        promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/scanned.pdf",
        originalPath: "/tmp/scanned.pdf",
        source: "picker" as const,
        createdAt: 1,
      },
      {
        id: "pdf-legacy",
        kind: "pdf",
        displayName: "legacy.pdf",
        mimeType: "application/pdf",
        stagedPath: "/vault/.obsidian/plugins/obsidian-codex-study/.staging/tab-1/legacy.pdf",
        vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/legacy.pdf",
        promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/legacy.pdf.txt",
        originalPath: "/tmp/legacy.pdf",
        source: "picker" as const,
        createdAt: 2,
      },
    ];

    expect(listPdfAttachmentsMissingText(attachments)).toEqual(["legacy.pdf"]);
  });

  it("returns missing PDFs when inline content cannot be built", async () => {
    const attachments: ComposerAttachment[] = [
      {
        id: "pdf-1",
        kind: "pdf",
        displayName: "scanned.pdf",
        mimeType: "application/pdf",
        stagedPath: "/vault/.obsidian/plugins/obsidian-codex-study/.staging/tab-1/scanned.pdf",
        vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/scanned.pdf",
        promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/scanned.pdf",
        originalPath: "/tmp/scanned.pdf",
        source: "picker" as const,
        createdAt: 1,
      },
    ];

    const pack = await buildInlineAttachmentContentPack("/vault", attachments);
    expect(pack.text).toBeNull();
    expect(pack.missingPdfTextAttachmentNames).toEqual([]);
    expect(pack.missingSourceAttachmentNames).toEqual(["scanned.pdf"]);
  });

  it("does not read attachment sources outside the managed staging root", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const outsidePath = join(vaultRoot, "outside.txt");
    await fs.writeFile(outsidePath, "secret outside staging", "utf8");

    try {
      const pack = await buildInlineAttachmentContentPack(vaultRoot, [
        {
          id: "file-1",
          kind: "file",
          displayName: "outside.txt",
          mimeType: "text/plain",
          stagedPath: outsidePath,
          vaultPath: "outside.txt",
          promptPath: "outside.txt",
          originalPath: outsidePath,
          source: "picker",
          createdAt: 1,
        },
      ]);

      expect(pack.text).toBeNull();
      expect(pack.missingSourceAttachmentNames).toEqual(["outside.txt"]);
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("does not unlink files outside the managed staging root during cleanup", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const outsidePath = join(vaultRoot, "outside.txt");
    await fs.writeFile(outsidePath, "keep me", "utf8");

    try {
      await cleanupComposerAttachments(vaultRoot, [
        {
          id: "file-1",
          kind: "file",
          displayName: "outside.txt",
          mimeType: "text/plain",
          stagedPath: outsidePath,
          vaultPath: "outside.txt",
          promptPath: "outside.txt",
          originalPath: outsidePath,
          source: "picker",
          createdAt: 1,
        },
      ]);

      await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("keep me");
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("describes non-contiguous PDF excerpt coverage accurately", async () => {
    const vaultRoot = await fs.mkdtemp(join(tmpdir(), "obsidian-codex-study-vault-"));
    const stageDir = join(vaultRoot, ".obsidian", "plugins", "obsidian-codex-study", ".staging", "tab-1");
    await fs.mkdir(stageDir, { recursive: true });
    const stagedPath = join(stageDir, "gapped.pdf");
    await seedPdfExtractionCache(
      stagedPath,
      "gapped.pdf",
      [
        "PDF extraction metadata:",
        "- File: gapped.pdf",
        "- Total pages: 12",
        "- Extracted text pages: 3",
        "",
        "[Page 1 of 12]",
        "First page.",
        "",
        "[Page 3 of 12]",
        "Third page.",
        "",
        "[Page 5 of 12]",
        "Fifth page.",
      ].join("\n"),
    );

    try {
      const pack = await buildAttachmentContentPack(vaultRoot, [
        {
          id: "pdf-gap",
          kind: "pdf",
          displayName: "gapped.pdf",
          mimeType: "application/pdf",
          stagedPath,
          vaultPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/gapped.pdf",
          promptPath: ".obsidian/plugins/obsidian-codex-study/.staging/tab-1/gapped.pdf",
          originalPath: "/tmp/gapped.pdf",
          source: "picker",
          createdAt: 1,
        },
      ]);

      expect(pack).toContain("[Attached excerpt includes pages 1, 3, 5 of 12.]");
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });
});
