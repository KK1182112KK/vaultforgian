import type { AgentCapability } from "./types";
import type { StudyRecipe } from "../../model/types";
import type { CodexPromptDefinition } from "../../util/codexPrompts";
import type { SupportedLocale } from "../../util/i18n";
import type { InstalledSkillDefinition } from "../../util/skillCatalog";
import { getSlashCommandCatalog, type SlashCommandDefinition } from "../../util/slashCommandCatalog";
import { buildStudyRecipeChatPrompt } from "../../util/studyRecipes";

export interface AgentCapabilityCatalogInput {
  locale: SupportedLocale;
  customPrompts: readonly CodexPromptDefinition[];
  installedSkills: readonly InstalledSkillDefinition[];
  studyRecipes: readonly StudyRecipe[];
}

function capabilityId(source: AgentCapability["source"], trigger: string): string {
  return `${source}:${trigger.toLowerCase()}`;
}

function addCapability(
  catalog: AgentCapability[],
  seen: Set<string>,
  capability: Omit<AgentCapability, "id">,
): void {
  const key = capability.trigger.toLowerCase();
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  catalog.push({
    ...capability,
    id: capabilityId(capability.source, capability.trigger),
  });
}

export function buildAgentCapabilityCatalog(input: AgentCapabilityCatalogInput): AgentCapability[] {
  const catalog: AgentCapability[] = [];
  const seen = new Set<string>();

  for (const command of getSlashCommandCatalog(input.locale)) {
    addCapability(catalog, seen, {
      kind: command.mode === "session" ? "session" : "slash",
      trigger: command.command,
      label: command.label,
      description: command.description,
      source: "builtin",
      payload: {
        mode: command.mode ?? null,
      },
    });
  }

  for (const prompt of input.customPrompts) {
    for (const command of [prompt.command, ...prompt.aliases]) {
      addCapability(catalog, seen, {
        kind: "slash",
        trigger: command,
        label: prompt.label,
        description: prompt.description,
        source: "custom_prompt",
        payload: {
          mode: "prompt",
          promptCommand: prompt.command,
        },
      });
    }
  }

  for (const skill of input.installedSkills) {
    addCapability(catalog, seen, {
      kind: "skill",
      trigger: `/${skill.name}`,
      label: skill.name,
      description: skill.description,
      source: "skill_alias",
      payload: {
        mode: "skill_alias",
        skillName: skill.name,
      },
    });
  }

  for (const recipe of input.studyRecipes) {
    addCapability(catalog, seen, {
      kind: "recipe",
      trigger: recipe.commandAlias,
      label: recipe.title,
      description: recipe.description,
      source: "study_recipe",
      payload: {
        mode: "study_recipe",
        recipeId: recipe.id,
        recipePrompt: buildStudyRecipeChatPrompt(recipe, input.locale),
        studyWorkflow: recipe.workflow === "custom" ? null : recipe.workflow,
      },
    });
  }

  return catalog;
}

export function agentCapabilitiesToSlashCommands(capabilities: readonly AgentCapability[]): SlashCommandDefinition[] {
  return capabilities
    .filter((capability) => capability.kind === "slash" || capability.kind === "skill" || capability.kind === "recipe" || capability.kind === "session")
    .map((capability) => {
      const mode = typeof capability.payload?.mode === "string" ? capability.payload.mode : undefined;
      return {
        command: capability.trigger,
        label: capability.label,
        description: capability.description,
        source: capability.source === "mention" ? undefined : capability.source,
        mode: mode as SlashCommandDefinition["mode"],
        skillName: typeof capability.payload?.skillName === "string" ? capability.payload.skillName : undefined,
        recipeId: typeof capability.payload?.recipeId === "string" ? capability.payload.recipeId : undefined,
        recipePrompt: typeof capability.payload?.recipePrompt === "string" ? capability.payload.recipePrompt : undefined,
        studyWorkflow:
          capability.payload?.studyWorkflow === "lecture" ||
          capability.payload?.studyWorkflow === "review" ||
          capability.payload?.studyWorkflow === "paper" ||
          capability.payload?.studyWorkflow === "homework"
            ? capability.payload.studyWorkflow
            : undefined,
      };
    });
}
