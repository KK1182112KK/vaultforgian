import { isWslPathLike, splitCommandString, usesWsl } from "./command";

export const WSL_CODEX_MISSING_SENTINEL = "__OBSIDIAN_CODEX_WSL_MISSING__";
const DEFAULT_WSL_FALLBACK_ARGV0 = "__obsidian_codex_fallback__";

function buildDefaultWslFallbackShellPrefix(): string {
  return [
    "source ~/.profile >/dev/null 2>&1 || true",
    "source ~/.bashrc >/dev/null 2>&1 || true",
    'export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:$PATH"',
    'CODEX_BIN=""',
    'if [ -z "$CODEX_BIN" ] && command -v codex >/dev/null 2>&1; then CODEX_BIN="$(command -v codex)"; fi',
    'for candidate in "$HOME"/.nvm/versions/node/*/bin/codex "$HOME/.local/bin/codex" "$HOME/bin/codex" "/usr/local/bin/codex" "/usr/bin/codex"; do if [ -z "$CODEX_BIN" ] && [ -x "$candidate" ]; then CODEX_BIN="$candidate"; break; fi; done',
    `if [ -z "$CODEX_BIN" ]; then printf '%s\\n' '${WSL_CODEX_MISSING_SENTINEL}' >&2; exit 127; fi`,
  ].join("; ");
}

function quoteCommandPart(value: string): string {
  if (!/[\s"\\]/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export const DEFAULT_WSL_FALLBACK_LAUNCHER_PARTS = [
  "wsl.exe",
  "-e",
  "bash",
  "-lc",
  `${buildDefaultWslFallbackShellPrefix()}; exec "$CODEX_BIN" "$@"`,
  DEFAULT_WSL_FALLBACK_ARGV0,
] as const;

export const DEFAULT_WSL_FALLBACK_COMMAND = DEFAULT_WSL_FALLBACK_LAUNCHER_PARTS.map((part) => quoteCommandPart(part)).join(" ");

const WINDOWS_SANDBOX_ERROR_PATTERNS = [
  /windows sandbox/i,
  /spawn setup refresh/i,
  /sandbox setup refresh/i,
  /sandbox bootstrap/i,
  /sandbox:\s*spawn/i,
];

const TROUBLESHOOTING_CHATTER_PATTERNS = [
  /local read failed/i,
  /retry(?:ing)? local/i,
  /retry(?:ing)? shell/i,
  /retry(?:ing)? source/i,
  /minimal command/i,
  /sandbox initialization failed/i,
  /windows sandbox/i,
  /spawn setup refresh/i,
  /shell .*failed/i,
  /folder structure/i,
  /directory contents/i,
  /note body/i,
  /shell 自体の初期化/i,
  /ローカル読(?:み|取)/i,
  /ソース取得/i,
  /最小コマンド/i,
  /sandbox 初期化/i,
  /同フォルダ構成/i,
  /ノート本文/i,
  /ディレクトリ/i,
  /フォルダ構成/i,
];

export function isKnownWindowsSandboxBootstrapError(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  return WINDOWS_SANDBOX_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function collectCandidateStrings(value: unknown, depth = 0): string[] {
  if (depth > 3) {
    return [];
  }
  if (typeof value === "string") {
    return value.trim() ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectCandidateStrings(entry, depth + 1));
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  return Object.values(record).flatMap((entry) => collectCandidateStrings(entry, depth + 1));
}

export interface RuntimeFallbackDecisionParams {
  platform?: string;
  platformName?: string;
  configuredCommand?: string | null;
  currentCommand?: string | null;
  resolvedCommand?: string | null;
  errorMessage: string;
}

function normalizeConfiguredCommand(commandText: string | null | undefined): string {
  return commandText?.trim() ?? "";
}

export function isLegacyBareWslCodexCommand(commandText: string | null | undefined): boolean {
  const normalized = normalizeConfiguredCommand(commandText);
  if (!normalized) {
    return false;
  }
  const parts = splitCommandString(normalized);
  if (!usesWsl(parts)) {
    return false;
  }
  const bashIndex = parts.lastIndexOf("-lc");
  if (bashIndex < 0) {
    return false;
  }
  return parts.slice(bashIndex + 1).join(" ").trim() === "codex";
}

function resolveCurrentCommand(params: RuntimeFallbackDecisionParams): string {
  return params.currentCommand?.trim() || params.resolvedCommand?.trim() || "";
}

export function shouldRetryWithWslFallback(params: RuntimeFallbackDecisionParams): boolean {
  const platform = params.platform ?? params.platformName ?? process.platform;
  if (platform !== "win32") {
    return false;
  }
  if (!isKnownWindowsSandboxBootstrapError(params.errorMessage)) {
    return false;
  }

  const configured = normalizeConfiguredCommand(params.configuredCommand);
  const usesDefaultConfiguredCommand = configured === "" || configured === "codex" || isLegacyBareWslCodexCommand(configured);
  if (!usesDefaultConfiguredCommand) {
    return false;
  }

  const currentCommand = resolveCurrentCommand(params);
  if (!currentCommand) {
    return true;
  }
  return !usesWsl(splitCommandString(currentCommand)) || isLegacyBareWslCodexCommand(currentCommand);
}

export interface ProactiveWslPreferenceParams {
  platform?: string;
  configuredCommand?: string | null;
  currentCommand?: string | null;
  workingDirectory?: string | null;
  sourcePathHints?: readonly string[];
}

export function shouldPreferWslForTurn(params: ProactiveWslPreferenceParams): boolean {
  const platform = params.platform ?? process.platform;
  if (platform !== "win32") {
    return false;
  }

  const configured = normalizeConfiguredCommand(params.configuredCommand);
  const usesDefaultConfiguredCommand = configured === "" || configured === "codex" || isLegacyBareWslCodexCommand(configured);
  if (!usesDefaultConfiguredCommand) {
    return false;
  }

  const currentCommand = params.currentCommand?.trim() ?? "";
  if (currentCommand && usesWsl(splitCommandString(currentCommand)) && !isLegacyBareWslCodexCommand(currentCommand)) {
    return false;
  }

  const candidates = [params.workingDirectory ?? "", ...(params.sourcePathHints ?? [])];
  return candidates.some((entry) => isWslPathLike(entry));
}

export function extractRetryableInTurnShellBootstrapError(event: unknown): string | null {
  const record = asRecord(event);
  const candidates = collectCandidateStrings({
    message: record?.message,
    error: record?.error,
    payload: record?.payload,
    item: record?.item,
    result: record?.result,
    output: record?.output,
    details: record?.details,
  });

  return candidates.find((candidate) => isKnownWindowsSandboxBootstrapError(candidate)) ?? null;
}

export function isAssistantTroubleshootingChatter(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return TROUBLESHOOTING_CHATTER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isWslCodexMissingError(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  return /bash:\s*line\s+\d+:\s*codex:\s*command not found/i.test(normalized) || normalized.includes(WSL_CODEX_MISSING_SENTINEL);
}
