import type { TFile } from "obsidian";
import type {
  ComposerAttachment,
  ConversationTabState,
  StudyRecipe,
  StudyWorkflowKind,
  TurnContextSnapshot,
  UserAdaptationMemory,
} from "../../model/types";
import { resolveEditTarget } from "../../util/editTarget";
import type { SupportedLocale, getLocalizedCopy } from "../../util/i18n";
import {
  buildAttachmentContentPackResult,
  buildAttachmentPromptManifest,
  PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS,
  PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS_PER_FILE,
} from "../../util/composerAttachments";
import { buildPluginFeatureGuideText } from "../../util/pluginFeatureGuides";
import {
  buildSourceAcquisitionContractText,
  type SourceAcquisitionMode,
} from "../../util/sourceAcquisition";
import { buildPaperStudyRuntimeOverlayText } from "../../util/paperStudyRuntimeOverlay";
import { buildRequestedSkillGuideText } from "../../util/skillGuides";
import type { InstalledSkillDefinition } from "../../util/skillCatalog";
import { buildPaperStudyGuideText, shouldAttachPaperStudyGuide } from "../../util/studyTurnGuides";
import { buildStudyWorkflowRuntimeBrief, type StudyWorkflowPromptContext } from "../../util/studyWorkflows";
import { buildUserAdaptationMemoryText } from "../../util/userAdaptation";
import { agentContextBundleFromTurnContext, type AgentContextBundle } from "./types";

type LocalizedCopy = ReturnType<typeof getLocalizedCopy>;

export interface AgentContextAssembly {
  context: TurnContextSnapshot;
  bundle: AgentContextBundle;
}

export interface AgentContextAssemblerInput {
  tabId: string;
  file: TFile | null;
  prompt: string;
  slashCommand: string | null;
  attachments: readonly ComposerAttachment[];
  mentionContextText: string | null;
  explicitTargetNotePath: string | null;
  mentionSkillNames: readonly string[];
  mentionSourcePathHints: readonly string[];
  workingDirectoryHint: string | null;
  skillNames: readonly string[];
  resolvedSkillDefinitions: readonly InstalledSkillDefinition[];
}

export interface AgentContextAssemblerDeps {
  getLocale: () => SupportedLocale;
  getLocalizedCopy: () => LocalizedCopy;
  findDailyNotePath: () => Promise<string | null>;
  findTab: (tabId: string) => Pick<
    ConversationTabState,
    | "selectionContext"
    | "studyWorkflow"
    | "activeStudyRecipeId"
    | "summary"
    | "lineage"
    | "studyCoachState"
    | "activeStudySkillNames"
  > | null;
  resolveTargetNotePath: (tabId: string) => string | null;
  getActivePanelId: (tabId: string) => string | null;
  getHubPanels: () => readonly StudyRecipe[];
  getStudyHubState: () => { isCollapsed: boolean };
  buildWorkflowPromptContext: (
    tabId: string,
    workflow: StudyWorkflowKind | null,
    currentFilePath: string | null,
  ) => StudyWorkflowPromptContext;
  captureContextPackText: (tabId: string, excludedPaths: string[]) => Promise<string | null>;
  captureVaultNoteSourcePackText: (
    activeFile: TFile | null,
    targetNotePath: string | null,
    selectionSourcePath: string | null,
    prompt: string,
  ) => Promise<string | null>;
  resolveVaultRoot: () => string;
  buildStudyCoachCarryForwardText: (tab: Pick<ConversationTabState, "studyWorkflow" | "studyCoachState" | "activeStudySkillNames"> | null) => string | null;
  getUserAdaptationMemory: () => UserAdaptationMemory | null;
}

export class AgentContextAssembler {
  constructor(private readonly deps: AgentContextAssemblerDeps) {}

  async assembleTurnContext(input: AgentContextAssemblerInput): Promise<AgentContextAssembly> {
    const dailyNotePath = await this.deps.findDailyNotePath();
    const tab = this.deps.findTab(input.tabId);
    const selectionContext = input.slashCommand === "/selection" ? null : tab?.selectionContext ?? null;
    const selection = selectionContext?.text ?? null;
    const targetNotePath = resolveEditTarget({
      explicitTargetPath: input.explicitTargetNotePath,
      selectionSourcePath: selectionContext?.sourcePath ?? null,
      activeFilePath: input.file?.path ?? null,
      sessionTargetPath: this.deps.resolveTargetNotePath(input.tabId),
    }).path;
    const studyWorkflow = tab?.studyWorkflow ?? null;
    const activePanelId = tab?.activeStudyRecipeId ?? this.deps.getActivePanelId(input.tabId);
    const workflowContext = this.deps.buildWorkflowPromptContext(input.tabId, studyWorkflow, input.file?.path ?? null);
    const pluginFeatureText = buildPluginFeatureGuideText({
      prompt: input.prompt,
      locale: this.deps.getLocale(),
      copy: this.deps.getLocalizedCopy(),
      panels: this.deps.getHubPanels(),
      activePanelId,
      isCollapsed: this.deps.getStudyHubState().isCollapsed,
      targetNotePath,
    });
    const excludedContextPaths = [
      input.slashCommand === "/note" ? input.file?.path ?? null : null,
      input.slashCommand === "/daily" ? dailyNotePath : null,
    ].filter((entry): entry is string => Boolean(entry));
    const contextPackText = await this.deps.captureContextPackText(input.tabId, excludedContextPaths);
    const noteSourcePackText = await this.deps.captureVaultNoteSourcePackText(
      input.file,
      targetNotePath,
      selectionContext?.sourcePath ?? input.file?.path ?? null,
      input.prompt,
    );
    const attachmentManifestText = buildAttachmentPromptManifest(input.attachments);
    const paperStudyTurn = shouldAttachPaperStudyGuide({
      locale: this.deps.getLocale(),
      studyWorkflow,
      skillNames: input.skillNames,
      attachmentKinds: input.attachments.map((attachment) => attachment.kind),
    });
    const attachmentContentPack = await buildAttachmentContentPackResult(
      this.deps.resolveVaultRoot(),
      input.attachments,
      paperStudyTurn
        ? {
            maxChars: PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS,
            maxCharsPerFile: PAPER_STUDY_ATTACHMENT_CONTENT_MAX_CHARS_PER_FILE,
          }
        : undefined,
    );
    const attachmentContentText = attachmentContentPack.text;
    const studyCoachText = this.deps.buildStudyCoachCarryForwardText(tab);
    const conversationSummaryText =
      tab?.lineage.pendingThreadReset && tab.summary?.text.trim()
        ? ["Conversation carry-forward summary", tab.summary.text.trim()].join("\n\n")
        : null;
    const sourceAcquisitionMode: SourceAcquisitionMode = attachmentContentText
      ? "paper_attachment"
      : noteSourcePackText
        ? "vault_note"
        : input.mentionContextText?.includes("Mentioned external directory") ||
            input.mentionContextText?.includes("Mentioned external directory (provenance)")
          ? "external_bundle"
          : "workspace_generic";
    const sourceAcquisitionContractText = buildSourceAcquisitionContractText({
      locale: this.deps.getLocale(),
      mode: sourceAcquisitionMode,
      hasSourcePackage: Boolean(attachmentContentText || noteSourcePackText),
    });
    const paperStudyRuntimeOverlayText = buildPaperStudyRuntimeOverlayText({
      locale: this.deps.getLocale(),
      studyWorkflow,
      skillNames: input.skillNames,
      hasAttachmentContent: Boolean(attachmentContentText),
    });
    const skillGuideText = await buildRequestedSkillGuideText(input.skillNames, input.resolvedSkillDefinitions, {
      paperStudyAttachmentTurn: Boolean(attachmentContentText) && paperStudyTurn,
    });
    const paperStudyGuideText = buildPaperStudyGuideText({
      locale: this.deps.getLocale(),
      studyWorkflow,
      skillNames: input.skillNames,
      attachmentKinds: input.attachments.map((attachment) => attachment.kind),
    });
    const context: TurnContextSnapshot = {
      activeFilePath: input.file?.path ?? null,
      targetNotePath,
      studyWorkflow,
      studyCoachText,
      userAdaptationText: buildUserAdaptationMemoryText(this.deps.getUserAdaptationMemory(), activePanelId),
      conversationSummaryText,
      sourceAcquisitionMode,
      sourceAcquisitionContractText,
      workflowText: studyWorkflow ? buildStudyWorkflowRuntimeBrief(studyWorkflow, workflowContext, this.deps.getLocale()) : null,
      pluginFeatureText,
      paperStudyRuntimeOverlayText,
      skillGuideText,
      paperStudyGuideText,
      mentionContextText: input.mentionContextText,
      selection: selection || null,
      selectionSourcePath: selectionContext?.sourcePath ?? input.file?.path ?? null,
      vaultRoot: this.deps.resolveVaultRoot(),
      dailyNotePath,
      contextPackText,
      attachmentManifestText,
      attachmentContentText,
      noteSourcePackText,
      attachmentMissingPdfTextNames: attachmentContentPack.missingPdfTextAttachmentNames,
      attachmentMissingSourceNames: attachmentContentPack.missingSourceAttachmentNames,
    };

    return {
      context,
      bundle: agentContextBundleFromTurnContext(context, {
        attachments: input.attachments,
        mentionSkillNames: input.mentionSkillNames,
        mentionSourcePathHints: input.mentionSourcePathHints,
        explicitTargetNotePath: input.explicitTargetNotePath,
        workingDirectoryHint: input.workingDirectoryHint,
      }),
    };
  }
}
