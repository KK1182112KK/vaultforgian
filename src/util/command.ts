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

export function toWslPath(inputPath: string, commandParts: string[]): string {
  if (!usesWsl(commandParts)) {
    return inputPath;
  }

  const windowsDriveMatch = /^([a-zA-Z]):[\\/](.*)$/.exec(inputPath);
  if (!windowsDriveMatch) {
    return inputPath.replace(/\\/g, "/");
  }

  const [, drive, remainder] = windowsDriveMatch;
  return `/mnt/${drive.toLowerCase()}/${remainder.replace(/\\/g, "/")}`;
}

export function quoteForBash(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
