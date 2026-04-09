import type { SlashCommandDefinition } from "./slashCommandCatalog";
import type { InstalledSkillDefinition } from "./skillCatalog";

export interface ComposerSuggestion {
  kind: "slash" | "skill" | "mention" | "instruction";
  token: string;
  label: string;
  description: string;
}

interface SkillMatch {
  start: number;
  end: number;
  fragment: string;
}

interface TokenMatch {
  start: number;
  end: number;
  fragment: string;
}

function findSkillFragment(input: string, cursor: number): SkillMatch | null {
  const beforeCursor = input.slice(0, cursor);
  const match = /(^|[\s(])\$([A-Za-z0-9:_-]*)$/u.exec(beforeCursor);
  if (!match) {
    return null;
  }
  const fragment = match[2] ?? "";
  return {
    start: beforeCursor.length - fragment.length - 1,
    end: beforeCursor.length,
    fragment,
  };
}

function findMentionFragment(input: string, cursor: number): TokenMatch | null {
  const beforeCursor = input.slice(0, cursor);
  const match = /(^|[\s(])@([A-Za-z0-9_:/().-]*)$/u.exec(beforeCursor);
  if (!match) {
    return null;
  }
  const fragment = match[2] ?? "";
  return {
    start: beforeCursor.length - fragment.length - 1,
    end: beforeCursor.length,
    fragment,
  };
}

function findInstructionFragment(input: string, cursor: number): TokenMatch | null {
  const beforeCursor = input.slice(0, cursor);
  const match = /(^|[\s(])#([A-Za-z0-9:_-]*)$/u.exec(beforeCursor);
  if (!match) {
    return null;
  }
  const fragment = match[2] ?? "";
  return {
    start: beforeCursor.length - fragment.length - 1,
    end: beforeCursor.length,
    fragment,
  };
}

function findSlashFragment(input: string, cursor: number): string | null {
  const beforeCursor = input.slice(0, cursor);
  const trimmedStart = beforeCursor.trimStart();
  if (!trimmedStart.startsWith("/")) {
    return null;
  }
  const leadingWhitespaceLength = beforeCursor.length - trimmedStart.length;
  const firstSpace = trimmedStart.indexOf(" ");
  if (firstSpace >= 0) {
    if (cursor > leadingWhitespaceLength + firstSpace) {
      return null;
    }
    return trimmedStart.slice(0, firstSpace).toLowerCase();
  }
  return trimmedStart.toLowerCase();
}

export function matchComposerSuggestions(
  input: string,
  cursor: number,
  slashCommands: readonly SlashCommandDefinition[],
  skills: readonly InstalledSkillDefinition[],
  mentions: readonly ComposerSuggestion[] = [],
  instructions: readonly ComposerSuggestion[] = [],
): ComposerSuggestion[] {
  const skillMatch = findSkillFragment(input, cursor);
  if (skillMatch) {
    return skills
      .filter((entry) => entry.name.toLowerCase().startsWith(skillMatch.fragment.toLowerCase()))
      .map((entry) => ({
        kind: "skill" as const,
        token: `$${entry.name}`,
        label: entry.name,
        description: entry.description,
      }));
  }

  const mentionMatch = findMentionFragment(input, cursor);
  if (mentionMatch) {
    return mentions.filter(
      (entry) =>
        entry.token.toLowerCase().startsWith(`@${mentionMatch.fragment.toLowerCase()}`) ||
        entry.label.toLowerCase().startsWith(mentionMatch.fragment.toLowerCase()),
    );
  }

  const instructionMatch = findInstructionFragment(input, cursor);
  if (instructionMatch) {
    return instructions.filter(
      (entry) =>
        entry.token.toLowerCase().startsWith(`#${instructionMatch.fragment.toLowerCase()}`) ||
        entry.label.toLowerCase().startsWith(instructionMatch.fragment.toLowerCase()),
    );
  }

  const slashFragment = findSlashFragment(input, cursor);
  if (!slashFragment) {
    return [];
  }

  return slashCommands
    .filter((entry) => entry.command.toLowerCase().startsWith(slashFragment))
    .map((entry) => ({
      kind: "slash" as const,
      token: entry.command,
      label: entry.label,
      description: entry.description,
    }));
}

export function applyComposerSuggestion(
  input: string,
  cursor: number,
  suggestion: ComposerSuggestion,
): { value: string; cursor: number } {
  if (suggestion.kind === "slash") {
    const trimmedStart = input.trimStart();
    const leadingWhitespace = input.slice(0, input.length - trimmedStart.length);
    const firstSpace = trimmedStart.indexOf(" ");
    if (firstSpace < 0 || cursor <= leadingWhitespace.length + firstSpace + 1) {
      const value = `${leadingWhitespace}${suggestion.token} `;
      return { value, cursor: value.length };
    }
    const rest = trimmedStart.slice(firstSpace + 1).trimStart();
    const value = `${leadingWhitespace}${suggestion.token}${rest ? ` ${rest}` : " "}`;
    return { value, cursor: value.length };
  }

  if (suggestion.kind === "mention" || suggestion.kind === "instruction") {
    const matcher = suggestion.kind === "mention" ? findMentionFragment : findInstructionFragment;
    const tokenMatch = matcher(input, cursor);
    if (!tokenMatch) {
      const value = `${input}${suggestion.token} `;
      return { value, cursor: value.length };
    }
    const value = `${input.slice(0, tokenMatch.start)}${suggestion.token} ${input.slice(tokenMatch.end)}`;
    const nextCursor = tokenMatch.start + suggestion.token.length + 1;
    return { value, cursor: nextCursor };
  }

  const skillMatch = findSkillFragment(input, cursor);
  if (!skillMatch) {
    const value = `${input}${suggestion.token} `;
    return { value, cursor: value.length };
  }

  const value = `${input.slice(0, skillMatch.start)}${suggestion.token} ${input.slice(skillMatch.end)}`;
  const nextCursor = skillMatch.start + suggestion.token.length + 1;
  return { value, cursor: nextCursor };
}
