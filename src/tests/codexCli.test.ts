import { describe, expect, it } from "vitest";
import {
  buildCodexSpawnSpec,
  isUnsupportedJsonFlagError,
  renderCodexSpawnSpec,
} from "../util/codexCli";

describe("codex CLI spawn spec", () => {
  it("builds a direct exec invocation", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "native",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.1-codex",
      workingDirectory: "/vault",
      images: ["/vault/assets/mock.png"],
    });

    expect(spec.command).toBe("codex");
    expect(spec.cwd).toBe("/vault");
    expect(spec.args).toEqual([
      "exec",
      "--json",
      "-m",
      "gpt-5.1-codex",
      "-i",
      "/vault/assets/mock.png",
      "-s",
      "read-only",
      "-C",
      "/vault",
      "--skip-git-repo-check",
      "--config",
      'approval_policy="never"',
      "--config",
      "sandbox_workspace_write.network_access=true",
      "--config",
      "features.fast_mode=false",
      "-",
    ]);
  });

  it("builds a WSL direct invocation with converted paths", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "wsl",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.1-codex",
      workingDirectory: "C:\\Obsidian\\My brain sync",
      images: ["C:\\Obsidian\\My brain sync\\assets\\diagram.png"],
    });

    expect(spec.command).toBe("wsl.exe");
    expect(spec.cwd).toBeUndefined();
    expect(spec.args).toEqual([
      "-e",
      "codex",
      "exec",
      "--json",
      "-m",
      "gpt-5.1-codex",
      "-i",
      "/mnt/c/Obsidian/My brain sync/assets/diagram.png",
      "-s",
      "read-only",
      "-C",
      "/mnt/c/Obsidian/My brain sync",
      "--skip-git-repo-check",
      "--config",
      'approval_policy="never"',
      "--config",
      "sandbox_workspace_write.network_access=true",
      "--config",
      "features.fast_mode=false",
      "-",
    ]);
  });

  it("builds a WSL invocation from WSL UNC working directories", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "wsl",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.1-codex",
      workingDirectory: "\\\\wsl.localhost\\Ubuntu\\home\\tester\\active\\research\\paper\\8",
    });

    expect(spec.args).toContain("-C");
    expect(spec.args).toContain("/home/tester/active/research/paper/8");
  });

  it("builds a WSL resume invocation without shell launchers", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "wsl",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.1-codex",
      workingDirectory: "C:\\Obsidian\\My brain sync",
      threadId: "thread-123",
      images: ["C:\\Obsidian\\My brain sync\\assets\\diagram.png"],
    });

    expect(spec.command).toBe("wsl.exe");
    expect(spec.args.slice(0, 5)).toEqual(["-e", "codex", "exec", "resume", "--json"]);
    expect(spec.args).toContain("/mnt/c/Obsidian/My brain sync/assets/diagram.png");
    expect(spec.args).toContain("thread-123");
    expect(renderCodexSpawnSpec(spec)).toContain("wsl.exe -e codex exec resume --json");
  });

  it("builds a WSL invocation from fallback launcher parts when provided", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "wsl",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.4",
      workingDirectory: "C:\\Obsidian\\My brain sync",
      launcherOverrideParts: ["wsl.exe", "-e", "bash", "-lc", 'echo "$@"', "__obsidian_codex_fallback__"],
    });

    expect(spec.command).toBe("wsl.exe");
    expect(spec.args.slice(0, 6)).toEqual(["-e", "bash", "-lc", 'echo "$@"', "__obsidian_codex_fallback__", "exec"]);
    expect(spec.args).toContain("/mnt/c/Obsidian/My brain sync");
  });

  it("passes full-auto through resume invocations only for workspace-write sessions", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "native",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.4",
      workingDirectory: "/vault",
      threadId: "thread-123",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    });

    expect(spec.args).toContain("resume");
    expect(spec.args).toContain("--full-auto");
    expect(spec.args).toContain('approval_policy="never"');
  });

  it("detects unsupported JSON flags", () => {
    expect(isUnsupportedJsonFlagError("error: unexpected argument '--json' found", "--json")).toBe(true);
    expect(isUnsupportedJsonFlagError("everything is fine", "--json")).toBe(false);
  });

  it("adds a reasoning effort override when provided", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "native",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.4",
      workingDirectory: "/vault",
      reasoningEffort: "xhigh",
    });

    expect(spec.args).toContain("--config");
    expect(spec.args).toContain('model_reasoning_effort="xhigh"');
  });

  it("adds an explicit fast mode override when enabled", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "native",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.4",
      workingDirectory: "/vault",
      fastMode: true,
    });

    expect(spec.args).toContain("--config");
    expect(spec.args).toContain("features.fast_mode=true");
  });

  it("respects a read-only sandbox override for new threads", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "native",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.4",
      workingDirectory: "/vault",
    });

    expect(spec.args).toContain("-s");
    expect(spec.args).toContain("read-only");
  });

  it("passes through a non-default approval policy", () => {
    const spec = buildCodexSpawnSpec({
      runtime: "native",
      executablePath: "codex",
      jsonOutputFlag: "--json",
      model: "gpt-5.4",
      workingDirectory: "/vault",
      approvalPolicy: "untrusted",
    });

    expect(spec.args).toContain("--config");
    expect(spec.args).toContain('approval_policy="untrusted"');
  });
});
