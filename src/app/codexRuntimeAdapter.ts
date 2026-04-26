import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { CodexRuntime } from "../model/types";
import { buildCodexSpawnSpec, isUnsupportedJsonFlagError, renderCodexSpawnSpec, type JsonOutputFlag } from "../util/codexCli";
import { isWindowsUncPath } from "../util/command";
import { DEFAULT_CODEX_EXECUTABLE, sanitizeCodexExecutablePath } from "../util/codexLauncher";
import {
  buildCodexRunWatchdogMessage,
  getCodexRunWatchdogStage,
  type CodexRunWatchdogStage,
} from "../util/codexRunWatchdog";
import {
  chooseHighestReasoningEffort,
  extractSupportedReasoningEfforts,
  getCompatibleReasoningEffort,
  isUnsupportedReasoningEffortError,
  unwrapApiErrorMessage,
  type ReasoningEffort,
} from "../util/reasoning";
import { DEFAULT_WSL_FALLBACK_LAUNCHER_PARTS, shouldRetryWithWslFallback } from "../util/runtimeFallback";

type JsonRecord = Record<string, unknown>;
type AbortReason = "user_interrupt" | "approval_abort" | "tab_close" | "plugin_unload" | "runtime_abort";
type SpawnLike = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export interface CodexRuntimeAdapterRequest {
  prompt: string;
  tabId: string;
  threadId: string | null;
  workingDirectory: string;
  runtime: CodexRuntime;
  executablePath: string;
  launcherOverrideParts?: string[];
  sandboxMode: "read-only" | "workspace-write";
  approvalPolicy: "untrusted" | "on-failure" | "never";
  images: string[];
  model: string;
  reasoningEffort: ReasoningEffort | null;
  fastMode: boolean;
  signal: AbortSignal;
  watchdogRecoveryAttempted?: boolean;
  onJsonEvent: (event: JsonRecord) => void;
  onSessionId: (threadId: string) => void;
  onLiveness: (observedAt: number) => void;
  onMeaningfulProgress: (observedAt: number) => void;
  onWatchdogStageChange?: (stage: Exclude<CodexRunWatchdogStage, "healthy">) => void;
}

export interface CodexRuntimeAdapterResult {
  threadId: string | null;
}

export interface CodexRuntimeAdapterDeps {
  getConfiguredCommandText: () => string;
  getLocale: () => "en" | "ja";
  getProcessEnv: () => NodeJS.ProcessEnv;
  getSessionFileMtimeMs?: (threadId: string) => number | null;
  spawn?: SpawnLike;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function extractAssistantResponseText(payload: JsonRecord): string | null {
  const content = Array.isArray(payload.content) ? payload.content : [];
  const parts = content
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => asString(entry.text))
    .filter((entry): entry is string => Boolean(entry?.trim()));

  if (parts.length > 0) {
    return parts.join("\n\n");
  }

  const directText = asString(payload.text);
  return directText?.trim() ? directText : null;
}

function extractAssistantOutputText(event: JsonRecord): string | null {
  const eventType = asString(event.type);
  const payload = asRecord(event.payload);
  const item = asRecord(event.item);

  if (eventType === "assistant_message") {
    return asString(event.text)?.trim() || null;
  }
  if (eventType === "event_msg" && asString(payload?.type) === "agent_message") {
    return asString(payload?.message)?.trim() || null;
  }
  if (
    eventType === "response_item" &&
    payload &&
    asString(payload.type) === "message" &&
    asString(payload.role) === "assistant"
  ) {
    return extractAssistantResponseText(payload)?.trim() || null;
  }
  if (asString(item?.type) === "agent_message") {
    return asString(item?.text)?.trim() || null;
  }
  return null;
}

function extractCodexSessionId(event: JsonRecord): string | null {
  if (asString(event.type) === "thread.started") {
    return asString(event.thread_id);
  }

  if (asString(event.type) === "session_meta") {
    return asString(asRecord(event.payload)?.id);
  }

  return null;
}

function extractNestedErrorMessage(value: unknown, seen = new Set<unknown>()): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  const record = asRecord(value);
  if (!record || seen.has(record)) {
    return null;
  }
  seen.add(record);
  const directMessage = asString(record.message);
  if (directMessage) {
    return directMessage;
  }
  for (const key of ["error", "last_error", "cause", "details", "payload"]) {
    const nestedMessage = extractNestedErrorMessage(record[key], seen);
    if (nestedMessage) {
      return nestedMessage;
    }
  }
  return null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return unwrapApiErrorMessage(value.message);
  }
  if (typeof value === "string") {
    return unwrapApiErrorMessage(value);
  }
  if (asRecord(value)) {
    const message = extractNestedErrorMessage(value);
    if (message) {
      return unwrapApiErrorMessage(message);
    }
    const json = safeJson(value);
    if (json !== "{}") {
      return unwrapApiErrorMessage(json);
    }
  }
  return "Unknown Codex error.";
}

function normalizeAbortReason(value: unknown): AbortReason {
  return value === "user_interrupt" ||
    value === "approval_abort" ||
    value === "tab_close" ||
    value === "plugin_unload" ||
    value === "runtime_abort"
    ? value
    : "runtime_abort";
}

function createAbortError(reason: AbortReason = "runtime_abort"): Error {
  const error = new Error("Turn interrupted.");
  const typedError = error as Error & { abortReason?: AbortReason };
  typedError.name = "AbortError";
  typedError.abortReason = reason;
  return typedError;
}

function annotateCodexRunError(
  error: Error,
  resolvedCommand: string,
  sawOutputEvent: boolean,
  threadId: string | null,
  options: {
    sawAssistantOutput?: boolean;
    sawMeaningfulProgress?: boolean;
    retryableInTurnShellBootstrapFailure?: boolean;
    watchdogStage?: Exclude<CodexRunWatchdogStage, "healthy"> | null;
  } = {},
): Error {
  const annotated = error as Error & {
    noTurnEvents?: boolean;
    noAssistantOutput?: boolean;
    noMeaningfulProgress?: boolean;
    resolvedCommand?: string;
    retryableInTurnShellBootstrapFailure?: boolean;
    watchdogStage?: Exclude<CodexRunWatchdogStage, "healthy"> | null;
    codexThreadId?: string | null;
  };
  annotated.noTurnEvents = !sawOutputEvent && !threadId;
  annotated.noAssistantOutput = !options.sawAssistantOutput;
  annotated.noMeaningfulProgress = !options.sawMeaningfulProgress;
  annotated.resolvedCommand = resolvedCommand;
  annotated.retryableInTurnShellBootstrapFailure = options.retryableInTurnShellBootstrapFailure ?? false;
  annotated.watchdogStage = options.watchdogStage ?? null;
  annotated.codexThreadId = threadId;
  return annotated;
}

export function getCodexWatchdogStageFromError(error: unknown): Exclude<CodexRunWatchdogStage, "healthy"> | null {
  const stage = asString(asRecord(error)?.watchdogStage);
  if (
    stage === "boot_timeout" ||
    stage === "stall_warn" ||
    stage === "stall_recovery" ||
    stage === "stall_abort" ||
    stage === "max_duration"
  ) {
    return stage;
  }
  return null;
}

export function getThreadIdFromCodexError(error: unknown): string | null {
  return asString(asRecord(error)?.codexThreadId);
}

function resolveSpawnCwd(cwd: string | undefined): string | undefined {
  if (!cwd) {
    return undefined;
  }
  if (process.platform === "win32" && isWindowsUncPath(cwd)) {
    return process.env.SystemRoot ?? "C:\\Windows";
  }
  return cwd;
}

function isAssistantOutputEvent(event: JsonRecord): boolean {
  return Boolean(extractAssistantOutputText(event));
}

function describeCodexLauncher(request: Pick<CodexRuntimeAdapterRequest, "runtime" | "executablePath" | "launcherOverrideParts">): string {
  if (request.launcherOverrideParts?.length) {
    return request.launcherOverrideParts.join(" ");
  }
  if (request.runtime === "wsl") {
    return `wsl.exe -e ${request.executablePath}`;
  }
  return request.executablePath;
}

function createWslFallbackRequest(request: CodexRuntimeAdapterRequest): CodexRuntimeAdapterRequest {
  return {
    ...request,
    runtime: "wsl",
    executablePath: DEFAULT_CODEX_EXECUTABLE,
    launcherOverrideParts: [...DEFAULT_WSL_FALLBACK_LAUNCHER_PARTS],
  };
}

export class CodexRuntimeAdapter {
  private jsonOutputFlag: JsonOutputFlag = "--json";
  private readonly spawn: SpawnLike;

  constructor(private readonly deps: CodexRuntimeAdapterDeps) {
    this.spawn = deps.spawn ?? nodeSpawn;
  }

  async run(request: CodexRuntimeAdapterRequest): Promise<CodexRuntimeAdapterResult> {
    const flags: JsonOutputFlag[] =
      this.jsonOutputFlag === "--experimental-json" ? ["--experimental-json"] : ["--json", "--experimental-json"];
    let lastError: unknown = null;
    let requestForAllFlags = request;

    for (const jsonOutputFlag of flags) {
      let currentEffort = request.reasoningEffort;
      let currentRequest = requestForAllFlags;
      const attemptedEfforts = new Set<string>([currentEffort ?? "__none__"]);

      while (true) {
        try {
          const threadId = await this.execute(currentRequest, jsonOutputFlag, currentEffort);
          this.jsonOutputFlag = jsonOutputFlag;
          return { threadId };
        } catch (error) {
          lastError = error;
          if (getCodexWatchdogStageFromError(error)) {
            throw error;
          }
          const message = getErrorMessage(error);
          if (
            shouldRetryWithWslFallback({
              platform: process.platform,
              configuredCommand: this.deps.getConfiguredCommandText(),
              currentCommand: describeCodexLauncher(currentRequest),
              errorMessage: message,
            })
          ) {
            currentRequest = createWslFallbackRequest(currentRequest);
            requestForAllFlags = currentRequest;
            continue;
          }
          if (jsonOutputFlag === "--json" && isUnsupportedJsonFlagError(message, jsonOutputFlag)) {
            break;
          }
          const fallbackEffort = this.getFallbackReasoningEffort(currentRequest.model, message, currentEffort);
          if (fallbackEffort && !attemptedEfforts.has(fallbackEffort)) {
            attemptedEfforts.add(fallbackEffort);
            currentEffort = fallbackEffort;
            continue;
          }
          throw error;
        }
      }
    }

    throw new Error(lastError ? getErrorMessage(lastError) : this.deps.getLocale() === "ja" ? "不明な Codex エラーです。" : "Unknown Codex error.");
  }

  private getFallbackReasoningEffort(
    model: string,
    message: string,
    currentEffort: ReasoningEffort | null,
  ): ReasoningEffort | null {
    if (!isUnsupportedReasoningEffortError(message)) {
      return null;
    }

    const supportedEfforts = extractSupportedReasoningEfforts(message);
    const fallback = chooseHighestReasoningEffort(supportedEfforts);
    if (!fallback) {
      return getCompatibleReasoningEffort(model, currentEffort);
    }
    return fallback === currentEffort ? null : fallback;
  }

  private buildCliExitMessage(
    stderrChunks: Buffer[],
    code: number | null,
    signal: NodeJS.Signals | null,
    spec: ReturnType<typeof buildCodexSpawnSpec>,
    terminalEventError: string | null,
  ): string {
    if (terminalEventError) {
      return unwrapApiErrorMessage(terminalEventError);
    }
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    if (stderr) {
      return unwrapApiErrorMessage(stderr);
    }
    const exitDetail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    return this.deps.getLocale() === "ja"
      ? `Codex CLI が ${exitDetail} で終了しました。\nResolved command: ${renderCodexSpawnSpec(spec)}`
      : `Codex CLI exited with ${exitDetail}.\nResolved command: ${renderCodexSpawnSpec(spec)}`;
  }

  private async execute(
    request: CodexRuntimeAdapterRequest,
    jsonOutputFlag: JsonOutputFlag,
    reasoningEffort: ReasoningEffort | null,
  ): Promise<string | null> {
    const resolvedExecutablePath = sanitizeCodexExecutablePath(request.executablePath);
    const spec = buildCodexSpawnSpec({
      runtime: request.runtime,
      executablePath: resolvedExecutablePath,
      launcherOverrideParts: request.launcherOverrideParts,
      jsonOutputFlag,
      model: request.model,
      threadId: request.threadId,
      workingDirectory: request.workingDirectory,
      sandboxMode: request.sandboxMode,
      approvalPolicy: request.approvalPolicy,
      images: request.images,
      reasoningEffort,
      fastMode: request.fastMode,
    });
    const resolvedCommand = spec.launcherParts.join(" ");

    const child = this.spawn(spec.command, spec.args, {
      cwd: resolveSpawnCwd(spec.cwd),
      env: this.deps.getProcessEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stderrChunks: Buffer[] = [];
    let threadId = request.threadId;
    let spawnError: Error | null = null;
    let watchdogError: Error | null = null;
    let terminalEventError: string | null = null;
    let sawOutputEvent = false;
    let sawAssistantOutput = false;
    let sawMeaningfulProgress = false;
    const startedAt = Date.now();
    let lastLivenessAt = startedAt;
    let stallWarned = false;
    let recoveryAttempted = request.watchdogRecoveryAttempted ?? false;
    let lastSessionMtimeMs = 0;

    child.once("error", (error) => {
      spawnError = error;
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      lastLivenessAt = Date.now();
      request.onLiveness(lastLivenessAt);
    });

    if (!child.stdin) {
      throw new Error(this.deps.getLocale() === "ja" ? "Codex process に stdin がありません。" : "Codex process has no stdin.");
    }
    if (!child.stdout) {
      throw new Error(this.deps.getLocale() === "ja" ? "Codex process に stdout がありません。" : "Codex process has no stdout.");
    }

    const abortListener = () => {
      try {
        child.kill();
      } catch {
        // ignore best-effort kill failures
      }
    };

    if (request.signal.aborted) {
      abortListener();
      throw createAbortError(normalizeAbortReason(request.signal.reason));
    }
    request.signal.addEventListener("abort", abortListener, { once: true });

    child.stdin.write(request.prompt);
    child.stdin.end();

    const reader = createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    const watchdog = setInterval(() => {
      if (threadId) {
        const mtimeMs = this.deps.getSessionFileMtimeMs?.(threadId) ?? 0;
        if (mtimeMs > lastSessionMtimeMs) {
          lastSessionMtimeMs = mtimeMs;
          lastLivenessAt = Date.now();
          request.onLiveness(lastLivenessAt);
        }
      }
      const stage = getCodexRunWatchdogStage({
        startedAt,
        lastLivenessAt,
        now: Date.now(),
        sawOutputEvent,
        stallWarned,
        recoveryAttempted,
      });
      if (stage === "healthy" || watchdogError) {
        return;
      }
      if (stage === "stall_warn") {
        stallWarned = true;
        request.onWatchdogStageChange?.("stall_warn");
        return;
      }
      if (stage === "stall_recovery") {
        recoveryAttempted = true;
        request.onWatchdogStageChange?.("stall_recovery");
      }
      watchdogError = annotateCodexRunError(
        new Error(buildCodexRunWatchdogMessage(stage, this.deps.getLocale())),
        resolvedCommand,
        sawOutputEvent,
        threadId,
        {
          sawAssistantOutput,
          sawMeaningfulProgress,
          watchdogStage: stage,
        },
      );
      try {
        child.kill();
      } catch {
        // ignore best-effort cleanup failures
      }
    }, 1_000);
    const exitResult = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    });

    try {
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        sawOutputEvent = true;
        lastLivenessAt = Date.now();
        request.onLiveness(lastLivenessAt);

        let event: JsonRecord;
        try {
          event = JSON.parse(trimmed) as JsonRecord;
        } catch {
          throw new Error(
            this.deps.getLocale() === "ja" ? `Codex event の解析に失敗しました: ${trimmed}` : `Failed to parse Codex event: ${trimmed}`,
          );
        }

        const sessionId = extractCodexSessionId(event);
        if (sessionId) {
          threadId = sessionId;
          request.onSessionId(sessionId);
        } else if (isAssistantOutputEvent(event)) {
          sawAssistantOutput = true;
          sawMeaningfulProgress = true;
          request.onMeaningfulProgress(Date.now());
        } else if (asString(event.type) === "turn.failed") {
          terminalEventError = getErrorMessage(event.error);
        } else if (asString(event.type) === "error") {
          terminalEventError = unwrapApiErrorMessage(asString(event.message) ?? "");
        } else if (asString(asRecord(event.item)?.type) === "error") {
          terminalEventError = unwrapApiErrorMessage(
            asString(asRecord(event.item)?.message) ?? getErrorMessage(asRecord(asRecord(event.item)?.error)),
          );
        } else {
          const itemType = asString(asRecord(event.item)?.type);
          if (itemType && itemType !== "reasoning" && itemType !== "agent_message") {
            sawMeaningfulProgress = true;
            request.onMeaningfulProgress(Date.now());
          }
        }
        if (!sawMeaningfulProgress && isAssistantOutputEvent(event)) {
          sawMeaningfulProgress = true;
          request.onMeaningfulProgress(Date.now());
        }
        request.onJsonEvent(event);
      }

      const { code, signal } = await exitResult;
      if (request.signal.aborted) {
        throw createAbortError(normalizeAbortReason(request.signal.reason));
      }
      if (spawnError) {
        throw annotateCodexRunError(spawnError, resolvedCommand, sawOutputEvent, threadId, {
          sawAssistantOutput,
          sawMeaningfulProgress,
        });
      }
      if (watchdogError) {
        throw watchdogError;
      }
      if (code !== 0 || signal) {
        throw annotateCodexRunError(
          new Error(this.buildCliExitMessage(stderrChunks, code, signal, spec, terminalEventError)),
          resolvedCommand,
          sawOutputEvent,
          threadId,
          { sawAssistantOutput, sawMeaningfulProgress },
        );
      }
      return threadId;
    } finally {
      clearInterval(watchdog);
      request.signal.removeEventListener("abort", abortListener);
      reader.close();
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr?.removeAllListeners();
      if (!child.killed && child.exitCode === null) {
        try {
          child.kill();
        } catch {
          // ignore best-effort cleanup failures
        }
      }
    }
  }
}
