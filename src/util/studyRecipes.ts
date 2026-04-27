import type { ComposerAttachment, ConversationTabState, PanelStudyMemory, StudyRecipe, StudyRecipeWorkflowKind } from "../model/types";
import type { SupportedLocale } from "./i18n";
import { getStudyRecipeWorkflowLabel, getStudyWorkflowDefinition } from "./studyWorkflows";

export interface StudyRecipeRuntimeContext {
  currentFilePath?: string | null;
  targetNotePath?: string | null;
  hasAttachments?: boolean;
  hasSelection?: boolean;
  pinnedContextCount?: number;
  panelMemory?: PanelStudyMemory | null;
  prompt?: string | null;
}

export type PanelSourceStrategy = "use_note" | "use_attachment" | "ask_for_source" | "continue_from_memory";

export interface PanelRuntimeContextHint {
  kind: "weak_concept" | "next_problem" | "source_preference" | "advisory";
  text: string;
}

export interface StudyRecipePreflight {
  ready: boolean;
  summary: string;
  missing: string[];
  advisories: string[];
  autoContextAdditions?: PanelRuntimeContextHint[];
  sourceStrategy?: PanelSourceStrategy;
  suggestedSkills?: string[];
}

export interface PanelRuntimePreflightInput {
  panel: StudyRecipe;
  panelMemory: PanelStudyMemory | null;
  tab: ConversationTabState | null;
  attachments: readonly ComposerAttachment[];
  selection: string | null;
  targetNote: string | null;
  pinnedContext: string | null;
  prompt: string;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function tokenizeForStudyRecipeSimilarity(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function hasHomeworkProblemText(prompt: string): boolean {
  return /(\d+\s*[=+\-*/^]|problem\s*\d+|given|solve|find|compute|calculate|homework\s*\d+|問|問題|求め|計算)/iu.test(prompt);
}

function chooseSourceStrategy(
  panel: StudyRecipe,
  context: Pick<StudyRecipeRuntimeContext, "currentFilePath" | "targetNotePath" | "hasAttachments" | "panelMemory" | "prompt">,
): PanelSourceStrategy {
  const hasTargetNote = Boolean(context.currentFilePath || context.targetNotePath);
  const hasAttachments = Boolean(context.hasAttachments);
  const hasMemory = Boolean(
    context.panelMemory &&
      (context.panelMemory.weakConcepts.length > 0 ||
        context.panelMemory.nextProblems.length > 0 ||
        context.panelMemory.sourcePreferences.length > 0),
  );
  if (panel.workflow === "paper" && hasAttachments) {
    return "use_attachment";
  }
  if (panel.workflow === "lecture" && hasTargetNote) {
    return "use_note";
  }
  if (panel.workflow === "review" && hasMemory) {
    return "continue_from_memory";
  }
  if (panel.workflow === "homework" && !hasTargetNote && !hasAttachments && !hasHomeworkProblemText(context.prompt ?? "")) {
    return "ask_for_source";
  }
  if (hasTargetNote) {
    return "use_note";
  }
  if (hasAttachments) {
    return "use_attachment";
  }
  if (hasMemory) {
    return "continue_from_memory";
  }
  return "ask_for_source";
}

export function slugifyStudyRecipeToken(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "study-recipe";
}

export function buildStudyRecipeCommandAlias(title: string, existingAliases: readonly string[] = []): string {
  const normalizedAliases = new Set(existingAliases.map((alias) => alias.trim().toLowerCase()));
  const base = `/recipe-${slugifyStudyRecipeToken(title)}`;
  if (!normalizedAliases.has(base.toLowerCase())) {
    return base;
  }
  let suffix = 2;
  while (normalizedAliases.has(`${base}-${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function formatWorkflowLabel(workflow: StudyRecipeWorkflowKind, locale: SupportedLocale): string {
  return getStudyRecipeWorkflowLabel(workflow, locale);
}

export function buildStudyRecipeChatPrompt(recipe: StudyRecipe, locale: SupportedLocale = "en", request = ""): string {
  const workflow = recipe.workflow === "custom" ? null : getStudyWorkflowDefinition(recipe.workflow, locale);
  const requestText = request.trim() || recipe.promptTemplate.trim();
  const sourceHints = recipe.sourceHints.length > 0 ? recipe.sourceHints : workflow?.sourcePriority ?? [];
  const outputContract = recipe.outputContract.length > 0 ? recipe.outputContract : workflow ? [...workflow.responseContract] : [];
  const header = locale === "ja" ? `保存済み recipe: ${recipe.title}` : `Saved study recipe: ${recipe.title}`;
  const workflowLine = locale === "ja" ? `Workflow: ${formatWorkflowLabel(recipe.workflow, locale)}` : `Workflow: ${formatWorkflowLabel(recipe.workflow, locale)}`;
  const promptLabel = locale === "ja" ? "Prompt template" : "Prompt template";
  const sourceLabel = locale === "ja" ? "Source priorities" : "Source priorities";
  const outputLabel = locale === "ja" ? "Output contract" : "Output contract";
  const requestLabel = locale === "ja" ? "Current request" : "Current request";

  return [
    header,
    workflowLine,
    "",
    promptLabel,
    recipe.promptTemplate.trim(),
    "",
    locale === "ja" ? "Panel description" : "Panel description",
    recipe.description.trim(),
    "",
    sourceLabel,
    ...sourceHints.map((hint) => `- ${hint}`),
    "",
    outputLabel,
    ...outputContract.map((hint) => `- ${hint}`),
    "",
    requestLabel,
    requestText,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildStudyRecipeMentionContext(recipe: StudyRecipe, locale: SupportedLocale = "en"): string {
  const workflowLabel = formatWorkflowLabel(recipe.workflow, locale);
  const header = locale === "ja" ? `保存済み recipe: ${recipe.title}` : `Saved study recipe: ${recipe.title}`;
  const contextLabel = locale === "ja" ? "Context contract" : "Context contract";
  const outputLabel = locale === "ja" ? "Output contract" : "Output contract";
  return [
    header,
    `Workflow: ${workflowLabel}`,
    "",
    contextLabel,
    recipe.contextContract.summary,
    ...recipe.sourceHints.map((entry) => `- ${entry}`),
    "",
    outputLabel,
    ...recipe.outputContract.map((entry) => `- ${entry}`),
  ].join("\n");
}

export function rankPanelSkillsForRecipe<TSkill extends { name: string; description: string; path?: string }>(params: {
  panel: StudyRecipe;
  panelMemory: PanelStudyMemory | null;
  skills: readonly TSkill[];
  selectedSkillNames?: readonly string[];
  explicitSkillNames?: readonly string[];
  preferredSkillNames?: readonly string[];
  prompt?: string;
}): TSkill[] {
  const selected = new Set((params.selectedSkillNames ?? []).map((entry) => entry.trim()).filter(Boolean));
  const explicit = new Set((params.explicitSkillNames ?? []).map((entry) => entry.trim()).filter(Boolean));
  const linked = new Set(params.panel.linkedSkillNames.map((entry) => entry.trim()).filter(Boolean));
  const preferred = new Set((params.preferredSkillNames ?? []).map((entry) => entry.trim()).filter(Boolean));
  const weakTokens = new Set(tokenizeForStudyRecipeSimilarity((params.panelMemory?.weakConcepts ?? []).map((entry) => entry.conceptLabel).join(" ")));
  const panelTokens = new Set(
    tokenizeForStudyRecipeSimilarity(
      [params.panel.workflow, params.panel.title, params.panel.description, params.panel.promptTemplate, params.prompt ?? ""].join(" "),
    ),
  );

  return [...params.skills]
    .map((skill, index) => {
      const skillTokens = new Set(tokenizeForStudyRecipeSimilarity(`${skill.name} ${skill.description}`));
      let score = 0;
      if (explicit.has(skill.name)) {
        score += 5;
      }
      if (selected.has(skill.name)) {
        score += 5;
      }
      if (linked.has(skill.name)) {
        score += 4;
      }
      if (preferred.has(skill.name)) {
        score += 2;
      }
      for (const token of weakTokens) {
        if (skillTokens.has(token)) {
          score += 3;
        }
      }
      for (const token of panelTokens) {
        if (skillTokens.has(token)) {
          score += 1;
        }
      }
      return { skill, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.skill);
}

export function evaluateStudyRecipePreflight(
  recipe: StudyRecipe,
  context: StudyRecipeRuntimeContext,
  locale: SupportedLocale = "en",
): StudyRecipePreflight {
  return evaluatePanelRuntimePreflight(
    {
      panel: recipe,
      panelMemory: context.panelMemory ?? null,
      tab: null,
      attachments: context.hasAttachments ? ([{ kind: "file" }] as unknown as readonly ComposerAttachment[]) : [],
      selection: context.hasSelection ? "selection" : null,
      targetNote: context.currentFilePath ?? context.targetNotePath ?? null,
      pinnedContext: (context.pinnedContextCount ?? 0) > 0 ? "pinned context" : null,
      prompt: context.prompt ?? "",
    },
    locale,
    context,
  );
}

export function evaluatePanelRuntimePreflight(
  input: PanelRuntimePreflightInput,
  locale: SupportedLocale = "en",
  legacyContext: StudyRecipeRuntimeContext | null = null,
): StudyRecipePreflight {
  const recipe = input.panel;
  const missing: string[] = [];
  const advisories: string[] = [];
  const hasTargetNote = Boolean(input.targetNote || legacyContext?.currentFilePath || legacyContext?.targetNotePath);
  const hasAttachments = input.attachments.length > 0 || Boolean(legacyContext?.hasAttachments);
  const hasSelection = Boolean(input.selection || legacyContext?.hasSelection);
  const pinnedCount = input.pinnedContext ? 1 : legacyContext?.pinnedContextCount ?? 0;
  const panelMemory = input.panelMemory ?? legacyContext?.panelMemory ?? null;
  const sourceStrategy = chooseSourceStrategy(recipe, {
    currentFilePath: legacyContext?.currentFilePath ?? input.targetNote,
    targetNotePath: legacyContext?.targetNotePath ?? input.targetNote,
    hasAttachments,
    panelMemory,
    prompt: input.prompt,
  });

  if (recipe.contextContract.requireSelection && !hasSelection) {
    missing.push(locale === "ja" ? "selection が必要です" : "Selection is required");
  }

  if (recipe.contextContract.requireTargetNote && !hasTargetNote) {
    missing.push(locale === "ja" ? "対象ノートが必要です" : "A target note is required");
  }

  if (recipe.contextContract.minimumPinnedContextCount > 0 && pinnedCount < recipe.contextContract.minimumPinnedContextCount) {
    advisories.push(
      locale === "ja"
        ? `固定 context を少なくとも ${recipe.contextContract.minimumPinnedContextCount} 件用意すると安定します`
        : `Add at least ${recipe.contextContract.minimumPinnedContextCount} pinned context notes for better results`,
    );
  }

  if (recipe.contextContract.recommendAttachments && !hasAttachments) {
    advisories.push(locale === "ja" ? "添付 source があると精度が上がります" : "Attach source material for better results");
  }
  if (recipe.workflow === "homework" && sourceStrategy === "ask_for_source") {
    advisories.push(locale === "ja" ? "問題文が不足している場合は短く確認してください" : "Ask for the problem statement before solving if it is missing");
  }

  const autoContextAdditions: PanelRuntimeContextHint[] = [];
  const weakConcept = panelMemory?.weakConcepts[0] ?? null;
  if (weakConcept) {
    autoContextAdditions.push({
      kind: "weak_concept",
      text: `Weak concept: ${weakConcept.conceptLabel} - ${weakConcept.lastStuckPoint || weakConcept.evidence}`,
    });
  }
  const nextProblem = panelMemory?.nextProblems[0] ?? null;
  if (nextProblem) {
    autoContextAdditions.push({
      kind: "next_problem",
      text: `Next problem: ${nextProblem.prompt}`,
    });
  }
  const sourcePreference = panelMemory?.sourcePreferences[0] ?? null;
  if (sourcePreference) {
    autoContextAdditions.push({
      kind: "source_preference",
      text: `Preferred source: ${sourcePreference.label}`,
    });
  }

  const ready = missing.length === 0;
  const summary =
    missing[0] ??
    advisories[0] ??
    (locale === "ja" ? "現在の context で実行できます" : "Ready with the current context");
  return {
    ready,
    summary,
    missing,
    advisories,
    autoContextAdditions,
    sourceStrategy,
    suggestedSkills: [],
  };
}

export function summarizeStudyRecipeDiff(current: StudyRecipe | null, next: StudyRecipe, locale: SupportedLocale = "en"): string {
  if (!current) {
    return locale === "ja" ? "新しい recipe を作成します。" : "This will create a new recipe.";
  }

  const changed: string[] = [];
  if (normalizeWhitespace(current.promptTemplate) !== normalizeWhitespace(next.promptTemplate)) {
    changed.push(locale === "ja" ? "prompt template" : "prompt template");
  }
  if (current.commandAlias !== next.commandAlias) {
    changed.push(locale === "ja" ? "chat alias" : "chat alias");
  }
  if (current.workflow !== next.workflow) {
    changed.push(locale === "ja" ? "workflow" : "workflow");
  }
  if (JSON.stringify(current.contextContract) !== JSON.stringify(next.contextContract)) {
    changed.push(locale === "ja" ? "context contract" : "context contract");
  }
  if (JSON.stringify(current.outputContract) !== JSON.stringify(next.outputContract)) {
    changed.push(locale === "ja" ? "output contract" : "output contract");
  }

  if (changed.length === 0) {
    return locale === "ja" ? "差分はほとんどありません。" : "No material differences were detected.";
  }
  return locale === "ja" ? `更新差分: ${changed.join(", ")}` : `Updates: ${changed.join(", ")}`;
}

export function buildStudySkillDraft(
  recipe: StudyRecipe,
  locale: SupportedLocale = "en",
  skillNameOverride: string | null = null,
): { skillName: string; content: string } {
  const workflowLabel = formatWorkflowLabel(recipe.workflow, locale);
  const skillName = (skillNameOverride?.trim() || slugifyStudyRecipeToken(recipe.title)).trim();
  const description =
    locale === "ja"
      ? `Use when the user wants the saved panel "${recipe.title}" or a ${workflowLabel} study flow based on it.`
      : `Use when the user wants the saved panel "${recipe.title}" or a ${workflowLabel} study flow based on it.`;
  const requiredContextLines = [
    recipe.contextContract.summary,
    ...recipe.sourceHints.map((hint) => `- ${hint}`),
  ];

  const content = [
    "---",
    `name: ${skillName}`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    "---",
    "",
    `# ${recipe.title}`,
    "",
    `Workflow: ${workflowLabel}`,
    "",
    "## Panel description",
    recipe.description.trim(),
    "",
    "## When to use",
    description,
    "",
    "## Required context",
    ...requiredContextLines,
    "",
    "## Expected output",
    ...recipe.outputContract.map((line) => `- ${line}`),
    "",
    "## Prompt template",
    recipe.promptTemplate.trim(),
    "",
    "## Example session",
    `- Source tab: ${recipe.exampleSession.sourceTabTitle}`,
    recipe.exampleSession.targetNotePath ? `- Target note: ${recipe.exampleSession.targetNotePath}` : "- Target note: none",
    `- Example prompt: ${recipe.exampleSession.prompt}`,
    recipe.exampleSession.outcomePreview ? `- Example outcome: ${recipe.exampleSession.outcomePreview}` : "- Example outcome: none",
    "",
    "## Notes",
    "Keep the answer grounded in the provided context before filling gaps from general knowledge.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    skillName,
    content,
  };
}

export function summarizeStudySkillDiff(existingContent: string | null, nextContent: string, locale: SupportedLocale = "en"): string {
  if (!existingContent) {
    return locale === "ja" ? "新しい skill を作成します。" : "This will create a new skill.";
  }

  const existingLines = new Set(
    existingContent
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const nextLines = new Set(
    nextContent
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const additions = [...nextLines].filter((line) => !existingLines.has(line)).length;
  const removals = [...existingLines].filter((line) => !nextLines.has(line)).length;
  return locale === "ja"
    ? `skill 差分: +${additions} / -${removals}`
    : `Skill diff: +${additions} / -${removals}`;
}
