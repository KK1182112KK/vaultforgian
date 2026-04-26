import { describe, expect, it } from "vitest";
import {
  DEFAULT_WSL_FALLBACK_COMMAND,
  extractRetryableInTurnShellBootstrapError,
  isLegacyBareWslCodexCommand,
  isKnownWindowsSandboxBootstrapError,
  isWindowsAppsCodexPath,
  isWslCodexMissingError,
  shouldPreferWslForTurn,
  shouldRetryWithWslFallback,
} from "../util/runtimeFallback";

describe("runtime fallback", () => {
  it("detects known Windows sandbox bootstrap failures", () => {
    expect(isKnownWindowsSandboxBootstrapError("windows sandbox: spawn setup refresh failed")).toBe(true);
    expect(isKnownWindowsSandboxBootstrapError("sandbox bootstrap failed during startup")).toBe(true);
    expect(isKnownWindowsSandboxBootstrapError("sandbox: spawn setup refresh failed")).toBe(true);
    expect(isKnownWindowsSandboxBootstrapError("ordinary CLI error")).toBe(false);
  });

  it("retries with WSL for default Windows launchers and known bootstrap failures", () => {
    expect(
      shouldRetryWithWslFallback({
        platform: "win32",
        configuredCommand: "codex",
        currentCommand: "C:\\Users\\TestUser\\.codex\\.sandbox-bin\\codex.exe",
        errorMessage: "windows sandbox: spawn setup refresh failed",
      }),
    ).toBe(true);
    expect(DEFAULT_WSL_FALLBACK_COMMAND).toContain("wsl.exe -e bash -lc");
    expect(DEFAULT_WSL_FALLBACK_COMMAND).toContain("source ~/.profile");
    expect(DEFAULT_WSL_FALLBACK_COMMAND).toContain("source ~/.bashrc");
    expect(DEFAULT_WSL_FALLBACK_COMMAND).toContain("__OBSIDIAN_CODEX_WSL_MISSING__");
    expect(DEFAULT_WSL_FALLBACK_COMMAND).toContain('\\"$HOME\\"/.nvm/versions/node/*/bin/codex');
  });

  it("treats an empty configured command as the default launcher", () => {
    expect(
      shouldRetryWithWslFallback({
        platform: "win32",
        configuredCommand: "   ",
        currentCommand: "codex",
        errorMessage: "sandbox bootstrap failed during startup",
      }),
    ).toBe(true);
  });

  it("does not retry on non-Windows platforms or unrelated errors", () => {
    expect(
      shouldRetryWithWslFallback({
        platform: "linux",
        configuredCommand: "codex",
        currentCommand: "codex",
        errorMessage: "windows sandbox: spawn setup refresh failed",
      }),
    ).toBe(false);
    expect(
      shouldRetryWithWslFallback({
        platform: "win32",
        configuredCommand: "codex",
        currentCommand: "codex",
        errorMessage: "plain ENOENT",
      }),
    ).toBe(false);
  });

  it("does not retry for custom or already-WSL launchers", () => {
    expect(
      shouldRetryWithWslFallback({
        platform: "win32",
        configuredCommand: DEFAULT_WSL_FALLBACK_COMMAND,
        currentCommand: DEFAULT_WSL_FALLBACK_COMMAND,
        errorMessage: "windows sandbox: spawn setup refresh failed",
      }),
    ).toBe(false);
    expect(
      shouldRetryWithWslFallback({
        platform: "win32",
        configuredCommand: "C:\\custom\\codex.exe",
        currentCommand: "C:\\custom\\codex.exe",
        errorMessage: "windows sandbox: spawn setup refresh failed",
      }),
    ).toBe(false);
  });

  it("keeps backward compatibility with older param names", () => {
    expect(
      shouldRetryWithWslFallback({
        platformName: "win32",
        configuredCommand: "codex",
        resolvedCommand: "C:\\Users\\TestUser\\.codex\\.sandbox-bin\\codex.exe",
        errorMessage: "windows sandbox: spawn setup refresh failed",
      }),
    ).toBe(true);
  });

  it("prefers WSL up front for WSL-native source paths on Windows defaults", () => {
    expect(
      shouldPreferWslForTurn({
        platform: "win32",
        configuredCommand: "codex",
        currentCommand: "C:\\Users\\TestUser\\.codex\\.sandbox-bin\\codex.exe",
        workingDirectory: "\\\\wsl.localhost\\Ubuntu\\home\\tester\\active\\research\\paper\\8",
      }),
    ).toBe(true);
    expect(
      shouldPreferWslForTurn({
        platform: "win32",
        configuredCommand: "codex",
        currentCommand: "codex",
        sourcePathHints: ["/home/tester/active/research/paper/8"],
      }),
    ).toBe(true);
  });

  it("does not proactively switch to WSL for custom or already-WSL launchers", () => {
    expect(
      shouldPreferWslForTurn({
        platform: "win32",
        configuredCommand: "C:\\custom\\codex.exe",
        currentCommand: "C:\\custom\\codex.exe",
        workingDirectory: "\\\\wsl.localhost\\Ubuntu\\home\\tester\\active\\research\\paper\\8",
      }),
    ).toBe(false);
    expect(
      shouldPreferWslForTurn({
        platform: "win32",
        configuredCommand: "codex",
        currentCommand: DEFAULT_WSL_FALLBACK_COMMAND,
        workingDirectory: "/home/tester/active/research/paper/8",
      }),
    ).toBe(false);
  });

  it("extracts retryable in-turn shell bootstrap failures from command execution events", () => {
    expect(
      extractRetryableInTurnShellBootstrapError({
        item: {
          type: "command_execution",
          result: "windows sandbox: spawn setup refresh failed",
        },
      }),
    ).toBe("windows sandbox: spawn setup refresh failed");
    expect(
      extractRetryableInTurnShellBootstrapError({
        item: {
          type: "command_execution",
          result: "normal shell output",
        },
      }),
    ).toBeNull();
  });

  it("detects WSL fallback codex-missing failures", () => {
    expect(isWslCodexMissingError("bash: line 1: codex: command not found")).toBe(true);
    expect(isWslCodexMissingError("__OBSIDIAN_CODEX_WSL_MISSING__")).toBe(true);
    expect(isWslCodexMissingError("windows sandbox: spawn setup refresh failed")).toBe(false);
  });

  it("identifies WindowsApps Codex paths that should not be adopted by WSL fallback", () => {
    expect(
      isWindowsAppsCodexPath("/mnt/c/Program Files/WindowsApps/OpenAI.Codex_26.422.3464.0_x64__2p2nqsd0c76g0/app/resources/codex"),
    ).toBe(true);
    expect(isWindowsAppsCodexPath("/home/tester/.local/bin/codex")).toBe(false);
  });

  it("treats the legacy bare WSL codex launcher as default-like so the safer fallback can replace it", () => {
    expect(isLegacyBareWslCodexCommand("wsl.exe -e bash -lc codex")).toBe(true);
    expect(isLegacyBareWslCodexCommand(DEFAULT_WSL_FALLBACK_COMMAND)).toBe(false);
    expect(
      shouldRetryWithWslFallback({
        platform: "win32",
        configuredCommand: "wsl.exe -e bash -lc codex",
        currentCommand: "wsl.exe -e bash -lc codex",
        errorMessage: "windows sandbox: spawn setup refresh failed",
      }),
    ).toBe(true);
    expect(
      shouldPreferWslForTurn({
        platform: "win32",
        configuredCommand: "wsl.exe -e bash -lc codex",
        currentCommand: "wsl.exe -e bash -lc codex",
        workingDirectory: "/home/tester/active/research/paper/8",
      }),
    ).toBe(true);
  });
});
