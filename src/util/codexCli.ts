import { quoteForBash, splitCommandString, toWslPath, usesWsl } from "./command";
import type { ReasoningEffort } from "./reasoning";

export type JsonOutputFlag = "--json" | "--experimental-json";

export interface CodexExecOptions {
  jsonOutputFlag: JsonOutputFlag;
  model: string;
  threadId?: string | null;
  workingDirectory: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-failure" | "never";
  images?: string[];
  reasoningEffort?: ReasoningEffort | null;
}

export interface CodexSpawnSpec {
  command: string;
  args: string[];
  cwd?: string;
  launcherParts: string[];
}

const DEFAULT_CODEX_COMMAND = "codex";
const BASH_LOGIN_FLAG = "-lc";

function usesBashLauncher(commandParts: string[]): boolean {
  return commandParts.includes(BASH_LOGIN_FLAG);
}

function buildCodexExecArgs(options: CodexExecOptions, launcherParts: string[]): string[] {
  const workingDirectory = usesWsl(launcherParts)
    ? toWslPath(options.workingDirectory, launcherParts)
    : options.workingDirectory;
  const imageArgs = (options.images ?? []).flatMap((imagePath) => [
    "-i",
    usesWsl(launcherParts) ? toWslPath(imagePath, launcherParts) : imagePath,
  ]);
  const configArgs = [
    "--config",
    `approval_policy="${options.approvalPolicy ?? "never"}"`,
    "--config",
    "sandbox_workspace_write.network_access=true",
  ];
  if (options.reasoningEffort) {
    configArgs.push("--config", `model_reasoning_effort="${options.reasoningEffort}"`);
  }

  if (options.threadId) {
    return [
      "exec",
      "resume",
      options.jsonOutputFlag,
      "-m",
      options.model,
      ...imageArgs,
      "--skip-git-repo-check",
      ...configArgs,
      options.threadId,
      "-",
    ];
  }

  return [
    "exec",
    options.jsonOutputFlag,
    "-m",
    options.model,
    ...imageArgs,
    "-s",
    options.sandboxMode ?? "workspace-write",
    "-C",
    workingDirectory,
    "--skip-git-repo-check",
    ...configArgs,
    "-",
  ];
}

export function buildCodexSpawnSpec(commandText: string, options: CodexExecOptions): CodexSpawnSpec {
  const launcherParts = splitCommandString(commandText.trim() || DEFAULT_CODEX_COMMAND);
  const normalizedLauncherParts = launcherParts.length > 0 ? launcherParts : [DEFAULT_CODEX_COMMAND];
  const codexArgs = buildCodexExecArgs(options, normalizedLauncherParts);

  if (usesWsl(normalizedLauncherParts) && usesBashLauncher(normalizedLauncherParts)) {
    const bashIndex = normalizedLauncherParts.lastIndexOf(BASH_LOGIN_FLAG);
    const prefixArgs = normalizedLauncherParts.slice(1, bashIndex + 1);
    const shellPrefix = normalizedLauncherParts.slice(bashIndex + 1).join(" ").trim() || DEFAULT_CODEX_COMMAND;
    const shellCommand = [shellPrefix, ...codexArgs.map((arg) => quoteForBash(arg))].join(" ").trim();
    return {
      command: normalizedLauncherParts[0] ?? DEFAULT_CODEX_COMMAND,
      args: [...prefixArgs, shellCommand],
      launcherParts: normalizedLauncherParts,
    };
  }

  return {
    command: normalizedLauncherParts[0] ?? DEFAULT_CODEX_COMMAND,
    args: [...normalizedLauncherParts.slice(1), ...codexArgs],
    cwd: usesWsl(normalizedLauncherParts) ? undefined : options.workingDirectory,
    launcherParts: normalizedLauncherParts,
  };
}

export function renderCodexSpawnSpec(spec: CodexSpawnSpec): string {
  return [spec.command, ...spec.args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

export function isUnsupportedJsonFlagError(message: string, flag: JsonOutputFlag): boolean {
  const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`unexpected argument '${escapedFlag}' found|unknown option: ${escapedFlag}|unrecognized option '${escapedFlag}'`, "i").test(
    message,
  );
}
