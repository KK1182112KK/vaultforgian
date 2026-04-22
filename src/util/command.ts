export function splitCommandString(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) {
    return [];
  }

  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }

    if (quote !== null && char === quote) {
      quote = null;
      continue;
    }

    if (char === "\\" && index + 1 < trimmed.length) {
      const next = trimmed[index + 1];
      if (quote !== null || /\s|["'\\]/.test(next)) {
        current += next;
        index += 1;
        continue;
      }
    }

    if (/\s/.test(char) && quote === null) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

export function usesWsl(commandParts: string[]): boolean {
  const head = commandParts[0]?.toLowerCase() ?? "";
  return head.endsWith("wsl.exe") || head === "wsl";
}

export function isWslPathLike(inputPath: string): boolean {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return false;
  }
  return (
    /^\\\\wsl(?:\.localhost)?\\[^\\]+\\/i.test(trimmed) ||
    /^\\\\wsl\$\\[^\\]+\\/i.test(trimmed) ||
    trimmed.startsWith("/home/") ||
    trimmed.startsWith("/mnt/") ||
    trimmed.startsWith("~/")
  );
}

export function isWindowsUncPath(inputPath: string): boolean {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return false;
  }
  return /^\\\\[^\\]+\\[^\\]+/i.test(trimmed);
}

export function normalizeRuntimePath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return "";
  }

  const wslShareMatch = /^\\\\wsl(?:\.localhost)?\\[^\\]+\\(.*)$/i.exec(trimmed);
  if (wslShareMatch) {
    const remainder = wslShareMatch[1]?.replace(/\\/g, "/").replace(/^\/+/, "") ?? "";
    return `/${remainder}`;
  }

  const legacyWslShareMatch = /^\\\\wsl\$\\[^\\]+\\(.*)$/i.exec(trimmed);
  if (legacyWslShareMatch) {
    const remainder = legacyWslShareMatch[1]?.replace(/\\/g, "/").replace(/^\/+/, "") ?? "";
    return `/${remainder}`;
  }

  const windowsDriveMatch = /^([a-zA-Z]):[\\/](.*)$/.exec(trimmed);
  if (windowsDriveMatch) {
    const [, drive, remainder] = windowsDriveMatch;
    return `/mnt/${drive.toLowerCase()}/${remainder.replace(/\\/g, "/")}`;
  }

  return trimmed.replace(/\\/g, "/");
}

export function toWslPath(inputPath: string, commandParts: string[]): string {
  if (!usesWsl(commandParts)) {
    return inputPath;
  }
  return normalizeRuntimePath(inputPath);
}

export function quoteForBash(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
