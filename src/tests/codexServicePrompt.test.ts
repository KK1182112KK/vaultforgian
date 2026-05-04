import { describe, expect, it } from "vitest";
import { CodexService } from "../app/codexService";
import { buildTurnPrompt } from "../app/turnPrompt";
import { DEFAULT_SETTINGS, type ChatMessage, type PatchProposal, type StudyTurnPlan, type TurnContextSnapshot } from "../model/types";
import { buildSkillOrchestrationPlan } from "../util/skillOrchestration";

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
      { noteSuggestionPolicy: "eligible" },
    );

    expect(prompt).toContain("obsidian-suggest");
    expect(prompt).toContain("rewrite_followup");
    expect(prompt).toContain("evidence: kind|label|sourceRef|snippet");
    expect(prompt).toContain("Treat a turn as note editing when the user asks you to change the note");
    expect(prompt).toContain("start the visible answer with one short status line");
  });

  it("does not teach greeting turns to emit note rewrite suggestions", () => {
    const prompt = buildTurnPrompt(
      "\u3053\u3093\u306b\u3061\u306f",
      createContext(),
      "normal",
      [],
      "chat",
      false,
      "manual",
      { noteSuggestionPolicy: "never" },
    );

    expect(prompt).not.toContain("obsidian-suggest");
    expect(prompt).not.toContain("note was not changed yet");
    expect(prompt).toContain("Do not mention note changes");
    expect(prompt).toContain("Do not narrate internal skill selection");
    expect(prompt).toContain("Do not narrate MCP/tool plumbing");
    expect(prompt).toContain("use readable LaTeX math notation with Markdown math delimiters");
    expect(prompt).toContain("Do not write raw ASCII math");
  });

  it("pins visible replies to the selected English display language", () => {
    const prompt = buildTurnPrompt(
      "\u3053\u3093\u306b\u3061\u306f",
      createContext(),
      "normal",
      [],
      "chat",
      false,
      "manual",
      { locale: "en", noteSuggestionPolicy: "never" },
    );

    expect(prompt).toContain("Selected plugin display language: English.");
    expect(prompt).toContain("Write all user-visible chat replies");
    expect(prompt).toContain("in English unless the user explicitly asks for another language");
  });

  it("pins visible replies to the selected Japanese display language", () => {
    const prompt = buildTurnPrompt(
      "hello",
      createContext(),
      "normal",
      [],
      "chat",
      false,
      "manual",
      { locale: "ja", noteSuggestionPolicy: "never" },
    );

    expect(prompt).toContain("Selected plugin display language: Japanese.");
    expect(prompt).toContain("in Japanese unless the user explicitly asks for another language");
  });

  it("injects the managed SVG diagram contract only for diagram generation turns", () => {
    const diagramPrompt = buildTurnPrompt(
      "Turn this concept into a study diagram.",
      createContext({
        selection: "P = V_rms^2 / R",
        selectionSourcePath: "Notes/Power.md",
        targetNotePath: "Notes/Power.md",
      }),
      "normal",
      [],
      "chat",
      false,
      "manual",
      { diagramGeneration: true },
    );
    const normalPrompt = buildTurnPrompt(
      "Explain this concept.",
      createContext(),
      "normal",
      [],
      "chat",
      false,
      "manual",
    );

    expect(diagramPrompt).toContain("obsidian-diagram");
    expect(diagramPrompt).toContain("safe self-contained SVG");
    expect(diagramPrompt).toContain("assets/vaultforgian/diagrams/");
    expect(diagramPrompt).toContain("Do not use external images, data URLs, scripts, event handlers, or foreignObject");
    expect(normalPrompt).not.toContain("obsidian-diagram");
  });

  it("injects requested skill guides when present", () => {
    const prompt = buildTurnPrompt(
      "Use $deep-read on this paper",
      createContext({
        skillGuideText:
          "Requested skill guides:\n\nSkill guide: $deep-read\nPath: /skills/deep-read/SKILL.md\nDescription: Read the paper deeply.\n\n# Deep Read\nRead source material deeply.",
      }),
      "normal",
      ["deep-read"],
      "chat",
      false,
      "manual",
    );

    expect(prompt).toContain("Required and auto-selected skill orchestration is active for this turn.");
    expect(prompt).toContain("Priority order for this turn: safety/source contracts > required/auto skill orchestration > StudyTurnPlan");
    expect(prompt).toContain("Skill orchestration plan");
    expect(prompt).toContain("Required skills: $deep-read");
    expect(prompt).toContain("Auto-selected skills: none");
    expect(prompt).toContain("$deep-read -> source_read");
    expect(prompt).toContain("Requested skill guides are attached for this turn.");
    expect(prompt).toContain("Do not say that an attached requested skill is unavailable");
    expect(prompt).toContain("Skill guide: $deep-read");
    expect(prompt).toContain("# Deep Read");
  });

  it("keeps selected skill orchestration and adds visible question-first skill declaration rules", () => {
    const studyTurnPlan: StudyTurnPlan = {
      objective: "Continue a study review.",
      teachingMode: "coach",
      focusConcepts: ["right triangles"],
      likelyStuckPoint: "Confuses the hypotenuse with a leg.",
      sourceStrategy: "use_note",
      checkQuestion: "Which side is longest?",
      nextAction: "Ask one reverse problem.",
      selectedSkillNames: ["brainstorming", "deep-read", "academic-paper"],
      recommendedSkills: [],
      panelSignals: [],
      visibleReplyGuidance: "Keep it short.",
    };
    const prompt = buildTurnPrompt(
      "Help me study this lecture material.",
      createContext({
        studyWorkflow: "review",
        workflowText: "Active study workflow: Review",
        studyCoachText: "Panel memory carry-forward:\n- Weak concepts: Pythagorean theorem",
        skillGuideText: [
          "Requested skill guides:",
          "",
          "Skill guide: $academic-paper",
          "Path: /skills/academic-paper/SKILL.md",
          "Description: Academic paper writing skill.",
          "",
          "Skill guide: $brainstorming",
          "Path: /skills/brainstorming/SKILL.md",
          "Description: Generate creative options before work.",
          "",
          "Skill guide: $deep-read",
          "Path: /skills/deep-read/SKILL.md",
          "Description: Read source material deeply.",
        ].join("\n"),
      }),
      "skill",
      ["academic-paper", "brainstorming", "deep-read"],
      "chat",
      false,
      "manual",
      { studyTurnPlan, turnIntentKind: "note_answer" },
    );

    expect(prompt).toContain("Skill orchestration plan");
    expect(prompt).toContain("Required skills: $academic-paper / $brainstorming / $deep-read");
    expect(prompt).toContain("$brainstorming -> brainstorm");
    expect(prompt).toContain("$deep-read -> source_read");
    expect(prompt).toContain("$academic-paper -> execute");
    expect(prompt).not.toContain("A hidden StudyTurnPlan");
    expect(prompt).not.toContain("- Check question:");
    expect(prompt).not.toContain("- Next action:");
    expect(prompt).toContain("Do not reveal the skill order, skill loading, or internal orchestration");
    expect(prompt).toContain("Visible behavior required by a skill guide is not internal orchestration");
    expect(prompt).toContain("First, I’ll use /brainstorming.");
    expect(prompt).toContain("まず /brainstorming skill を使用します。");
    expect(prompt).toContain("For a required brainstorming-style skill");
    expect(prompt).toContain("unless the user explicitly asks for a direct answer without questions");
    expect(prompt).not.toContain("unless the user's request is already fully specified");
    expect(prompt).toContain("Do not emit `obsidian-suggest` while a selected skill is still asking questions");
    expect(prompt).toContain("Do not offer an apply-to-note CTA during a skill turn unless the user explicitly asks");
    expect(prompt).toContain("When Learning Mode is off, do not add study-coach `Check question`, `Next action`");
  });

  it("forbids rewrite/apply invitations in skill turns unless the user explicitly asks for note edits", () => {
    const prompt = buildTurnPrompt(
      "Help me study this lecture material.",
      createContext({
        targetNotePath: "Pythagorean Theorem.md",
        sourceAcquisitionMode: "vault_note",
        noteSourcePackText: "Target note source pack",
        skillGuideText: "Requested skill guides:\n\nSkill guide: $brainstorming\nPath: /skills/brainstorming/SKILL.md",
      }),
      "skill",
      ["brainstorming", "lecture-read"],
      "chat",
      false,
      "manual",
      { noteSuggestionPolicy: "eligible", turnIntentKind: "note_answer" },
    );

    expect(prompt).not.toContain("you may end with one short question asking whether to apply it to the note now");
    expect(prompt).not.toContain("append a fenced `obsidian-suggest` JSON block");
    expect(prompt).toContain("Do not mention note changes");
    expect(prompt).toContain("Do not offer an apply-to-note CTA during a skill turn unless the user explicitly asks");
    expect(prompt).toContain("Do not end the skill reply with unsolicited questions like");
  });

  it("treats panel skill continuations as the next phase after brainstorming choices", () => {
    const prompt = buildTurnPrompt(
      "2",
      createContext({
        targetNotePath: "Pythagorean Theorem.md",
        sourceAcquisitionMode: "vault_note",
        noteSourcePackText: "Target note source pack",
        skillGuideText: [
          "Requested skill guides:",
          "",
          "Skill guide: $brainstorming",
          "Path: /skills/brainstorming/SKILL.md",
          "",
          "Skill guide: $lecture-read",
          "Path: /skills/lecture-read/SKILL.md",
          "",
          "Skill guide: $paper-visualizer",
          "Path: /skills/paper-visualizer/SKILL.md",
        ].join("\n"),
      }),
      "skill",
      ["brainstorming", "lecture-read", "paper-visualizer"],
      "chat",
      false,
      "manual",
      { turnIntentKind: "note_answer", skillContinuation: true },
    );

    expect(prompt).toContain("This is a continuation of the same Panel Studio skill route.");
    expect(prompt).toContain("If the latest user message is a short numeric or option choice");
    expect(prompt).toContain("do not restart /brainstorming");
    expect(prompt).toContain("advance to the next useful skill phase");
    expect(prompt).toContain("When $lecture-read is active");
    expect(prompt).toContain("When $paper-visualizer is active");
    expect(prompt).toContain("compact visual artifact");
    expect(prompt).toContain("Complete the remaining route in this same reply");
    expect(prompt).toContain("Do not stop after the brainstorming choice to ask for note rewrite/apply");
    expect(prompt).toContain("Next, I’ll use /lecture-read, then /paper-visualizer for option 2.");
    expect(prompt).toContain("This step is complete. Continue to the next study step?");
    expect(prompt).toContain("ここまでで一段落です。次に進みますか？");
    expect(prompt).toContain("This neutral skill checkpoint is allowed even when Learning Mode is off");
    expect(prompt).toContain("It is not a note apply/rewrite CTA");
  });

  it("keeps rewrite/apply instructions available for explicit skill note-edit requests", () => {
    const prompt = buildTurnPrompt(
      "rewrite this note with /lecture-read",
      createContext({
        targetNotePath: "Pythagorean Theorem.md",
        sourceAcquisitionMode: "vault_note",
        noteSourcePackText: "Target note source pack",
        skillGuideText: "Requested skill guides:\n\nSkill guide: $lecture-read\nPath: /skills/lecture-read/SKILL.md",
      }),
      "skill",
      ["lecture-read"],
      "chat",
      false,
      "manual",
      { noteSuggestionPolicy: "eligible", turnIntentKind: "note_answer" },
    );

    expect(prompt).toContain("obsidian-suggest");
    expect(prompt).toContain("rewrite_followup");
    expect(prompt).toContain("unless the user explicitly asks to rewrite, edit, apply, add, or reflect content into a note");
  });

  it("can inject required, auto-selected, and skipped skill orchestration details", () => {
    const skillOrchestrationPlan = buildSkillOrchestrationPlan(["deep-read"], {
      prompt: "Review the frequency response source and explain the weak concept.",
      weakConceptLabels: ["frequency response phase"],
      candidates: [
        { name: "deep-read", description: "Read source material deeply.", userOwned: true },
        {
          name: "bode-drill",
          description: "Practice frequency response phase drills.",
          userOwned: true,
          panelPreferred: true,
        },
        { name: "quiet-helper", description: "Unrelated helper.", userOwned: true },
      ],
    });
    const prompt = buildTurnPrompt(
      "Review the frequency response source.",
      createContext(),
      "skill",
      skillOrchestrationPlan?.selectedSkills ?? ["deep-read"],
      "chat",
      false,
      "manual",
      { skillOrchestrationPlan },
    );

    expect(prompt).toContain("Required skills: $deep-read");
    expect(prompt).toContain("Auto-selected skills: $bode-drill");
    expect(prompt).toContain("Skipped skills: $quiet-helper");
    expect(prompt).toContain("Confidence:");
    expect(prompt).toContain("Priority order for this turn: safety/source contracts > required/auto skill orchestration > StudyTurnPlan");
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
      createContext({ studyWorkflow: "review" }),
      "normal",
      [],
      "chat",
      false,
      "manual",
      { learningMode: true },
    );

    expect(prompt).toContain("Learning mode is active for this tab.");
    expect(prompt).toContain("Use the attached LearningCoachPlan");
    expect(prompt).toContain("one short hint");
    expect(prompt).toContain("at most one scaffold");
    expect(prompt).toContain("one short understanding-check question");
    expect(prompt).toContain("next action");
    expect(prompt).toContain("```obsidian-study-contract");
    expect(prompt).toContain("Do not show the contract JSON");
  });

  it("keeps quiz questions before hints even when learning mode is hint-first", () => {
    const prompt = buildTurnPrompt(
      "quiz me on this note",
      createContext({
        studyWorkflow: "review",
        studyCoachText: [
          "Study quiz session:",
          "- Current quiz: Quiz 1/5.",
          "- Ask exactly one question as Quiz 1/5.",
          "- Question order: show the Quiz heading and question first, then any optional hint.",
        ].join("\n"),
      }),
      "normal",
      [],
      "chat",
      false,
      "manual",
      { learningMode: true },
    );

    expect(prompt).not.toContain("Default to hint-first support");
    expect(prompt).toContain("Question order: show the Quiz heading and question first, then any optional hint.");
    expect(prompt).toContain("For active quiz turns, the quiz question order overrides generic hint-first coaching:");
    expect(prompt).toContain("Do not lead with `Hint:` for a fresh quiz question.");
  });

  it("lets direct-answer requests bypass the coaching preamble for that turn", () => {
    const prompt = buildTurnPrompt(
      "Just give me the answer: what is a Laplace transform?",
      createContext({ studyWorkflow: "review" }),
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
    expect(prompt).toContain("```obsidian-study-contract");
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
