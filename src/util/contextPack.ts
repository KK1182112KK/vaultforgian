export interface ContextPackSource {
  path: string;
  content: string;
}

export const MAX_CONTEXT_PATHS = 6;
export const MAX_CONTEXT_CHARS_PER_NOTE = 8000;

export function normalizeContextPaths(paths: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const rawPath of paths) {
    const path = rawPath.trim();
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    unique.push(path);
    if (unique.length >= MAX_CONTEXT_PATHS) {
      break;
    }
  }

  return unique;
}

function truncateContextContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_CONTEXT_CHARS_PER_NOTE) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_CONTEXT_CHARS_PER_NOTE).trimEnd()}\n\n...[truncated for context pack]`;
}

export function buildContextPackText(sources: ContextPackSource[]): string | null {
  const usable = sources
    .map((source) => ({
      path: source.path.trim(),
      content: truncateContextContent(source.content),
    }))
    .filter((source) => source.path.length > 0 && source.content.length > 0);

  if (usable.length === 0) {
    return null;
  }

  return [
    "Pinned context notes:",
    ...usable.map((source, index) => `Pinned note ${index + 1}: ${source.path}\n\n\`\`\`md\n${source.content}\n\`\`\``),
  ].join("\n\n");
}
