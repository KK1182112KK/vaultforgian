import { describe, expect, it } from "vitest";
import {
  CODEX_RUN_BOOT_TIMEOUT_MS,
  CODEX_RUN_MAX_DURATION_MS,
  CODEX_RUN_STALL_ABORT_MS,
  CODEX_RUN_STALL_RECOVERY_MS,
  CODEX_RUN_STALL_WARN_MS,
  buildCodexRunWatchdogMessage,
  getCodexRunWatchdogStage,
} from "../util/codexRunWatchdog";

describe("codex run watchdog", () => {
  it("detects boot timeout, staged stall recovery, and max-duration cutoffs", () => {
    expect(
      getCodexRunWatchdogStage({
        startedAt: 0,
        lastLivenessAt: 0,
        now: CODEX_RUN_BOOT_TIMEOUT_MS,
        sawOutputEvent: false,
        stallWarned: false,
        recoveryAttempted: false,
      }),
    ).toBe("boot_timeout");

    expect(
      getCodexRunWatchdogStage({
        startedAt: 0,
        lastLivenessAt: 0,
        now: CODEX_RUN_STALL_WARN_MS,
        sawOutputEvent: true,
        stallWarned: false,
        recoveryAttempted: false,
      }),
    ).toBe("stall_warn");

    expect(
      getCodexRunWatchdogStage({
        startedAt: 0,
        lastLivenessAt: 0,
        now: CODEX_RUN_STALL_RECOVERY_MS,
        sawOutputEvent: true,
        stallWarned: true,
        recoveryAttempted: false,
      }),
    ).toBe("stall_recovery");

    expect(
      getCodexRunWatchdogStage({
        startedAt: 0,
        lastLivenessAt: 0,
        now: CODEX_RUN_STALL_ABORT_MS,
        sawOutputEvent: true,
        stallWarned: true,
        recoveryAttempted: true,
      }),
    ).toBe("stall_abort");

    expect(
      getCodexRunWatchdogStage({
        startedAt: 0,
        lastLivenessAt: CODEX_RUN_STALL_ABORT_MS - 1,
        now: CODEX_RUN_MAX_DURATION_MS,
        sawOutputEvent: true,
        stallWarned: true,
        recoveryAttempted: true,
      }),
    ).toBe("max_duration");
  });

  it("treats fresh liveness as healthy even without meaningful progress", () => {
    expect(
      getCodexRunWatchdogStage({
        startedAt: 0,
        lastLivenessAt: CODEX_RUN_STALL_WARN_MS - 1,
        now: CODEX_RUN_STALL_WARN_MS,
        sawOutputEvent: true,
        stallWarned: false,
        recoveryAttempted: false,
      }),
    ).toBe("healthy");
  });

  it("builds localized staged watchdog messages", () => {
    expect(buildCodexRunWatchdogMessage("stall_warn", "en")).toContain("120 seconds");
    expect(buildCodexRunWatchdogMessage("stall_recovery", "en")).toContain("same thread");
    expect(buildCodexRunWatchdogMessage("stall_abort", "en")).toContain("could not be recovered");
    expect(buildCodexRunWatchdogMessage("max_duration", "ja")).toContain("30 分");
  });
});
