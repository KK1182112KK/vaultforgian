import { promises as fs } from "node:fs";
import { join, basename } from "node:path";

export interface InstalledSkillDefinition {
  name: string;
  description: string;
  path: string;
}

async function collectSkillFiles(root: string, relativeDir = ""): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(join(root, relativeDir), { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryName = String(entry.name);
    const entryRelativePath = relativeDir ? join(relativeDir, entryName) : entryName;
    if (entry.isDirectory()) {
      files.push(...(await collectSkillFiles(root, entryRelativePath)));
      continue;
    }
    if (entryName !== "SKILL.md") {
      continue;
    }
    files.push(join(root, entryRelativePath));
  }
  return files;
}

function extractSkillDescription(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    return line;
  }
  return "Installed Codex skill";
}

export async function loadInstalledSkillCatalog(skillRoots: string[]): Promise<InstalledSkillDefinition[]> {
  const catalog: InstalledSkillDefinition[] = [];
  const seenNames = new Set<string>();

  for (const root of skillRoots) {
    const files = await collectSkillFiles(root);
    for (const filePath of files) {
      const name = basename(join(filePath, ".."));
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
