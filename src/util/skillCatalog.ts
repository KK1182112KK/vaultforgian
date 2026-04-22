import { promises as fs } from "node:fs";
import { join, basename, relative, sep } from "node:path";

export interface InstalledSkillDefinition {
  name: string;
  description: string;
  path: string;
}

export interface SkillCatalogLoadOptions {
  maxDepth?: number;
  maxDirectories?: number;
  maxFiles?: number;
}

const DEFAULT_MAX_TRAVERSAL_DEPTH = 8;
const DEFAULT_MAX_TRAVERSED_DIRECTORIES = 512;
const DEFAULT_MAX_DISCOVERED_SKILL_FILES = 256;

export function isUserOwnedSkillDefinition(skill: InstalledSkillDefinition): boolean {
  return !/[\\/]\.codex[\\/]plugins[\\/]cache[\\/]/i.test(skill.path);
}

async function collectSkillFiles(
  root: string,
  options: Required<SkillCatalogLoadOptions>,
): Promise<string[]> {
  const stack: Array<{ relativeDir: string; depth: number }> = [{ relativeDir: "", depth: 0 }];
  const files: string[] = [];
  let traversedDirectories = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (traversedDirectories >= options.maxDirectories) {
      break;
    }
    traversedDirectories += 1;

    let entries;
    try {
      entries = await fs.readdir(join(root, current.relativeDir), { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        continue;
      }
      throw error;
    }

    const orderedEntries = [...entries].sort((left, right) => String(left.name).localeCompare(String(right.name)));
    for (let index = orderedEntries.length - 1; index >= 0; index -= 1) {
      const entry = orderedEntries[index];
      if (!entry) {
        continue;
      }
      const entryName = String(entry.name);
      const entryRelativePath = current.relativeDir ? join(current.relativeDir, entryName) : entryName;
      if (entry.isDirectory()) {
        if (current.depth < options.maxDepth) {
          stack.push({ relativeDir: entryRelativePath, depth: current.depth + 1 });
        }
        continue;
      }
      if (entryName !== "SKILL.md") {
        continue;
      }
      files.push(join(root, entryRelativePath));
      if (files.length >= options.maxFiles) {
        return files;
      }
    }
  }

  return files;
}

function resolveLoadOptions(options: SkillCatalogLoadOptions): Required<SkillCatalogLoadOptions> {
  return {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_TRAVERSAL_DEPTH,
    maxDirectories: options.maxDirectories ?? DEFAULT_MAX_TRAVERSED_DIRECTORIES,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_DISCOVERED_SKILL_FILES,
  };
}

function extractSkillDescription(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index]?.trim() ?? "";
      if (line === "---") {
        break;
      }
      if (line.startsWith("description:")) {
        return line
          .slice("description:".length)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
    }
  }
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line === "---" || line.startsWith("name:") || line.startsWith("description:")) {
      continue;
    }
    return line;
  }
  return "Installed Codex skill";
}

function deriveSkillName(root: string, filePath: string): string {
  const segments = relative(root, filePath).split(sep).filter(Boolean);
  const skillsIndex = segments.lastIndexOf("skills");
  const skillDirName = basename(join(filePath, ".."));
  if (skillsIndex >= 0 && skillsIndex + 1 < segments.length && segments[skillsIndex - 3] === "openai-curated") {
    const pluginName = segments[skillsIndex - 2];
    if (pluginName) {
      return `${pluginName}:${skillDirName}`;
    }
  }
  return skillDirName;
}

export async function loadInstalledSkillCatalog(
  skillRoots: string[],
  options: SkillCatalogLoadOptions = {},
): Promise<InstalledSkillDefinition[]> {
  const catalog: InstalledSkillDefinition[] = [];
  const seenNames = new Set<string>();
  const loadOptions = resolveLoadOptions(options);

  for (const root of skillRoots) {
    const files = await collectSkillFiles(root, loadOptions);
    for (const filePath of files) {
      const name = deriveSkillName(root, filePath);
      if (!name || seenNames.has(name)) {
        continue;
      }
      const content = await fs.readFile(filePath, "utf8");
      seenNames.add(name);
      catalog.push({
        name,
        description: extractSkillDescription(content),
        path: filePath,
      });
    }
  }

  return catalog.sort((left, right) => left.name.localeCompare(right.name));
}
