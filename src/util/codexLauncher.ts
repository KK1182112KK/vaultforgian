import type { CodexRuntime } from "../model/types";
import { splitCommandString } from "./command";

export const DEFAULT_CODEX_EXECUTABLE = "codex";

const WINDOWS_WSL_HEADS = new Set(["wsl", "wsl.exe"]);
const SHELL_LAUNCHER_HEADS = new Set([
  "bash",
  "sh",
  "zsh",
  "fish",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

export interface MigratedCodexLauncherConfig {
  runtime: CodexRuntime;
  executablePath: string;
  blockedLegacyCommand: string | null;
}

export function normalizeCodexRuntime(value: string | null | undefined): CodexRuntime {
  return value?.trim().toLowerCase() === "wsl" ? "wsl" : "native";
}

export function sanitizeCodexExecutablePath(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || DEFAULT_CODEX_EXECUTABLE;
}

export function isUnsafeCodexExecutablePath(value: string | null | undefined): boolean {
  const normalized = sanitizeCodexExecutablePath(value);
  if (!normalized) {
    return true;
  }
  if (/[\r\n;&|<>`$()]/.test(normalized)) {
    return true;
  }

  const lowered = normalized.toLowerCase();
  for (const head of SHELL_LAUNCHER_HEADS) {
    if (lowered === head || lowered.startsWith(`${head} `)) {
      return true;
    }
  }
  for (const head of WINDOWS_WSL_HEADS) {
    if (lowered === head || lowered.startsWith(`${head} `)) {
      return true;
    }
  }
  return false;
}

export function migrateLegacyCodexLauncher(commandText: string | null | undefined): MigratedCodexLauncherConfig {
  const normalized = commandText?.trim() ?? "";
  if (!normalized) {
    return {
      runtime: "native",
      executablePath: DEFAULT_CODEX_EXECUTABLE,
      blockedLegacyCommand: null,
    };
  }

  const parts = splitCommandString(normalized);
  if (parts.length === 1 && !isUnsafeCodexExecutablePath(parts[0])) {
    return {
      runtime: "native",
      executablePath: sanitizeCodexExecutablePath(parts[0]),
      blockedLegacyCommand: null,
    };
  }

  const head = parts[0]?.toLowerCase() ?? "";
  if (WINDOWS_WSL_HEADS.has(head) && parts[1] === "-e" && parts.length === 3 && !isUnsafeCodexExecutablePath(parts[2])) {
    return {
      runtime: "wsl",
      executablePath: sanitizeCodexExecutablePath(parts[2]),
      blockedLegacyCommand: null,
    };
  }

  return {
    runtime: "native",
    executablePath: DEFAULT_CODEX_EXECUTABLE,
    blockedLegacyCommand: normalized,
  };
}
