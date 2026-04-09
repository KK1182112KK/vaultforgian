import type { RefactorCampaign, RefactorRecipe, RefactorRecipeExample, SurgeryScopeKind } from "../model/types";

const MAX_RECIPE_EXAMPLES = 8;

function uniqueOperationKinds(recipeExamples: readonly RefactorRecipeExample[]): RefactorRecipe["operationKinds"] {
  const seen = new Set<RefactorRecipe["operationKinds"][number]>();
  const ordered: RefactorRecipe["operationKinds"] = [];
  for (const example of recipeExamples) {
    if (seen.has(example.operationKind)) {
      continue;
    }
    seen.add(example.operationKind);
    ordered.push(example.operationKind);
  }
  return ordered;
}

function inferPreferredScopeKind(campaign: RefactorCampaign): SurgeryScopeKind {
  const query = campaign.query.trim();
  if (/\bsmart set:/i.test(query)) {
    return "smart_set";
  }
  if (/\bcurrent note:/i.test(query) || campaign.targetPaths.length <= 1) {
    return "current_note";
  }
  if (/\bsearch query:/i.test(query)) {
    return "search_query";
  }
  return "search_query";
}

function buildRecipeTitle(campaign: RefactorCampaign): string {
  const query = campaign.query.trim();
  if (query.length > 0) {
    return `${campaign.title}: ${query}`.slice(0, 80);
  }
  return campaign.title || "Refactor Recipe";
}

function buildRecipeDescription(examples: readonly RefactorRecipeExample[]): string {
  const hasRename = examples.some((example) => example.operationKind === "rename");
  const hasMove = examples.some((example) => example.operationKind === "move");
  const hasPatch = examples.some((example) => example.operationKind === "update" || example.operationKind === "create");
  if (hasRename && hasMove) {
    return "Backlink-safe rename and move surgery for a bounded note set.";
  }
  if (hasRename) {
    return "Backlink-safe rename surgery for a bounded note set.";
  }
  if (hasMove) {
    return "Backlink-safe move surgery for a bounded note set.";
  }
  if (hasPatch) {
    return "Patch-first vault cleanup recipe for a bounded note set.";
  }
  return "Reusable vault surgery recipe for a bounded note set.";
}

export function buildRefactorRecipeFromCampaign(
  campaign: RefactorCampaign,
  recipeId: string,
  now = Date.now(),
): RefactorRecipe {
  const enabledItems = campaign.items.filter((item) => item.enabled);
  if (enabledItems.length === 0) {
    throw new Error("Cannot build a recipe from a campaign with no enabled items.");
  }
  const sourceItems = enabledItems;
  const examples: RefactorRecipeExample[] = sourceItems.slice(0, MAX_RECIPE_EXAMPLES).map((item) => ({
    kind: item.kind,
    operationKind: item.operationKind,
    title: item.title,
    summary: item.summary,
    targetPath: item.targetPath,
    destinationPath: item.destinationPath,
  }));

  return {
    id: recipeId,
    title: buildRecipeTitle(campaign),
    description: buildRecipeDescription(examples),
    sourceCampaignId: campaign.id,
    sourceCampaignTitle: campaign.title,
    sourceQuery: campaign.query,
    preferredScopeKind: inferPreferredScopeKind(campaign),
    operationKinds: uniqueOperationKinds(examples),
    examples,
    createdAt: now,
    updatedAt: now,
  };
}

function formatRecipeExample(example: RefactorRecipeExample): string {
  if (example.destinationPath) {
    return `- ${example.operationKind}: ${example.targetPath} -> ${example.destinationPath}`;
  }
  return `- ${example.operationKind}: ${example.targetPath} · ${example.summary}`;
}

export function buildRecipeCampaignPrompt(
  recipe: RefactorRecipe,
  scopeLabel: string,
  targetPaths: readonly string[],
): string {
  return [
    `Vault surgery recipe: ${recipe.title}`,
    `Recipe description: ${recipe.description}`,
    `Original campaign: ${recipe.sourceCampaignTitle}`,
    recipe.sourceQuery.trim() ? `Original scope: ${recipe.sourceQuery}` : null,
    `Requested scope: ${scopeLabel}`,
    `Target notes (${targetPaths.length})`,
    ...targetPaths.map((path) => `- ${path}`),
    "",
    "Apply the same style of vault surgery to this exact note set.",
    "Prefer small, high-value, backlink-safe changes.",
    recipe.operationKinds.length > 0 ? `Bias toward these operation kinds: ${recipe.operationKinds.join(", ")}.` : null,
    recipe.examples.length > 0 ? "Reference examples from the saved recipe" : null,
    ...recipe.examples.map(formatRecipeExample),
    "",
    "You may propose backlink-safe rename, move, property, and task changes with `obsidian-ops`.",
    "You may propose note-body updates with `obsidian-patch`.",
    "Explain the surgery briefly before the fenced blocks.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
