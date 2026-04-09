import { promises as fs } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { splitCommandString } from "./command";

export interface CodexPromptDefinition {
  command: string;
  aliases: string[];
  label: string;
  description: string;
  argumentHint: string | null;
  path: string;
  body: string;
}

interface PromptMetadata {
  name: string | null;
  description: string | null;
  argumentHint: string | null;
  body: string;
}

const PROMPT_FILE_EXTENSIONS = new Set([".md", ".prompt", ".txt"]);

function normalizeCommandName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizePromptAlias(relativePromptPath: string): string {
  const dotted = relativePromptPath
    .replace(/\.[^.]+$/u, "")
    .replace(/[\\/]+/gu, ".")
    .replace(/^\.+|\.+$/gu, "");
  return `/prompts:${dotted || "prompt"}`;
}

function parseFrontmatter(lines: string[]): PromptMetadata | null {
  if (lines[0]?.trim() !== "---") {
    return null;
  }

  const metadata = new Map<string, string>();
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line === "---") {
      index += 1;
      break;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/u.exec(line);
    if (!match) {
      continue;
    }
    metadata.set(match[1].toLowerCase(), match[2].trim());
  }

  if (index <= 1) {
    return null;
  }

  return {
    name: metadata.get("name") ?? null,
    description: metadata.get("description") ?? null,
    argumentHint: metadata.get("argument-hint") ?? metadata.get("argument_hint") ?? null,
    body: lines.slice(index).join("\n").trim(),
  };
}

function parseInlineMetadata(lines: string[]): PromptMetadata | null {
  const metadata = new Map<string, string>();
  let consumed = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      consumed += 1;
      continue;
    }
    const match = /^(?:#+\s*)?(name|description|argument-hint|argument_hint)\s*:\s*(.+)$/iu.exec(line);
    if (!match) {
      break;
    }
    metadata.set(match[1].toLowerCase(), match[2].trim());
    consumed += 1;
  }

  if (metadata.size === 0) {
    return null;
  }

  return {
    name: metadata.get("name") ?? null,
    description: metadata.get("description") ?? null,
    argumentHint: metadata.get("argument-hint") ?? metadata.get("argument_hint") ?? null,
    body: lines.slice(consumed).join("\n").trim(),
  };
}

function parsePromptMetadata(content: string): PromptMetadata {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  return parseFrontmatter(lines) ?? parseInlineMetadata(lines) ?? {
    name: null,
    description: null,
    argumentHint: null,
    body: content.trim(),
  };
}

async function collectPromptFiles(root: string, relativeDir = ""): Promise<string[]> {
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
    if (entryName.startsWith(".")) {
      continue;
    }
    const entryRelativePath = relativeDir ? join(relativeDir, entryName) : entryName;
    if (entry.isDirectory()) {
      files.push(...(await collectPromptFiles(root, entryRelativePath)));
      continue;
    }
    if (!PROMPT_FILE_EXTENSIONS.has(extname(entryName).toLowerCase())) {
      continue;
    }
    files.push(join(root, entryRelativePath));
  }
  return files;
}

export async function loadCodexPromptCatalog(promptRoots: string[]): Promise<CodexPromptDefinition[]> {
  const catalog: CodexPromptDefinition[] = [];
  const seenCommands = new Set<string>();

  for (const root of promptRoots) {
    const files = await collectPromptFiles(root);
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8");
      const metadata = parsePromptMetadata(content);
      const fallbackName = basename(filePath, extname(filePath));
      const relativePromptPath = relative(root, filePath).replace(/\\/g, "/");
      const command = normalizeCommandName(metadata.name ?? fallbackName);
      const alias = normalizePromptAlias(relativePromptPath);
      const aliases = alias === command ? [] : [alias];
      const normalizedKeys = [command, ...aliases].map((value) => value.toLowerCase());
      if (normalizedKeys.some((value) => seenCommands.has(value))) {
        continue;
      }
      for (const key of normalizedKeys) {
        seenCommands.add(key);
      }
      catalog.push({
        command,
        aliases,
        label: command.slice(1) || fallbackName,
        description: metadata.description ?? "Custom Codex prompt",
        argumentHint: metadata.argumentHint,
        path: filePath,
        body: metadata.body,
      });
    }
  }

  return catalog.sort((left, right) => left.command.localeCompare(right.command));
}

export function resolveCodexPromptCommand(
  command: string,
  prompts: CodexPromptDefinition[],
): CodexPromptDefinition | null {
  const normalized = command.trim().toLowerCase();
  return prompts.find((entry) => {
    if (entry.command.toLowerCase() === normalized) {
      return true;
    }
    return entry.aliases.some((alias) => alias.toLowerCase() === normalized);
  }) ?? null;
}

export function expandCodexPrompt(definition: CodexPromptDefinition, rawArguments: string): string {
  const args = splitCommandString(rawArguments.trim());
  let expanded = definition.body;

  expanded = expanded.replace(/\$ARGUMENTS\b/gu, rawArguments.trim());
  for (let index = 0; index < 9; index += 1) {
    const pattern = new RegExp(`\\$${index + 1}\\b`, "gu");
    expanded = expanded.replace(pattern, args[index] ?? "");
  }

  const sections = [expanded.trim()];
  const hasArgumentPlaceholder = /\$(?:ARGUMENTS|[1-9])\b/u.test(definition.body);
  if (rawArguments.trim() && !hasArgumentPlaceholder) {
    sections.push(rawArguments.trim());
  }

  return sections.filter(Boolean).join("\n\n").trim();
}
