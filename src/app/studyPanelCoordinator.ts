import { existsSync, promises as fs, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { TFile, type App } from "obsidian";
import { AgentStore } from "../model/store";
import type {
  ChatSuggestion,
  ComposerAttachment,
  ConversationTabState,
  PanelSessionOrigin,
  StudyRecipe,
  StudyWorkflowKind,
} from "../model/types";
import type { LocalizedCopy, SupportedLocale } from "../util/i18n";
import { makeId } from "../util/id";
import type { InstalledSkillDefinition } from "../util/skillCatalog";
import {
  buildStudyRecipeCommandAlias,
  buildStudySkillDraft,
  evaluateStudyRecipePreflight,
  summarizeStudyRecipeDiff,
  summarizeStudySkillDiff,
  type StudyRecipePreflight,
  type StudyRecipeRuntimeContext,
} from "../util/studyRecipes";
import {
  getStudyWorkflowDefinition,
  type StudyWorkflowPromptContext,
} from "../util/studyWorkflows";
import { normalizeUserPromptWhitespace } from "./promptPipeline";

export const MAX_STUDY_HUB_PANELS = 6;

export const DEFAULT_LINKED_PANEL_SKILLS: Record<StudyWorkflowKind, string[]> = {
  lecture: [],
  review: [],
  paper: [],
  homework: [],
};

const MANAGED_SKILL_ROOT_SEGMENTS = [".codex", "skills"] as const;
const MANAGED_SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

const COMPLETION_KEYWORDS = [
  "done",
  "finished",
  "applied",
  "updated",
  "complete",
  "completed",
  "saved",
  "worked",
  "できた",
  "やった",
  "適用した",
  "更新した",
  "終わった",
  "完了した",
  "保存した",
];

export interface StudyRecipeSavePreview {
  candidate: StudyRecipe;
  existingRecipe: StudyRecipe | null;
  diffSummary: string;
}

export interface StudyRecipeSkillDraft {
  recipe: StudyRecipe;
  skillName: string;
  targetPath: string;
  mode: "create" | "update";
  diffSummary: string;
  content: string;
}

interface ManagedSkillTarget {
  targetPath: string;
  mode: "create" | "update";
  existingContent: string | null;
}

export interface StudyPanelCoordinatorDeps {
  app: App;
  store: AgentStore;
  getLocale: () => SupportedLocale;
  getLocalizedCopy: () => LocalizedCopy;
  getActiveTab: () => ConversationTabState | null;
  findTab: (tabId: string) => ConversationTabState | null;
  getStudyRecipes: () => StudyRecipe[];
  getActiveStudyWorkflow: () => StudyWorkflowKind | null;
  getPreferredTargetFile: () => TFile | null;
  resolveTargetNotePath: (tabId: string) => string | null;
  getTabSessionItems: (tabId: string) => ComposerAttachment[];
  buildWorkflowPromptContext: (
    tabId: string,
    workflow: StudyWorkflowKind | null,
    currentFilePath: string | null,
  ) => StudyWorkflowPromptContext;
  refreshCodexCatalogs: () => Promise<void>;
  resolveVaultRoot: () => string;
  getInstalledSkillCatalog: () => readonly InstalledSkillDefinition[];
}

function summarizePreviewText(text: string, maxLines = 3, maxChars = 220): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
  const joined = lines.join("\n");
  if (joined.length <= maxChars) {
    return joined;
  }
  return `${joined.slice(0, maxChars).trimEnd()}...`;
}

function normalizePanelPromptSnapshot(value: string, activeSkillNames: readonly string[]): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const skillNames = new Set(activeSkillNames.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  const lines = trimmed.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith("/")) {
      const maybeSkill = line.slice(1).trim().toLowerCase();
      if (skillNames.has(maybeSkill)) {
        index += 1;
        continue;
      }
    }
    if (line.startsWith("$")) {
      const maybeSkill = line.slice(1).trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
      if (skillNames.has(maybeSkill)) {
        index += 1;
        continue;
      }
    }
    break;
  }
  return lines.slice(index).join("\n").trim();
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && rel !== ".." && !isAbsolute(rel));
}

function formatPanelSkillDraft(skillNames: readonly string[], body: string): string {
  const aliases = [...new Set(skillNames.map((entry) => entry.trim()).filter(Boolean))].map((skillName) => `/${skillName}`);
  const trimmedBody = body.trim();
  return [...aliases, ...(aliases.length > 0 && trimmedBody ? [""] : []), ...(trimmedBody ? [trimmedBody] : [])].join("\n");
}

function tokenizeForSimilarity(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function containsCompletionKeyword(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return COMPLETION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "message" in value && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  return "Unknown Codex error.";
}

function isPanelCompletionSuggestion(
  suggestion: ChatSuggestion,
): suggestion is ChatSuggestion & { kind: "panel_completion"; panelId: string; panelTitle: string } {
  return suggestion.kind === "panel_completion" && typeof suggestion.panelId === "string" && typeof suggestion.panelTitle === "string";
}

export class StudyPanelCoordinator {
  constructor(private readonly deps: StudyPanelCoordinatorDeps) {}

  getStudyRecipePreflight(recipeId: string, tabId: string | null): StudyRecipePreflight {
    const recipe = this.requireStudyRecipe(recipeId);
    if (!tabId) {
      return evaluateStudyRecipePreflight(recipe, {}, this.deps.getLocale());
    }
    return evaluateStudyRecipePreflight(recipe, this.getStudyRecipeRuntimeContext(tabId), this.deps.getLocale());
  }

  ensureDefaultStudyPanels(): void {
    if (this.deps.getStudyRecipes().length > 0) {
      return;
    }
    const aliases: string[] = [];
    const panels = (["lecture", "review", "paper", "homework"] as const).map((workflow) => {
      const panel = this.buildStudyPanelSeed(workflow, aliases);
      aliases.push(panel.commandAlias);
      return panel;
    });
    this.deps.store.setStudyRecipes(panels);
    const activeTab = this.deps.getActiveTab();
    if (activeTab && panels[0]) {
      this.deps.store.setActiveStudyPanel(activeTab.id, panels[0].id, []);
    }
  }

  createHubPanel(
    initialDraft: Partial<Pick<StudyRecipe, "title" | "description" | "promptTemplate" | "linkedSkillNames">> = {},
  ): StudyRecipe {
    const panels = this.deps.getStudyRecipes();
    if (panels.length >= MAX_STUDY_HUB_PANELS) {
      throw new Error(this.deps.getLocalizedCopy().service.panelLimitReached(MAX_STUDY_HUB_PANELS));
    }
    const created = this.buildBlankPanelSeed(panels.map((entry) => entry.commandAlias));
    const normalizedTitle = initialDraft.title?.trim() ?? "";
    const normalizedLinkedSkillNames = [...new Set((initialDraft.linkedSkillNames ?? []).map((entry) => entry.trim()).filter(Boolean))];
    const finalTitle = normalizedTitle ? this.createUniquePanelTitle(normalizedTitle) : "";
    const finalAlias = finalTitle ? buildStudyRecipeCommandAlias(finalTitle, panels.map((entry) => entry.commandAlias)) : created.commandAlias;
    const finalized: StudyRecipe = {
      ...created,
      title: finalTitle,
      description: initialDraft.description?.trim() ?? created.description,
      promptTemplate: initialDraft.promptTemplate?.trim() ?? created.promptTemplate,
      linkedSkillNames: normalizedLinkedSkillNames,
      commandAlias: finalAlias,
      updatedAt: Date.now(),
    };
    this.deps.store.upsertStudyRecipe(finalized);
    return finalized;
  }

  updateHubPanel(
    panelId: string,
    patch: Partial<Pick<StudyRecipe, "title" | "description" | "promptTemplate" | "linkedSkillNames">>,
  ): StudyRecipe {
    const current = this.requireStudyRecipe(panelId);
    const existingAliases = this.deps
      .getStudyRecipes()
      .filter((entry) => entry.id !== panelId)
      .map((entry) => entry.commandAlias);
    const title = patch.title !== undefined ? this.createUniquePanelTitle(patch.title, panelId) : current.title;
    const updated: StudyRecipe = {
      ...current,
      title,
      description: patch.description !== undefined ? patch.description.trim() : current.description,
      promptTemplate: patch.promptTemplate !== undefined ? patch.promptTemplate.trim() : current.promptTemplate,
      linkedSkillNames:
        patch.linkedSkillNames !== undefined
          ? [...new Set(patch.linkedSkillNames.map((entry) => entry.trim()).filter(Boolean))]
          : [...current.linkedSkillNames],
      commandAlias:
        title !== current.title ? buildStudyRecipeCommandAlias(title, existingAliases) : current.commandAlias,
      updatedAt: Date.now(),
    };
    this.deps.store.upsertStudyRecipe(updated);
    return updated;
  }

  seedHubPanelPrompt(tabId: string, panelId: string, file: TFile | null = this.deps.getPreferredTargetFile()): string {
    const panel = this.requireStudyRecipe(panelId);
    this.applyStudyRecipeContext(tabId, panel);
    const prompt = panel.promptTemplate.trim();
    this.deps.store.setDraft(tabId, prompt);
    if (file) {
      this.deps.store.setTargetNotePath(tabId, file.path);
    }
    return prompt;
  }

  seedHubPanelSkills(tabId: string, panelId: string, skillNames: string[], file: TFile | null = this.deps.getPreferredTargetFile()): string {
    const panel = this.requireStudyRecipe(panelId);
    const tab = this.deps.findTab(tabId);
    const normalizedSkillNames = skillNames.map((entry) => entry.trim()).filter(Boolean);
    const nextLinkedSkillNames = [...new Set([...panel.linkedSkillNames, ...normalizedSkillNames])];
    const panelForSeed =
      nextLinkedSkillNames.length === panel.linkedSkillNames.length
        ? panel
        : {
            ...panel,
            linkedSkillNames: nextLinkedSkillNames,
            updatedAt: Date.now(),
          };
    this.applyStudyRecipeContext(tabId, panelForSeed);
    const nextSkillNames = [
      ...new Set([
        ...((tab?.activeStudyRecipeId === panel.id ? tab.activeStudySkillNames : []).map((entry) => entry.trim()).filter(Boolean)),
        ...normalizedSkillNames,
      ]),
    ];
    this.deps.store.setActiveStudyPanel(tabId, panel.id, nextSkillNames);
    const body =
      tab?.activeStudyRecipeId === panel.id
        ? normalizePanelPromptSnapshot(tab.draft, tab.activeStudySkillNames) || panelForSeed.promptTemplate.trim()
        : panelForSeed.promptTemplate.trim();
    const draft = formatPanelSkillDraft(nextSkillNames, body);
    this.deps.store.setDraft(tabId, draft);
    if (file) {
      this.deps.store.setTargetNotePath(tabId, file.path);
    }
    return draft;
  }

  seedHubPanelSkill(tabId: string, panelId: string, skillName: string, file: TFile | null = this.deps.getPreferredTargetFile()): string {
    return this.seedHubPanelSkills(tabId, panelId, [skillName], file);
  }

  suggestStudyRecipeTitle(tabId: string): string {
    const tab = this.deps.findTab(tabId);
    const workflow = tab?.studyWorkflow;
    const workflowLabel = workflow ? getStudyWorkflowDefinition(workflow, this.deps.getLocale()).label : "Study";
    const targetPath = this.deps.resolveTargetNotePath(tabId);
    if (targetPath) {
      const stem = basename(targetPath, extname(targetPath));
      return `${workflowLabel} ${stem}`.trim();
    }
    return `${workflowLabel} Recipe`.trim();
  }

  previewStudyRecipeSave(tabId: string, requestedTitle: string, existingRecipeId: string | null = null): StudyRecipeSavePreview {
    const candidate = this.buildStudyRecipeCandidate(tabId, requestedTitle, existingRecipeId);
    const normalizedAlias = candidate.commandAlias.toLowerCase();
    const existingRecipe =
      this.deps.getStudyRecipes().find(
        (recipe) => recipe.id !== candidate.id && recipe.workflow === candidate.workflow && recipe.commandAlias.toLowerCase() === normalizedAlias,
      ) ?? null;
    return {
      candidate,
      existingRecipe,
      diffSummary: summarizeStudyRecipeDiff(existingRecipe, candidate, this.deps.getLocale()),
    };
  }

  saveStudyRecipe(preview: StudyRecipeSavePreview): StudyRecipe {
    this.deps.store.upsertStudyRecipe(preview.candidate);
    const activeTab = this.deps.getActiveTab();
    if (activeTab) {
      this.deps.store.addMessage(activeTab.id, {
        id: makeId("study-recipe-save"),
        kind: "system",
        text: this.deps.getLocalizedCopy().service.studyRecipeSaved(preview.candidate.title, preview.candidate.commandAlias),
        createdAt: Date.now(),
      });
    }
    return preview.candidate;
  }

  removeStudyRecipe(recipeId: string): void {
    this.deps.store.removeStudyRecipe(recipeId);
  }

  seedStudyRecipeInComposer(tabId: string, recipeId: string): string {
    const recipe = this.requireStudyRecipe(recipeId);
    this.applyStudyRecipeContext(tabId, recipe);
    this.deps.store.setDraft(tabId, recipe.promptTemplate);
    return recipe.promptTemplate;
  }

  prepareStudyRecipeSkillDraft(recipeId: string): StudyRecipeSkillDraft {
    const recipe = this.requireStudyRecipe(recipeId);
    const { skillName, content } = buildStudySkillDraft(recipe, this.deps.getLocale());
    const target = this.resolveManagedSkillTarget(skillName);
    return {
      recipe,
      skillName,
      targetPath: target.targetPath,
      mode: target.mode,
      diffSummary: summarizeStudySkillDiff(target.existingContent, content, this.deps.getLocale()),
      content,
    };
  }

  async saveStudyRecipeSkillDraft(recipeId: string, nextContent: string): Promise<StudyRecipeSkillDraft> {
    const review = this.prepareStudyRecipeSkillDraft(recipeId);
    const content = nextContent.trim();
    if (!content) {
      throw new Error("Skill draft cannot be empty.");
    }
    await fs.mkdir(dirname(review.targetPath), { recursive: true });
    await fs.writeFile(review.targetPath, `${content.trimEnd()}\n`, "utf8");
    await this.deps.refreshCodexCatalogs();
    this.deps.store.upsertStudyRecipe({
      ...review.recipe,
      promotionState: "promoted",
      promotedSkillName: review.skillName,
      updatedAt: Date.now(),
    });
    const activeTab = this.deps.getActiveTab();
    if (activeTab) {
      this.deps.store.addMessage(activeTab.id, {
        id: makeId("study-recipe-skill"),
        kind: "system",
        text: this.deps.getLocalizedCopy().service.studyRecipeSkillSaved(review.recipe.title, review.skillName),
        createdAt: Date.now(),
      });
    }
    return review;
  }

  capturePanelSessionOrigin(tabId: string, rawInput: string): void {
    const tab = this.deps.findTab(tabId);
    const panelId = tab?.activeStudyRecipeId ?? null;
    if (!tab || !panelId) {
      return;
    }
    const panel = this.requireStudyRecipe(panelId);
    const promptSnapshot = normalizePanelPromptSnapshot(rawInput, tab.activeStudySkillNames ?? []) || panel.promptTemplate;
    const current = tab.panelSessionOrigin;
    const origin: PanelSessionOrigin = {
      panelId,
      selectedSkillNames:
        tab.activeStudySkillNames.length > 0
          ? [...tab.activeStudySkillNames]
          : [...(current?.selectedSkillNames ?? [])],
      promptSnapshot,
      awaitingCompletionSignal: false,
      lastAssistantMessageId: null,
      startedAt: current?.startedAt ?? Date.now(),
    };
    this.deps.store.setPanelSessionOrigin(tabId, origin);
    this.deps.store.setChatSuggestion(tabId, null);
  }

  armPanelCompletionSignal(tabId: string): void {
    const tab = this.deps.findTab(tabId);
    const origin = tab?.panelSessionOrigin;
    if (!tab || !origin) {
      return;
    }
    const lastAssistantMessage =
      [...tab.messages].reverse().find((message) => message.kind === "assistant" && message.text.trim().length > 0) ?? null;
    if (!lastAssistantMessage) {
      return;
    }
    this.deps.store.setPanelSessionOrigin(tabId, {
      ...origin,
      awaitingCompletionSignal: true,
      lastAssistantMessageId: lastAssistantMessage.id,
    });
  }

  disarmPanelCompletionSignal(tabId: string): void {
    const tab = this.deps.findTab(tabId);
    if (!tab?.panelSessionOrigin) {
      return;
    }
    this.deps.store.setPanelSessionOrigin(tabId, {
      ...tab.panelSessionOrigin,
      awaitingCompletionSignal: false,
      lastAssistantMessageId: null,
    });
  }

  maybeHandlePanelCompletionSignal(tabId: string, input: string): boolean {
    const tab = this.deps.findTab(tabId);
    const origin = tab?.panelSessionOrigin;
    if (!tab || !origin || !origin.awaitingCompletionSignal || tab.chatSuggestion?.status === "pending") {
      return false;
    }
    if (!containsCompletionKeyword(input)) {
      return false;
    }

    const panel = this.requireStudyRecipe(origin.panelId);
    const createdAt = Date.now();
    this.deps.store.addMessage(tabId, {
      id: makeId("user"),
      kind: "user",
      text: input.trim(),
      createdAt,
    });

    const suggestion = this.createPanelCompletionSuggestion(panel, origin);
    if (!suggestion) {
      this.deps.store.addMessage(tabId, {
        id: makeId("panel-suggestion-none"),
        kind: "assistant",
        text: this.deps.getLocalizedCopy().service.panelNothingToSave(this.getPanelDisplayTitle(panel.title)),
        createdAt: Date.now(),
      });
      this.disarmPanelCompletionSignal(tabId);
      return true;
    }

    this.deps.store.addMessage(tabId, {
      id: suggestion.messageId,
      kind: "assistant",
      text: this.buildPanelCompletionSuggestionMessage(suggestion),
      createdAt: suggestion.createdAt,
    });
    this.deps.store.setChatSuggestion(tabId, suggestion);
    this.disarmPanelCompletionSignal(tabId);
    return true;
  }

  async respondToChatSuggestion(
    tabId: string,
    action: "update_panel" | "save_panel_copy" | "update_skill" | "dismiss",
  ): Promise<void> {
    const tab = this.deps.findTab(tabId);
    const suggestion = tab?.chatSuggestion;
    if (!tab || !suggestion || suggestion.status !== "pending" || !isPanelCompletionSuggestion(suggestion)) {
      return;
    }
    const copy = this.deps.getLocalizedCopy();

    if (action === "dismiss") {
      this.deps.store.setChatSuggestion(tabId, null);
      this.deps.store.addMessage(tabId, {
        id: makeId("chat-suggestion-dismiss"),
        kind: "system",
        text: copy.service.panelSuggestionDismissed(suggestion.panelTitle),
        createdAt: Date.now(),
      });
      return;
    }

    try {
      if (action === "update_panel") {
        const updated = this.applyPanelPromptToRecipe(tabId, suggestion, false);
        this.deps.store.addMessage(tabId, {
          id: makeId("panel-update"),
          kind: "system",
          text: copy.service.panelUpdated(updated.title),
          createdAt: Date.now(),
        });
      } else if (action === "save_panel_copy") {
        const created = this.applyPanelPromptToRecipe(tabId, suggestion, true);
        this.deps.store.addMessage(tabId, {
          id: makeId("panel-copy"),
          kind: "system",
          text: copy.service.panelCopied(created.title),
          createdAt: Date.now(),
        });
      } else if (action === "update_skill") {
        const skillName = await this.applySuggestionToSkill(tabId, suggestion);
        this.deps.store.addMessage(tabId, {
          id: makeId("panel-skill"),
          kind: "system",
          text: copy.service.panelSkillUpdated(suggestion.panelTitle, skillName),
          createdAt: Date.now(),
        });
      }
      this.deps.store.setChatSuggestion(tabId, null);
    } catch (error) {
      this.deps.store.addMessage(tabId, {
        id: makeId("chat-suggestion-error"),
        kind: "system",
        text: getErrorMessage(error),
        createdAt: Date.now(),
      });
    }
  }

  requireStudyRecipe(recipeId: string): StudyRecipe {
    const recipe = this.deps.store.getState().studyRecipes.find((entry) => entry.id === recipeId) ?? null;
    if (!recipe) {
      throw new Error("Study recipe not found.");
    }
    return structuredClone(recipe);
  }

  applyStudyRecipeContext(tabId: string, recipe: StudyRecipe): void {
    this.deps.store.setTabStudyWorkflow(tabId, recipe.workflow === "custom" ? null : recipe.workflow);
    this.deps.store.setComposeMode(tabId, "chat");
    this.deps.store.setActiveStudyPanel(tabId, recipe.id, []);
    this.deps.store.activateStudyRecipe(recipe.id);
    this.deps.store.upsertStudyRecipe({
      ...recipe,
      useCount: recipe.useCount + 1,
      lastUsedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  private getStudyRecipeRuntimeContext(tabId: string): StudyRecipeRuntimeContext {
    const tab = this.deps.findTab(tabId);
    return {
      currentFilePath: this.deps.getPreferredTargetFile()?.path ?? null,
      targetNotePath: this.deps.resolveTargetNotePath(tabId),
      hasAttachments: this.deps.getTabSessionItems(tabId).length > 0,
      hasSelection: Boolean(tab?.selectionContext),
      pinnedContextCount: 0,
    };
  }

  private buildStudyPanelSeed(workflow: StudyWorkflowKind, existingAliases: readonly string[] = []): StudyRecipe {
    const definition = getStudyWorkflowDefinition(workflow, this.deps.getLocale());
    const title = definition.label;
    const now = Date.now();
    return {
      id: makeId("study-panel"),
      title,
      description: definition.description,
      commandAlias: buildStudyRecipeCommandAlias(title, existingAliases),
      workflow,
      promptTemplate: definition.promptLead,
      linkedSkillNames: [...DEFAULT_LINKED_PANEL_SKILLS[workflow]],
      contextContract: this.deriveStudyRecipeContextContract(workflow, { hasAttachments: false }),
      outputContract: [...definition.responseContract],
      sourceHints: [...definition.sourcePriority],
      exampleSession: {
        sourceTabTitle: this.deps.getLocalizedCopy().service.studyChatTitle,
        targetNotePath: null,
        prompt: definition.promptLead,
        outcomePreview: null,
        createdAt: now,
      },
      promotionState: "captured",
      promotedSkillName: null,
      useCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private buildBlankPanelSeed(existingAliases: readonly string[] = []): StudyRecipe {
    const now = Date.now();
    return {
      id: makeId("study-panel"),
      title: "",
      description: "",
      commandAlias: buildStudyRecipeCommandAlias("Panel", existingAliases),
      workflow: "custom",
      promptTemplate: "",
      linkedSkillNames: [],
      contextContract: {
        summary: "",
        requireTargetNote: false,
        recommendAttachments: false,
        requireSelection: false,
        minimumPinnedContextCount: 0,
      },
      outputContract: [],
      sourceHints: [],
      exampleSession: {
        sourceTabTitle: this.deps.getLocalizedCopy().service.studyChatTitle,
        targetNotePath: null,
        prompt: "",
        outcomePreview: null,
        createdAt: now,
      },
      promotionState: "captured",
      promotedSkillName: null,
      useCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private createUniquePanelTitle(baseTitle: string, excludeId: string | null = null): string {
    const titles = new Set(
      this.deps
        .getStudyRecipes()
        .filter((panel) => panel.id !== excludeId)
        .map((panel) => panel.title.trim().toLowerCase()),
    );
    const cleaned = baseTitle.trim() || "Panel";
    if (!titles.has(cleaned.toLowerCase())) {
      return cleaned;
    }
    let suffix = 2;
    while (titles.has(`${cleaned} ${suffix}`.toLowerCase())) {
      suffix += 1;
    }
    return `${cleaned} ${suffix}`;
  }

  private deriveStudyRecipeContextContract(
    workflow: StudyWorkflowKind,
    workflowContext: StudyWorkflowPromptContext,
  ): StudyRecipe["contextContract"] {
    if (workflow === "lecture") {
      return {
        summary: "Prefer lecture slides, PDF handouts, or the current lecture note before general explanation.",
        requireTargetNote: !workflowContext.hasAttachments,
        recommendAttachments: true,
        requireSelection: false,
        minimumPinnedContextCount: 0,
      };
    }
    if (workflow === "review") {
      return {
        summary: "Prefer a pinned note pack so review order and weak spots stay concrete.",
        requireTargetNote: false,
        recommendAttachments: false,
        requireSelection: false,
        minimumPinnedContextCount: 1,
      };
    }
    if (workflow === "paper") {
      return {
        summary: "Prefer the paper PDF, figures, or a source-grounded reading note before summarizing.",
        requireTargetNote: !workflowContext.hasAttachments,
        recommendAttachments: true,
        requireSelection: false,
        minimumPinnedContextCount: 0,
      };
    }
    return {
      summary: "Prefer the exact problem statement or homework sheet before solving.",
      requireTargetNote: false,
      recommendAttachments: true,
      requireSelection: false,
      minimumPinnedContextCount: 0,
    };
  }

  private collectStudyRecipeExampleSession(tabId: string): StudyRecipe["exampleSession"] {
    const tab = this.deps.findTab(tabId);
    const userMessages = (tab?.messages ?? []).filter((message) => message.kind === "user");
    const assistantMessages = (tab?.messages ?? []).filter((message) => message.kind === "assistant");
    const prompt =
      tab?.draft.trim() ||
      userMessages[userMessages.length - 1]?.text.trim() ||
      this.deps.getLocalizedCopy().service.studyRecipeFallbackPrompt;
    const outcomePreview =
      assistantMessages.length > 0 ? summarizePreviewText(assistantMessages[assistantMessages.length - 1]?.text ?? "", 3, 220) : null;
    return {
      sourceTabTitle: tab?.title ?? this.deps.getLocalizedCopy().service.studyChatTitle,
      targetNotePath: this.deps.resolveTargetNotePath(tabId),
      prompt,
      outcomePreview,
      createdAt: Date.now(),
    };
  }

  private buildStudyRecipeCandidate(tabId: string, requestedTitle: string, existingRecipeId: string | null = null): StudyRecipe {
    const tab = this.deps.findTab(tabId);
    const workflow = tab?.studyWorkflow;
    if (!tab || !workflow) {
      throw new Error(this.deps.getLocalizedCopy().service.studyRecipeWorkflowRequired);
    }

    const cleanedTitle = requestedTitle.trim() || this.suggestStudyRecipeTitle(tabId);
    const existing = existingRecipeId ? this.deps.getStudyRecipes().find((recipe) => recipe.id === existingRecipeId) ?? null : null;
    const now = Date.now();
    const targetFile = this.deps.getPreferredTargetFile();
    const workflowContext = this.deps.buildWorkflowPromptContext(tabId, workflow, targetFile?.path ?? null);
    const definition = getStudyWorkflowDefinition(workflow, this.deps.getLocale());
    const existingAliases = this.deps
      .getStudyRecipes()
      .filter((recipe) => recipe.id !== existingRecipeId)
      .map((recipe) => recipe.commandAlias);
    const commandAlias = existing?.commandAlias ?? buildStudyRecipeCommandAlias(cleanedTitle, existingAliases);
    const exampleSession = this.collectStudyRecipeExampleSession(tabId);
    const promptTemplate = exampleSession.prompt;

    return {
      id: existing?.id ?? makeId("study-recipe"),
      title: cleanedTitle,
      description: existing?.description ?? definition.description,
      commandAlias,
      workflow,
      promptTemplate,
      linkedSkillNames: existing?.linkedSkillNames ?? (existing?.promotedSkillName ? [existing.promotedSkillName] : [...DEFAULT_LINKED_PANEL_SKILLS[workflow]]),
      contextContract: this.deriveStudyRecipeContextContract(workflow, workflowContext),
      outputContract: [...definition.responseContract],
      sourceHints: [...definition.sourcePriority],
      exampleSession,
      promotionState: existing?.promotionState ?? "captured",
      promotedSkillName: existing?.promotedSkillName ?? null,
      useCount: existing?.useCount ?? 0,
      lastUsedAt: existing?.lastUsedAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private createPanelCompletionSuggestion(panel: StudyRecipe, origin: PanelSessionOrigin): ChatSuggestion | null {
    const linkedSkillNames = [...new Set([...(panel.linkedSkillNames ?? []), ...(origin.selectedSkillNames ?? [])].filter(Boolean))];
    const promptSnapshot = origin.promptSnapshot.trim() || panel.promptTemplate.trim();
    const canUpdatePanel =
      normalizeUserPromptWhitespace(panel.promptTemplate) !== normalizeUserPromptWhitespace(promptSnapshot) ||
      linkedSkillNames.length !== panel.linkedSkillNames.length;
    const matchedSkillName = this.findBestLinkedPanelSkillMatch(promptSnapshot, panel.title, panel.description, linkedSkillNames);
    const canSaveCopy = canUpdatePanel && this.deps.getStudyRecipes().length < MAX_STUDY_HUB_PANELS;
    if (!canUpdatePanel && !matchedSkillName && !canSaveCopy) {
      return null;
    }
    return {
      id: makeId("chat-suggestion"),
      kind: "panel_completion",
      status: "pending",
      messageId: makeId("chat-suggestion-message"),
      panelId: panel.id,
      panelTitle: this.getPanelDisplayTitle(panel.title),
      promptSnapshot,
      matchedSkillName,
      canUpdatePanel,
      canSaveCopy,
      planSummary: null,
      planStatus: null,
      createdAt: Date.now(),
    };
  }

  private findBestLinkedPanelSkillMatch(
    promptSnapshot: string,
    panelTitle: string,
    panelDescription: string,
    linkedSkillNames: readonly string[],
  ): string | null {
    const installedCandidates = this.deps.getInstalledSkillCatalog().filter((skill) => linkedSkillNames.includes(skill.name));
    if (installedCandidates.length === 0) {
      return null;
    }
    const haystackTokens = new Set(tokenizeForSimilarity([promptSnapshot, panelTitle, panelDescription].join(" ")));
    let best: { skillName: string; score: number } | null = null;
    for (const skill of installedCandidates) {
      const skillTokens = new Set(tokenizeForSimilarity(`${skill.name} ${skill.description}`));
      let score = 0;
      for (const token of haystackTokens) {
        if (skillTokens.has(token)) {
          score += 1;
        }
      }
      if (score <= 0) {
        continue;
      }
      if (!best || score > best.score) {
        best = { skillName: skill.name, score };
      }
    }
    return best?.skillName ?? installedCandidates[0]?.name ?? null;
  }

  private buildPanelCompletionSuggestionMessage(suggestion: ChatSuggestion): string {
    if (!isPanelCompletionSuggestion(suggestion)) {
      return "";
    }
    const copy = this.deps.getLocalizedCopy();
    if (suggestion.matchedSkillName) {
      return copy.service.panelSavePromptWithSkill(suggestion.panelTitle, suggestion.matchedSkillName);
    }
    return copy.service.panelSavePrompt(suggestion.panelTitle);
  }

  private applyPanelPromptToRecipe(tabId: string, suggestion: ChatSuggestion, asCopy: boolean): StudyRecipe {
    if (!isPanelCompletionSuggestion(suggestion)) {
      throw new Error("Panel suggestion is required.");
    }
    const source = this.requireStudyRecipe(suggestion.panelId);
    const tab = this.deps.findTab(tabId);
    const selectedSkillNames = tab?.panelSessionOrigin?.selectedSkillNames ?? [];
    const linkedSkillNames = [...new Set([...source.linkedSkillNames, ...selectedSkillNames])];
    const now = Date.now();

    if (asCopy) {
      if (this.deps.getStudyRecipes().length >= MAX_STUDY_HUB_PANELS) {
        throw new Error(this.deps.getLocalizedCopy().service.panelLimitReached(MAX_STUDY_HUB_PANELS));
      }
      const title = this.createUniquePanelTitle(`${source.title.trim() || "Panel"} copy`);
      const created: StudyRecipe = {
        ...source,
        id: makeId("study-panel"),
        title,
        commandAlias: buildStudyRecipeCommandAlias(title, this.deps.getStudyRecipes().map((entry) => entry.commandAlias)),
        promptTemplate: suggestion.promptSnapshot,
        linkedSkillNames,
        exampleSession: this.collectStudyRecipeExampleSession(tabId),
        createdAt: now,
        updatedAt: now,
      };
      this.deps.store.upsertStudyRecipe(created);
      this.deps.store.setActiveStudyPanel(tabId, created.id, selectedSkillNames);
      return created;
    }

    const updated: StudyRecipe = {
      ...source,
      promptTemplate: suggestion.promptSnapshot,
      linkedSkillNames,
      exampleSession: this.collectStudyRecipeExampleSession(tabId),
      updatedAt: now,
    };
    this.deps.store.upsertStudyRecipe(updated);
    this.deps.store.setActiveStudyPanel(tabId, updated.id, selectedSkillNames);
    return updated;
  }

  private async applySuggestionToSkill(tabId: string, suggestion: ChatSuggestion): Promise<string> {
    if (!isPanelCompletionSuggestion(suggestion)) {
      throw new Error("Panel suggestion is required.");
    }
    const source = this.requireStudyRecipe(suggestion.panelId);
    const skillName = suggestion.matchedSkillName ?? this.deps.findTab(tabId)?.panelSessionOrigin?.selectedSkillNames?.[0] ?? null;
    if (!skillName) {
      throw new Error("No linked skill is available to update.");
    }
    const nextRecipe: StudyRecipe = {
      ...source,
      promptTemplate: suggestion.promptSnapshot,
      linkedSkillNames: [...new Set([...source.linkedSkillNames, skillName])],
      updatedAt: Date.now(),
    };
    const { skillName: resolvedName, content } = buildStudySkillDraft(nextRecipe, this.deps.getLocale(), skillName);
    const target = this.resolveManagedSkillTarget(resolvedName);
    const targetPath = target.targetPath;
    await fs.mkdir(dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `${content.trimEnd()}\n`, "utf8");
    await this.deps.refreshCodexCatalogs();
    this.deps.store.upsertStudyRecipe({
      ...nextRecipe,
      promotedSkillName: resolvedName,
      promotionState: "promoted",
      updatedAt: Date.now(),
    });
    this.deps.store.setActiveStudyPanel(tabId, nextRecipe.id, [resolvedName]);
    return resolvedName;
  }

  private findInstalledSkill(skillName: string): { name: string; path: string; content: string } | null {
    const existing = this.deps.getInstalledSkillCatalog().find((entry) => entry.name === skillName) ?? null;
    if (!existing) {
      return null;
    }
    return {
      name: existing.name,
      path: existing.path,
      content: existsSync(existing.path) ? readFileSync(existing.path, "utf8") : "",
    };
  }

  private resolveManagedSkillTarget(skillName: string): ManagedSkillTarget {
    const resolvedName = this.assertManagedSkillName(skillName);
    const managedRoot = resolve(this.deps.resolveVaultRoot(), ...MANAGED_SKILL_ROOT_SEGMENTS);
    const managedPath = resolve(managedRoot, resolvedName, "SKILL.md");
    if (!isPathWithinRoot(managedRoot, managedPath)) {
      throw new Error("Unsafe skill target path.");
    }

    const existingSkill = this.findInstalledSkill(resolvedName);
    if (existingSkill) {
      const existingPath = resolve(existingSkill.path);
      if (isPathWithinRoot(managedRoot, existingPath)) {
        return {
          targetPath: existingPath,
          mode: "update",
          existingContent: existingSkill.content,
        };
      }
    }

    if (existsSync(managedPath)) {
      return {
        targetPath: managedPath,
        mode: "update",
        existingContent: readFileSync(managedPath, "utf8"),
      };
    }

    return {
      targetPath: managedPath,
      mode: "create",
      existingContent: null,
    };
  }

  private assertManagedSkillName(skillName: string): string {
    const normalized = skillName.trim();
    if (!MANAGED_SKILL_NAME_PATTERN.test(normalized)) {
      throw new Error("Unsafe skill target.");
    }
    return normalized;
  }

  private getPanelDisplayTitle(title: string): string {
    return title.trim() || this.deps.getLocalizedCopy().workspace.untitledPanel;
  }
}
