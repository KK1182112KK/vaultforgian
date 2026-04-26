import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  CODEX_RUN_STALL_RECOVERY_MS,
} from "../util/codexRunWatchdog";
import {
  CodexRuntimeAdapter,
  getCodexWatchdogStageFromError,
  getThreadIdFromCodexError,
  type CodexRuntimeAdapterRequest,
} from "../app/codexRuntimeAdapter";

type FakeCloseSignal = NodeJS.Signals | null;

class FakeCodexChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;

  kill(): boolean {
    if (this.killed) {
      return true;
    }
    this.killed = true;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", null, "SIGTERM" satisfies FakeCloseSignal);
    return true;
  }

  close(code: number | null, signal: FakeCloseSignal = null): void {
    this.exitCode = code;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }
}

interface SpawnScript {
  stdout?: string[];
  stderr?: string[];
  closeCode?: number | null;
  closeSignal?: FakeCloseSignal;
  stayOpen?: boolean;
}

function createSpawn(scripts: SpawnScript[]) {
  const calls: Array<{
    command: string;
    args: string[];
    options: unknown;
    child: FakeCodexChild;
  }> = [];
  const spawn = vi.fn((command: string, args: string[], options: unknown) => {
    const script = scripts.shift();
    if (!script) {
      throw new Error("No fake spawn script was provided.");
    }
    const child = new FakeCodexChild();
    calls.push({ command, args, options, child });
    queueMicrotask(() => {
      for (const chunk of script.stdout ?? []) {
        child.stdout.write(`${chunk}\n`);
      }
      for (const chunk of script.stderr ?? []) {
        child.stderr.write(chunk);
      }
      if (!script.stayOpen) {
        child.close(script.closeCode ?? 0, script.closeSignal ?? null);
      }
    });
    return child;
  });
  return { spawn, calls };
}

function createAdapter(spawn: ReturnType<typeof createSpawn>["spawn"]) {
  return new CodexRuntimeAdapter({
    getConfiguredCommandText: () => "codex",
    getLocale: () => "en",
    getProcessEnv: () => ({}),
    spawn: spawn as never,
  });
}

function createRequest(overrides: Partial<CodexRuntimeAdapterRequest> = {}): CodexRuntimeAdapterRequest {
  return {
    prompt: "Explain this note.",
    tabId: "tab-1",
    threadId: null,
    workingDirectory: "/vault",
    runtime: "native",
    executablePath: "codex",
    sandboxMode: "read-only",
    approvalPolicy: "never",
    images: [],
    model: "gpt-5.5",
    reasoningEffort: null,
    fastMode: false,
    signal: new AbortController().signal,
    onJsonEvent: vi.fn(),
    onSessionId: vi.fn(),
    onLiveness: vi.fn(),
    onMeaningfulProgress: vi.fn(),
    onWatchdogStageChange: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CodexRuntimeAdapter", () => {
  it("streams JSON events and returns the resolved thread id", async () => {
    const { spawn } = createSpawn([
      {
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
          JSON.stringify({ type: "assistant_message", text: "Ready." }),
        ],
      },
    ]);
    const adapter = createAdapter(spawn);
    const request = createRequest();

    await expect(adapter.run(request)).resolves.toEqual({ threadId: "thread-1" });

    expect(request.onJsonEvent).toHaveBeenCalledTimes(2);
    expect(request.onSessionId).toHaveBeenCalledWith("thread-1");
    expect(request.onLiveness).toHaveBeenCalled();
    expect(request.onMeaningfulProgress).toHaveBeenCalled();
  });

  it("falls back from --json to --experimental-json when the active CLI does not support the first flag", async () => {
    const { spawn, calls } = createSpawn([
      {
        stderr: ["error: unexpected argument '--json' found"],
        closeCode: 2,
      },
      {
        stdout: [JSON.stringify({ type: "thread.started", thread_id: "thread-json-fallback" })],
      },
    ]);
    const adapter = createAdapter(spawn);

    await expect(adapter.run(createRequest())).resolves.toEqual({ threadId: "thread-json-fallback" });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toContain("--json");
    expect(calls[1]?.args).toContain("--experimental-json");
  });

  it("retries with a compatible reasoning effort when Codex rejects the selected effort", async () => {
    const { spawn, calls } = createSpawn([
      {
        stderr: [
          JSON.stringify({
            error: {
              message: "unsupported value for reasoning.effort. supported values are: 'low', 'medium', 'high'",
              param: "reasoning.effort",
            },
          }),
        ],
        closeCode: 1,
      },
      {
        stdout: [JSON.stringify({ type: "thread.started", thread_id: "thread-reasoning-fallback" })],
      },
    ]);
    const adapter = createAdapter(spawn);

    await expect(adapter.run(createRequest({ reasoningEffort: "xhigh" }))).resolves.toEqual({
      threadId: "thread-reasoning-fallback",
    });

    expect(calls[0]?.args).toContain('model_reasoning_effort="xhigh"');
    expect(calls[1]?.args).toContain('model_reasoning_effort="high"');
  });

  it("retries with the safe WSL fallback launcher for Windows sandbox bootstrap failures", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });
    const { spawn, calls } = createSpawn([
      {
        stderr: ["windows sandbox: spawn setup refresh failed"],
        closeCode: 1,
      },
      {
        stdout: [JSON.stringify({ type: "thread.started", thread_id: "thread-wsl-fallback" })],
      },
    ]);
    const adapter = createAdapter(spawn);

    try {
      await expect(adapter.run(createRequest())).resolves.toEqual({ threadId: "thread-wsl-fallback" });
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
    }

    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe("codex");
    expect(calls[1]?.command).toBe("wsl.exe");
    expect(calls[1]?.args.slice(0, 3)).toEqual(["-e", "bash", "-lc"]);
  });

  it("kills the running process when the request aborts", async () => {
    const controller = new AbortController();
    const { spawn, calls } = createSpawn([{ stayOpen: true }]);
    const adapter = createAdapter(spawn);
    const pending = adapter.run(createRequest({ signal: controller.signal }));
    await Promise.resolve();

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0]?.child.killed).toBe(true);
  });

  it("annotates watchdog recovery errors with stage and thread id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { spawn, calls } = createSpawn([
      {
        stayOpen: true,
      },
    ]);
    const adapter = createAdapter(spawn);
    const request = createRequest();
    const pending = adapter.run(request);
    const rejection = pending.catch((error: unknown) => error);
    await Promise.resolve();
    calls[0]?.child.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "thread-stall" })}\n`);
    await Promise.resolve();
    expect(request.onSessionId).toHaveBeenCalledWith("thread-stall");

    await vi.advanceTimersByTimeAsync(CODEX_RUN_STALL_RECOVERY_MS + 1);

    const error = await rejection;
    expect(error).toMatchObject({
      watchdogStage: "stall_recovery",
      codexThreadId: "thread-stall",
    });
    expect(getCodexWatchdogStageFromError(error)).toBe("stall_recovery");
    expect(getThreadIdFromCodexError(error)).toBe("thread-stall");
  });
});
