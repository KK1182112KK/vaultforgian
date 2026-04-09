import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAttachmentPromptManifest, normalizeComposerAttachments, stageComposerAttachment } from "../util/composerAttachments";

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
    ).toContain("extracted text");
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
});
