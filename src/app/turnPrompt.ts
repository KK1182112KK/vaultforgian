import type { ComposeMode, RuntimeMode, TurnContextSnapshot } from "../model/types";
import type { NoteApplyPolicy } from "../util/permissionMode";
import {
  buildDelimiterPatchExample,
  buildPatchMathFormattingRules,
  buildQuotedPatchMathFormattingRules,
} from "../util/patchPromptContract";
import { allowsVaultWrite as promptAllowsVaultWrite } from "../util/vaultEdit";

const DIRECT_ANSWER_PATTERNS: readonly RegExp[] = [
  /\bjust give me the answer\b/i,
  /\bjust tell me\b/i,
  /\bdirect answer\b/i,
  /\banswer first\b/i,
  /\bskip the questions\b/i,
  /\bno hints\b/i,
  /\bshow me the solution\b/i,
  /答えだけ/,
  /先に答え/,
  /そのまま答え/,
  /質問しないで/,
  /ヒントはいらない/,
  /解答だけ/,
  /結論から/,
];

const EXPLANATION_PATTERNS: readonly RegExp[] = [
  /\bexplain\b/i,
  /\bteach me\b/i,
  /\bhelp me understand\b/i,
  /\bwalk me through\b/i,
  /\bstudy\b/i,
  /\blearn\b/i,
  /\breview\b/i,
  /\bwhat is\b/i,
  /\bhow does\b/i,
  /\bwhy\b/i,
  /説明/,
  /教えて/,
  /理解/,
  /勉強/,
  /復習/,
  /なぜ/,
  /どうして/,
  /とは/,
  /解説/,
];

function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function shouldUseLearningMode(
  prompt: string,
  context: TurnContextSnapshot,
  composeMode: ComposeMode,
  allowVaultWrite: boolean,
): boolean {
  if (composeMode !== "chat" || allowVaultWrite) {
    return false;
  }
  if (promptAllowsVaultWrite(prompt)) {
    return false;
  }
  if (context.studyWorkflow) {
    return true;
  }
  return matchesAnyPattern(prompt, EXPLANATION_PATTERNS);
}

export function buildTurnPrompt(
  prompt: string,
  context: TurnContextSnapshot,
  mode: RuntimeMode,
  skillNames: string[],
  composeMode: ComposeMode,
  allowVaultWrite: boolean,
  noteApplyPolicy: NoteApplyPolicy,
  options: {
    preferredName?: string | null;
    customSystemPrompt?: string | null;
    shellBlocklist?: readonly string[];
    learningMode?: boolean;
  } = {},
): string {
  const instructions = [
    "You are Codex embedded in an Obsidian vault.",
    "Prefer concise, practical markdown answers.",
    context.sourceAcquisitionContractText
      ? context.noteSourcePackText
        ? "A source acquisition contract and vault note source pack are attached for this turn. Treat them as the canonical note source and do not reopen local files."
        : "A source acquisition contract is attached for this turn. Follow it before attempting any local reads."
      : context.paperStudyRuntimeOverlayText && context.attachmentContentText
        ? "Use the attached source package directly instead of re-acquiring local source files."
        : "Use the local workspace directly instead of guessing note contents.",
    composeMode === "plan"
      ? 'Planmode is active for this turn. Treat this as a specification interview. Ask exactly one high-impact clarifying question at a time until the request is decision-complete, then summarize the agreed plan. When the plan is ready to implement, append a fenced `obsidian-plan` JSON block with {"status":"ready_to_implement","summary":"..."} after the visible summary. Do not edit files, do not apply patches, and do not make lasting workspace changes.'
      : [
          "Chat mode is active for this turn.",
          "If you are giving a study/explanation answer about a note, lecture, paper, or homework AND you are not emitting an `obsidian-patch`, `obsidian-ops`, or `obsidian-plan` block, start the visible answer with one short status line saying the note was not changed yet, then end with one short question asking whether to apply it to the note now.",
          "After that visible question, append a fenced `obsidian-suggest` JSON block with `{\"kind\":\"rewrite_followup\",\"summary\":\"...\",\"question\":\"...\"}` so the plugin can show the rewrite CTA.",
          "Use the user's language for that visible question. Skip this suggestion block only when the user explicitly says not to edit or not to suggest note changes.",
        ].join("\n"),
    allowVaultWrite
      ? [
          "You are this user's Obsidian note-editing assistant. The vault is the user's knowledge base and your job is to EDIT it when they ask you to. Edits flow through the plugin's approval UI via fenced `obsidian-patch` and `obsidian-ops` blocks - NEVER by shell/apply_patch/write tools.",
          noteApplyPolicy === "manual"
            ? "This turn is in Suggest only mode. The user has explicitly asked for an edit, so you should emit an `obsidian-patch` or `obsidian-ops` block for the requested note change, but the plugin will not auto-apply it."
            : noteApplyPolicy === "approval"
              ? "This turn is in Review before applying mode. Emit `obsidian-patch` or `obsidian-ops` blocks for requested note changes; the plugin will hold them for user review."
              : "This turn is in Apply automatically mode. Emit `obsidian-patch` or `obsidian-ops` blocks for requested note changes; the plugin may auto-apply them unless review is required for readability or safety.",
          "Treat a turn as note editing when the user asks you to change the note, including common phrasings like improve, translate, reformat, expand, clean up, or turn content into the note.",
          "Target resolution for note edits: prefer an explicitly mentioned note or path first, then the selection source note, then the active note for this turn, then the session target note. If none of those resolve, ask one short question instead of guessing.",
          "HARD RULES (violations produce bad UX and must be avoided):",
          "1. If the user explicitly asks you to change a note (\"edit\", \"rewrite\", \"fix\", \"add to note\", \"apply to note\", \"summarize into the note\", etc.), you MUST emit an `obsidian-patch` block or `obsidian-ops` block. Do NOT paste the rewritten content inline as prose or in ```markdown blocks.",
          '2. If you are already making a note change, do NOT ask permission phrases like "パッチを生成しましょうか", "Should I apply this?", or "Want me to turn this into a patch?". Just emit the patch. The user reviews and approves in the UI; that is the approval step.',
          "3. Do NOT write to files under the vault with shell tools, apply_patch, sed, echo >, tee, Python file writes, or any other means. The plugin is the only writer. If you try to write via shell, your edit will race the plugin's approval flow and corrupt the user's note.",
          "4. For edit-related turns, start the visible answer with one short status line that says what happened, then keep the rest to at most 2-3 short sentences that summarize WHAT changed and WHY. Do not repeat the new note contents in the chat.",
          '5. FUTURE TENSE BANNED: Do not announce "I will return a patch", "パッチとして返します", "差し替え版を作ります", "次に修正版を返します" or similar future-tense promises. If you have a patch to make, emit the block now. Announcing a patch without emitting it breaks the UI.',
          "Patch block schema (PRIMARY FORMAT - delimiter-based, NOT JSON):",
          "- Fence: ```obsidian-patch ... ```",
          '- Header lines at the top (one per line, `key: value`): `path:` (required, vault-relative), `kind:` ("create" or "update"), `summary:` (short sentence).',
          "- Optional repeated header lines: `evidence: kind|label|sourceRef|snippet`. `kind` must be `vault_note`, `attachment`, or `web`. Keep each snippet short and single-line.",
          '- After the header, anchor entries use delimiter markers on their own lines: `---anchorBefore`, `---anchorAfter`, `---replacement`, `---end`. Between the markers, write the field body VERBATIM - real newlines, real `$`, real `"`, real backslashes, no escaping. The plugin reads the raw text between markers.',
          "- For any edit on an existing note longer than ~2000 characters you MUST use anchor entries, not full content. `anchorBefore` and `anchorAfter` are verbatim substrings from the current note that appear exactly once and sandwich the region you are changing; the plugin inserts `replacement` between them and keeps the anchors themselves unchanged. Emit multiple anchor entries (`---anchorBefore` ... `---end` repeated) to touch multiple regions in one patch.",
          "- For `create` kind (new note), use `---content` ... `---end` once instead of anchor entries.",
          ...buildPatchMathFormattingRules().map((line) => `- ${line}`),
          ...buildQuotedPatchMathFormattingRules().map((line) => `- ${line}`),
          "- Example (delimiter format - this is what you MUST emit):",
          buildDelimiterPatchExample("Notes/Example.md").replace(
            "summary: <one short sentence describing the change>",
            "summary: Convert ASCII math to LaTeX in the Core Equations section",
          ),
          "- For rename/move/property/task edits emit an `obsidian-ops` JSON block with an `ops` array instead (ops are short - JSON is fine there).",
          "- For explanation answers that do NOT emit a patch, start by stating that the note was not changed yet and MAY append an `obsidian-suggest` block with `kind: rewrite_followup` so the plugin can offer a one-click apply-to-note CTA.",
          'If the user explicitly says "just show me" or "don\'t edit, just suggest", then skip the patch block and describe the change in prose. Otherwise, emit a patch block whenever the user asks to revise the note, even if they say improve, translate, reformat, expand, or clean it up instead of literally saying edit.',
        ].join("\n")
      : "Default to analysis and explanation unless a concrete workspace change is clearly required by the user and permitted by the active sandbox.",
    `Vault root: ${context.vaultRoot}`,
    `Active note path: ${context.activeFilePath ?? "none"}`,
    `Session target note path: ${context.targetNotePath ?? "none"}`,
    `Active study workflow: ${context.studyWorkflow ?? "none"}`,
    `Study coach carry-forward: ${context.studyCoachText ? "attached" : "none"}`,
    `User adaptation memory: ${context.userAdaptationText ? "attached" : "none"}`,
    `Conversation carry-forward summary: ${context.conversationSummaryText ? "attached" : "none"}`,
    `Source acquisition mode: ${context.sourceAcquisitionMode}`,
    `Source acquisition contract: ${context.sourceAcquisitionContractText ? "attached" : "none"}`,
    `Paper-study runtime overlay: ${context.paperStudyRuntimeOverlayText ? "attached" : "none"}`,
    `Requested skill guides: ${context.skillGuideText ? "attached" : "none"}`,
    `Paper-study guidance: ${context.paperStudyGuideText ? "attached" : "none"}`,
    `Explicit mentions: ${context.mentionContextText ? "attached" : "none"}`,
    `Selection snapshot: ${context.selection ? `attached from ${context.selectionSourcePath ?? "the current note"}` : "none"}`,
    `Vault note source pack: ${context.noteSourcePackText ? "attached" : "none"}`,
    `File/image attachments: ${context.attachmentManifestText ? "attached" : "none"}`,
    `Attachment content pack: ${context.attachmentContentText ? "attached" : "none"}`,
    `Daily note path: ${context.dailyNotePath ?? "none"}`,
  ];

  if (options.preferredName?.trim()) {
    instructions.push(`If you address the user directly, call them "${options.preferredName.trim()}".`);
  }

  if ((options.shellBlocklist?.length ?? 0) > 0) {
    instructions.push(`User-configured blocked shell patterns: ${options.shellBlocklist?.join(", ")}`);
    instructions.push("Do not propose or rely on shell commands matching those blocked patterns.");
  }

  const learningModeActive = Boolean(options.learningMode) && shouldUseLearningMode(prompt, context, composeMode, allowVaultWrite);
  if (learningModeActive) {
    const directAnswerRequested = matchesAnyPattern(prompt, DIRECT_ANSWER_PATTERNS);
    if (directAnswerRequested) {
      instructions.push(
        "Learning mode is active for this tab. Use a study-coach response structure for study and explanation turns. Because the user explicitly asked for the direct answer in this turn, Give the direct answer first.",
      );
      instructions.push(
        "After the direct answer, still include one short understanding-check question, name one likely point of confusion, suggest the next study step, and append a fenced `obsidian-study-checkpoint` JSON block after the visible answer. Use this literal fence label: ```obsidian-study-checkpoint",
      );
    } else {
      instructions.push(
        "Learning mode is active for this tab. Use a study-coach response structure for study and explanation turns: lead with the key explanation, include one short understanding-check question, name a likely point of confusion, and end with the next study step.",
      );
      instructions.push(
        "After the visible answer, append a fenced `obsidian-study-checkpoint` JSON block with keys `workflow`, `mastered`, `unclear`, `next_step`, and `confidence_note`. Keep the checkpoint factual and concise so the plugin can carry it forward into the next turn. Use this literal fence label: ```obsidian-study-checkpoint",
      );
      instructions.push(
        "Do not force this study-coach contract onto note-editing, patch-generation, implementation, or operational tasks.",
      );
    }
  }

  if (context.pluginFeatureText) {
    instructions.push("A plugin feature guide is attached for this turn. Answer plugin-UI questions from that guide first.");
    instructions.push(
      "Do not claim local search/read failures or fall back to generic web-style instructions when the attached plugin feature guide already answers the question.",
    );
  }

  if (mode === "skill" && skillNames.length > 0) {
    instructions.push(`Explicit skill references present: ${skillNames.map((name) => `$${name}`).join(", ")}`);
    instructions.push("Honor the explicit $skill references present in the user request.");
  }

  if (context.paperStudyRuntimeOverlayText) {
    instructions.push(
      "A paper-study runtime overlay is attached for this turn. It overrides attached skill guides and any source-bundle/path hints in the user request.",
    );
    instructions.push("Do not perform a second local PDF ingestion pass when the attached source text is already present.");
    instructions.push("Do not call shell or file-reading tools for source acquisition in this turn.");
  }

  if (context.sourceAcquisitionContractText) {
    instructions.push("A source acquisition contract is attached for this turn. Follow it before any shell or file-read step.");
    instructions.push("Do not let raw path hints in the user request override the attached source acquisition contract.");
  }

  if (context.skillGuideText) {
    instructions.push(
      context.paperStudyRuntimeOverlayText
        ? "Requested skill guides are attached for this turn. Follow them only where they do not conflict with the paper-study runtime overlay and attached source contract."
        : "Requested skill guides are attached for this turn. Treat them as the authoritative local skill instructions even if your runtime skill list differs.",
    );
    instructions.push("Do not say that an attached requested skill is unavailable when its local guide is attached below.");
  }

  if (context.conversationSummaryText) {
    instructions.push("A carry-forward conversation summary is attached for this turn because the prior thread was compacted.");
    instructions.push("Use the attached conversation summary as prior thread context for this fresh thread.");
  }

  if (learningModeActive && context.studyCoachText) {
    instructions.push("A study coach carry-forward summary is attached for this turn.");
    instructions.push("Use it to continue from the learner's latest recap, unresolved weak point, and next study step.");
  }

  if (context.userAdaptationText) {
    instructions.push("A user adaptation memory summary is attached for this turn.");
    instructions.push(
      "Use it as a lightweight personalization hint for explanation depth, note-structuring preferences, and panel-specific habits.",
    );
    instructions.push("Do not quote it back to the user and do not treat it as a hard rule when the current request conflicts.");
  }

  if (context.paperStudyGuideText) {
    instructions.push("A paper-study guide is attached for this turn. Follow it before falling back to generic paper-reading instructions.");
    instructions.push(
      "When attached paper text is present, do not fall back to generic 'paste the abstract' or 'local read failed' instructions.",
    );
  }

  if (context.attachmentContentText) {
    instructions.push("An attachment content pack is attached for this turn. Use it as the primary source evidence before asking for pasted excerpts.");
    instructions.push(
      "If the attachment content pack includes explicit PDF metadata such as total page count or excerpt coverage, answer from that metadata directly instead of claiming the total pages are unknown.",
    );
    instructions.push("Do not narrate sandbox, shell, or local-read troubleshooting when the attachment content pack already covers the source.");
  }

  if (context.noteSourcePackText) {
    instructions.push("A vault note source pack is attached for this turn. Use it as the primary note evidence before reopening local files.");
    instructions.push("Do not call shell or file-reading tools for note acquisition in this turn.");
    instructions.push("Do not narrate sandbox, shell, or local-read troubleshooting when the vault note source pack already covers the note.");
    instructions.push("For note-improvement turns, stay anchored to the attached note source pack and return note-specific guidance or note patches directly.");
    instructions.push("Do not claim that the note could not be inspected when the vault note source pack is already attached for this turn.");
  }

  const selectionBlock = context.selection
    ? [
        context.selectionSourcePath ? `Selected text from ${context.selectionSourcePath}` : "Selected text",
        `\`\`\`md\n${context.selection}\n\`\`\``,
      ].join("\n\n")
    : null;

  return [
    instructions.join("\n"),
    context.sourceAcquisitionContractText,
    learningModeActive ? context.studyCoachText ?? null : null,
    context.userAdaptationText,
    context.conversationSummaryText,
    context.workflowText,
    context.pluginFeatureText,
    context.paperStudyRuntimeOverlayText,
    context.skillGuideText,
    context.paperStudyGuideText,
    context.mentionContextText,
    selectionBlock,
    context.noteSourcePackText,
    context.attachmentManifestText,
    context.attachmentContentText,
    context.contextPackText,
    options.customSystemPrompt?.trim() ? ["User-added system instructions:", options.customSystemPrompt.trim()].join("\n\n") : null,
    "User request:",
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}
