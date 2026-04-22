export const CODEX_RUN_BOOT_TIMEOUT_MS = 60_000;
export const CODEX_RUN_STALL_WARN_MS = 120_000;
export const CODEX_RUN_STALL_RECOVERY_MS = 300_000;
export const CODEX_RUN_STALL_ABORT_MS = 600_000;
export const CODEX_RUN_MAX_DURATION_MS = 1_800_000;

export type CodexRunWatchdogStage =
  | "healthy"
  | "boot_timeout"
  | "stall_warn"
  | "stall_recovery"
  | "stall_abort"
  | "max_duration";

export function getCodexRunWatchdogStage(params: {
  startedAt: number;
  lastLivenessAt: number;
  now: number;
  sawOutputEvent: boolean;
  stallWarned: boolean;
  recoveryAttempted: boolean;
}): CodexRunWatchdogStage {
  const elapsed = params.now - params.startedAt;
  if (elapsed >= CODEX_RUN_MAX_DURATION_MS) {
    return "max_duration";
  }
  if (!params.sawOutputEvent && elapsed >= CODEX_RUN_BOOT_TIMEOUT_MS) {
    return "boot_timeout";
  }
  const silentFor = params.now - params.lastLivenessAt;
  if (silentFor >= CODEX_RUN_STALL_ABORT_MS) {
    return "stall_abort";
  }
  if (!params.recoveryAttempted && silentFor >= CODEX_RUN_STALL_RECOVERY_MS) {
    return "stall_recovery";
  }
  if (!params.stallWarned && silentFor >= CODEX_RUN_STALL_WARN_MS) {
    return "stall_warn";
  }
  return "healthy";
}

export function buildCodexRunWatchdogMessage(stage: Exclude<CodexRunWatchdogStage, "healthy">, locale: "en" | "ja"): string {
  if (locale === "ja") {
    if (stage === "boot_timeout") {
      return "Codex が起動後 60 秒以内に event を返さなかったため、この turn を中断しました。";
    }
    if (stage === "stall_warn") {
      return "Codex はまだ作業中ですが、120 秒間 event がありません。引き続き監視します。";
    }
    if (stage === "stall_recovery") {
      return "Codex が 300 秒間 event を返さなかったため、同じ thread で回復を試みます。";
    }
    if (stage === "stall_abort") {
      return "Codex が長時間応答せず、同じ thread での回復にも失敗したため、この turn を終了しました。";
    }
    return "Codex の turn が長すぎるため、30 分で終了しました。";
  }
  if (stage === "boot_timeout") {
    return "Codex did not emit any events within 60 seconds, so this turn was aborted.";
  }
  if (stage === "stall_warn") {
    return "Codex is still working, but this turn has been quiet for 120 seconds. The plugin will keep waiting.";
  }
  if (stage === "stall_recovery") {
    return "Codex has been quiet for 300 seconds, so the plugin will try to recover this turn on the same thread.";
  }
  if (stage === "stall_abort") {
    return "Codex stopped responding long enough that this turn could not be recovered.";
  }
  return "Codex exceeded the 30 minute turn limit, so this turn was aborted.";
}
