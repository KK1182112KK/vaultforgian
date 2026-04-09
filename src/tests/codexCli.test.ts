import { describe, expect, it } from "vitest";
import {
  buildCodexSpawnSpec,
  isUnsupportedJsonFlagError,
  renderCodexSpawnSpec,
} from "../util/codexCli";

describe("codex CLI spawn spec", () => {
  it("builds a direct exec invocation", () => {
    const spec = buildCodexSpawnSpec("codex", {
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
      "workspace-write",
      "-C",
      "/vault",
      "--skip-git-repo-check",
      "--config",
      'approval_policy="never"',
      "--config",
      "sandbox_workspace_write.network_access=true",
      "-",
    ]);
  });

  it("builds a WSL direct invocation with converted paths", () => {
    const spec = buildCodexSpawnSpec("wsl.exe -e codex", {
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
      "workspace-write",
      "-C",
      "/mnt/c/Obsidian/My brain sync",
      "--skip-git-repo-check",
      "--config",
      'approval_policy="never"',
      "--config",
      "sandbox_workspace_write.network_access=true",
      "-",
    ]);
  });

  it("builds a WSL bash launcher invocation", () => {
    const spec = buildCodexSpawnSpec("wsl.exe -e bash -lc codex", {
      jsonOutputFlag: "--json",
      model: "gpt-5.1-codex",
      workingDirectory: "C:\\Obsidian\\My brain sync",
      threadId: "thread-123",
      images: ["C:\\Obsidian\\My brain sync\\assets\\diagram.png"],
    });

    expect(spec.command).toBe("wsl.exe");
    expect(spec.args).toHaveLength(4);
    expect(spec.args.slice(0, 3)).toEqual(["-e", "bash", "-lc"]);
    expect(spec.args[3]).toContain("codex 'exec' 'resume' '--json'");
    expect(spec.args[3]).toContain("'-i' '/mnt/c/Obsidian/My brain sync/assets/diagram.png'");
    expect(spec.args[3]).toContain("'thread-123' '-'");
    expect(renderCodexSpawnSpec(spec)).toContain("\"codex 'exec' 'resume' '--json'");
  });

  it("detects unsupported JSON flags", () => {
    expect(isUnsupportedJsonFlagError("error: unexpected argument '--json' found", "--json")).toBe(true);
    expect(isUnsupportedJsonFlagError("everything is fine", "--json")).toBe(false);
  });

  it("adds a reasoning effort override when provided", () => {
    const spec = buildCodexSpawnSpec("codex", {
      jsonOutputFlag: "--json",
      model: "gpt-5.4",
      workingDirectory: "/vault",
      reasoningEffort: "xhigh",
    });

    expect(spec.args).toContain("--config");
    expect(spec.args).toContain('model_reasoning_effort="xhigh"');
  });

  it("respects a read-only sandbox override for new threads", () => {
    const spec = buildCodexSpawnSpec("codex", {
      jsonOutputFlag: "--json",
      model: "gpt-5.4",
      workingDirectory: "/vault",
      sandboxMode: "read-only",
    });

    expect(spec.args).toContain("-s");
    expect(spec.args).toContain("read-only");
  });

  it("passes through a non-default approval policy", () => {
    const spec = buildCodexSpawnSpec("codex", {
      jsonOutputFlag: "--json",
      model: "gpt-5.4",
      workingDirectory: "/vault",
      approvalPolicy: "untrusted",
    });

    expect(spec.args).toContain("--config");
    expect(spec.args).toContain('approval_policy="untrusted"');
  });
});
