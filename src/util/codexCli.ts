import type { CodexRuntime } from "../model/types";
import { isWslPathLike, toWslPath } from "./command";
import { DEFAULT_CODEX_EXECUTABLE } from "./codexLauncher";
import type { ReasoningEffort } from "./reasoning";

export type JsonOutputFlag = "--json" | "--experimental-json";

export interface CodexExecOptions {
  runtime: CodexRuntime;
  executablePath: string;
  launcherOverrideParts?: string[];
  jsonOutputFlag: JsonOutputFlag;
  model: string;
  threadId?: string | null;
  workingDirectory: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-failure" | "never";
  images?: string[];
  reasoningEffort?: ReasoningEffort | null;
  fastMode?: boolean;
}

export interface CodexSpawnSpec {
  command: string;
  args: string[];
  cwd?: string;
  launcherParts: string[];
}

const DEFAULT_WSL_EXECUTABLE = "wsl.exe";

function usesWslRuntime(runtime: CodexRuntime): boolean {
  return runtime === "wsl";
}

function resolveSpawnCwd(workingDirectory: string, runtime: CodexRuntime): string | undefined {
  if (usesWslRuntime(runtime)) {
    return undefined;
  }
  const normalized = workingDirectory.trim();
  if (!normalized) {
    return undefined;
  }
  if (process.platform === "win32" && (normalized.startsWith("\\\\") || isWslPathLike(normalized))) {
    return process.env.USERPROFILE?.trim() || undefined;
  }
  return workingDirectory;
}

function buildResumePermissionArgs(options: CodexExecOptions): string[] {
  if (options.sandboxMode === "workspace-write" && options.approvalPolicy === "never") {
    return ["--full-auto"];
  }
  return [];
}

function buildCodexExecArgs(options: CodexExecOptions): string[] {
  const launcherParts =
    options.launcherOverrideParts && options.launcherOverrideParts.length > 0
      ? options.launcherOverrideParts
      : usesWslRuntime(options.runtime)
        ? [DEFAULT_WSL_EXECUTABLE]
        : [options.executablePath];
  const workingDirectory = usesWslRuntime(options.runtime)
    ? toWslPath(options.workingDirectory, launcherParts)
    : options.workingDirectory;
  const imageArgs = (options.images ?? []).flatMap((imagePath) => [
    "-i",
    usesWslRuntime(options.runtime) ? toWslPath(imagePath, launcherParts) : imagePath,
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
  configArgs.push("--config", `features.fast_mode=${options.fastMode ? "true" : "false"}`);

  if (options.threadId) {
    return [
      "exec",
      "resume",
      options.jsonOutputFlag,
      "-m",
      options.model,
      ...imageArgs,
      ...buildResumePermissionArgs(options),
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
    options.sandboxMode ?? "read-only",
    "-C",
    workingDirectory,
    "--skip-git-repo-check",
    ...configArgs,
    "-",
  ];
}

export function buildCodexSpawnSpec(options: CodexExecOptions): CodexSpawnSpec {
  const executablePath = options.executablePath.trim() || DEFAULT_CODEX_EXECUTABLE;
  const codexArgs = buildCodexExecArgs(options);
  const launcherParts =
    options.launcherOverrideParts && options.launcherOverrideParts.length > 0
      ? options.launcherOverrideParts
      : usesWslRuntime(options.runtime)
        ? [DEFAULT_WSL_EXECUTABLE, "-e", executablePath]
        : [executablePath];

  if (launcherParts.length > 0) {
    return {
      command: launcherParts[0] ?? DEFAULT_WSL_EXECUTABLE,
      args: [...launcherParts.slice(1), ...codexArgs],
      cwd: resolveSpawnCwd(options.workingDirectory, options.runtime),
      launcherParts,
    };
  }

  return {
    command: executablePath,
    args: codexArgs,
    cwd: resolveSpawnCwd(options.workingDirectory, options.runtime),
    launcherParts: [executablePath],
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
