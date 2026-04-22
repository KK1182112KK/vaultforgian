import { promises as fs } from "node:fs";
import type { InstalledSkillDefinition } from "./skillCatalog";

export interface RequestedSkillGuideOptions {
  paperStudyAttachmentTurn?: boolean;
}

export interface RequestedSkillDefinitionResolutionOptions {
  refreshInstalledSkills?: () => Promise<readonly InstalledSkillDefinition[]>;
}

function normalizeRequestedSkillName(skillName: string): string {
  return skillName.trim().replace(/^\$+/, "");
}

function uniqueSkillNames(skillNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of skillNames) {
    const normalized = normalizeRequestedSkillName(name);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function indexInstalledSkills(
  installedSkills: readonly InstalledSkillDefinition[],
): Map<string, InstalledSkillDefinition> {
  const installedByName = new Map<string, InstalledSkillDefinition>();
  for (const definition of installedSkills) {
    if (!definition.name || installedByName.has(definition.name)) {
      continue;
    }
    installedByName.set(definition.name, definition);
  }
  return installedByName;
}

function selectRequestedSkillDefinitions(
  skillNames: readonly string[],
  installedSkills: readonly InstalledSkillDefinition[],
): InstalledSkillDefinition[] {
  const installedByName = indexInstalledSkills(installedSkills);
  const ordered: InstalledSkillDefinition[] = [];

  for (const skillName of uniqueSkillNames(skillNames)) {
    const definition = installedByName.get(skillName);
    if (definition) {
      ordered.push(definition);
    }
  }

  return ordered;
}

export async function resolveRequestedSkillDefinitions(
  skillNames: readonly string[],
  installedSkills: readonly InstalledSkillDefinition[],
  options: RequestedSkillDefinitionResolutionOptions = {},
): Promise<InstalledSkillDefinition[]> {
  const requestedSkillNames = uniqueSkillNames(skillNames);
  if (requestedSkillNames.length === 0) {
    return [];
  }

  const resolvedFromCurrent = selectRequestedSkillDefinitions(requestedSkillNames, installedSkills);
  if (resolvedFromCurrent.length === requestedSkillNames.length || !options.refreshInstalledSkills) {
    return resolvedFromCurrent;
  }

  const refreshedSkills = await options.refreshInstalledSkills();
  return selectRequestedSkillDefinitions(requestedSkillNames, refreshedSkills);
}

function getRuntimeFallbackSkillDescription(skillName: string): string {
  if (skillName === "deep-read") {
    return "Read the attached paper deeply.";
  }
  if (skillName === "study-material-builder") {
    return "Build study materials from the attached source package.";
  }
  if (skillName === "deep-research") {
    return "Use the attached source package as the primary evidence bundle.";
  }
  return "Runtime-resolved skill contract";
}

export async function buildRequestedSkillGuideText(
  skillNames: readonly string[],
  installedSkills: readonly InstalledSkillDefinition[],
  options: RequestedSkillGuideOptions = {},
): Promise<string | null> {
  const installedByName = indexInstalledSkills(installedSkills);
  const blocks: string[] = [];

  for (const skillName of uniqueSkillNames(skillNames)) {
    const definition = installedByName.get(skillName);
    const runtimeResolvedGuide = buildPaperStudyRuntimeSkillContract(skillName);
    if (!definition && options.paperStudyAttachmentTurn && runtimeResolvedGuide) {
      blocks.push(
        [
          `Skill guide: $${skillName}`,
          "Path: (runtime-resolved attachment contract)",
          `Description: ${getRuntimeFallbackSkillDescription(skillName)}`,
          "",
          runtimeResolvedGuide,
        ].join("\n"),
      );
      continue;
    }
    if (!definition) {
      continue;
    }

    if (options.paperStudyAttachmentTurn && runtimeResolvedGuide) {
      blocks.push(
        [
          `Skill guide: $${definition.name}`,
          `Path: ${definition.path}`,
          `Description: ${definition.description}`,
          "",
          runtimeResolvedGuide,
        ].join("\n"),
      );
      continue;
    }

    try {
      const body = (await fs.readFile(definition.path, "utf8")).trim();
      if (!body) {
        continue;
      }
      blocks.push(
        [
          `Skill guide: $${definition.name}`,
          `Path: ${definition.path}`,
          `Description: ${definition.description}`,
          "",
          body,
        ].join("\n"),
      );
    } catch {
      // Missing or unreadable guides should not block the turn.
    }
  }

  if (blocks.length === 0) {
    return null;
  }

  return ["Requested skill guides:", ...blocks].join("\n\n");
}

function buildPaperStudyRuntimeSkillContract(skillName: string): string | null {
  if (skillName === "deep-read") {
    return [
      "Runtime-resolved contract for this turn:",
      "- The attached source package is already the canonical paper text.",
      "- Do not normalize paths, copy the PDF, call shell tools, or retry Read-tool ingestion.",
      "- Do not ask for the file path again and do not narrate sandbox/bootstrap failures to the user.",
      "- Start directly from the attached coverage and separate authors' claims, methods, results, assumptions, and limitations.",
    ].join("\n");
  }

  if (skillName === "study-material-builder") {
    return [
      "Runtime-resolved contract for this turn:",
      "- Replace Workflow 1 source-bundle inspection with attachment-manifest + attachment-content classification.",
      "- Do not inspect the source bundle, staging path, or local PDF again.",
      "- Build the Reader/Guide from the attached source package and state coverage boundaries when the excerpt is partial.",
      "- Do not ask for file paths or emit sandbox/local-read troubleshooting chatter.",
    ].join("\n");
  }

  if (skillName === "deep-research") {
    return [
      "Runtime-resolved contract for this turn:",
      "- Use the attached source package as the primary evidence bundle for this turn.",
      "- Do not perform a second local source-acquisition pass before analyzing the attached material.",
    ].join("\n");
  }

  return null;
}
