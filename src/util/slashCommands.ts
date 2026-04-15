import { basename, extname } from "node:path";
import type { App, Editor, Stat, TFile } from "obsidian";
import { expandCodexPrompt, resolveCodexPromptCommand, type CodexPromptDefinition } from "./codexPrompts";
import type { SlashCommandDefinition } from "./slashCommandCatalog";
import { getSlashCommandCatalog, matchSlashCommands } from "./slashCommandCatalog";
import type { InstalledSkillDefinition } from "./skillCatalog";
import type { PatchProposal } from "../model/types";

export type SlashLocalActionType = "fork" | "resume" | "compact" | "apply_latest_patch";

export interface SlashLocalAction {
  type: SlashLocalActionType;
}

export interface SlashExpansion {
  command: string | null;
  prompt: string;
  skillPrompt: string;
  studyRecipeId?: string;
  localAction?: SlashLocalAction;
}

export interface SlashContext {
  app: App;
  currentFile: TFile | null;
  targetFile?: TFile | null;
  editor: Editor | null;
  selectionText?: string | null;
  selectionSourcePath?: string | null;
  customPrompts?: CodexPromptDefinition[];
  installedSkills?: InstalledSkillDefinition[];
  commands?: readonly SlashCommandDefinition[];
  patchBasket?: readonly PatchProposal[];
}

function formatFileContext(label: string, file: TFile, content: string): string {
  return `${label}: ${file.path}\n\n\`\`\`md\n${content}\n\`\`\``;
}

function isLikelyTFile(value: unknown): value is TFile {
  return typeof value === "object" && value !== null && typeof (value as { path?: unknown }).path === "string";
}

function getTodayStamp(): string {
  const now = new Date();
  const year = `${now.getFullYear()}`;
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function loadDailyNote(app: App): Promise<TFile | null> {
  const today = getTodayStamp();
  const direct = app.vault.getAbstractFileByPath(`${today}.md`);
  if (isLikelyTFile(direct)) {
    return direct;
  }

  const nested = app.vault.getAbstractFileByPath(`daily/${today}.md`);
  if (isLikelyTFile(nested)) {
    return nested;
  }

  return null;
}

function splitCommand(input: string): { command: string | null; rest: string } {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { command: null, rest: input };
  }

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace < 0) {
    return { command: trimmed, rest: "" };
  }

  return {
    command: trimmed.slice(0, firstSpace),
    rest: trimmed.slice(firstSpace + 1).trim(),
  };
}

function matchesApplyLatestPatchIntent(input: string): boolean {
  const normalized = input.trim();
  if (!normalized) {
    return false;
  }
  return [
    /^(?:そのまま|じゃあ|では)?\s*(?:ノートに)?(?:反映|適用)(?:して|してください|してほしい|して下さい)?$/i,
    /^apply (?:it|that|the patch)$/i,
    /^go ahead and apply(?: it| the patch)?$/i,
    /^apply latest patch$/i,
  ].some((pattern) => pattern.test(normalized));
}

function resolveMatchedSlashCommand(command: string, commands: readonly SlashCommandDefinition[]): SlashCommandDefinition | null {
  return commands.find((entry) => entry.command.toLowerCase() === command.toLowerCase()) ?? matchSlashCommands(command, commands)[0] ?? null;
}

function extractLeadingSkillAliasBlock(
  input: string,
  commands: readonly SlashCommandDefinition[],
): { command: string; skillNames: string[]; rest: string } | null {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const skillNames: string[] = [];
  let firstCommand: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      if (skillNames.length > 0) {
        index += 1;
        continue;
      }
      break;
    }
    const { command, rest } = splitCommand(line);
    if (!command || rest.trim()) {
      break;
    }
    const matched = resolveMatchedSlashCommand(command, commands);
    if (matched?.mode !== "skill_alias" || !matched.skillName) {
      break;
    }
    firstCommand ??= matched.command;
    if (!skillNames.includes(matched.skillName)) {
      skillNames.push(matched.skillName);
    }
    index += 1;
  }

  if (!firstCommand || skillNames.length === 0) {
    return null;
  }

  while (index < lines.length && !(lines[index]?.trim() ?? "")) {
    index += 1;
  }

  return {
    command: firstCommand,
    skillNames,
    rest: lines.slice(index).join("\n").trim(),
  };
}

function resolvePrimaryFile(context: SlashContext): TFile | null {
  return context.targetFile ?? context.currentFile ?? null;
}

function formatList(label: string, items: readonly string[]): string {
  if (items.length === 0) {
    return `${label}: none`;
  }
  return [label, ...items.map((item) => `- ${item}`)].join("\n");
}

function getNoteStem(path: string): string {
  const base = basename(path);
  return base.slice(0, Math.max(0, base.length - extname(base).length));
}

function collectBacklinks(app: App, targetPath: string): { total: number; sources: string[] } {
  const resolvedLinks = app.metadataCache.resolvedLinks ?? {};
  const sources: Array<{ source: string; count: number }> = [];
  let total = 0;
  for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
    const count = targets?.[targetPath] ?? 0;
    if (count > 0) {
      total += count;
      sources.push({ source: sourcePath, count });
    }
  }
  return {
    total,
    sources: sources.sort((left, right) => right.count - left.count).map((entry) => `${entry.source} (${entry.count})`),
  };
}

function collectUnresolved(app: App, filePath: string): { items: string[]; total: number } {
  const unresolved = app.metadataCache.unresolvedLinks?.[filePath] ?? {};
  const items = Object.entries(unresolved)
    .map(([target, count]) => `${target} (${count})`)
    .sort((left, right) => left.localeCompare(right));
  return {
    items,
    total: items.length,
  };
}

function collectUnresolvedForStem(app: App, noteStem: string): { total: number; sources: string[] } {
  const unresolvedLinks = app.metadataCache.unresolvedLinks ?? {};
  const sources: string[] = [];
  for (const [sourcePath, targets] of Object.entries(unresolvedLinks)) {
    const hasMatch = Object.keys(targets ?? {}).some((target) => target === noteStem || target === `${noteStem}.md`);
    if (hasMatch) {
      sources.push(sourcePath);
    }
  }
  return {
    total: sources.length,
    sources: sources.slice(0, 5),
  };
}

async function formatHistoryContext(context: SlashContext, file: TFile): Promise<string> {
  const stat: Stat | null = await context.app.vault.adapter.stat(file.path);
  const patches = (context.patchBasket ?? [])
    .filter((proposal) => proposal.targetPath === file.path)
    .slice(-3)
    .map((proposal) => `${proposal.status}: ${proposal.summary}`);
  const lines = [
    `History context: ${file.path}`,
    stat ? `Modified: ${new Date(stat.mtime).toISOString()}` : "Modified: unknown",
    stat ? `Created: ${new Date(stat.ctime).toISOString()}` : "Created: unknown",
    stat ? `Size: ${stat.size} bytes` : null,
    formatList("Recent Codex patches", patches),
    "Recovery note: Use Obsidian File Recovery for snapshot restore.",
  ].filter((entry): entry is string => Boolean(entry));
  return lines.join("\n");
}

async function formatDiffContext(context: SlashContext, file: TFile): Promise<string> {
  const proposal =
    (context.patchBasket ?? [])
      .filter((entry) => entry.targetPath === file.path)
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  if (!proposal) {
    return `Diff context: ${file.path}\n\nNo Codex patch is staged for this note in the current tab.`;
  }
  return `Diff context: ${file.path}\n\n\`\`\`diff\n${proposal.unifiedDiff}\n\`\`\``;
}

async function formatSearchContext(context: SlashContext, query: string): Promise<string> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    throw new Error("Provide a search query after /searchctx.");
  }
  const files = context.app.vault.getMarkdownFiles();
  const matches: string[] = [];
  for (const file of files) {
    const content = await context.app.vault.cachedRead(file);
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    for (const [index, line] of lines.entries()) {
      if (!line.toLowerCase().includes(normalizedQuery)) {
        continue;
      }
      matches.push(`${file.path}:${index + 1} ${line.trim()}`);
      if (matches.length >= 5) {
        break;
      }
    }
    if (matches.length >= 5) {
      break;
    }
  }
  return [`Search context for "${query.trim()}"`, ...matches.map((entry) => `- ${entry}`), matches.length === 0 ? "- no matches" : ""]
    .filter(Boolean)
    .join("\n");
}

async function buildBuiltInSlashPrompt(command: string, rest: string, context: SlashContext): Promise<SlashExpansion | null> {
  const file = resolvePrimaryFile(context);

  if (command === "/backlinks") {
    if (!file) {
      throw new Error("No current or reference note is available for /backlinks.");
    }
    const backlinks = collectBacklinks(context.app, file.path);
    const prompt = [
      `Backlinks for ${file.path}`,
      `Total backlinks: ${backlinks.total}`,
      formatList("Source notes", backlinks.sources.slice(0, 8)),
      rest,
    ]
      .filter(Boolean)
      .join("\n\n");
    return { command, prompt, skillPrompt: rest };
  }

  if (command === "/unresolved") {
    if (!file) {
      throw new Error("No current or reference note is available for /unresolved.");
    }
    const unresolved = collectUnresolved(context.app, file.path);
    const prompt = [
      `Unresolved links for ${file.path}`,
      `Total unresolved targets: ${unresolved.total}`,
      formatList("Unresolved targets", unresolved.items.slice(0, 12)),
      rest,
    ]
      .filter(Boolean)
      .join("\n\n");
    return { command, prompt, skillPrompt: rest };
  }

  if (command === "/history") {
    if (!file) {
      throw new Error("No current or reference note is available for /history.");
    }
    const prompt = [await formatHistoryContext(context, file), rest].filter(Boolean).join("\n\n");
    return { command, prompt, skillPrompt: rest };
  }

  if (command === "/diff") {
    if (!file) {
      throw new Error("No current or reference note is available for /diff.");
    }
    const prompt = [await formatDiffContext(context, file), rest].filter(Boolean).join("\n\n");
    return { command, prompt, skillPrompt: rest };
  }

  if (command === "/searchctx") {
    const prompt = await formatSearchContext(context, rest);
    return { command, prompt, skillPrompt: rest };
  }

  if (command === "/rename-plan" || command === "/move-plan" || command === "/property-plan" || command === "/task-plan") {
    if (!file) {
      throw new Error(`No current or reference note is available for ${command}.`);
    }
    const backlinks = collectBacklinks(context.app, file.path);
    const noteStem = getNoteStem(file.path);
    const unresolved = collectUnresolvedForStem(context.app, noteStem);
    const actionLabel =
      command === "/rename-plan"
        ? "rename"
        : command === "/move-plan"
          ? "move"
          : command === "/property-plan"
            ? "property update"
            : "task update";
    const prompt = [
      `Prepare an ${actionLabel} proposal for ${file.path}.`,
      `Backlinks detected: ${backlinks.total}.`,
      formatList("Backlink source notes", backlinks.sources.slice(0, 6)),
      unresolved.total > 0 ? formatList("Unresolved references to the current note title", unresolved.sources) : "No unresolved title references detected.",
      "Respond with a short explanation and the appropriate `obsidian-ops` block. Do not directly edit the note body.",
      rest || `Focus on the best ${actionLabel} that keeps the vault safe and coherent.`,
    ].join("\n\n");
    return { command, prompt, skillPrompt: rest };
  }

  return null;
}

export { getSlashCommandCatalog, matchSlashCommands };
export type { SlashCommandDefinition };

export async function expandSlashCommand(input: string, context: SlashContext): Promise<SlashExpansion> {
  const commands = context.commands ?? getSlashCommandCatalog();
  const leadingSkillAliases = extractLeadingSkillAliasBlock(input, commands);
  if (leadingSkillAliases) {
    const prompt =
      leadingSkillAliases.rest ||
      `Use ${leadingSkillAliases.skillNames.map((name) => `$${name}`).join(", ")} for this request.`;
    return {
      command: leadingSkillAliases.command,
      prompt,
      skillPrompt: [...leadingSkillAliases.skillNames.map((name) => `$${name}`), ...(leadingSkillAliases.rest ? [leadingSkillAliases.rest] : [])].join(
        "\n",
      ),
    };
  }

  const { command, rest } = splitCommand(input);
  if (command === null) {
    if (matchesApplyLatestPatchIntent(input)) {
      return {
        command: null,
        prompt: "",
        skillPrompt: "",
        localAction: {
          type: "apply_latest_patch",
        },
      };
    }
    return { command: null, prompt: input.trim(), skillPrompt: input.trim() };
  }

  const matchedCommand = resolveMatchedSlashCommand(command, commands);

  if (command === "/note") {
    if (!context.currentFile) {
      throw new Error("No active note to attach.");
    }
    const content = await context.app.vault.cachedRead(context.currentFile);
    const prompt = [formatFileContext("Active note", context.currentFile, content), rest].filter(Boolean).join("\n\n");
    return { command, prompt, skillPrompt: rest };
  }

  if (command === "/selection") {
    const selection = context.selectionText?.trim() || context.editor?.getSelection().trim() || "";
    if (!selection) {
      if (!context.editor) {
        throw new Error("No editor selection is available.");
      }
      throw new Error("Select some text before using /selection.");
    }
    const sourcePath = context.selectionSourcePath ?? context.currentFile?.path ?? null;
    const label = sourcePath ? `Selection from ${sourcePath}` : "Selection";
    const prompt = [`${label}\n\n\`\`\`md\n${selection}\n\`\`\``, rest].filter(Boolean).join("\n\n");
    return { command, prompt, skillPrompt: rest };
  }

  if (command === "/daily") {
    const file = await loadDailyNote(context.app);
    if (!file) {
      throw new Error("Today's daily note was not found.");
    }
    const content = await context.app.vault.cachedRead(file);
    const prompt = [formatFileContext("Daily note", file, content), rest].filter(Boolean).join("\n\n");
    return { command, prompt, skillPrompt: rest };
  }

  const builtInSlash = await buildBuiltInSlashPrompt(command, rest, context);
  if (builtInSlash) {
    return builtInSlash;
  }

  if (command === "/fork" || command === "/resume" || command === "/compact") {
    return {
      command,
      prompt: "",
      skillPrompt: "",
      localAction: {
        type: command === "/fork" ? "fork" : command === "/resume" ? "resume" : "compact",
      },
    };
  }

  if (matchedCommand?.mode === "skill_alias" && matchedCommand.skillName) {
    const prompt = rest.trim() || `Use $${matchedCommand.skillName} for this request.`;
    const skillPrompt = `$${matchedCommand.skillName}${rest.trim() ? ` ${rest.trim()}` : ""}`;
    return {
      command: matchedCommand.command,
      prompt,
      skillPrompt,
    };
  }

  if (matchedCommand?.mode === "study_recipe" && matchedCommand.recipeId && matchedCommand.recipePrompt) {
    const prompt = [matchedCommand.recipePrompt.trim(), rest.trim()].filter(Boolean).join("\n\n");
    return {
      command: matchedCommand.command,
      prompt,
      skillPrompt: rest.trim(),
      studyRecipeId: matchedCommand.recipeId,
    };
  }

  const customPrompt = resolveCodexPromptCommand(command, context.customPrompts ?? []);
  if (customPrompt) {
    return {
      command: customPrompt.command,
      prompt: expandCodexPrompt(customPrompt, rest),
      skillPrompt: rest,
    };
  }

  return { command: null, prompt: input.trim(), skillPrompt: input.trim() };
}
