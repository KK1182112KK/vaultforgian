import type { StudyRecipe, StudyRecipeWorkflowKind } from "../model/types";
import type { SupportedLocale } from "./i18n";
import { getStudyRecipeWorkflowLabel, getStudyWorkflowDefinition } from "./studyWorkflows";

export interface StudyRecipeRuntimeContext {
  currentFilePath?: string | null;
  targetNotePath?: string | null;
  hasAttachments?: boolean;
  hasSelection?: boolean;
  pinnedContextCount?: number;
}

export interface StudyRecipePreflight {
  ready: boolean;
  summary: string;
  missing: string[];
  advisories: string[];
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
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

export function evaluateStudyRecipePreflight(
  recipe: StudyRecipe,
  context: StudyRecipeRuntimeContext,
  locale: SupportedLocale = "en",
): StudyRecipePreflight {
  const missing: string[] = [];
  const advisories: string[] = [];
  const hasTargetNote = Boolean(context.currentFilePath || context.targetNotePath);
  const hasAttachments = Boolean(context.hasAttachments);
  const hasSelection = Boolean(context.hasSelection);
  const pinnedCount = context.pinnedContextCount ?? 0;

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

  const ready = missing.length === 0;
  const summary =
    missing[0] ??
    advisories[0] ??
    (locale === "ja" ? "現在の context で実行できます" : "Ready with the current context");
  return { ready, summary, missing, advisories };
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
