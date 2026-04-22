import { describe, expect, it } from "vitest";
import { CodexService } from "../app/codexService";
import { buildTurnPrompt } from "../app/turnPrompt";
import { DEFAULT_SETTINGS, type ChatMessage, type PatchProposal, type TurnContextSnapshot } from "../model/types";

function createContext(overrides: Partial<TurnContextSnapshot> = {}): TurnContextSnapshot {
  return {
    activeFilePath: "Notes/Test.md",
    targetNotePath: null,
    studyWorkflow: null,
    studyCoachText: null,
    conversationSummaryText: null,
    sourceAcquisitionMode: "workspace_generic",
    sourceAcquisitionContractText: null,
    workflowText: null,
    pluginFeatureText: null,
    paperStudyRuntimeOverlayText: null,
    skillGuideText: null,
    paperStudyGuideText: null,
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

function createApp(basePath: string) {
  return {
    vault: {
      adapter: { basePath },
      getAbstractFileByPath: () => null,
    },
    workspace: {
      getActiveFile: () => null,
      getMostRecentLeaf: () => null,
    },
  } as never;
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
    expect(prompt).toContain("Treat a turn as note editing when the user asks you to change the note");
    expect(prompt).toContain("start the visible answer with one short status line");
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

  it("attaches user adaptation memory separately from skill guides when present", () => {
    const context = createContext() as TurnContextSnapshot & { userAdaptationText?: string | null };
    context.userAdaptationText = [
      "User adaptation memory",
      "- Prefer step-by-step explanations when editing study notes.",
      "- Panel overlay (paper-panel): keep claim vs interpretation separate.",
    ].join("\n");
    const prompt = buildTurnPrompt(
      "Use $deep-read on this paper",
      context,
      "skill",
      ["deep-read"],
      "chat",
      false,
      "manual",
    );

    expect(prompt).toContain("User adaptation memory: attached");
    expect(prompt).toContain("A user adaptation memory summary is attached for this turn.");
    expect(prompt).toContain("Use it as a lightweight personalization hint");
    expect(prompt).toContain("User adaptation memory");
    expect(prompt).toContain("Panel overlay (paper-panel)");
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
    expect(prompt).toContain("Reserve single-dollar math for inline expressions only.");
    expect(prompt).toContain("Multi-line display math MUST use `$$` on their own lines.");
    expect(prompt).toContain("Inside callouts and blockquotes, every line of the rewritten block must keep its `>` prefix.");
    expect(prompt).toContain("Display math inside callouts and blockquotes must use standalone quoted delimiters such as `> $$`.");
    expect(prompt).not.toContain("JSON body format");
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

    expect(prompt).toContain("Apply automatically mode");
    expect(prompt).toContain("plugin may auto-apply them unless review is required for readability or safety");
    expect(prompt).toContain("Target resolution for note edits");
  });

  it("includes preferred-name, custom system prompt, and shell blocklist overlays when configured", () => {
    const prompt = buildTurnPrompt("Help me refactor this note.", createContext(), "normal", [], "chat", false, "manual", {
      preferredName: "Kenshin",
      customSystemPrompt: "Prefer literal code references and avoid filler.",
      shellBlocklist: ["rm -rf", "del /s"],
    });

    expect(prompt).toContain('If you address the user directly, call them "Kenshin".');
    expect(prompt).toContain("User-configured blocked shell patterns: rm -rf, del /s");
    expect(prompt).toContain("Do not propose or rely on shell commands matching those blocked patterns.");
    expect(prompt).toContain("User-added system instructions:");
    expect(prompt).toContain("Prefer literal code references and avoid filler.");
  });

  it("uses study-coach guidance when learning mode is active for an explanation turn", () => {
    const prompt = buildTurnPrompt(
      "Explain Fourier transforms to me.",
      createContext(),
      "normal",
      [],
      "chat",
      false,
      "manual",
      { learningMode: true },
    );

    expect(prompt).toContain("Learning mode is active for this tab.");
    expect(prompt).toContain("Use a study-coach response structure");
    expect(prompt).toContain("key explanation");
    expect(prompt).toContain("one short understanding-check question");
    expect(prompt).toContain("likely point of confusion");
    expect(prompt).toContain("next study step");
    expect(prompt).toContain("```obsidian-study-checkpoint");
  });

  it("lets direct-answer requests bypass the coaching preamble for that turn", () => {
    const prompt = buildTurnPrompt(
      "Just give me the answer: what is a Laplace transform?",
      createContext(),
      "normal",
      [],
      "chat",
      false,
      "manual",
      { learningMode: true },
    );

    expect(prompt).toContain("the user explicitly asked for the direct answer in this turn");
    expect(prompt).toContain("Give the direct answer first");
    expect(prompt).toContain("After the direct answer, still include");
  });

  it("does not force learning-mode tutoring onto editing turns", () => {
    const prompt = buildTurnPrompt(
      "Rewrite this note to be clearer.",
      createContext(),
      "normal",
      [],
      "chat",
      true,
      "approval",
      { learningMode: true },
    );

    expect(prompt).not.toContain("Learning mode is active for this tab.");
  });

  it("attaches prior study recap context when a weak point ledger exists", () => {
    const prompt = buildTurnPrompt(
      "Continue helping me with this lecture.",
      createContext({
        studyWorkflow: "review",
        studyCoachText: [
          "Study coach carry-forward:",
          "- Latest recap: comfortable with the convolution overview.",
          "- Weak point: still unclear on why convolution becomes multiplication in frequency space.",
          "- Next check: explain the bridge in one sentence.",
        ].join("\n"),
      }),
      "normal",
      [],
      "chat",
      false,
      "manual",
      { learningMode: true },
    );

    expect(prompt).toContain("A study coach carry-forward summary is attached for this turn.");
    expect(prompt).toContain("Study coach carry-forward:");
    expect(prompt).toContain("Weak point: still unclear on why convolution becomes multiplication in frequency space.");
  });
});

describe("CodexService patch prompt contracts", () => {
  it("keeps the readability repair prompt delimiter-only and quote-aware", () => {
    const service = new CodexService(
      createApp("/vault"),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );
    const message: ChatMessage = {
      id: "assistant-1",
      kind: "assistant",
      text: "```obsidian-patch\npath: Notes/Test.md\nkind: update\nsummary: Repair me\n\n---content\n> $\n> x=y\n> $\n---end\n```",
      createdAt: 1,
    };
    const proposal: PatchProposal = {
      id: "patch-1",
      threadId: null,
      sourceMessageId: "assistant-1",
      originTurnId: "turn-1",
      targetPath: "Notes/Test.md",
      kind: "update",
      baseSnapshot: "Before",
      proposedText: "> $\n> x=y\n> $",
      unifiedDiff: "@@",
      summary: "Repair callout math",
      status: "pending",
      createdAt: 1,
      qualityState: "review_required",
      qualityIssues: [{ code: "display_math_single_dollar", line: 1 }],
    };

    const prompt = (
      service as unknown as {
        buildPatchReadabilityRepairPrompt: (
          context: TurnContextSnapshot,
          message: ChatMessage,
          proposal: PatchProposal,
        ) => string;
      }
    ).buildPatchReadabilityRepairPrompt(createContext(), message, proposal);

    expect(prompt).toContain("Required delimiter format");
    expect(prompt).toContain("Display math inside callouts and blockquotes must use standalone quoted delimiters such as `> $$`.");
    expect(prompt).not.toContain("JSON patch");
  });

  it("keeps rewrite follow-up prompts quote-aware and delimiter-only", () => {
    const service = new CodexService(
      createApp("/vault"),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const prompt = (
      service as unknown as {
        buildRewriteFollowupPromptFromMessage: (tabId: string, messageId: string, fallbackSummary: string | null) => string;
      }
    ).buildRewriteFollowupPromptFromMessage(service.getActiveTab()!.id, "missing-message", "Rewrite the callout explanation.");

    expect(prompt).toContain("Turn your immediately previous assistant answer");
    expect(prompt).toContain("Inside callouts and blockquotes, every line of the rewritten block must keep its `>` prefix.");
    expect(prompt).not.toContain("JSON patch");
  });
});
