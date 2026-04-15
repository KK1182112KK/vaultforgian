export type MentionEntityKind = "note" | "skill" | "recipe" | "external_dir" | "mcp";

export interface ParsedMention {
  kind: MentionEntityKind;
  value: string;
}

export interface PromptMetadataExtraction {
  cleanedPrompt: string;
  executionPrompt: string;
  instructionLabels: string[];
  mentions: ParsedMention[];
}

export interface NormalizePromptInputOptions {
  hasSelection: boolean;
  attachmentCount: number;
  selectionPrompt: string;
  attachmentPrompt: string;
  selectionAndAttachmentPrompt: string;
}

export function formatPlanModePrompt(prompt: string, _skillNames: readonly string[]): string {
  return prompt;
}

export function normalizeUserPromptWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizePromptInput(input: string, options: NormalizePromptInputOptions): string {
  const trimmed = input.trim();
  if (trimmed) {
    return trimmed;
  }
  if (options.hasSelection && options.attachmentCount > 0) {
    return options.selectionAndAttachmentPrompt;
  }
  if (options.hasSelection) {
    return options.selectionPrompt;
  }
  if (options.attachmentCount > 0) {
    return options.attachmentPrompt;
  }
  return "";
}

export function extractPromptMetadata(input: string): PromptMetadataExtraction {
  const instructionLabels = new Set<string>();
  const mentions: ParsedMention[] = [];

  const withoutInstructions = input.replace(/(^|[\s(])#([A-Za-z0-9:_-]+)/gu, (_match, prefix: string, label: string) => {
    if (label?.trim()) {
      instructionLabels.add(label.trim().toLowerCase());
    }
    return prefix || "";
  });

  const cleanedPrompt = withoutInstructions.replace(
    /@(?:(note|skill|recipe|dir|mcp)\(([^)]+)\))/gu,
    (_match, rawKind: string, rawValue: string) => {
      const value = rawValue?.trim() ?? "";
      if (!value) {
        return "";
      }
      const kind: MentionEntityKind =
        rawKind === "note"
          ? "note"
          : rawKind === "skill"
              ? "skill"
              : rawKind === "recipe"
                ? "recipe"
                : rawKind === "dir"
                  ? "external_dir"
                  : "mcp";
      mentions.push({ kind, value });
      return "";
    },
  );

  const seenExternalDirs = new Set(
    mentions
      .filter((mention) => mention.kind === "external_dir")
      .map((mention) => mention.value.trim().toLowerCase()),
  );

  const implicitExternalDirs = [
    ...cleanedPrompt.matchAll(/\\\\wsl(?:\.localhost)?\\[^\s\\]+\\[^\s"'`<>]+/giu),
    ...cleanedPrompt.matchAll(/\\\\wsl\$\\[^\s\\]+\\[^\s"'`<>]+/giu),
    ...cleanedPrompt.matchAll(/(?:^|[\s(])([A-Za-z]:\\[^\s)"'`<>]+)/gu),
    ...cleanedPrompt.matchAll(/(?:^|[\s(])((?:~\/|\/(?:home|mnt|tmp)\/)[^\s)"'`<>]+)/gu),
  ]
    .map((match) => (match[1] ?? match[0] ?? "").trim())
    .filter(Boolean);

  for (const value of implicitExternalDirs) {
    const normalizedKey = value.toLowerCase();
    if (seenExternalDirs.has(normalizedKey)) {
      continue;
    }
    seenExternalDirs.add(normalizedKey);
    mentions.push({ kind: "external_dir", value });
  }

  const normalizedPrompt = normalizeUserPromptWhitespace(cleanedPrompt);
  const externalDirValues = [
    ...mentions.filter((mention) => mention.kind === "external_dir").map((mention) => mention.value),
    ...implicitExternalDirs,
  ];
  const executionPrompt = normalizeUserPromptWhitespace(
    externalDirValues.reduce(
      (current, value) => current.split(value).join("[external source path attached separately]"),
      normalizedPrompt,
    ),
  );

  return {
    cleanedPrompt: normalizedPrompt,
    executionPrompt,
    instructionLabels: [...instructionLabels],
    mentions,
  };
}
