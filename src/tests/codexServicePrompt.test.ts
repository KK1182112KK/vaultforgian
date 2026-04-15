import { describe, expect, it } from "vitest";
import { buildTurnPrompt } from "../app/turnPrompt";
import type { TurnContextSnapshot } from "../model/types";

function createContext(overrides: Partial<TurnContextSnapshot> = {}): TurnContextSnapshot {
  return {
    activeFilePath: "Notes/Test.md",
    targetNotePath: null,
    studyWorkflow: null,
    conversationSummaryText: null,
    sourceAcquisitionMode: "workspace_generic",
    sourceAcquisitionContractText: null,
    workflowText: null,
    pluginFeatureText: null,
    paperStudyRuntimeOverlayText: null,
    skillGuideText: null,
    paperStudyGuideText: null,
    instructionText: null,
    mentionContextText: null,
    selection: null,
    selectionSourcePath: null,
    vaultRoot: "/vault",
    dailyNotePath: null,
    contextPackText: null,
    attachmentManifestText: null,
    attachmentContentText: null,
    noteSourcePackText: null,
    attachmentMissingPdfTextNames: [],
    attachmentMissingSourceNames: [],
    ...overrides,
  };
}

describe("buildTurnPrompt", () => {
  it("injects plugin feature guidance when present", () => {
    const prompt = buildTurnPrompt(
      "Panel Studio の使い方を教えて",
      createContext({
        pluginFeatureText: "Plugin feature guide: Panel Studio\n- Seed prompt copies the panel prompt into the composer.",
      }),
      "normal",
      [],
      "chat",
      false,
      "manual",
    );

    expect(prompt).toContain("A plugin feature guide is attached for this turn.");
    expect(prompt).toContain("Do not claim local search/read failures");
    expect(prompt).toContain("Plugin feature guide: Panel Studio");
    expect(prompt).toContain("Seed prompt copies the panel prompt into the composer.");
  });

  it("teaches chat-mode note answers to emit rewrite suggestions and evidence headers", () => {
    const prompt = buildTurnPrompt(
      "Summarize this note",
      createContext(),
      "normal",
      [],
      "chat",
      true,
      "approval",
    );

    expect(prompt).toContain("obsidian-suggest");
    expect(prompt).toContain("rewrite_followup");
    expect(prompt).toContain("evidence: kind|label|sourceRef|snippet");
  });

  it("injects requested skill guides when present", () => {
    const prompt = buildTurnPrompt(
      "Use $deep-read on this paper",
      createContext({
        skillGuideText: "Requested skill guides:\n\nSkill guide: $deep-read\nPath: /skills/deep-read/SKILL.md\nDescription: Read the paper deeply.",
      }),
      "skill",
      ["deep-read"],
      "chat",
      false,
      "manual",
    );

    expect(prompt).toContain("Requested skill guides are attached for this turn.");
    expect(prompt).toContain("Do not say that an attached requested skill is unavailable");
    expect(prompt).toContain("Skill guide: $deep-read");
  });

  it("injects paper-study and attachment-content guidance for attached PDFs", () => {
    const prompt = buildTurnPrompt(
      "Read this paper deeply",
      createContext({
        studyWorkflow: "paper",
        paperStudyRuntimeOverlayText:
          "Paper-study runtime overlay:\n- FOR THIS TURN, SOURCE INGESTION IS CLOSED.\n- Source ingestion is already complete for this turn.\n- Skip `$deep-read` Step 0 and `$study-material-builder` Workflow 1 source-bundle/PDF ingestion for this turn.",
        skillGuideText:
          "Requested skill guides:\n\nSkill guide: $deep-read\nPath: /skills/deep-read/SKILL.md\nDescription: Read the paper deeply.\n\nRuntime-resolved contract for this turn:",
        paperStudyGuideText: "Paper study guide\n- Separate authors' claims from our interpretation.",
        attachmentManifestText: "Attached files and images:\n- PDF: technical_note.pdf (original: a.pdf, extracted text: a.txt)",
        attachmentContentText: "Attached source excerpts:\n\nAttachment text: technical_note.pdf\nFirst paragraph of the paper.",
      }),
      "skill",
      ["deep-read", "study-material-builder"],
      "chat",
      false,
      "manual",
    );

    expect(prompt).toContain("A paper-study runtime overlay is attached for this turn.");
    expect(prompt).toContain("Do not perform a second local PDF ingestion pass");
    expect(prompt).toContain("Do not call shell or file-reading tools for source acquisition in this turn.");
    expect(prompt).toContain("Source ingestion is already complete for this turn.");
    expect(prompt).toContain("Skip `$deep-read` Step 0 and `$study-material-builder` Workflow 1");
    expect(prompt).toContain("A paper-study guide is attached for this turn.");
    expect(prompt).toContain("Separate authors' claims from our interpretation.");
    expect(prompt).toContain("Attachment content pack: attached");
    expect(prompt).toContain("If the attachment content pack includes explicit PDF metadata such as total page count");
    expect(prompt).toContain("Attachment text: technical_note.pdf");
    expect(prompt).toContain("First paragraph of the paper.");
    expect(prompt).toContain("Follow them only where they do not conflict with the paper-study runtime overlay");
    expect(prompt.indexOf("Paper-study runtime overlay:")).toBeLessThan(prompt.indexOf("Skill guide: $deep-read"));
    expect(prompt).toContain("Do not narrate sandbox, shell, or local-read troubleshooting");
  });

  it("forbids direct file writes when vault edits are allowed", () => {
    const prompt = buildTurnPrompt(
      "ノートを作成して",
      createContext(),
      "normal",
      [],
      "chat",
      true,
      "manual",
    );

    expect(prompt).toContain("Do NOT write to files under the vault with shell tools");
    expect(prompt).toContain("you MUST emit an `obsidian-patch` block");
    expect(prompt).toContain("FUTURE TENSE BANNED");
    expect(prompt).toContain("If you have a patch to make, emit the block now");
    expect(prompt).toContain("```obsidian-patch");
  });

  it("treats attached vault note source packs as canonical for note-improvement turns", () => {
    const prompt = buildTurnPrompt(
      "このノートをもっとわかりやすく整えて",
      createContext({
        sourceAcquisitionMode: "vault_note",
        sourceAcquisitionContractText:
          "Source acquisition contract:\n- この turn には vault note source pack が添付されています。これを一次資料として使ってください。",
        noteSourcePackText:
          "Vault note source pack:\n\nCurrent note: Notes/Test.md\n\nFrontmatter summary:\n- type: study-guide\n\n```md\n---\ntype: study-guide\n---\n# Heading\nBody\n```",
      }),
      "normal",
      [],
      "chat",
      true,
      "approval",
    );

    expect(prompt).toContain("A source acquisition contract is attached for this turn.");
    expect(prompt).toContain("A vault note source pack is attached for this turn.");
    expect(prompt).toContain("Do not call shell or file-reading tools for note acquisition in this turn.");
    expect(prompt).toContain("For note-improvement turns, stay anchored to the attached note source pack");
    expect(prompt).toContain("Do not claim that the note could not be inspected");
    expect(prompt).toContain("Frontmatter summary:");
    expect(prompt).toContain("Vault note source pack:");
  });

  it("attaches a carry-forward conversation summary after compaction", () => {
    const prompt = buildTurnPrompt(
      "Continue from the prior conversation.",
      createContext({
        conversationSummaryText: "Conversation carry-forward summary\n\nRecent user requests:\n- Explain Theorem 5.7",
      }),
      "normal",
      [],
      "chat",
      false,
      "manual",
    );

    expect(prompt).toContain("Conversation carry-forward summary: attached");
    expect(prompt).toContain("A carry-forward conversation summary is attached for this turn");
    expect(prompt).toContain("Use the attached conversation summary as prior thread context");
    expect(prompt).toContain("Recent user requests:");
  });

  it("explains automatic note application when auto-apply is enabled", () => {
    const prompt = buildTurnPrompt("Fix this note", createContext(), "normal", [], "chat", true, "auto");

    expect(prompt).toContain("Edit automatically mode");
    expect(prompt).toContain("plugin may auto-apply them unless review is required");
  });
});
