import { describe, expect, it, vi } from "vitest";
import { CodexService } from "../app/codexService";
import { DEFAULT_SETTINGS, type PluginSettings } from "../model/types";

function createApp(basePath: string) {
  return {
    vault: {
      adapter: { basePath },
      getAbstractFileByPath: () => null,
    },
    workspace: {
      getActiveFile: () => null,
      getMostRecentLeaf: () => null,
    },
  } as never;
}

function createService(basePath: string) {
  const settings: PluginSettings = {
    ...DEFAULT_SETTINGS,
  };
  return new CodexService(createApp(basePath), () => settings, () => "en", null, async () => {}, async () => {});
}

describe("CodexService launcher resolution", () => {
  it("prefers Windows-native launcher candidates before WSL fallback helpers", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      const service = createService("/vault") as unknown as {
        getCodexCommandCandidates: () => string[];
      };
      const candidates = service.getCodexCommandCandidates();

      expect(candidates[0]).toContain(".sandbox-bin");
      expect(candidates[0]).toContain("codex.exe");
      expect(candidates[1]).toContain("AppData");
      expect(candidates[1]).toContain("codex.cmd");
      expect(candidates.at(-1)).toBe("codex");
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  it("uses structured WSL runtime settings without freeform command strings", () => {
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      codex: {
        ...DEFAULT_SETTINGS.codex,
        runtime: "wsl",
        executablePath: "codex",
      },
    };
    const service = new CodexService(createApp("/vault"), () => settings, () => "en", null, async () => {}, async () => {}) as unknown as {
      resolveConfiguredCodexLauncher: () => { runtime: "native" | "wsl"; executablePath: string };
    };

    expect(service.resolveConfiguredCodexLauncher()).toEqual({
      runtime: "wsl",
      executablePath: "codex",
    });
  });

  it("normalizes WSL codex command-not-found errors", () => {
    const service = createService("/vault") as unknown as {
      normalizeCodexError: (message: string) => string;
    };

    const normalized = service.normalizeCodexError("bash: line 1: codex: command not found");
    expect(normalized).toContain("Codex");
    expect(normalized).toContain("WSL");
  });

  it("includes native-first Windows guidance for missing executables", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      const service = createService("/vault") as unknown as {
        normalizeCodexError: (message: string) => string;
      };

      const normalized = service.normalizeCodexError("spawn codex ENOENT");
      expect(normalized).toContain("Resolved command");
      expect(normalized).toContain("where codex");
      expect(normalized).toContain("codex.exe");
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  it("prefers a WSL fallback launcher for WSL-native turn hints on Windows defaults", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      const service = createService("C:\\vault") as unknown as {
        resolveTurnCodexLauncher: (options: {
          defaultWorkingDirectory: string;
          workingDirectoryHint: string | null;
          sourcePathHints: readonly string[];
        }) => {
          runtime: "native" | "wsl";
          executablePath: string;
          launcherOverrideParts?: string[];
        };
      };

      const launcher = service.resolveTurnCodexLauncher({
        defaultWorkingDirectory: "C:\\vault",
        workingDirectoryHint: null,
        sourcePathHints: ["\\\\wsl.localhost\\Ubuntu\\home\\tester\\active\\research\\paper\\8"],
      });

      expect(launcher.runtime).toBe("wsl");
      expect(launcher.executablePath).toBe("codex");
      expect(launcher.launcherOverrideParts?.join(" ")).toContain("bash -lc");
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  it("retries with a WSL fallback launcher on Windows sandbox bootstrap failures", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
    const service = createService("/vault");
      const executeSpy = vi
        .fn()
        .mockRejectedValueOnce(new Error("windows sandbox: spawn setup refresh failed"))
        .mockResolvedValueOnce("thread-123");
    Object.assign(service as object, {
      executeCodexStream: executeSpy,
    });

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const runCodexStream = service as unknown as {
      runCodexStream: (request: {
        prompt: string;
        tabId: string;
        threadId: string | null;
        workingDirectory: string;
        runtime: "native" | "wsl";
        executablePath: string;
        sandboxMode: "read-only" | "workspace-write";
        approvalPolicy: "untrusted" | "on-failure" | "never";
        images: string[];
        model: string;
        reasoningEffort: "low" | "medium" | "high" | "xhigh" | null;
        signal: AbortSignal;
        onEvent: (event: unknown) => void;
      }) => Promise<{ threadId: string | null }>;
    };
      await expect(
        runCodexStream.runCodexStream({
        prompt: "Explain the paper deeply.",
        tabId,
        threadId: null,
        workingDirectory: "/vault",
        runtime: "native",
        executablePath: "codex",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        images: [],
        model: "gpt-5.4",
        reasoningEffort: null,
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        }),
      ).resolves.toEqual({
        threadId: "thread-123",
      });

      expect(executeSpy).toHaveBeenCalledTimes(2);
      expect(executeSpy.mock.calls[0]?.[0]).toMatchObject({
        runtime: "native",
        executablePath: "codex",
      });
      expect(executeSpy.mock.calls[1]?.[0]).toMatchObject({
        runtime: "wsl",
        executablePath: "codex",
      });
      expect(executeSpy.mock.calls[1]?.[0]?.launcherOverrideParts?.join(" ")).toContain("bash -lc");
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
    }
  });
});
